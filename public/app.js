import DOMPurify from '/purify.js';
import { enhanceSelects } from '/motion.js';
import { writeProject, readProject, listProjects, migrateDraft, stageProject, recoverPending } from '/projects.js';
import { reconstructionRules } from '/reconstruction.js';

const $ = (selector) => [...document.querySelectorAll(selector)].find(el => !el.closest('#artboard > svg'));
const NS = 'http://www.w3.org/2000/svg';
const graphicTags = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use', 'svg']);
const icons = {
  cursor: '<path d="m5 3 13 8-6 1-3 6Z"/><path d="m12 12 4 7"/>',
  region: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v6c0 5-3 7-7 7-3 0-5-2-7-5l-3-4c-1-2 1-3 3-1l2 2Z"/>',
  undo: '<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12" transform="translate(0 -3)"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12" transform="translate(0 -3)"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  file: '<path d="M5 3h9l5 5v13H5Zm9 0v6h5"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  artboard: '<rect x="5" y="5" width="14" height="14"/><path d="M5 2v20M19 2v20M2 5h20M2 19h20"/>',
  ungroup: '<rect x="3" y="3" width="10" height="10"/><rect x="11" y="11" width="10" height="10"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
document.querySelectorAll('[data-icon]').forEach(el => {
  const icon = document.createElementNS(NS, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.5');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = icons[el.dataset.icon] || '';
  el.prepend(icon);
});

const viewport = $('#viewport');
const artboard = $('#artboard');
let svg, filename = 'method-overview.svg', selected = [], collapsed = new Set();
let mode = 'select', scale = 1, pan = { x: 0, y: 0 }, region = null;
let undoStack = [], redoStack = [], pending = null, request = null, cliToken = '', cliAvailable = false;
let gesture = null, spaceDown = false, toastTimer;
let fileBinding = null, lastDiskSvg = '', fileBusy = false, fileMode = 'new', defaultDirectory = '', folderView = null;
let models = [], availableEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
let syncSelects = () => {};
let pngSource = null, workflowTimer = null;
let attachments = [];
let annotations = [];
let currentProject = null, pendingSave = Promise.resolve();
const unprotectedSaves = new Map();
let latestSaveId = null;
window.addEventListener('beforeunload', event => { if (unprotectedSaves.size) { event.preventDefault(); event.returnValue = ''; } });
const projectSessions = new Map();
let thumbnailUrls = [];
$('#reconstruction-text').textContent = reconstructionRules;
function rememberSession() {
  if (currentProject) projectSessions.set(currentProject, { attachments, pngSource, prompt: $('#ai-prompt').value });
}
function showEditor() {
  $('#welcome').hidden = true; $('#studio').hidden = false; document.body.classList.remove('at-home');
}
async function renderProjects() {
  const projects = await listProjects();
  thumbnailUrls.forEach(url => URL.revokeObjectURL(url)); thumbnailUrls = [];
  $('#recent-projects').replaceChildren(); $('#recent-empty').hidden = Boolean(projects.length);
  $('#project-count').textContent = `${projects.length} 个本机项目`;
  for (const [index, project] of projects.entries()) {
    const button = document.createElement('button'); button.className = 'project-card'; button.style.animationDelay = `${Math.min(index*55,350)}ms`;
    const preview = document.createElement('div'); preview.className = 'project-thumbnail';
    try {
      const clean = new XMLSerializer().serializeToString(sanitize(project.svg));
      const url = URL.createObjectURL(new Blob([clean], { type: 'image/svg+xml' })); thumbnailUrls.push(url);
      const image = new Image(); image.src = url; image.alt = `${project.filename} 缩略图`; preview.append(image);
    } catch { preview.textContent = '◇'; }
    const caption = document.createElement('div'); caption.className = 'project-caption';
    const info = document.createElement('div'), name = document.createElement('strong'), time = document.createElement('small'), arrow = document.createElement('span');
    name.textContent = project.filename; time.textContent = new Date(project.updatedAt).toLocaleString('zh-CN', { month:'short',day:'numeric',hour:'2-digit',minute:'2-digit' }); arrow.textContent = '↗';
    info.append(name,time); caption.append(info,arrow); button.append(preview,caption);
    button.onclick = async () => {
      if (locked()) return;
      try {
        await pendingSave;
        const saved = await readProject(project.id);
        if (!saved) throw new Error('项目不存在。');
        rememberSession();
        // Parse before changing active project so corrupt history cannot replace the current work.
        sanitize(saved.svg);
        currentProject = saved.id; load(saved.svg,saved.filename,true);
        fileBinding = saved.fileBinding || null; lastDiskSvg = saved.lastDiskSvg || '';
        annotations = Array.isArray(saved.annotations) ? saved.annotations.filter(note => note && Array.isArray(note.ids) && note.ids.every(id => typeof id === 'string') && typeof note.prompt === 'string' && typeof note.label === 'string').slice(0,50) : [];
        const session = projectSessions.get(currentProject);
        attachments = session?.attachments || []; pngSource = session?.pngSource || null;
        $('#ai-prompt').value = session?.prompt || '';
        if (pngSource) { $('#png-preview').src = pngSource.data; $('#png-name').textContent = pngSource.name; }
        renderAttachments(); save(); refresh(); fit();
      } catch (error) { toast(error.message,true); }
    };
    $('#recent-projects').append(button);
  }
}
async function goHome() {
  if (locked()) return toast('请先完成或取消当前操作。');
  rememberSession();
  if (svg) save();
  try { await pendingSave; } catch { return toast('项目未保存成功，请先导出画布。',true); }
  $('#studio').hidden = true; $('#welcome').hidden = false; document.body.classList.add('at-home');
  try { await renderProjects(); } catch (error) { toast(error.message,true); }
}
$('#go-home').onclick = goHome;
$('#studio .brand').onclick = event => { event.preventDefault(); goHome(); };
$('#welcome .brand').onclick = event => { event.preventDefault(); };
function chooseCreation() { if (!locked()) $('#create-dialog').showModal(); }
$('#create-close').onclick = () => $('#create-dialog').close();
for (const id of ['welcome-png','create-png']) $(`#${id}`).onclick = () => { $('#create-dialog').close(); $('#png-input').click(); };
for (const id of ['welcome-blank','create-blank']) $(`#${id}`).onclick = () => { $('#create-dialog').close(); openFileDialog('new'); };
$('#welcome-open').onclick = () => $('#file-input').click();
document.addEventListener('visibilitychange', () => document.body.classList.toggle('page-hidden',document.hidden));


function toast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200);
}

