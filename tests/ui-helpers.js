import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
export async function openSample(page) {
  await expect(page.locator('#welcome')).toBeVisible();
  await page.locator('#file-input').setInputFiles({ name: 'method-overview.svg', mimeType: 'image/svg+xml', buffer: await readFile(new URL('../public/sample.svg',import.meta.url)) });
  await expect(page.locator('#artboard > svg')).toBeVisible();
  await expect(page.locator('#save-state')).toHaveText('项目已自动保存');
}
export async function reopenProject(page) {
  await expect(page.locator('#welcome')).toBeVisible();
  await page.locator('.project-card').first().click();
  await expect(page.locator('#artboard > svg')).toBeVisible();
}
