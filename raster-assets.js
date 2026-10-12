import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const NS = 'http://www.w3.org/2000/svg';
const elements = root => [root, ...Array.from(root.getElementsByTagName('*'))];
const href = el => el.getAttribute('href') || el.getAttribute('xlink:href') || '';
function parse(value) {
  if (typeof value !== 'string' || value.length > 7_000_000 || /<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('SVG 内容无效或过大。');
  const doc = new DOMParser({ onError: (level, message) => { throw new Error(`SVG XML 无效：${message}`); } }).parseFromString(value, 'image/svg+xml');
  if (doc.documentElement.localName !== 'svg') throw new Error('需要完整 SVG。');
  return doc;
}
const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
function transform(value) {
  let m = [1,0,0,1,0,0], rest = value || '';
  while (rest.trim()) {
    const part = /^\s*,?\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/.exec(rest);
    if (!part) throw new Error('局部图片变换无效。');
    const n = part[2].trim().split(/[\s,]+/).map(Number);
    if (!n.length || !n.every(Number.isFinite)) throw new Error('局部图片变换无效。');
    let t;
    if (part[1] === 'matrix' && n.length === 6) t = n;
    if (part[1] === 'translate' && n.length <= 2) t = [1,0,0,1,n[0],n[1] || 0];
    if (part[1] === 'scale' && n.length <= 2) t = [n[0],0,0,n[1] ?? n[0],0,0];
    if (part[1] === 'rotate' && [1,3].includes(n.length)) {
      const a = n[0]*Math.PI/180, c = Math.cos(a), s = Math.sin(a), x = n[1] || 0, y = n[2] || 0;
      t = [c,s,-s,c,x-c*x+s*y,y-s*x-c*y];
    }
    if (/^skew/.test(part[1]) && n.length === 1) t = part[1] === 'skewX' ? [1,0,Math.tan(n[0]*Math.PI/180),1,0,0] : [1,Math.tan(n[0]*Math.PI/180),0,1,0,0];
    if (!t || !t.every(Number.isFinite)) throw new Error('局部图片变换无效。');
    m = multiply(m,t); rest = rest.slice(part[0].length);
  }
  return m;
}

export async function resolveRasterAssets(result, body, sources, generation) {
  let doc;
  if (generation) doc = parse(result.svg);
  else {
    doc = parse(body.svg);
    for (const item of result.replacements) {
      const target = elements(doc.documentElement).find(el => el.getAttribute('id') === item.id);
      const fragment = parse(`<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${item.svg}</svg>`).documentElement;
      const children = Array.from(fragment.childNodes).filter(n => n.nodeType === 1);
      if (!target || children.length !== 1 || children[0].getAttribute('id') !== item.id) throw new Error('替换元素结构无效。');
      target.parentNode.replaceChild(doc.importNode(children[0], true), target);
    }
  }
  const root = doc.documentElement, all = elements(root);
  const old = generation ? [] : elements(parse(body.svg).documentElement);
  const oldImages = new Map(old.filter(el => el.localName === 'image').map(el => [el.getAttribute('id'), href(el)]));
  const assets = result.rasterAssets || [];
  if (!Array.isArray(assets) || assets.length > 30) throw new Error('局部图片数量无效。');
  const ids = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset.elementId !== 'string' || ids.has(asset.elementId) || !asset.purpose?.trim()) throw new Error('局部图片说明无效。');
    ids.add(asset.elementId);
  }
  const newImages = all.filter(el => el.localName === 'image' && (generation || oldImages.get(el.getAttribute('id')) !== href(el) || ids.has(el.getAttribute('id'))));
  if (newImages.length !== assets.length) throw new Error('新增图片必须提供受控裁切说明，不能直接嵌入整图。');
  if (newImages.length && all.some(el => el.localName === 'style')) throw new Error('含局部图片的结果请使用内联 SVG 属性。');
  if (all.some(el => ['feImage','foreignObject','script','animate','animateTransform','set'].includes(el.localName))) throw new Error('SVG 包含不支持的外部图像或动态内容。');
  const box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const area = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? box[2]*box[3] : 0;
  if (generation && (!area || !all.some(el => ['path','rect','circle','ellipse','line','polyline','polygon','text'].includes(el.localName)))) throw new Error('结果没有有效的可编辑矢量主体。');
  let total = 0;
  const sourceTotals = new Map();
  for (const el of newImages) {
    const id = el.getAttribute('id'), asset = assets.find(a => a.elementId === id);
    if (!asset || href(el) !== `asset:${id}` || all.filter(n => n.getAttribute('id') === id).length !== 1) throw new Error('图片占位引用无效。');
    const source = sources.get(asset.sourceId);
    if (!source) throw new Error('局部图片来源不存在。');
    const image = await loadImage(source);
    const c = asset.crop;
    if (!c || !['x','y','width','height'].every(k => Number.isInteger(c[k])) || c.x < 0 || c.y < 0 || c.width < 1 || c.height < 1 || c.x+c.width > image.width || c.y+c.height > image.height) throw new Error('裁切范围超出源图。');
    const sourceFraction = c.width*c.height/(image.width*image.height);
    const sourceTotal = (sourceTotals.get(asset.sourceId) || 0) + sourceFraction;
    if (asset.sourceId === 'source' && (sourceFraction > .2 || sourceTotal > .4)) throw new Error('裁切图片过大：主体结构需要逐个重绘。');
    sourceTotals.set(asset.sourceId, sourceTotal);
    let matrix = [1,0,0,1,0,0];
    const ancestors = [];
    for (let n = el; n?.nodeType === 1; n = n.parentNode) ancestors.unshift(n);
    for (const n of ancestors) {
      if (['defs','pattern','mask','clipPath','symbol'].includes(n.localName) || (n.localName === 'svg' && n !== root) || ['style','filter','mask','clip-path'].some(a => n.hasAttribute(a))) throw new Error('局部图片不能通过蒙版、样式或定义区铺底。');
      matrix = multiply(matrix, transform(n.getAttribute('transform')));
      const nid = n.getAttribute('id');
      if (nid && all.some(a => a.localName === 'use' && href(a) === `#${nid}`)) throw new Error('局部图片不能通过 use 重复铺设。');
    }
    const values = ['x','y','width','height'].map(k => Number(el.getAttribute(k) || (['x','y'].includes(k) ? '0' : 'NaN')));
    const [x,y,w,h] = values;
    if (!values.every(Number.isFinite) || w <= 0 || h <= 0 || area <= 0) throw new Error('局部图片尺寸无效。');
    const points = [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([a,b]) => [matrix[0]*a+matrix[2]*b+matrix[4],matrix[1]*a+matrix[3]*b+matrix[5]]);
    const footprint = (Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])))*(Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1])));
    total += footprint;
    if (!Number.isFinite(total) || footprint > area*.2 || total > area*.4) throw new Error('图片覆盖面积过大，框线、文字和主体图形需要重绘。');
    const canvas = createCanvas(c.width,c.height);
    canvas.getContext('2d').drawImage(image,c.x,c.y,c.width,c.height,0,0,c.width,c.height);
    el.removeAttribute('xlink:href');
    el.setAttribute('href', `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`);
  }
  const serializer = new XMLSerializer();
  const full = serializer.serializeToString(root);
  if (Buffer.byteLength(full) > 5_000_000) throw new Error('生成 SVG 超过 5 MB，请减少局部素材。');
  if (generation) result.svg = full;
  else for (const item of result.replacements) item.svg = serializer.serializeToString(elements(root).find(n => n.getAttribute('id') === item.id));
  return result;
}
