import { openSample, reopenProject } from './ui-helpers.js';
import { pdfFixture } from './pdf-fixture.js';
import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await openSample(page);
  await expect(page.locator('#artboard > svg')).toBeVisible();
});

test('select, recolor, drag, undo, redo and persist a native SVG element', async ({ page }) => {
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await expect(page.locator('#ai-panel')).toBeVisible();
  await expect(page.locator('#selected-name')).toHaveText('encoder-card');
  await page.locator('#fill-value').fill('#336699');
  await page.locator('#fill-value').press('Tab');
  await expect(page.locator('#encoder-card')).toHaveCSS('fill', 'rgb(51, 102, 153)');
  await page.locator('#undo').click();
  await expect(page.locator('#encoder-card')).not.toHaveCSS('fill', 'rgb(51, 102, 153)');
  await page.locator('#redo').click();
  await expect(page.locator('#encoder-card')).toHaveCSS('fill', 'rgb(51, 102, 153)');
  const box = await page.locator('#encoder-card').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down(); await page.mouse.move(box.x + 25, box.y + 17); await page.mouse.up();
  await expect(page.locator('#encoder-card')).toHaveAttribute('transform', /translate/);
  await page.reload();
  await reopenProject(page);
  await expect(page.locator('#encoder-card')).toHaveCSS('fill', 'rgb(51, 102, 153)');
  await expect(page.locator('#encoder-card')).toHaveAttribute('transform', /translate/);
});

test('region selects contained roots and export produces standalone SVG', async ({ page }) => {
  await page.getByRole('button', { name: '区域框选', exact: true }).click();
  const box = await page.locator('#encoder-module').boundingBox();
  await page.mouse.move(box.x - 5, box.y - 5); await page.mouse.down(); await page.mouse.move(box.x + box.width + 5, box.y + box.height + 5, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('#ai-selection')).toHaveText('区域 · 1 个元素');
  await expect(page.locator('#selected-name')).toHaveText('encoder-module');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#extract').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('method-overview-selection.svg');
  const stream = await download.createReadStream();
  let text = ''; for await (const chunk of stream) text += chunk;
  expect(text).toContain('id="encoder-module"');
  expect(text).not.toContain('id="input-module"');
  expect(text).toContain('<defs>');
});

test('AI preview is scoped, compared, applied and undoable (mock transport)', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test' } }));
  await page.reload();
  await reopenProject(page);
  const outsideBefore = await page.locator('#input-module').evaluate(el => el.outerHTML);
  await page.route('**/api/edit', async route => {
    const body = route.request().postDataJSON();
    expect(body.ids).toEqual(['encoder-card']);
    await route.fulfill({ json: { summary: '将编码器背景改为蓝色', replacements: [{ id: 'encoder-card', svg: '<rect id="encoder-card" x="335" y="202" width="285" height="249" rx="10" fill="#336699"/>' }] } });
  });
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await page.locator('#ai-prompt').fill('将背景改成蓝色');
  await page.locator('#ai-submit').click();
  await expect(page.locator('#preview-actions')).toBeVisible();
  await expect(page.locator('#encoder-card')).toHaveCSS('fill', 'rgb(51, 102, 153)');
  expect(await page.locator('#input-module').evaluate(el => el.outerHTML)).toBe(outsideBefore);
  await page.locator('#compare').click();
  await expect(page.locator('#encoder-card')).not.toHaveCSS('fill', 'rgb(51, 102, 153)');
  await page.locator('#apply').click();
  await expect(page.locator('#encoder-card')).toHaveCSS('fill', 'rgb(51, 102, 153)');
  await page.locator('#undo').click();
  await expect(page.locator('#encoder-card')).not.toHaveCSS('fill', 'rgb(51, 102, 153)');
});

