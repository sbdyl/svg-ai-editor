import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const profile = await mkdtemp(join(tmpdir(), 'figura-portable-check-'));
const launcher = spawn(resolve('release/Figura-SVG-Studio-1.0.0-x64-Portable.exe'), ['--remote-debugging-port=14331'], {
  windowsHide: true, stdio: 'ignore', env: { ...process.env, FIGURA_USER_DATA: profile, FIGURA_PORT: '14330' },
});
let browser;
try {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { const response = await fetch('http://127.0.0.1:14331/json/version'); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  browser = await chromium.connectOverCDP('http://127.0.0.1:14331');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  await expect(page.locator('#welcome')).toBeVisible();
  await page.locator('#file-input').setInputFiles(resolve('public/sample.svg'));
  await expect(page.locator('#encoder-card')).toBeVisible();
  await page.locator('#encoder-card').click({ position: { x: 6, y: 6 } });
  await page.locator('#fill-value').fill('#aaccdd'); await page.locator('#fill-value').press('Tab');
  await expect(page.locator('#encoder-card')).toHaveCSS('fill', 'rgb(170, 204, 221)');
  await page.screenshot({ path: '.release-work/portable-verified.png' });
  console.log('Portable EXE verified: extraction, window launch, import, edit.');
} finally {
  if (browser) { const cdp = await browser.newBrowserCDPSession(); await Promise.race([cdp.send('Browser.close').catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]); await browser.close(); }
  else if (launcher.pid) spawn('taskkill', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}