// Imported SVG styles stay inside the document. External resources and active content are removed.
function sanitize(source) {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('文件不是有效的 SVG，请检查 XML 格式。');
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set', 'a'],
  });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const result = doc.documentElement;
  if (result.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('SVG 清理后无效。');
  result.setAttribute('xmlns', NS);
  result.setAttribute('data-figura-root', 'true');
  for (const el of [result, ...result.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.localName.toLowerCase();
      const unsafeUrl = [...attr.value.matchAll(/url\(([^)]*)\)/gi)].some(match => !/^["']?#[\w:.-]+["']?$/.test(match[1].trim()));
      if ((name === 'href' && !/^#/.test(attr.value) && !(el.localName === 'image' && /^data:image\/(png|jpeg|webp);base64,/i.test(attr.value))) || unsafeUrl) el.removeAttributeNode(attr);
      if (name === 'style') {
        for (const prop of [...el.style]) {
          if (/url\(/i.test(el.style.getPropertyValue(prop)) && !/^url\(["']?#[\w:.-]+["']?\)$/i.test(el.style.getPropertyValue(prop).trim())) el.style.removeProperty(prop);
        }
      }
    }
  }
  for (const style of result.querySelectorAll('style')) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style.textContent);
    const safeRules = [];
    for (const rule of sheet.cssRules) {
      if (rule.type !== CSSRule.STYLE_RULE) continue;
      for (const property of [...rule.style]) {
        if (/url\(/i.test(rule.style.getPropertyValue(property)) && !/^url\(["']?#[\w:.-]+["']?\)$/i.test(rule.style.getPropertyValue(property).trim())) rule.style.removeProperty(property);
      }
      // Scope every selector, including comma-separated selectors, to the imported SVG.
      const selectors = rule.selectorText.split(',').map(selector => {
        const trimmed = selector.trim().replace(/^:where\(svg\[data-figura-root\]\)\s*/, '');
        return `:where(svg[data-figura-root]) ${trimmed}`;
      });
      safeRules.push(`${selectors.join(',')} {${rule.style.cssText}}`);
    }
    style.textContent = safeRules.join('\n');
  }
  const ids = new Set();
  for (const el of [result, ...result.querySelectorAll('*')]) {
    if (el.id && ids.has(el.id)) throw new Error(`SVG 存在重复 ID：${el.id}。请先修复后导入。`);
    if (el.id) ids.add(el.id);
  }
  let next = 1;
  for (const el of result.querySelectorAll('*')) {
    if (graphicTags.has(el.localName) && !el.id && !el.closest('defs,clipPath,mask,marker,pattern,symbol')) {
      while (ids.has(`figura-${next}`)) next++;
      el.id = `figura-${next++}`;
      ids.add(el.id);
    }
  }
  let view = result.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!view || view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) {
    const w = parseFloat(result.getAttribute('width')) || 1000;
    const h = parseFloat(result.getAttribute('height')) || 640;
    if (w <= 0 || h <= 0 || w > 100000 || h > 100000) throw new Error('画布尺寸无效。');
    result.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  return document.importNode(result, true);
}

function serialized() { return svg ? new XMLSerializer().serializeToString(svg) : ''; }
function viewBox() { return svg.viewBox.baseVal; }
function nodes() { return [...svg.querySelectorAll('[id]')].filter(el => graphicTags.has(el.localName) && !el.closest('defs,clipPath,mask,marker,pattern,symbol')); }
function byId(id) { return [...svg.querySelectorAll('[id]')].find(el => el.id === id); }
function roots(elements) { return elements.filter(el => !elements.some(parent => parent !== el && parent.contains(el))); }
function selection() { return roots(selected.map(byId).filter(Boolean)); }
function locked() { return Boolean(request || pending || fileBusy); }
function save() {
  if (!svg || !currentProject) return;
  $('#filename').title = fileBinding?.path || filename;
  const record = { id: currentProject, saveId: crypto.randomUUID(), svg: serialized(), filename, fileBinding, lastDiskSvg, annotations: structuredClone(annotations), updatedAt: Date.now() };
  latestSaveId = record.saveId;
  if (!stageProject(record)) unprotectedSaves.set(record.id,record.saveId);
  else unprotectedSaves.delete(record.id);
  $('#save-state').textContent = '正在保存项目…';
  pendingSave = pendingSave.catch(() => {}).then(() => writeProject(record));
  pendingSave.then(() => {
    if (unprotectedSaves.get(record.id) === record.saveId) unprotectedSaves.delete(record.id);
    if (currentProject === record.id && latestSaveId === record.saveId) $('#save-state').textContent = fileBinding ? (serialized() === lastDiskSvg ? '已保存到文件' : '待保存到文件') : '项目已自动保存';
  }).catch(() => { if (latestSaveId === record.saveId) $('#save-state').textContent = '项目保存失败，请导出'; });
}

function snapshot() { return serialized(); }
function commit(before) {
  if (before === serialized()) return;
  undoStack.push(before);
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  save(); refresh();
}
function mount(element) {
  svg = element;
  artboard.replaceChildren(svg);
  const box = viewBox();
  artboard.style.width = `${box.width}px`;
  artboard.style.height = `${box.height}px`;
  $('#canvas-width').value = Math.round(box.width);
  $('#canvas-height').value = Math.round(box.height);
  $('#artboard-size').textContent = `${Math.round(box.width)} × ${Math.round(box.height)}`;
  paintView();
}
function load(source, name, restore = false) {
  if (locked()) return toast('请先结束当前 AI 修改。');
  const element = sanitize(source);
  if (!restore) { rememberSession(); currentProject = crypto.randomUUID(); }
  attachments = []; renderAttachments();
  $('#ai-prompt').value = ''; $('#ai-feedback').hidden = true; $('#ai-workflow').hidden = true;
  artboard.classList.remove('vectors-only'); $('#vectors-only').setAttribute('aria-pressed','false');
  showEditor();
  annotations = [];
  pngSource = null;
  mount(element);
  filename = name;
  fileBinding = null; lastDiskSvg = serialized();
  selected = []; region = null; undoStack = []; redoStack = [];
  collapsed = new Set(nodes().filter(el => el.localName === 'g').map(el => el.id));
  $('#filename').textContent = filename;
  $('#tree-filename').textContent = filename.replace(/\.svg$/i, '');
  fit(); refresh();
  if (!restore) save();
}
function fit() {
  if (!svg) return;
  const box = viewBox();
  scale = Math.min((viewport.clientWidth - 80) / box.width, (viewport.clientHeight - 130) / box.height, 1.3);
  scale = Math.max(.05, scale);
  pan = { x: (viewport.clientWidth - box.width * scale) / 2, y: Math.max(36, (viewport.clientHeight - 60 - box.height * scale) / 2) };
  paintView();
}
function paintView() {
  artboard.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${scale})`;
  $('#zoom-value').textContent = `${Math.round(scale * 100)}%`;
  const caption = $('.canvas-caption');
  caption.style.left = `${pan.x}px`; caption.style.top = `${pan.y - 23}px`;
  caption.style.width = `${(svg ? viewBox().width : 1000) * scale}px`;
  drawSelection();
}
function zoom(value, center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
  const next = Math.max(.05, Math.min(5, value));
  pan.x = center.x - (center.x - pan.x) * next / scale;
  pan.y = center.y - (center.y - pan.y) * next / scale;
  scale = next; paintView();
}
function drawSelection() {
  const overlay = $('#selection-overlay');
  overlay.replaceChildren();
  const bounds = viewport.getBoundingClientRect();
  selection().forEach(el => {
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const marker = document.createElement('div');
    marker.className = 'selection-box';
    Object.assign(marker.style, { left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    overlay.append(marker);
  });
  drawAnnotations();
}
function annotationMissing(note) { return note.ids.some(id => !byId(id)); }
function focusAnnotation(note) {
  if (locked()) return;
  if (annotationMissing(note)) return toast('这条修改的原元素已不存在，请删除条目后重新标记。', true);
  setSelection(note.ids.map(byId));
  region = note.region || null;
  refreshProperties();
  $('#ai-prompt').focus();
}
function drawAnnotations() {
  const overlay = $('#annotation-overlay');
  overlay.replaceChildren();
  if (pngSource || !svg) return;
  const viewportBounds = viewport.getBoundingClientRect(), placed = [];
  annotations.forEach((note, index) => {
    if (annotationMissing(note)) return;
    const bounds = note.ids.map(byId).map(el => el.getBoundingClientRect()).filter(rect => rect.width || rect.height);
    if (!bounds.length) return;
    let x = Math.max(...bounds.map(rect => rect.right)) - viewportBounds.left;
    let y = Math.min(...bounds.map(rect => rect.top)) - viewportBounds.top;
    if (x < 0 || x > viewport.clientWidth || y < 0 || y > viewport.clientHeight) return;
    x = Math.min(viewport.clientWidth - 18, Math.max(18, x));
    y = Math.min(viewport.clientHeight - 18, Math.max(18, y));
    while (placed.some(point => Math.hypot(point.x - x, point.y - y) < 32)) {
      y += 34;
      if (y > viewport.clientHeight - 18) { y = 18; x -= 34; }
    }
    placed.push({ x, y });
    const pin = document.createElement('button');
    pin.type = 'button'; pin.className = 'annotation-pin'; pin.textContent = index + 1;
    pin.setAttribute('aria-label', `修改 ${index + 1}：${note.prompt}`); pin.title = note.prompt;
    pin.style.left = `${x}px`; pin.style.top = `${y}px`; pin.disabled = locked();
    pin.onclick = () => focusAnnotation(note);
    overlay.append(pin);
  });
}
function renderAnnotations() {
  const list = $('#annotation-list');
  list.replaceChildren(); list.hidden = !annotations.length || Boolean(pngSource);
  $('#annotation-count').textContent = `${annotations.length} 条修改`;
  annotations.forEach((note, index) => {
    const row = document.createElement('li'); row.className = 'annotation-row';
    const missing = annotationMissing(note);
    row.classList.toggle('missing', missing);
    const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'annotation-locate';
    locate.setAttribute('aria-label', `定位修改 ${index + 1}`); locate.disabled = locked() || missing;
    const number = document.createElement('span'); number.className = 'annotation-number'; number.textContent = index + 1;
    const content = document.createElement('span'); content.className = 'annotation-content';
    const target = document.createElement('small'); target.textContent = missing ? '原元素已不存在，请删除后重新标记' : note.label;
    const prompt = document.createElement('span'); prompt.textContent = note.prompt;
    content.append(target, prompt); locate.append(number, content); locate.onclick = () => focusAnnotation(note);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'annotation-remove';
    remove.textContent = '×'; remove.setAttribute('aria-label', `删除修改 ${index + 1}`); remove.disabled = locked();
    remove.onclick = () => { if (locked()) return; annotations = annotations.filter(item => item !== note); save(); refresh(); };
    row.append(locate, remove); list.append(row);
  });
}
function addAnnotation() {
  if (locked() || pngSource) return;
  const prompt = $('#ai-prompt').value.trim(), elements = selection();
  if (!elements.length) return feedback('请先在画布或图层中选择要修改的地方。');
  if (!prompt) return $('#ai-prompt').focus();
  if (prompt.length > 8000) return feedback('单条修改意见不能超过 8000 字。', true);
  if (annotations.length >= 50) return feedback('每批最多添加 50 处修改，请先生成当前批次。', true);
  annotations.push({ ids: elements.map(el => el.id), prompt, region: region ? { ...region } : null,
    label: elements.length === 1 ? label(elements[0]) : `${elements.length} 个元素${region ? ' · 框选区域' : ''}` });
  $('#ai-prompt').value = ''; selected = []; region = null;
  $('#ai-feedback').hidden = true; $('#ai-workflow').hidden = true;
  save(); refresh();
}
$('#add-annotation').onclick = addAnnotation;
$('#ai-prompt').addEventListener('input', () => {
  $('#add-annotation').disabled = locked() || Boolean(pngSource) || !selected.length || !$('#ai-prompt').value.trim();
});
function setSelection(elements, append = false) {
  if (pngSource || locked()) return;
  const next = append ? [...selected.map(byId).filter(Boolean)] : [];
  for (const el of elements) { const i = next.indexOf(el); if (append && i !== -1) next.splice(i, 1); else next.push(el); }
  selected = roots(next).map(el => el.id);
  for (const el of roots(next)) {
    for (let parent = el.parentElement; parent && parent !== svg; parent = parent.parentElement) collapsed.delete(parent.id);
  }
  if (!append) region = null;
  $('#ai-feedback').hidden = true; $('#ai-workflow').hidden = true;
  refresh();
}
function label(el) { return el.getAttribute('aria-label') || (el.localName === 'text' ? el.textContent.slice(0, 36) : el.id); }
function renderTree(animateGroup = null) {
  const tree = $('#layer-tree');
  tree.replaceChildren();
  const query = $('#layer-search').value.toLowerCase();
  const all = nodes();
  const nodeSet = new Set(all);
  function visit(parent, depth) {
    [...parent.children].forEach(el => {
      if (!nodeSet.has(el)) return;
      const children = [...el.children].some(child => nodeSet.has(child));
      const match = !query || label(el).toLowerCase().includes(query) || el.localName.includes(query);
      if (!match && ![...el.querySelectorAll('[id]')].some(child => label(child).toLowerCase().includes(query))) return;
      const row = document.createElement('div');
      row.className = `layer-row${selected.includes(el.id) ? ' selected' : ''}${el.style.display === 'none' ? ' is-hidden' : ''}`;
      row.dataset.nodeId = el.id;
      row.style.paddingLeft = `${depth * 12 + 2}px`;
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-selected', String(selected.includes(el.id))); row.tabIndex = 0;
      row.title = `${label(el)} · <${el.localName}>`;
      const disclosure = document.createElement('button'); disclosure.className = 'disclosure';
      disclosure.textContent = children ? (collapsed.has(el.id) && !query ? '›' : '⌄') : '';
      disclosure.setAttribute('aria-label', `展开 ${label(el)}`);
      disclosure.onclick = event => { event.stopPropagation(); if (children) { collapsed.has(el.id) ? collapsed.delete(el.id) : collapsed.add(el.id); renderTree(collapsed.has(el.id) ? null : el); } };
      if (children) row.setAttribute('aria-expanded', String(!collapsed.has(el.id)));
      const symbol = document.createElement('span'); symbol.className = 'tree-symbol';
      symbol.textContent = ({ g: '▱', text: 'T', path: '⌁', rect: '□', circle: '○', image: '▧' })[el.localName] || '◇';
      const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = label(el);
      const visibility = document.createElement('button'); visibility.className = 'visibility'; visibility.textContent = el.style.display === 'none' ? '◌' : '◉'; visibility.title = '显示 / 隐藏'; visibility.setAttribute('aria-label', `显示或隐藏 ${label(el)}`);
      visibility.onclick = event => { event.stopPropagation(); if (locked()) return; const before = snapshot(); el.style.display = el.style.display === 'none' ? '' : 'none'; commit(before); };
      row.append(disclosure, symbol, name, visibility);
      row.onclick = event => setSelection([el], event.shiftKey);
      row.onkeydown = event => { if (event.key === 'Enter') setSelection([el], event.shiftKey); };
      tree.append(row);
      if (children && (!collapsed.has(el.id) || query)) visit(el, depth + 1);
    });
  }
  visit(svg, 0);
  $('#layer-count').textContent = all.length;
  $('#element-total').textContent = all.length;
  if (animateGroup instanceof SVGElement) {
    [...tree.children].filter(row => { const child = byId(row.dataset.nodeId); return child !== animateGroup && animateGroup.contains(child); }).forEach((row, index) => {
      row.animate([{ opacity: 0, translate: '-5px 0' }, { opacity: 1, translate: '0 0' }], { duration: 220, delay: Math.min(index * 18, 90), easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
    });
  }
}
function colorHex(value) {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  const parts = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return parts ? `#${parts.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : null;
}
function refreshProperties() {
  const elements = selection(), first = elements[0];
  $('#document-properties').hidden = Boolean(first);
  $('#element-properties').hidden = !first;
  $('#ai-panel').hidden = false;
  $('#png-source').hidden = !pngSource;
  const showPng = Boolean(pngSource && (!pending || pending.showingBefore));
  $('#png-preview').hidden = !showPng;
  viewport.classList.toggle('reference-mode', showPng);
  $('#remove-png').disabled = locked();
  $('#empty-hint').hidden = Boolean(first || pngSource);
  $('#selection-status').textContent = first ? `已选择 ${elements.length} 个元素` : '未选择元素';
  $('#ai-selection').textContent = region ? `区域 · ${elements.length} 个元素` : elements.length === 1 ? `<${first?.localName}> ${label(first).slice(0, 24)}` : `${elements.length} 个元素`;
  $('#ai-scope').textContent = region ? '仅修改框选元素' : '仅修改选中元素';
  $('#annotation-hint').textContent = pngSource ? 'PNG 转换后可逐处添加修改意见' : first ? `第 ${annotations.length + 1} 处 · ${elements.length === 1 ? label(first) : `已选择 ${elements.length} 个元素`}` : annotations.length ? '继续选择下一处，或统一生成修改' : '选中或框选一处，输入意见后添加修改';
  if (!first) return;
  $('#selected-type').textContent = elements.length === 1 ? ({ g: '编组', text: '文字', path: '路径', rect: '矩形', circle: '圆形' })[first.localName] || '元素' : '多个元素';
  $('#selected-tag').textContent = elements.length === 1 ? first.localName.toUpperCase() : `${elements.length} ITEMS`;
  $('#selected-name').textContent = elements.length === 1 ? first.id : '修改将应用到所有选中元素';
  const bounds = first.getBBox();
  $('#element-width').value = Math.round(bounds.width * 10) / 10;
  $('#element-height').value = Math.round(bounds.height * 10) / 10;
  const styles = elements.map(el => getComputedStyle(el));
  for (const type of ['fill', 'stroke']) {
    const value = styles[0][type];
    const mixed = styles.some(style => style[type] !== value);
    $(`#${type}-value`).value = mixed ? '' : colorHex(value) || value;
    $(`#${type}-value`).placeholder = mixed ? '混合颜色' : 'none';
    $(`#${type}-picker`).value = colorHex(value) || '#000000';
  }
  $('#fill-mixed').textContent = first.localName === 'g' ? '应用到组内图形' : '';
  $('#stroke-width').value = parseFloat(styles[0].strokeWidth) || 0;
  $('#opacity').value = Math.round(Number(styles[0].opacity) * 100);
  const isText = elements.length === 1 && first.localName === 'text';
  $('#text-properties').hidden = !isText;
  if (isText) { $('#text-content').value = first.textContent; $('#font-size').value = parseFloat(styles[0].fontSize); $('#font-family').value = styles[0].fontFamily.split(',')[0].replace(/["']/g, ''); }
  $('#ungroup').disabled = elements.some(el => el.localName !== 'g');
  $('#element-properties').querySelectorAll('input,textarea,select,button').forEach(el => { if (el.id !== 'ungroup') el.disabled = locked(); });
  if (locked()) $('#ungroup').disabled = true;
}
function refresh() {
  if (!svg) { syncSelects(); return; }
  selected = selected.filter(id => byId(id));
  renderTree(); refreshProperties(); renderAnnotations(); drawSelection();
  $('#undo').disabled = !undoStack.length || locked(); $('#redo').disabled = !redoStack.length || locked();
  $('#ai-submit').disabled = !cliAvailable || (!selected.length && !pngSource && !annotations.length) || locked();
  $('#ai-submit').title = annotations.length && !pngSource ? `统一生成 ${annotations.length} 条修改 (Ctrl+Enter)` : '生成修改 (Ctrl+Enter)';
  $('#add-annotation').hidden = Boolean(pngSource);
  $('#add-annotation').disabled = locked() || Boolean(pngSource) || !selected.length || !$('#ai-prompt').value.trim();
  for (const id of ['ai-model', 'ai-custom-model', 'ai-effort', 'new-file', 'save-file', 'save-as', 'import']) $(`#${id}`).disabled = locked();
  $('#add-file').disabled = locked();
  $('#context-list').querySelectorAll('input,button').forEach(el => { el.disabled = locked(); });
  $('#reconstruction-rules').hidden = !pngSource && !attachments.some(file => file.redraw);
  $('#create-generate').disabled = locked() || !cliAvailable;
  $('#go-home').disabled = locked();
  syncSelects();
}
function editProperty(property, value, cascade = false) {
  if (locked()) return;
  const before = snapshot();
  selection().forEach(el => {
    const targets = cascade && el.localName === 'g' ? [el, ...el.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,text,use,g')] : [el];
    targets.forEach(target => target.style.setProperty(property, value, 'important'));
  });
  commit(before);
}
function setMode(next) {
  mode = next; viewport.dataset.mode = next;
  document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === next));
  $('#tool-hint').textContent = ({ select: '选择工具 · Shift + 点击多选，拖动元素移动', region: '框选工具 · 拖动选择完全包含的元素', hand: '移动画布 · 拖动平移，滚轮缩放' })[next];
}
function localPoint(event) { const rect = viewport.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
function svgPoint(x, y) { return new DOMPoint(x, y).matrixTransform(svg.getScreenCTM().inverse()); }

viewport.addEventListener('pointerdown', event => {
  if (event.target.closest('.ai-panel,.zoom-controls,.annotation-pin') || event.button !== 0 || locked()) return;
  const start = localPoint(event);
  if (mode === 'hand' || spaceDown) gesture = { type: 'pan', start, pan: { ...pan } };
  else if (mode === 'region') {
    gesture = { type: 'region', start, clientStart: { x: event.clientX, y: event.clientY }, append: event.shiftKey };
    Object.assign($('#marquee').style, { left: `${start.x}px`, top: `${start.y}px`, width: '0', height: '0' }); $('#marquee').hidden = false;
  } else {
    let target = event.target;
    while (target && target !== svg && (!target.id || !graphicTags.has(target.localName))) target = target.parentElement;
    if (target && target !== svg && svg.contains(target)) {
      if (event.shiftKey || !selected.includes(target.id)) setSelection([target], event.shiftKey);
      if (!event.shiftKey) gesture = { type: 'move', start, before: snapshot(), items: selection().map(el => ({ el, transform: el.getAttribute('transform') || '', inverse: el.parentNode.getScreenCTM().inverse() })) };
    } else setSelection([]);
  }
  if (gesture) { viewport.setPointerCapture(event.pointerId); event.preventDefault(); }
});
viewport.addEventListener('pointermove', event => {
  if (!gesture) return;
  const point = localPoint(event), dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
  if (gesture.type === 'pan') { pan = { x: gesture.pan.x + dx, y: gesture.pan.y + dy }; paintView(); }
  if (gesture.type === 'region') Object.assign($('#marquee').style, { left: `${Math.min(point.x, gesture.start.x)}px`, top: `${Math.min(point.y, gesture.start.y)}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` });
  if (gesture.type === 'move' && Math.hypot(dx, dy) > 2) {
    gesture.moved = true;
    gesture.items.forEach(({ el, transform, inverse }) => {
      const a = new DOMPoint(0, 0).matrixTransform(inverse), b = new DOMPoint(dx, dy).matrixTransform(inverse);
      el.setAttribute('transform', `translate(${b.x - a.x} ${b.y - a.y}) ${transform}`);
    });
    drawSelection();
  }
});
viewport.addEventListener('pointerup', event => {
  if (!gesture) return;
  if (gesture.type === 'region') {
    const x = Math.min(gesture.clientStart.x, event.clientX), y = Math.min(gesture.clientStart.y, event.clientY);
    const right = Math.max(gesture.clientStart.x, event.clientX), bottom = Math.max(gesture.clientStart.y, event.clientY);
    const elements = nodes().filter(el => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && (r.width || r.height) && r.left >= x && r.top >= y && r.right <= right && r.bottom <= bottom; });
    const a = svgPoint(x, y), b = svgPoint(right, bottom);
    setSelection(roots(elements), gesture.append);
    region = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    $('#marquee').hidden = true; refreshProperties();
    if (!elements.length) toast('区域内没有完整元素，请扩大框选范围。');
  }
  if (gesture.type === 'move' && gesture.moved) commit(gesture.before);
  gesture = null;
});
viewport.addEventListener('pointercancel', () => { if (gesture?.type === 'move' && gesture.moved) { mount(sanitize(gesture.before)); refresh(); } gesture = null; $('#marquee').hidden = true; });
viewport.addEventListener('wheel', event => {
  if (event.target.closest('.ai-panel')) return;
  event.preventDefault(); zoom(scale * Math.exp(-event.deltaY * .0015), localPoint(event));
}, { passive: false });

function undo(redo = false) {
  if (locked()) return;
  const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
  if (!from.length) return;
  to.push(snapshot()); mount(sanitize(from.pop())); save(); refresh();
}
function download(source, name) {
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportSelection() {
  if (!selected.length) return;
  // Keep original ancestor transforms and all definitions; remove unrelated graphics.
  const clone = svg.cloneNode(true);
  const originals = nodes();
  const chosen = selection();
  const keep = new Set(originals.filter(el => chosen.some(root => root === el || root.contains(el) || el.contains(root))).map(el => el.id));
  for (const el of [...clone.querySelectorAll('[id]')]) {
    if (graphicTags.has(el.localName) && !el.closest('defs,clipPath,mask,marker,pattern,symbol') && !keep.has(el.id)) el.remove();
  }
  const bounds = chosen.map(el => el.getBoundingClientRect());
  const a = svgPoint(Math.min(...bounds.map(b => b.left)), Math.min(...bounds.map(b => b.top)));
  const b = svgPoint(Math.max(...bounds.map(b => b.right)), Math.max(...bounds.map(b => b.bottom)));
  const margin = 8;
  clone.setAttribute('viewBox', `${a.x - margin} ${a.y - margin} ${Math.max(1, b.x - a.x) + margin * 2} ${Math.max(1, b.y - a.y) + margin * 2}`);
  clone.setAttribute('width', Math.max(1, b.x - a.x) + margin * 2); clone.setAttribute('height', Math.max(1, b.y - a.y) + margin * 2);
  download(new XMLSerializer().serializeToString(clone), filename.replace(/\.svg$/i, '-selection.svg'));
  toast('已导出独立 SVG 选区，保留图层和矢量结构。');
}

async function importFile(file) {
  if (!file || locked()) return;
  if (file.size > 5_000_000) return toast('请选择小于 5 MB 的 SVG 文件。',true);
  try { load(await file.text(),file.name); toast('SVG 已作为独立项目打开。'); }
  catch (error) { toast(error.message,true); }
}
function renderAttachments() {
  $('#context-list').replaceChildren(); $('#context-note').hidden = !attachments.length;
  for (const file of attachments) {
    const row = document.createElement('div'); row.className = 'context-chip'; row.dataset.state = file.status || 'added';
    const badge = document.createElement('span'); badge.className = 'context-type'; badge.textContent = file.name.split('.').pop().slice(0,6).toUpperCase();
    const info = document.createElement('span'); info.className = 'context-file-info';
    const name = document.createElement('span'); name.className = 'context-file-name'; name.textContent = file.name; name.title = file.name;
    const state = document.createElement('span'); state.className = 'context-file-state'; state.textContent = file.message || '已添加 · 发送时读取'; state.title = state.textContent;
    info.append(name,state); row.append(badge,info);
    if (/\.pdf$/i.test(file.name)) {
      const pages = document.createElement('input'); pages.className = 'context-pages'; pages.placeholder = '全部页 / 1-3,5'; pages.value = file.pages || ''; pages.maxLength = 200; pages.setAttribute('aria-label',`${file.name} 参考页码`);
      pages.oninput = () => { file.pages = pages.value; file.status = 'added'; file.message = '页码已更新 · 发送时读取'; state.textContent = file.message; };
      row.append(pages);
    }
    if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
      const label = document.createElement('label'); label.className = 'redraw-option';
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = file.redraw; toggle.setAttribute('aria-label',`${file.name} 按可编辑 SVG 重绘`);
      toggle.onchange = () => { file.redraw = toggle.checked; refresh(); }; label.append(toggle,document.createTextNode('按可编辑 SVG 重绘')); row.append(label);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'context-remove'; remove.textContent = '×'; remove.setAttribute('aria-label',`移除 ${file.name}`);
    remove.onclick = () => { if (!locked()) { attachments = attachments.filter(item => item !== file); renderAttachments(); refresh(); } }; row.append(remove);
    $('#context-list').append(row);
  }
}
async function addFiles(files) {
  if (locked() || !files.length) return;
  fileBusy = true; refresh();
  try {
    if (attachments.length+files.length > 10) throw new Error('最多添加 10 个文件。');
    if (attachments.reduce((sum,file) => sum+file.size,0)+files.reduce((sum,file) => sum+file.size,0) > 20_000_000) throw new Error('文件合计不能超过 20 MB。');
    const added = [];
    for (const file of files) {
      if (file.size > 10_000_000 || file.name.length > 200) throw new Error('单个文件最多 10 MB，文件名最多 200 字。');
      if (/\.pdf$/i.test(file.name) && await file.slice(0,5).text() !== '%PDF-') throw new Error(`${file.name} 不是有效的 PDF。`);
      const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('文件读取失败。')); reader.readAsDataURL(file); });
      added.push({ id: crypto.randomUUID(), name:file.name, size:file.size, type:file.type, data, pages:'', redraw:false, status:'added' });
    }
    attachments.push(...added); renderAttachments();
    toast(added.some(file => /\.(png|jpe?g|webp)$/i.test(file.name)) ? '图片已添加。需要重绘时，可开启图片旁的“按可编辑 SVG 重绘”。' : '文件已添加，发送时读取。');
  } catch (error) { toast(error.message,true); }
  finally { fileBusy = false; refresh(); }
}
$('#add-file').onclick = () => $('#context-input').click();
$('#context-input').onchange = event => { addFiles([...event.target.files]); event.target.value = ''; };

async function importPng(file) {
  if (!file || locked()) return;
  if (file.size > 5_000_000) return toast('请选择小于 5 MB 的 PNG 图片。', true);
  fileBusy = true; refresh();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if ([137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte)) throw new Error('文件不是有效的 PNG。');
    if (bytes.length < 33) throw new Error('PNG 文件不完整。');
    const header = new DataView(bytes.buffer);
    const width = header.getUint32(16), height = header.getUint32(20);
    if (!width || !height || width > 16000 || height > 16000 || width * height > 40_000_000) throw new Error('PNG 最多 4000 万像素，单边不超过 16000。');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败。')); reader.readAsDataURL(new Blob([bytes], { type: 'image/png' })); });
    const preview = new Image(); preview.src = data; await preview.decode();
    if (preview.naturalWidth > 16000 || preview.naturalHeight > 16000 || preview.naturalWidth * preview.naturalHeight > 40_000_000) throw new Error('PNG 最多 4000 万像素，单边不超过 16000。');
    fileBusy = false;
    load(`<svg xmlns="${NS}" viewBox="0 0 ${preview.naturalWidth} ${preview.naturalHeight}"><g id="artwork"/></svg>`,file.name.replace(/\.png$/i,'.svg'));
    pngSource = { data, name: file.name }; selected = []; region = null;
    $('#png-preview').src = data;
    $('#png-name').textContent = `${file.name} · ${preview.naturalWidth} × ${preview.naturalHeight}`;
    $('#ai-prompt').value = ''; $('#ai-feedback').hidden = true; $('#ai-workflow').hidden = true;
  } catch (error) { toast(error.message, true); }
  finally { fileBusy = false; refresh(); }
}
$('#png-input').onchange = event => { importPng(event.target.files[0]); event.target.value = ''; };
$('#remove-png').onclick = () => { if (locked()) return; pngSource = null; $('#png-preview').removeAttribute('src'); refresh(); };

$('#import').onclick = () => $('#file-input').click();
$('#file-input').onchange = event => { importFile(event.target.files[0]); event.target.value = ''; };
let dragDepth = 0;
document.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); if (!locked()) document.body.classList.add('files-dragging'); } });
document.addEventListener('dragenter', event => { if ([...event.dataTransfer.types].includes('Files')) dragDepth++; });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('files-dragging'); } });
document.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; document.body.classList.remove('files-dragging');
  const files = [...event.dataTransfer.files];
  if (document.body.classList.contains('at-home')) {
    if (files.length === 1 && /\.png$/i.test(files[0].name)) importPng(files[0]);
    else if (files.length === 1 && /\.svg$/i.test(files[0].name)) importFile(files[0]);
    else toast('先创建或打开项目，再添加参考文件。');
  } else addFiles(files);
});
$('#export').onclick = () => { if (pending) return toast('请先应用或放弃 AI 预览。'); download(serialized(), filename); toast('SVG 已导出。'); };
$('#extract').onclick = exportSelection;
$('#fit').onclick = $('#zoom-fit').onclick = fit;
$('#zoom-in').onclick = () => zoom(scale * 1.2);
$('#zoom-out').onclick = () => zoom(scale / 1.2);
$('#zoom-value').onclick = () => zoom(1);
$('#undo').onclick = () => undo(); $('#redo').onclick = () => undo(true);
document.querySelectorAll('[data-tool]').forEach(button => { button.onclick = () => setMode(button.dataset.tool); });
$('#try-region').onclick = () => setMode('region');
$('#layer-search').oninput = renderTree;
$('#collapse-all').onclick = () => { collapsed = collapsed.size ? new Set() : new Set(nodes().filter(el => el.children.length).map(el => el.id)); renderTree(); };
$('#clear-selection').onclick = () => { if (!locked()) setSelection([]); else toast('请先应用、放弃或取消 AI 修改。'); };
for (const type of ['fill', 'stroke']) {
  $(`#${type}-picker`).onchange = event => editProperty(type, event.target.value, true);
  $(`#${type}-value`).onchange = event => { const value = event.target.value.trim(); if (!CSS.supports(type, value) || /url|var\(/i.test(value)) { toast('请输入有效颜色或 none。', true); refreshProperties(); return; } editProperty(type, value, true); };
}
$('#stroke-width').onchange = event => { const n = Number(event.target.value); if (n >= 0 && n <= 100) editProperty('stroke-width', String(n), true); else refreshProperties(); };
$('#opacity').onchange = event => { const n = Number(event.target.value); if (n >= 0 && n <= 100) editProperty('opacity', String(n / 100)); else refreshProperties(); };
$('#font-size').onchange = event => { const n = Number(event.target.value); if (n > 0 && n <= 500) editProperty('font-size', `${n}px`); else refreshProperties(); };
$('#font-family').onchange = event => editProperty('font-family', event.target.value);
$('#text-content').onchange = event => { if (locked()) return; const first = selection()[0]; if (first?.localName !== 'text') return; const before = snapshot(); first.textContent = event.target.value; commit(before); };
for (const color of ['#6f8760', '#5f8398', '#c99962', '#b87568', '#9083a1', '#363e33', '#ffffff']) {
  const button = document.createElement('button'); button.style.background = color; button.title = color; button.setAttribute('aria-label', `配色 ${color}`); button.onclick = () => editProperty('fill', color, true); $('#palette').append(button);
}
function deleteSelected() { if (locked() || !selected.length) return; const before = snapshot(); selection().forEach(el => el.remove()); selected = []; commit(before); }
$('#delete').onclick = deleteSelected;
$('#ungroup').onclick = () => {
  if (locked()) return;
  const elements = selection();
  if (elements.some(el => el.localName !== 'g')) return;
  // Retain a styled wrapper for each child to preserve inherited styles, clip paths and transforms.
  const before = snapshot(), next = [];
  for (const group of elements) {
    const children = [...group.children];
    for (const child of children) {
      const wrapper = group.cloneNode(false); wrapper.id = `group-${crypto.randomUUID()}`;
      wrapper.removeAttribute('aria-label'); wrapper.append(child); group.before(wrapper);
      if (graphicTags.has(child.localName)) next.push(wrapper.id);
    }
    group.remove();
  }
  selected = next; commit(before); toast('已拆为可独立选择的子元素，保留原有样式和变换。');
};

function previewResult(result, before, ids) {
  const candidate = sanitize(before);
  if (!Array.isArray(result.replacements) || !result.replacements.length) throw new Error('AI 没有返回有效修改。');
  const seen = new Set();
  for (const replacement of result.replacements) {
    if (!ids.includes(replacement.id) || seen.has(replacement.id)) throw new Error('AI 返回选区外的修改，已拒绝。');
    seen.add(replacement.id);
    const old = [...candidate.querySelectorAll('[id]')].find(el => el.id === replacement.id);
    const wrapper = sanitize(`<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${replacement.svg}</svg>`);
    const children = [...wrapper.children];
    if (children.length !== 1 || !graphicTags.has(children[0].localName) || children[0].id !== replacement.id || children[0].querySelector('style,defs')) throw new Error('AI 返回的元素结构或 ID 无效，已拒绝。');
    old.replaceWith(children[0]);
  }
  // Full validation also catches duplicate IDs introduced by AI across different replacements.
  return sanitize(new XMLSerializer().serializeToString(candidate));
}
function feedback(message, error = false) { $('#ai-feedback').textContent = message; $('#ai-feedback').classList.toggle('error', error); $('#ai-feedback').hidden = false; }
function workflow(stage, message) {
  $('#ai-workflow').hidden = false;
  $('#ai-workflow').dataset.stage = stage;
  $('#workflow-message').textContent = message;
  const stages = ['prepare', 'generate', 'validate', 'preview'];
  $('#ai-workflow').querySelectorAll('li').forEach((el, index) => {
    el.classList.toggle('active', el.dataset.stage === stage);
    el.classList.toggle('done', index < stages.indexOf(stage));
  });
}
async function readAIResponse(response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'AI 请求失败。');
    return result;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result;
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'progress') workflow(event.stage, event.message);
    if (event.type === 'result') result = event.result;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      if (done) break;
    }
    consume(buffer);
    if (!result) throw new Error('连接已中断，未收到完整结果。请重试。');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
