import { validateAttachments, selectedPages, preparePdfContext } from '../pdf-context.js';
import { pdfFixture } from './pdf-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, validateRequest, validateResult, validateGeneration } from '../server.js';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSvg, listDirectories } from '../files.js';
import { codexOptions } from '../codex-options.js';
import { resolveRasterAssets } from '../raster-assets.js';
import { prepareFileContext, validateAttachments as validateFiles } from '../file-context.js';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';

test('AI requests require a bounded SVG, selected IDs and a prompt', () => {
  assert.doesNotThrow(() => validateRequest({ svg: '<svg/>', prompt: 'Make blue', ids: ['shape'] }));
  assert.throws(() => validateRequest({ svg: '<svg/>', prompt: '', ids: ['shape'] }));
  assert.throws(() => validateRequest({ svg: '<svg/>', prompt: 'Blue', ids: [] }));
  assert.throws(() => validateRequest({ svg: '<svg/>' + 'a'.repeat(5_000_001), prompt: 'Blue', ids: ['a'] }));
});

test('AI cannot return changes outside the selection or duplicate replacements', () => {
  const replacement = { id: 'selected', svg: '<rect id="selected"/>' };
  assert.doesNotThrow(() => validateResult({ summary: 'Blue', replacements: [replacement] }, ['selected']));
  assert.throws(() => validateResult({ summary: 'Blue', replacements: [replacement] }, ['other']));
  assert.throws(() => validateResult({ summary: 'Blue', replacements: [replacement, replacement] }, ['selected']));
  assert.throws(() => validateResult({ summary: 'Blue', replacements: [] }, ['selected']));
});

