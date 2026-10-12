import { chromium, expect } from '@playwright/test';
import { createServer } from '../server.js';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('docs/media', { recursive: true });
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, recordVideo: { dir: '.release-work/video', size: { width: 1500, height: 1000 } } });
const page = await context.newPage();
const pause = ms => page.waitForTimeout(ms);
async function caption(kicker, title) {
  await page.evaluate(({ kicker, title }) => {
    document.querySelector('#demo-caption')?.remove();
    const box = document.createElement('div'); box.id = 'demo-caption';
    box.style.cssText = 'position:fixed;z-index:99999;bottom:28px;left:50%;transform:translateX(-50%);background:#243126f2;color:white;border:1px solid #9eb087;border-radius:16px;padding:14px 32px;box-shadow:0 12px 40px #0003;text-align:center;pointer-events:none;font:19px system-ui;min-width:550px';
    const small = document.createElement('div'); small.textContent = kicker; small.style.cssText = 'font:11px system-ui;letter-spacing:3px;color:#c8d6ac;margin-bottom:6px';
    const text = document.createElement('div'); text.textContent = title;
    box.append(small, text); document.body.append(box);
  }, { kicker, title });
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.locator('#welcome')).toBeVisible(); await pause(1200);
  await page.screenshot({ path: 'docs/media/welcome.png' });
  await caption('FIGURA / SVG STUDIO', '每一个细节，都值得精心表达。'); await pause(3500);
  await page.locator('#file-input').setInputFiles(resolve('public/sample.svg'));
  await expect(page.locator('#encoder-card')).toBeVisible();
  await caption('01 / OPEN', '打开 SVG，保留图层、文字与矢量结构'); await pause(3500);
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await caption('02 / REFINE', '选中元素，直接调整填充与样式');
  await page.locator('#fill-value').fill('#dbe6f5'); await page.locator('#fill-value').press('Tab'); await pause(2500);
  await page.locator('#undo').click(); await pause(1000); await page.locator('#redo').click(); await pause(1000);
  await caption('03 / ANNOTATE', '把多处修改意见，留在各自的选区');
  await page.locator('#ai-prompt').fill('将编码器背景改成柔和的浅蓝色'); await pause(1000); await page.locator('#add-annotation').click();
  await page.locator('#input-card').click({ position: { x: 6, y: 6 } });
  await page.locator('#ai-prompt').fill('加粗输入模块的边框，保留文字与结构'); await pause(1000); await page.locator('#add-annotation').click(); await pause(2500);
  await page.evaluate(() => document.querySelector('#demo-caption')?.remove());
  await page.screenshot({ path: 'docs/media/editor.png' });
  await caption('AI WORKFLOW', '意见可统一发送给 Codex；本片演示标注准备，不调用模型'); await pause(4000);
  await caption('04 / EXPORT', '导出标准 SVG，继续你的论文与设计工作');
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadEvent;
  await download.saveAs('.release-work/demo-export.svg'); await pause(3000);
  await page.locator('#go-home').click();
  await caption('05 / CONTINUE', '历史项目自动保存，下次接着创作'); await pause(3000);
  await page.locator('.project-card').first().click(); await pause(1500);
  await caption('FIGURA / MADE FOR DISCOVERY', 'From pixels to possibilities.'); await pause(3000);
} finally {
  const video = page.video(); await context.close(); await copyFile(await video.path(), 'docs/media/figura-demo.webm');
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
console.log('Recorded real application workflow; no AI request was made.');