$('#ai-form').onsubmit = async event => {
  event.preventDefault();
  if (locked() || (!selected.length && !pngSource && !annotations.length) || !cliAvailable) return;
  const draft = $('#ai-prompt').value.trim();
  let prompt = draft, ids = selection().map(el => el.id), requestRegion = region;
  const batch = !pngSource && annotations.length > 0;
  if (batch) {
    if (annotations.some(annotationMissing)) return feedback('有修改条目的原元素已不存在，请删除该条目后重新标记。', true);
    if (draft && !ids.length) return feedback('输入框中还有意见，请先选择它对应的位置并添加修改，或清空输入框后生成队列。', true);
    const notes = [...annotations, ...(draft ? [{ ids, prompt: draft, region }] : [])];
    ids = roots([...new Set(notes.flatMap(note => note.ids))].map(byId)).map(el => el.id);
    if (ids.length > 300) return feedback('选中元素超过 300 个，请分批生成修改。', true);
    requestRegion = null;
    prompt = '请按以下编号逐条完成修改。每条意见只作用于其 ids 对应的元素；即使为返回完整父编组而替换父级，也必须保留该编组内没有修改意见的其他内容。编号是界面批注，不要画进 SVG。\n' + JSON.stringify(notes.map((note, index) => ({ number: index + 1, ids: note.ids, region: note.region, instruction: note.prompt })));
  }
  if (!prompt && !pngSource) return $('#ai-prompt').focus();
  if (prompt.length > 8000) return feedback('提示词不能超过 8000 字。', true);
  if ($('#ai-model').value === '__custom' && !$('#ai-custom-model').value.trim()) return feedback('请输入自定义模型 ID。', true);
  const before = snapshot();
  request = new AbortController();
  $('#ai-cancel').hidden = false; $('#ai-submit').hidden = true;
  $('#ai-prompt').disabled = true; viewport.classList.add('busy');
  workflow('prepare', '正在提交请求…');
  const started = Date.now();
  $('#workflow-time').textContent = '0 秒';
  workflowTimer = setInterval(() => { $('#workflow-time').textContent = `${Math.floor((Date.now() - started) / 1000)} 秒`; }, 1000);
  $('#ai-feedback').hidden = true; refresh();
  try {
    const response = await fetch(pngSource ? '/api/generate' : '/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Figura-Token': cliToken }, body: JSON.stringify({ prompt, attachments: attachments.map(({ id, name, type, data, pages, redraw }) => ({ id, name, type, data, pages, redraw })), ...(pngSource ? { png: pngSource.data } : { svg: before, ids, region: requestRegion }), ...selectedModelOptions() }), signal: request.signal });
    const result = await readAIResponse(response);
    for (const status of result.attachmentStatus || []) { const file = attachments.find(file => file.id === status.id); if (file) Object.assign(file,{ status:status.status, message:status.message }); }
    renderAttachments();
    workflow('validate', '正在检查 SVG 结构与安全性');
    const candidate = pngSource ? sanitize(result.svg) : previewResult(result, before, ids);
    if (batch && ids.some(id => !result.replacements.some(item => item.id === id))) throw new Error('AI 未返回全部修改位置，已保留原图和修改队列，请重试。');
    if (pngSource && (!candidate.querySelector('path,rect,circle,ellipse,line,polyline,polygon,text,use'))) throw new Error('结果没有有效的可编辑矢量元素，请重试。');
    pending = { before, after: new XMLSerializer().serializeToString(candidate), showingBefore: false, batch };
    mount(candidate);
    if (pngSource) fit();
    workflow('preview', '生成完成，请对比并确认');
    feedback(`预览 · ${result.summary || '修改已生成，请检查画布。'}`);
    $('#preview-actions').hidden = false; $('#compare').textContent = '查看原图';
  } catch (error) { workflow('stopped', error.name === 'AbortError' ? '已取消，可重新生成' : '生成失败，可重试'); feedback(error.name === 'AbortError' ? '已取消修改，原图保持不变。' : error.message, error.name !== 'AbortError'); }
  finally { clearInterval(workflowTimer); request = null; $('#ai-cancel').hidden = true; $('#ai-submit').hidden = false; $('#ai-prompt').disabled = Boolean(pending); viewport.classList.remove('busy'); refresh(); }
};
$('#ai-cancel').onclick = () => request?.abort();
$('#create-generate').onclick = () => $('#ai-form').requestSubmit();
$('#vectors-only').onclick = () => { const enabled = artboard.classList.toggle('vectors-only'); $('#vectors-only').setAttribute('aria-pressed',String(enabled)); };
$('#compare').onclick = () => { if (!pending) return; pending.showingBefore = !pending.showingBefore; mount(sanitize(pending.showingBefore ? pending.before : pending.after)); $('#compare').textContent = pending.showingBefore ? '查看修改' : '查看原图'; refresh(); };
function finishPreview(apply) {
  if (!pending) return;
  const { before, after, batch } = pending; pending = null;
  artboard.classList.remove('vectors-only'); $('#vectors-only').setAttribute('aria-pressed','false');
  if (apply && (batch || pngSource)) annotations = [];
  mount(sanitize(apply ? after : before));
  $('#preview-actions').hidden = true; $('#ai-prompt').disabled = false;
  if (apply && pngSource) {
    filename = pngSource.name.replace(/\.png$/i, '') + '.svg';
    fileBinding = null; lastDiskSvg = ''; pngSource = null;
    $('#filename').textContent = filename; $('#tree-filename').textContent = filename;
    selected = []; fit();
  }
  $('#ai-workflow').hidden = true;
  if (apply) { commit(before); save(); feedback('修改已应用。可随时使用 Ctrl+Z 撤销。'); $('#ai-prompt').value = ''; }
  else feedback('已放弃预览，恢复原图。');
  refresh();
}
$('#apply').onclick = () => finishPreview(true); $('#reject').onclick = () => finishPreview(false);
function modal(title, content, code = false) {
  $('#modal-title').textContent = title;
  $('#modal-content').replaceChildren();
  const element = document.createElement(code ? 'pre' : 'div');
  element.textContent = content; element.style.whiteSpace = 'pre-wrap';
  $('#modal-content').append(element); $('#modal').showModal();
}
$('#modal-close').onclick = () => $('#modal').close();
$('#code').onclick = () => modal('SVG 源码', serialized(), true);
$('#help').onclick = () => modal('在 Figura 中创作', '欢迎页：从 PNG 新建、建立空白项目，或打开历史项目。画布和修改意见自动保存在当前浏览器；刷新后从首页选择项目继续。保存 / Ctrl+S 写入磁盘文件。\n\nV 选择，M 框选，H / 空格平移；滚轮缩放。Shift + 点击多选。Ctrl+Z 撤销，Ctrl+Shift+Z 重做。\n\n选中一处后输入意见，Enter 添加修改，Shift+Enter 换行；可累积多处，Ctrl+Enter 统一生成。每条意见保留自己的元素范围。结果先预览，可比较、应用或放弃。\n\nPNG 新建会自动附带重绘规则。文字、框线、箭头与主体图形逐个绘制，仅小图标和局部图片允许裁切保留。“仅看矢量结构”可以隐藏图片检查主体。\n\n“添加文件”支持 PDF、Word、文本和图片，也支持拖入多个文件。编辑器内拖入文件只添加上下文。图片可选择“按可编辑 SVG 重绘”，仍按当前选区修改。其他文件由本机 Codex 尝试读取，无法解析时会在附件卡片中明确说明。原图和附件按项目隔离，刷新后重新添加。\n\nAI 通过本机 Codex CLI 使用现有模型配置与登录状态，SVG 与参考材料发送至配置的模型服务。');
document.addEventListener('keydown', event => {
  if (document.body.classList.contains('at-home') || $('#create-dialog').open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !$('#modal').open && !$('#file-dialog').open) {
    event.preventDefault(); document.activeElement?.blur();
    if (event.shiftKey) openFileDialog('save'); else saveToFile();
    return;
  }
  const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
  if (editing) {
    if (event.target.id === 'ai-prompt' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('#ai-form').requestSubmit(); }
    else if (event.target.id === 'ai-prompt' && event.key === 'Enter' && !event.shiftKey && !event.isComposing && !pngSource) { event.preventDefault(); addAnnotation(); }
    return;
  }
  if ($('#modal').open || $('#file-dialog').open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey); return; }
  if (event.key === ' ') { event.preventDefault(); spaceDown = true; viewport.style.cursor = 'grab'; }
  if (event.key.toLowerCase() === 'v') setMode('select');
  if (event.key.toLowerCase() === 'm') setMode('region');
  if (event.key.toLowerCase() === 'h') setMode('hand');
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
  if (event.key === 'Escape' && !locked()) setSelection([]);
});
document.addEventListener('keyup', event => { if (event.key === ' ') { spaceDown = false; viewport.style.cursor = ''; } });
window.addEventListener('blur', () => { spaceDown = false; viewport.style.cursor = ''; });
new ResizeObserver(() => {
  if (svg) fit();
  $('#ai-prompt').placeholder = viewport.clientWidth < 520 ? '写下这处的修改意见…' : '写下这处的修改意见，Enter 添加，Shift+Enter 换行…';
}).observe(viewport);