test('local server blocks cross-origin requests, private files and unauthenticated AI calls', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/status`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(`${base}/api/edit`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/api/files/save`, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/api/files/directories`, { method: 'POST', body: '{}' })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('files are created by exact name and location, saved by revision, and protected from conflicts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'figura-file-test-'));
  try {
    const content = '<svg xmlns="http://www.w3.org/2000/svg"><text>论文图像</text></svg>';
    const created = await saveSvg({ directory, name: '论文 figure', svg: content });
    assert.equal(created.name, '论文 figure.svg');
    assert.equal(await readFile(created.path, 'utf8'), content);
    await assert.rejects(saveSvg({ directory, name: created.name, svg: '<svg/>' }), /同名文件/);
    const updated = await saveSvg({ directory, name: created.name, svg: '<svg/>', expectedRevision: created.revision });
    assert.equal(await readFile(created.path, 'utf8'), '<svg/>');
    await writeFile(created.path, '<svg><!-- external change --></svg>');
    await assert.rejects(saveSvg({ directory, name: created.name, svg: content, expectedRevision: updated.revision }), /其他程序修改/);
    assert.equal(await readFile(created.path, 'utf8'), '<svg><!-- external change --></svg>');
    await assert.rejects(saveSvg({ directory, name: '../escape.svg', svg: content }), /文件名无效/);
    await assert.rejects(saveSvg({ directory, name: 'CON.svg', svg: content }), /文件名无效/);
    const listing = await listDirectories(directory);
    assert.ok(listing.path); assert.deepEqual(listing.directories, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Codex options preserve defaults, forward explicit choices and reject incompatible levels', () => {
  assert.deepEqual(codexOptions({}), []);
  assert.deepEqual(codexOptions({ model: 'custom-model', effort: 'high' }), ['--model', 'custom-model', '-c', 'model_reasoning_effort="high"']);
  assert.throws(() => codexOptions({ model: '--bad-model' }));
  assert.throws(() => codexOptions({ effort: 'invalid' }));
  assert.throws(() => codexOptions({ model: 'test-model', effort: 'ultra' }, [{ id: 'test-model', efforts: ['low', 'high'] }]));
});

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
test('PNG generation accepts optional prompts and bounds file type, dimensions and size', () => {
  assert.ok(validateGeneration({ png, prompt: '' }).length);
  assert.throws(() => validateGeneration({ png: 'data:image/png;base64,YWJj', prompt: '' }));
  assert.throws(() => validateGeneration({ png, prompt: 'x'.repeat(8001) }));
  const oversized = Buffer.from(png.split(',')[1], 'base64'); oversized.writeUInt32BE(20000, 16);
  assert.throws(() => validateGeneration({ png: `data:image/png;base64,${oversized.toString('base64')}`, prompt: '' }));
});

test('generation attaches a PNG to CLI and streams actual stages and result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'figura-cli-test-'));
  const previous = process.env.CODEX_BIN;
  const cli = join(directory, 'fake.js');
  await writeFile(cli, `const fs = require('node:fs');
    const args = process.argv.slice(2);
    if (!fs.readFileSync(args[args.indexOf('--image') + 1]).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) process.exit(2);
    let prompt = ''; process.stdin.on('data', data => prompt += data);
    process.stdin.on('end', () => fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ summary: '生成完成', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' })));
  `);
  process.env.CODEX_BIN = cli;
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/generate`, { method: 'POST', body: '{}' })).status, 403);
    const { token } = await (await fetch(`${base}/api/status`)).json();
    const headers = { 'Content-Type': 'application/json', 'X-Figura-Token': token, Accept: 'application/x-ndjson' };
    const response = await fetch(`${base}/api/generate`, { method: 'POST', headers, body: JSON.stringify({ png, prompt: '' }) });
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.filter(event => event.type === 'progress').map(event => event.stage), ['prepare', 'generate', 'validate']);
    assert.match(events.at(-1).result.svg, /<rect/);
    assert.equal((await fetch(`${base}/api/generate`, { method: 'POST', headers, body: JSON.stringify({ png: 'bad', prompt: '' }) })).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('PDF contexts validate file limits and explicit page selection', () => {
  const file = { name: 'paper.pdf', pages: '1-2', data: pdfFixture(['first', 'second']).toString('base64') };
  assert.equal(validateAttachments([file]).length, 1);
  assert.throws(() => validateAttachments(Array(11).fill(file)));
  assert.throws(() => validateAttachments([{ ...file, data: Buffer.from('not a PDF').toString('base64') }]));
  assert.throws(() => validateAttachments([{ ...file, pages: '../path' }]));
  assert.deepEqual(selectedPages('3,1-2,2', 3), [1, 2, 3]);
  assert.throws(() => selectedPages('4', 3));
  assert.throws(() => selectedPages('', 21));
  assert.throws(() => validateRequest({ svg: '<svg/>', prompt: 'edit', ids: ['a'], attachments: [{}] }));
  assert.throws(() => validateGeneration({ png, prompt: '', attachments: [{}] }));
});

test('PDF context extracts requested pages, renders images, reports progress and rejects corrupt PDFs', async () => {
  const work = await mkdtemp(join(tmpdir(), 'figura-pdf-test-'));
  const controller = new AbortController();
  const file = { name: 'paper.pdf', pages: '2', data: pdfFixture(['excluded context', 'selected context']).toString('base64') };
  const progress = [];
  try {
    const result = await preparePdfContext([file], work, controller.signal, (stage, message) => progress.push(message));
    assert.match(result.text, /selected context/); assert.doesNotMatch(result.text, /excluded context/);
    assert.equal(result.images.length, 1);
    assert.equal((await readFile(result.images[0])).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(progress.some(message => message.includes('2/2')));
    await assert.rejects(preparePdfContext([{ ...file, data: Buffer.from('%PDF-broken').toString('base64') }], work, controller.signal, () => {}), /PDF 解析失败/);
    controller.abort();
    await assert.rejects(preparePdfContext([file], work, controller.signal, () => {}), /取消/);
  } finally { await rm(work, { recursive: true, force: true }); }
});

test('both AI entry points receive PDF text and rendered page attachments in CLI input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'figura-context-cli-'));
  const previous = process.env.CODEX_BIN;
  const cli = join(directory, 'fake.js');
  await writeFile(cli, `const fs = require('node:fs');
    const args = process.argv.slice(2);
    const images = args.flatMap((arg, index) => arg === '--image' ? [args[index + 1]] : []);
    const generation = images.some(path => path.endsWith('input.png'));
    if (images.length !== (generation ? 2 : 1)) process.exit(2);
    for (const image of images) if (!fs.readFileSync(image).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) process.exit(3);
    let prompt = ''; process.stdin.on('data', data => prompt += data);
    process.stdin.on('end', () => {
      if (!prompt.includes('latent alignment') || !prompt.includes('paper.pdf')) process.exit(4);
      fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(generation ? { summary: 'done', svg: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' } : { summary: 'done', replacements: [{ id: 'shape', svg: '<rect id="shape"/>' }] }));
    });`);
  process.env.CODEX_BIN = cli;
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { token } = await (await fetch(`${base}/api/status`)).json();
    for (const endpoint of ['edit', 'generate']) {
      const body = { prompt: 'Use the reference', attachments: [{ name: 'paper.pdf', pages: '', data: pdfFixture().toString('base64') }], ...(endpoint === 'edit' ? { svg: '<svg><rect id="shape"/></svg>', ids: ['shape'] } : { png }) };
      const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figura-Token': token }, body: JSON.stringify(body) });
      const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.summary, 'done');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('controlled icon crops stay editable alongside vectors and reject background workarounds', async () => {
  const canvas = createCanvas(100,100); canvas.getContext('2d').fillRect(0,0,100,100);
  const sources = new Map([['source',canvas.toBuffer('image/png')]]);
  const make = (attributes = '', crop = { x:10,y:10,width:20,height:20 }) => ({ summary:'done',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text id="label" x="5" y="10">Editable</text><rect id="frame" width="100" height="100" fill="none" stroke="black"/><image id="icon" href="asset:icon" x="10" y="20" width="20" height="20" ${attributes}/></svg>`,
    rasterAssets: [{ elementId:'icon',sourceId:'source',purpose:'small icon',crop }],
  });
  const result = await resolveRasterAssets(make(),{},sources,true);
  assert.match(result.svg,/data:image\/png;base64/); assert.match(result.svg,/<text/);
  const standalone = make('',{x:0,y:0,width:100,height:100}); standalone.rasterAssets[0].sourceId = 'uploaded-icon';
  assert.match((await resolveRasterAssets(standalone,{},new Map([['uploaded-icon',canvas.toBuffer('image/png')]]),true)).svg,/data:image\/png;base64/);
  await assert.rejects(resolveRasterAssets(make('transform="scale(4)"'),{},sources,true),/覆盖面积/);
  await assert.rejects(resolveRasterAssets(make('',{x:0,y:0,width:100,height:100}),{},sources,true),/裁切图片过大/);
  const duplicate = make(); duplicate.svg = duplicate.svg.replace('</svg>','<use href="#icon"/></svg>');
  await assert.rejects(resolveRasterAssets(duplicate,{},sources,true),/重复铺设/);
  const rasterOnly = make(); rasterOnly.svg = '<svg viewBox="0 0 100 100"><image href="data:image/png;base64,abc" width="100" height="100"/></svg>'; rasterOnly.rasterAssets = [];
  await assert.rejects(resolveRasterAssets(rasterOnly,{},sources,true),/受控裁切/);
  const preserved = { summary:'keep image',replacements:[{id:'frame',svg:'<rect id="frame" width="100" height="100" fill="blue"/>'}] };
  await resolveRasterAssets(preserved,{svg:result.svg},new Map(),false);
});

test('mixed file contexts read PDF, DOCX, text and images and report unknown or broken inputs', async () => {
  const work = await mkdtemp(join(tmpdir(),'figura-mixed-'));
  const zip = new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word context label</w:t></w:r></w:p></w:body></w:document>');
  const image = createCanvas(30,30).toBuffer('image/png');
  const file = (id,name,bytes) => ({id,name,data:Buffer.from(bytes).toString('base64')});
  const input = [file('word','reference.docx',await zip.generateAsync({type:'nodebuffer'})),file('text','note.md','text context label'),file('img','icon.png',image),file('pdf','paper.pdf',pdfFixture()),file('unknown','blob.bin',Buffer.from([0,255,0,254])),file('broken','bad.doc',Buffer.from('bad'))];
  try {
    const result = await prepareFileContext(input,work,new AbortController().signal,()=>{});
    assert.match(result.text,/Word context label/); assert.match(result.text,/text context label/);
    assert.equal(result.images.length,2); assert.equal(result.sources[0][0],'img');
    assert.deepEqual(result.statuses.map(item=>item.status),['read','read','read','read','pending','failed']);
    assert.deepEqual(result.generic,['unknown']);
    assert.throws(()=>validateFiles(Array(11).fill(input[0])),/10 个/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(prepareFileContext(input,work,controller.signal,()=>{}),/取消/);
  } finally { await rm(work,{recursive:true,force:true}); }
});