test('AI out-of-scope response is rejected without changing the document', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test' } }));
  await page.reload();
  await reopenProject(page);
  await page.route('**/api/edit', route => route.fulfill({ json: { summary: 'Invalid', replacements: [{ id: 'input-card', svg: '<rect id="input-card" fill="red"/>' }] } }));
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  const before = await page.locator('#artboard').innerHTML();
  await page.locator('#ai-prompt').fill('修改颜色'); await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-feedback')).toContainText('选区外');
  await expect(page.locator('#preview-actions')).toBeHidden();
  expect(await page.locator('#artboard').innerHTML()).toBe(before);
});

test('imports SVG with CSS, preserves transforms and strips active or external content', async ({ page }) => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><style>.shape {fill:#123456} body {background:red}</style><script>alert(1)</script><g id="group" transform="translate(20 20)"><rect id="shape" class="shape" width="100" height="100" onclick="alert(1)"/></g><image href="https://example.com/a.png"/></svg>';
  await page.locator('#file-input').setInputFiles({ name: 'import.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(source) });
  await expect(page.locator('#shape')).toHaveCSS('fill', 'rgb(18, 52, 86)');
  await expect(page.locator('#artboard script')).toHaveCount(0);
  await expect(page.locator('#shape')).not.toHaveAttribute('onclick');
  await expect(page.locator('#artboard image')).not.toHaveAttribute('href');
  await expect(page.locator('body')).not.toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await page.locator('#shape').click();
  await page.locator('#fill-value').fill('#112233'); await page.locator('#fill-value').press('Tab');
  await page.locator('#undo').click();
  await expect(page.locator('#shape')).toHaveCSS('fill', 'rgb(18, 52, 86)');
  await expect(page.locator('#group')).toHaveAttribute('transform', 'translate(20 20)');
});

test('invalid SVG leaves the existing document intact', async ({ page }) => {
  await page.locator('#file-input').setInputFiles({ name: 'broken.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg><g></svg>') });
  await expect(page.locator('#toast')).toContainText('不是有效的 SVG');
  await expect(page.locator('#figure-title')).toBeVisible();
});

test('text edits and deletion support undo', async ({ page }) => {
  await page.locator('#figure-title').click();
  await page.locator('#text-content').fill('A new scientific figure'); await page.locator('#text-content').press('Tab');
  await expect(page.locator('#figure-title')).toHaveText('A new scientific figure');
  await page.locator('#delete').click();
  await expect(page.locator('#figure-title')).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(page.locator('#figure-title')).toHaveText('A new scientific figure');
});

test('new SVG uses the requested folder, name and size, then saves and restores its binding', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'figura-ui-test-'));
  try {
    await page.locator('#new-file').click();
    await page.locator('#create-blank').click();
    await expect(page.locator('#import-png')).toHaveCount(0);
    await page.locator('#file-directory').fill(directory);
    await page.locator('#browse-folder').click();
    await expect(page.locator('#folder-current')).toHaveText(directory);
    await page.locator('#folder-choose').click();
    await writeFile(join(directory, 'occupied.svg'), '<svg><!-- keep --></svg>');
    await page.locator('#file-name').fill('occupied.svg');
    await page.locator('#file-confirm').click();
    await expect(page.locator('#file-error')).toContainText('同名文件已存在');
    await expect(page.locator('#filename')).toHaveText('method-overview.svg');
    expect(await readFile(join(directory, 'occupied.svg'), 'utf8')).toBe('<svg><!-- keep --></svg>');
    await page.locator('#file-name').fill('论文 figure.svg');
    await page.locator('#new-width').fill('800'); await page.locator('#new-height').fill('500');
    await page.locator('#file-confirm').click();
    await expect(page.locator('#file-dialog')).not.toBeVisible();
    await expect(page.locator('#artboard > svg')).toHaveAttribute('viewBox', '0 0 800 500');
    await expect(page.locator('#selected-name')).toHaveText('artwork');
    const file = join(directory, '论文 figure.svg');
    expect(await readFile(file, 'utf8')).toContain('viewBox="0 0 800 500"');
    await page.locator('#fill-value').fill('#336699'); await page.locator('#fill-value').press('Tab');
    await expect(page.locator('#save-state')).toHaveText('待保存到文件');
    await page.keyboard.press('Control+s');
    await expect(page.locator('#save-state')).toHaveText('已保存到文件');
    expect(await readFile(file, 'utf8')).toContain('rgb(51, 102, 153)');
    await page.reload();
  await reopenProject(page);
    await expect(page.locator('#filename')).toHaveAttribute('title', file);
    await page.locator('#save-as').click();
    await page.locator('#file-confirm').click();
    await expect(page.locator('#file-error')).toContainText('同名文件已存在');
    await page.locator('#file-name').fill('另一个版本'); await page.locator('#file-confirm').click();
    await expect(page.locator('#filename')).toHaveText('另一个版本.svg');
    const copy = join(directory, '另一个版本.svg');
    expect(await readFile(copy, 'utf8')).toContain('rgb(51, 102, 153)');
    await writeFile(copy, '<svg><!-- external --></svg>');
    await page.locator('#save-file').click();
    await expect(page.locator('#toast')).toContainText('其他程序修改');
    expect(await readFile(copy, 'utf8')).toBe('<svg><!-- external --></svg>');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('model and effort choices persist, filter by capability, and are sent with AI requests', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test', models: [
    { id: 'test-model', name: 'Test model', efforts: ['low', 'high'], defaultEffort: 'low' },
  ] } }));
  await page.reload();
  await reopenProject(page);
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await page.locator('#ai-model').selectOption('test-model');
  await expect(page.locator('#ai-effort option')).toHaveCount(3);
  await page.locator('#ai-effort').selectOption('high');
  await page.reload();
  await reopenProject(page);
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await expect(page.locator('#ai-model')).toHaveValue('test-model');
  await expect(page.locator('#ai-effort')).toHaveValue('high');
  await page.route('**/api/edit', async route => {
    const body = route.request().postDataJSON();
    expect(body.model).toBe('test-model'); expect(body.effort).toBe('high');
    await route.fulfill({ status: 400, json: { error: 'test request received' } });
  });
  await page.locator('#ai-prompt').fill('修改颜色'); await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-feedback')).toHaveText('test request received');
  await page.locator('#ai-model').selectOption('__custom');
  await expect(page.locator('#ai-custom-model')).toBeVisible();
  await page.locator('#ai-custom-model').fill('custom-provider/model');
  await page.locator('#ai-custom-model').press('Tab');
  await page.reload();
  await reopenProject(page);
  await expect(page.locator('#ai-custom-model')).toHaveValue('custom-provider/model');
});