async function localApi(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figura-Token': cliToken }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败，请重试。');
  return result;
}

function openFileDialog(type) {
  if (locked()) return toast('请先结束当前操作。');
  fileMode = type;
  $('#file-dialog-title').textContent = type === 'new' ? '建立空白项目' : '另存为 SVG';
  $('#file-confirm').textContent = type === 'new' ? '创建项目' : '保存文件';
  $('#file-name').value = type === 'new' ? 'untitled.svg' : filename;
  $('#file-directory').value = fileBinding?.directory || defaultDirectory;
  $('#new-file-options').hidden = type !== 'new';
  $('#new-width').disabled = $('#new-height').disabled = type !== 'new';
  $('#file-note').textContent = type === 'new' ? '在所选文件夹创建 SVG，画布与修改意见同时保留在历史项目中。' : '保存到指定位置，不会覆盖已有同名文件。';
  $('#file-error').hidden = true; $('#folder-browser').hidden = true;
  $('#file-dialog').showModal(); $('#file-name').focus(); $('#file-name').select();
}

async function browseFolder(directory) {
  try {
    folderView = await localApi('/api/files/directories', { directory });
    $('#folder-current').textContent = folderView.path; $('#folder-current').title = folderView.path;
    $('#folder-list').replaceChildren();
    for (const name of folderView.directories) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `▱  ${name}`;
      button.onclick = () => browseFolder(folderView.path.replace(/[\\/]$/, '') + folderView.separator + name);
      $('#folder-list').append(button);
    }
    if (!folderView.directories.length) { const text = document.createElement('p'); text.textContent = '没有子文件夹，可直接使用此位置。'; $('#folder-list').append(text); }
    $('#folder-parent').disabled = folderView.path === folderView.parent;
    $('#folder-browser').hidden = false; $('#file-error').hidden = true;
  } catch (error) { $('#file-error').textContent = error.message; $('#file-error').hidden = false; }
}

