import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { pdfFixture } from '../tests/pdf-fixture.js';

const work = await mkdtemp(join(tmpdir(), 'figura-desktop-check-'));
const fakeCli = join(work, 'codex-fixture.js');
await writeFile(fakeCli, `const fs=require('fs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const a=process.argv;fs.writeFileSync(a[a.indexOf('-o')+1],JSON.stringify({summary:'Desktop transport verified',replacements:[{id:'encoder-card',svg:'<rect id="encoder-card" x="335" y="202" width="285" height="249" rx="10" fill="#aac5f2"/>'}],rasterAssets:[],attachmentStatus:[]}));});`);
const executablePath = process.env.FIGURA_EXE;
const launch = () => electron.launch({ ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['.'] }),
  env: { ...process.env, FIGURA_USER_DATA: join(work, 'profile'), FIGURA_PORT: '14329', CODEX_BIN: fakeCli }, timeout: 60000 });
let app = await launch();
try {
  const page = await app.firstWindow();
  await expect(page.locator('#welcome')).toBeVisible();
  await page.locator('#file-input').setInputFiles(resolve('public/sample.svg'));
  await expect(page.locator('#encoder-card')).toBeVisible();
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await page.locator('#fill-value').fill('#aaccdd');
  await page.locator('#fill-value').press('Tab');
  await expect(page.locator('#encoder-card')).toHaveCSS('fill', 'rgb(170, 204, 221)');
  const save = await page.evaluate(async ({ work }) => {
    const status = await (await fetch('/api/status')).json();
    const body = { directory: work, name: 'desktop-smoke.svg', svg: document.querySelector('#artboard').innerHTML };
    const response = await fetch('/api/files/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-figura-token': status.token }, body: JSON.stringify(body) });
    return { status: response.status, result: await response.json() };
  }, { work });
  assert.equal(save.status, 200, JSON.stringify(save));
  assert.match(await readFile(join(work, 'desktop-smoke.svg'), 'utf8'), /encoder-card/);
  // Exercise packaged PDF worker + native canvas + Electron-as-Node CLI dispatch.
  const pdf = pdfFixture().toString('base64');
  const result = await page.evaluate(async pdf => {
    const status = await (await fetch('/api/status')).json();
    const response = await fetch('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-figura-token': status.token }, body: JSON.stringify({ svg: document.querySelector('#artboard').innerHTML, ids: ['encoder-card'], prompt: 'Test transport', attachments: [{ id: 'pdf', name: 'test.pdf', data: pdf, pages: '1' }] }) });
    return { status: response.status, result: await response.json() };
  }, pdf);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.result.summary, 'Desktop transport verified');
  await expect(page.locator('#save-state')).toHaveText('项目已自动保存');
  await app.close();
  app = await launch();
  const reopened = await app.firstWindow();
  await expect(reopened.locator('.project-card')).toHaveCount(1);
  await reopened.locator('.project-card').click();
  await expect(reopened.locator('#encoder-card')).toHaveCSS('fill', 'rgb(170, 204, 221)');
  console.log('Desktop verified: launch, import, edit, disk save, PDF worker/native canvas, CLI dispatch (fixture), project persistence.');
} finally { await app.close(); }
console.log('Evidence directory:', work);
