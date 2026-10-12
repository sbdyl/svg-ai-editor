import { openSample, reopenProject } from './ui-helpers.js';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { available: true, token: 'test' } }));
  await page.goto('/');
  await openSample(page);
  await expect(page.locator('#artboard > svg')).toBeVisible();
});

async function addNote(page, id, instruction, keyboard = false) {
  await page.locator(`#${id}`).click({ position: { x: 6, y: 6 } });
  await page.locator('#ai-prompt').fill(instruction);
  if (keyboard) await page.locator('#ai-prompt').press('Enter');
  else await page.locator('#add-annotation').click();
}

test('persistent composer queues, renumbers, locates and restores numbered annotations', async ({ page }) => {
  await expect(page.locator('#ai-panel')).toBeVisible();
  await expect(page.locator('#add-annotation')).toBeDisabled();
  await addNote(page, 'encoder-card', '改成蓝色', true);
  await addNote(page, 'input-card', '加粗边框');
  await addNote(page, 'policy-card', '减小圆角');
  await expect(page.locator('.annotation-pin')).toHaveText(['1', '2', '3']);
  await expect(page.locator('.annotation-row')).toHaveCount(3);
  await expect(page.locator('#ai-prompt')).toHaveValue('');
  await page.getByRole('button', { name: '删除修改 2', exact: true }).click();
  await expect(page.locator('.annotation-pin')).toHaveText(['1', '2']);
  await expect(page.locator('#annotation-list')).not.toContainText('加粗边框');
  await page.reload();
  await reopenProject(page);
  await expect(page.locator('.annotation-pin')).toHaveText(['1', '2']);
  await page.getByRole('button', { name: '定位修改 2', exact: true }).click();
  await expect(page.locator('#selected-name')).toHaveText('policy-card');
  await page.locator('#ai-prompt').press('Escape');
  await expect(page.locator('#ai-panel')).toBeVisible();
  const pin = page.locator('.annotation-pin').first();
  const before = await pin.boundingBox();
  await page.locator('#zoom-in').click();
  const after = await pin.boundingBox();
  expect(after.x).not.toBe(before.x);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(await page.locator('#artboard').innerHTML()).not.toContain('annotation-pin');
});

test('batch request keeps individual targets, rejects outside edits, applies as one undo step', async ({ page }) => {
  const before = await page.locator('#artboard').innerHTML();
  await addNote(page, 'encoder-card', '蓝色背景');
  await addNote(page, 'input-card', '红色边框');
  let invalid = true;
  await page.route('**/api/edit', async route => {
    const body = route.request().postDataJSON();
    expect(body.ids).toEqual(['encoder-card', 'input-card']);
    const notes = JSON.parse(body.prompt.slice(body.prompt.indexOf('\n') + 1));
    expect(notes.map(note => [note.number, note.ids, note.instruction])).toEqual([
      [1, ['encoder-card'], '蓝色背景'], [2, ['input-card'], '红色边框'],
    ]);
    await route.fulfill({ json: { summary: '两处修改', replacements: invalid
      ? [{ id: 'policy-card', svg: '<rect id="policy-card" fill="red"/>' }]
      : [
        { id: 'encoder-card', svg: '<rect id="encoder-card" x="335" y="202" width="285" height="249" rx="10" fill="#336699"/>' },
        { id: 'input-card', svg: '<rect id="input-card" x="48" y="202" width="245" height="249" rx="10" fill="white" stroke="red"/>' },
      ] } });
  });
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-feedback')).toContainText('选区外');
  expect(await page.locator('#artboard').innerHTML()).toBe(before);
  await expect(page.locator('.annotation-row')).toHaveCount(2);
  invalid = false;
  await page.locator('#ai-submit').click();
  await expect(page.locator('#preview-actions')).toBeVisible();
  await expect(page.getByRole('button', { name: '删除修改 1', exact: true })).toBeDisabled();
  await page.locator('#reject').click();
  await expect(page.locator('.annotation-row')).toHaveCount(2);
  await page.locator('#ai-submit').click();
  await expect(page.locator('#preview-actions')).toBeVisible();
  await page.locator('#apply').click();
  await expect(page.locator('.annotation-pin')).toHaveCount(0);
  await expect(page.locator('#annotation-list')).toBeHidden();
  await expect(page.locator('#ai-panel')).toBeVisible();
  await expect(page.locator('#encoder-card')).toHaveCSS('fill', 'rgb(51, 102, 153)');
  await page.locator('#undo').click();
  expect(await page.locator('#artboard').innerHTML()).toBe(before);
  await page.reload();
  await reopenProject(page);
  await expect(page.locator('.annotation-row')).toHaveCount(0);
});

test('stale targets cannot silently switch scope and document imports reset the queue', async ({ page }) => {
  await addNote(page, 'encoder-card', '修改背景');
  await page.getByRole('button', { name: '定位修改 1', exact: true }).click();
  await page.locator('#delete').click();
  await expect(page.locator('.annotation-row')).toContainText('原元素已不存在');
  let requests = 0;
  await page.route('**/api/edit', route => { requests++; return route.abort(); });
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-feedback')).toContainText('重新标记');
  expect(requests).toBe(0);
  await page.locator('#undo').click();
  await expect(page.locator('.annotation-pin')).toHaveCount(1);
  await page.locator('#file-input').setInputFiles({ name: 'new.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="encoder-card" width="100" height="100"/></svg>') });
  await expect(page.locator('.annotation-row')).toHaveCount(0);
  await expect(page.locator('.annotation-pin')).toHaveCount(0);
});

test('incomplete batch responses preserve all notes and unassigned draft text blocks submission', async ({ page }) => {
  await addNote(page, 'encoder-card', '蓝色背景');
  await addNote(page, 'input-card', '红色边框');
  let requests = 0;
  await page.route('**/api/edit', route => {
    requests++;
    return route.fulfill({ json: { summary: '只完成一处', replacements: [
      { id: 'encoder-card', svg: '<rect id="encoder-card" x="335" y="202" width="285" height="249" fill="#336699"/>' },
    ] } });
  });
  await page.locator('#ai-prompt').fill('尚未选择位置的意见');
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-feedback')).toContainText('选择它对应的位置');
  expect(requests).toBe(0);
  await expect(page.locator('#ai-prompt')).toHaveValue('尚未选择位置的意见');
  await page.locator('#ai-prompt').fill('');
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-feedback')).toContainText('未返回全部修改位置');
  await expect(page.locator('#preview-actions')).toBeHidden();
  await expect(page.locator('.annotation-row')).toHaveCount(2);
  await expect(page.locator('#encoder-card')).not.toHaveCSS('fill', 'rgb(51, 102, 153)');
});

test('parent and child notes normalize request roots while preserving per-note scope', async ({ page }) => {
  await addNote(page, 'encoder-card', '背景变蓝');
  await page.locator('.layer-row[data-node-id="encoder-module"] .layer-name').click();
  await page.locator('#ai-prompt').fill('整个组往右移');
  await page.locator('#add-annotation').click();
  await page.route('**/api/edit', async route => {
    const body = route.request().postDataJSON();
    expect(body.ids).toEqual(['encoder-module']);
    expect(body.prompt).toContain('encoder-card');
    expect(body.prompt).toContain('整个组往右移');
    await route.fulfill({ status: 500, json: { error: '模拟失败' } });
  });
  await page.locator('#ai-submit').click();
  await expect(page.locator('#ai-feedback')).toContainText('模拟失败');
  await expect(page.locator('.annotation-row')).toHaveCount(2);
});