async function saveToFile() {
  if (locked()) return toast('请先结束当前操作。');
  if (!fileBinding) return openFileDialog('save');
  fileBusy = true; refresh();
  const content = serialized();
  try {
    fileBinding = await localApi('/api/files/save', { directory: fileBinding.directory, name: fileBinding.name, svg: content, expectedRevision: fileBinding.revision });
    lastDiskSvg = content; save(); toast('已保存到文件。');
  } catch (error) { toast(error.message, true); }
  finally { fileBusy = false; refresh(); }
}

$('#new-file').onclick = chooseCreation;
$('#save-file').onclick = saveToFile;
$('#save-as').onclick = () => openFileDialog('save');
$('#browse-folder').onclick = () => browseFolder($('#file-directory').value.trim());
$('#folder-parent').onclick = () => browseFolder(folderView.parent);
$('#folder-choose').onclick = () => { $('#file-directory').value = folderView.path; $('#folder-browser').hidden = true; };
$('#file-dialog-close').onclick = $('#file-cancel').onclick = () => { if (!fileBusy) $('#file-dialog').close(); };
$('#file-dialog').addEventListener('cancel', event => { if (fileBusy) event.preventDefault(); });
$('#file-form').onsubmit = async event => {
  event.preventDefault();
  if (locked()) return;
  let content = serialized();
  if (fileMode === 'new') {
    const width = Number($('#new-width').value), height = Number($('#new-height').value);
    if (![width, height].every(n => Number.isFinite(n) && n >= 1 && n <= 10000)) return;
    const fill = $('#new-background').value === 'white' ? 'white' : 'none';
    content = new XMLSerializer().serializeToString(sanitize(`<svg xmlns="${NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g id="artwork" aria-label="内容图层"><rect id="canvas-background" width="${width}" height="${height}" fill="${fill}"/></g></svg>`));
  }
  fileBusy = true; $('#file-confirm').disabled = true; $('#file-error').hidden = true; refresh();
  try {
    const binding = await localApi('/api/files/save', { directory: $('#file-directory').value.trim(), name: $('#file-name').value.trim(), svg: content });
    fileBusy = false;
    if (fileMode === 'new') load(content, binding.name);
    filename = binding.name; fileBinding = binding; lastDiskSvg = serialized(); defaultDirectory = binding.directory;
    $('#filename').textContent = filename; $('#tree-filename').textContent = filename.replace(/\.svg$/i, '');
    save(); $('#file-dialog').close();
    if (fileMode === 'new') setSelection([byId('artwork')]);
    toast(fileMode === 'new' ? 'SVG 已创建并保存，可开始绘制。' : '已保存到指定位置。');
  } catch (error) { $('#file-error').textContent = error.message; $('#file-error').hidden = false; }
  finally { fileBusy = false; $('#file-confirm').disabled = false; refresh(); }
};