test('animated model menus support pointer, keyboard, dismissal and compact composer layout', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test', models: [
    { id: 'test-model', name: 'Test model', efforts: ['low', 'high'], defaultEffort: 'low' },
  ] } }));
  await page.reload();
  await reopenProject(page);
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await page.locator('#ai-model-trigger').click();
  await expect(page.locator('#ai-model-menu')).toBeVisible();
  await expect(page.locator('#ai-model-trigger')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#ai-model-menu').getByRole('option', { name: 'Test model', exact: true }).click();
  await expect(page.locator('#ai-model')).toHaveValue('test-model');
  await expect(page.locator('#ai-model-trigger')).toContainText('Test model');
  await page.locator('#ai-effort-trigger').focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(page.locator('#ai-effort')).toHaveValue('high');
  await expect(page.locator('#ai-effort-trigger')).toBeFocused();
  await page.locator('#ai-model-trigger').click(); await page.keyboard.press('Escape');
  await expect(page.locator('#ai-model-menu')).not.toBeVisible();
  await expect(page.locator('#ai-panel')).toBeVisible();
  await page.locator('#ai-model-trigger').click(); await page.locator('#ai-prompt').click();
  await expect(page.locator('#ai-model-menu')).not.toBeVisible();
  const form = await page.locator('#ai-form').boundingBox(), prompt = await page.locator('#ai-prompt').boundingBox(), send = await page.locator('#ai-submit').boundingBox();
  expect(form.height).toBeLessThan(125);
  expect(send.y).toBeGreaterThanOrEqual(prompt.y + prompt.height);
  expect(send.x + send.width).toBeLessThanOrEqual(form.x + form.width);
});

