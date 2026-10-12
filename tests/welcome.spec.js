import { test, expect } from '@playwright/test';
import { openSample, reopenProject } from './ui-helpers.js';
import { createCanvas } from '@napi-rs/canvas';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({page}, testInfo) => {
  const directory = testInfo.outputPath('projects');
  await mkdir(directory, {recursive:true});
  await page.route('**/api/status', async route => {
    const status = await (await route.fetch()).json();
    await route.fulfill({json:{...status,available:true,defaultDirectory:directory}});
  });
});

test('welcome animates, creates independent projects and restores history explicitly', async ({page}) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible(); await expect(page.locator('#studio')).toBeHidden();
  expect(await page.locator('.diagram-sheet').evaluate(el=>getComputedStyle(el).animationName)).toBe('sheet-float');
  await page.locator('#welcome-blank').click();
  await page.locator('#file-name').fill('My figure'); await page.locator('#file-confirm').click();
  await expect(page.locator('#selected-name')).toHaveText('artwork');
  await page.locator('#ai-prompt').fill('绘制流程框架'); await page.locator('#add-annotation').click();
  await page.locator('#go-home').click(); await expect(page.locator('.project-card')).toHaveCount(1);
  await page.locator('#welcome-blank').click(); await page.locator('#file-name').fill('Second'); await page.locator('#file-confirm').click();
  await page.locator('#go-home').click(); await expect(page.locator('.project-card')).toHaveCount(2);
  await page.reload(); await expect(page.locator('#studio')).toBeHidden();
  await page.getByRole('button',{name:/My figure.svg 缩略图/}).click();
  await expect(page.locator('.annotation-row')).toContainText('绘制流程框架');
  await expect(page.locator('#filename')).toHaveText('My figure.svg');
  expect(errors).toEqual([]);
});

test('mixed drop attaches context without replacing canvas and image toggle is scoped', async ({page}) => {
  await page.goto('/'); await openSample(page);
  const before=await page.locator('#artboard').innerHTML();
  const png=createCanvas(30,30).toBuffer('image/png');
  await page.evaluate(bytes=>{
    const data=new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)],'reference.png',{type:'image/png'})); data.items.add(new File(['reference text'],'notes.md',{type:'text/markdown'}));
    document.querySelector('#viewport').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));
  },[...png]);
  await expect(page.locator('.context-chip')).toHaveCount(2);
  expect(await page.locator('#artboard').innerHTML()).toBe(before);
  await expect(page.getByRole('checkbox',{name:'reference.png 按可编辑 SVG 重绘'})).not.toBeChecked();
  await page.getByRole('checkbox',{name:'reference.png 按可编辑 SVG 重绘'}).check();
  await expect(page.locator('#reconstruction-rules')).toBeVisible();
  await page.locator('#encoder-card').click({position:{x:6,y:6}});
  await page.route('**/api/edit',route=>{
    const body=route.request().postDataJSON(); expect(body.attachments[0].redraw).toBe(true); expect(body.ids).toEqual(['encoder-card']);
    return route.fulfill({json:{summary:'完成',replacements:[{id:'encoder-card',svg:'<rect id="encoder-card" x="335" y="202" width="285" height="249" fill="blue"/>'}],attachmentStatus:body.attachments.map(file=>({id:file.id,status:'read',message:'已读取'}))}});
  });
  await page.locator('#ai-prompt').fill('参考图片调整颜色'); await page.locator('#ai-submit').click(); await page.locator('#apply').click();
  await expect(page.locator('.context-chip[data-state=read]')).toHaveCount(2);
  await page.locator('#go-home').click(); await page.locator('#welcome-blank').click(); await page.locator('#file-confirm').click();
  await expect(page.locator('.context-chip')).toHaveCount(0);
  await page.locator('#go-home').click(); await page.getByRole('button',{name:/method-overview.svg 缩略图/}).click();
  await expect(page.locator('.context-chip')).toHaveCount(2);
  await page.reload(); await reopenProject(page); await expect(page.locator('.context-chip')).toHaveCount(0);
});

test('legacy draft migrates without auto-opening and animated welcome fits desktop sizes', async ({page}) => {
  await page.addInitScript(()=>{ if (!sessionStorage.getItem('seed')) { localStorage.setItem('figura-document',JSON.stringify({filename:'legacy.svg',svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text id="text" x="10" y="20">Old draft</text></svg>',annotations:[]})); sessionStorage.setItem('seed','yes'); } });
  await page.goto('/'); await expect(page.locator('.project-card')).toHaveCount(1); await expect(page.locator('#studio')).toBeHidden();
  expect(await page.evaluate(()=>localStorage.getItem('figura-document'))).toBeNull();
  for (const width of [1440,1280,1024,390]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#welcome-png')).toBeVisible();
  }
  await page.setViewportSize({width:1440,height:960}); await reopenProject(page); await expect(page.locator('#text')).toHaveText('Old draft');
});