function selectedModelOptions() {
  const model = $('#ai-model').value === '__custom' ? $('#ai-custom-model').value.trim() : $('#ai-model').value;
  const entry = models.find(item => item.id === model);
  return { model, effort: $('#ai-effort').value || (model && entry?.defaultEffort) || '' };
}
function rememberModel() {
  try { localStorage.setItem('figura-ai-settings', JSON.stringify({ model: $('#ai-model').value, custom: $('#ai-custom-model').value, effort: $('#ai-effort').value })); } catch { /* settings are still usable for this session */ }
}
function updateEfforts(value = '') {
  const model = models.find(item => item.id === $('#ai-model').value);
  const choices = model ? model.efforts : availableEfforts;
  const labels = { none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: 'Ultra' };
  $('#ai-effort').replaceChildren(new Option(model ? `模型默认${model.defaultEffort ? ` (${model.defaultEffort})` : ''}` : '跟随 CLI 配置', ''));
  choices.forEach(level => $('#ai-effort').append(new Option(`${labels[level] || level} · ${level}`, level)));
  $('#ai-effort').value = choices.includes(value) ? value : '';
  $('#ai-custom-model').hidden = $('#ai-model').value !== '__custom';
}
function setupModels(status) {
  models = status.models || []; availableEfforts = status.efforts || availableEfforts;
  $('#ai-model').replaceChildren(new Option('跟随 CLI 配置', ''));
  models.forEach(model => $('#ai-model').append(new Option(model.name, model.id)));
  $('#ai-model').append(new Option('自定义模型…', '__custom'));
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem('figura-ai-settings')) || {}; } catch { /* use CLI defaults */ }
  if (models.some(model => model.id === settings.model) || settings.model === '__custom') $('#ai-model').value = settings.model;
  $('#ai-custom-model').value = settings.custom || '';
  updateEfforts(settings.effort);
}
$('#ai-model').onchange = () => { updateEfforts(); rememberModel(); };
$('#ai-effort').onchange = rememberModel;
$('#ai-custom-model').onchange = rememberModel;

async function start() {
  try {
    try { await migrateDraft(); await recoverPending(); await renderProjects(); }
    catch (error) { toast(`历史项目读取失败：${error.message}`,true); }
    const status = await (await fetch('/api/status')).json();
    cliToken = status.token; cliAvailable = status.available;
    defaultDirectory = status.defaultDirectory || '';
    setupModels(status);
    $('#cli-status').textContent = status.available ? 'Codex CLI 已检测到' : 'Codex CLI 未安装';
    $('#cli-status').title = status.available ? '使用本机 CLI 配置与登录状态；发送请求后验证连接。' : status.error;
    $('#cli-status').classList.toggle('unavailable', !status.available);
    refresh();
  } catch (error) { toast(`初始化失败：${error.message}`, true); }
}
syncSelects = enhanceSelects();
start();