test('animated dropdown works inside a modal', async ({ page }) => {
  await page.locator('#new-file').click();
  await page.locator('#create-blank').click();
  await page.locator('#new-background-trigger').click();
  await page.locator('#new-background-menu').getByRole('option', { name: '透明', exact: true }).click();
  await expect(page.locator('#new-background')).toHaveValue('transparent');
  await expect(page.locator('#new-background-menu')).not.toBeVisible();
  await page.locator('#file-cancel').click();
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  expect(await page.locator('#ai-panel').evaluate(el => parseFloat(getComputedStyle(el).animationDuration))).toBeGreaterThan(0);
});

test('readable typography and popover clearance survive desktop and compact layouts', async ({ page }) => {
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('#ai-prompt')).toHaveCSS('font-size', '16px');
    await expect(page.locator('#ai-model-trigger')).toHaveCSS('font-size', '13px');
    await page.locator('#ai-model-trigger').click();
    const menu = page.locator('#ai-model-menu');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox(), composer = await page.locator('#ai-form').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(composer.y - 9);
    expect(box.x).toBeGreaterThanOrEqual(12);
    expect(box.x + box.width).toBeLessThanOrEqual(composer.x + composer.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(12);
    expect(await page.locator('#ai-form').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  for (const selector of ['.layer-row', '#fill-value', '#file-name', '.search input']) {
    expect(await page.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  }
  await page.locator('#new-file').click();
  await page.locator('#create-blank').click();
  await page.locator('#new-background-trigger').click();
  const field = await page.locator('#new-background-trigger').boundingBox(), popup = await page.locator('#new-background-menu').boundingBox();
  expect(popup.y).toBeGreaterThanOrEqual(field.y + field.height + 9);
  expect(popup.y + popup.height).toBeLessThanOrEqual(960 - 12);
});

const pngInput = { name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64') };
test('PNG generation streams workflow, compares reference, applies editable vectors and undoes', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test' } }));
  await page.reload();
  await reopenProject(page);
  await page.route('**/api/generate', async route => {
    expect(route.request().postDataJSON().png).toContain('data:image/png;base64,');
    expect(route.request().postDataJSON().prompt).toBe('');
    await route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'progress', stage: 'generate', message: '正在重建矢量图' },
      { type: 'result', result: { summary: '已生成', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect id="generated" width="400" height="300" fill="blue"/></svg>' } },
    ].map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await page.locator('#png-input').setInputFiles(pngInput);
  await expect(page.locator('#png-preview')).toBeVisible();
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-workflow')).toHaveAttribute('data-stage', 'preview');
  await expect(page.locator('#generated')).toBeVisible();
  await page.locator('#compare').click();
  await expect(page.locator('#png-preview')).toBeVisible();
  await page.locator('#apply').click();
  await expect(page.locator('#generated')).toBeVisible();
  await expect(page.locator('#filename')).toHaveText('reference.svg');
  await page.locator('#undo').click();
  await expect(page.locator('#artwork')).toHaveCount(1);
});

test('PNG failures and discarded previews preserve original SVG and permit retry', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test' } }));
  await page.reload();
  await reopenProject(page);
  await page.locator('#png-input').setInputFiles(pngInput);
  await expect(page.locator('#png-preview')).toBeVisible();
  const original = await page.locator('#artboard').innerHTML();
  await page.locator('#ai-prompt').fill('文字重叠，请调整间距');
  await page.route('**/api/generate', route => {
    expect(route.request().postDataJSON().prompt).toBe('文字重叠，请调整间距');
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'error', error: '模型暂不可用' }) + '\n' });
  });
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-feedback')).toHaveText('模型暂不可用');
  expect(await page.locator('#artboard').innerHTML()).toBe(original);
  await page.route('**/api/generate', route => route.fulfill({ json: { summary: '完成', svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' } }));
  await page.locator('#ai-submit').click();
  await expect(page.locator('#preview-actions')).toBeVisible();
  await page.locator('#reject').click();
  await page.locator('#remove-png').click();
  expect(await page.locator('#artboard').innerHTML()).toBe(original);
});

test('PNG generation remains cancellable with a visible workflow and compact layout', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test' } }));
  await page.reload();
  await reopenProject(page);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/generate', async route => { await held; await route.fulfill({ json: { error: 'cancelled' } }).catch(() => {}); });
  await page.locator('#png-input').setInputFiles(pngInput);
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-workflow')).toBeVisible();
  await expect(page.locator('#workflow-time')).toContainText('秒');
  await expect(page.locator('#new-file')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#ai-cancel')).toBeVisible();
  await page.locator('#ai-cancel').click();
  await expect(page.locator('#ai-feedback')).toContainText('已取消');
  await expect(page.locator('#ai-submit')).toBeEnabled();
  release();
  await page.locator('#remove-png').click();
  await expect(page.locator('#artwork')).toHaveCount(1);
});

test('PDF attachments persist between PNG generation and ordinary edits with page ranges and removal', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test' } }));
  await page.reload();
  await reopenProject(page);
  const pdf = { name: 'paper.pdf', mimeType: 'application/pdf', buffer: pdfFixture(['First page', 'Second page']) };
  await page.locator('#png-input').setInputFiles(pngInput);
  await page.locator('#context-input').setInputFiles(pdf);
  await expect(page.locator('.context-chip')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'paper.pdf 参考页码' }).fill('2');
  await page.route('**/api/generate', route => {
    const body = route.request().postDataJSON();
    expect(body.attachments[0]).toMatchObject({ name: 'paper.pdf', data: pdf.buffer.toString('base64'), pages: '2' });
    return route.fulfill({ json: { summary: '根据上下文生成', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect id="context-shape" width="400" height="300" fill="blue"/></svg>' } });
  });
  await page.locator('#ai-submit').click();
  await expect(page.locator('#apply')).toBeVisible();
  await expect(page.locator('#add-file')).toBeDisabled();
  await page.locator('#apply').click();
  await expect(page.locator('.context-chip')).toHaveCount(1);
  await page.locator('#context-shape').click({ position: { x: 10, y: 10 } });
  await page.route('**/api/edit', route => {
    const body = route.request().postDataJSON();
    expect(body.attachments[0].pages).toBe('2'); expect(body.ids).toEqual(['context-shape']);
    return route.fulfill({ json: { summary: '参考 PDF 调色', replacements: [{ id: 'context-shape', svg: '<rect id="context-shape" width="400" height="300" fill="red"/>' }] } });
  });
  await page.locator('#ai-prompt').fill('按论文配色修改');
  await page.locator('#ai-submit').click();
  await page.locator('#apply').click();
  await expect(page.locator('#context-shape')).toHaveCSS('fill', 'rgb(255, 0, 0)');
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '移除 paper.pdf' }).click();
  await expect(page.locator('.context-chip')).toHaveCount(0);
});

test('PDF upload rejects wrong formats and excessive attachments without losing existing context', async ({ page }) => {
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await page.locator('#context-input').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('bad') });
  await expect(page.locator('#toast')).toContainText('不是有效的 PDF');
  await expect(page.locator('.context-chip')).toHaveCount(0);
  const files = Array.from({length:10},(_,i)=>i+1).map(index => ({ name: `paper-${index}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture() }));
  await page.locator('#context-input').setInputFiles(files);
  await expect(page.locator('.context-chip')).toHaveCount(10);
  await page.locator('#context-input').setInputFiles(files[0]);
  await expect(page.locator('#toast')).toContainText('最多添加 10 个文件');
  await expect(page.locator('.context-chip')).toHaveCount(10);
  await page.reload();
  await reopenProject(page);
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await expect(page.locator('.context-chip')).toHaveCount(0);
});
