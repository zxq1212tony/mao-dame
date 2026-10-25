import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ANCHOR_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.ANCHOR_BROWSER_CHANNEL ? { channel: process.env.ANCHOR_BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const url = process.env.ANCHOR_TEST_URL || 'http://127.0.0.1:4179/plugin/';
await fs.mkdir(new URL('../.qa/', import.meta.url), { recursive: true });
try {
  await page.goto(url);
  assert.equal(await page.title(), '锚点 · 建筑提示词工作台');
  assert.ok(await page.locator('#copy-all').isDisabled());
  const payloads = await page.evaluate(() => ['base', 'material', 'atmosphere', 'plants'].map((role, i) => {
    const canvas = document.createElement('canvas'); canvas.width = i === 0 ? 1400 : 700; canvas.height = i === 0 ? 1000 : 900;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = ['#dddddd', '#8c9da8', '#a0a9b2', '#71836b'][i]; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#333'; ctx.font = '64px sans-serif'; ctx.fillText(role.toUpperCase(), 40, 100);
    // Edge markers make accidental crop visible in the reference board.
    ctx.fillRect(0, 0, 12, canvas.height); ctx.fillRect(canvas.width - 12, 0, 12, canvas.height);
    return { role, base64: canvas.toDataURL('image/png').split(',')[1] };
  }));
  for (const item of payloads) await page.locator(`[data-upload=${item.role}]`).setInputFiles({ name: `${item.role}.png`, mimeType: 'image/png', buffer: Buffer.from(item.base64, 'base64') });
  await page.locator('[name=note]').fill('道路为黑色，植物稀疏；保留塔楼之间的弧形连接。');
  await page.locator('[name=light]').selectOption('阴天柔光');
  await page.waitForFunction(() => !document.querySelector('#copy-all').disabled);
  const originalPrompt = await page.locator('#brief').inputValue();
  assert.match(originalPrompt, /区域 04｜植物景观/);
  assert.match(originalPrompt, /阴天柔光/);
  await page.locator('#copy-all').click();
  await page.getByText(/参考板与文字版提示词已写入剪贴板/).waitFor();
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read(); const item = items[0];
    const png = await item.getType('image/png'); const bitmap = await createImageBitmap(png);
    return { count: items.length, types: item.types, text: await (await item.getType('text/plain')).text(), width: bitmap.width, height: bitmap.height, bytes: png.size };
  });
  assert.equal(copied.count, 1); assert.ok(copied.types.includes('image/png')); assert.ok(copied.types.includes('text/plain'));
  assert.equal(copied.text.replaceAll('\r\n', '\n'), originalPrompt); assert.equal(copied.width, 2400); assert.ok(copied.bytes > 1000);
  // A real keyboard paste into another browser page, not a clipboard API mock.
  const target = await context.newPage(); await target.goto(url);
  await target.evaluate(() => {
    document.body.innerHTML = '<div contenteditable="true" id="paste-target">Paste test</div>';
    document.querySelector('#paste-target').addEventListener('paste', event => {
      event.preventDefault(); window.pasteResult = { text: event.clipboardData.getData('text/plain'), types: [...event.clipboardData.types], files: [...event.clipboardData.files].map(file => ({ type: file.type, size: file.size })) };
    });
  });
  await target.locator('#paste-target').click(); await target.keyboard.press('Control+V');
  await target.waitForFunction(() => window.pasteResult);
  const pasted = await target.evaluate(() => window.pasteResult);
  assert.equal(pasted.text.replaceAll('\r\n', '\n'), originalPrompt); assert.equal(pasted.files.length, 1); assert.equal(pasted.files[0].type, 'image/png');
  await target.close(); await page.bringToFront();
  await page.locator('#copy-image').click();
  await page.getByText(/参考板已复制（内含/).waitFor();
  const imageTypes = await page.evaluate(async () => (await navigator.clipboard.read())[0].types);
  assert.ok(imageTypes.includes('image/png')); assert.ok(!imageTypes.includes('text/plain'));
  await page.locator('#copy-text').click();
  await page.getByText(/仅提示词已复制/).waitFor();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), originalPrompt);
  const downloaded = page.waitForEvent('download'); await page.locator('#download-board').click();
  const download = await downloaded; await download.saveAs(fileURLToPath(new URL('../.qa/reference-board.png', import.meta.url)));
  const savedPlan = page.waitForEvent('download'); await page.locator('#save-plan').click();
  const plan = JSON.parse(await fs.readFile(await (await savedPlan).path(), 'utf8'));
  assert.equal(plan.images.length, 4);
  assert.equal(plan.images[0].dataUrl.split(',')[1], payloads[0].base64);
  await page.locator('[data-role=plants] .remove').click();
  await page.waitForFunction(() => !document.querySelector('#copy-all').disabled);
  assert.doesNotMatch(await page.locator('#brief').inputValue(), /区域 04/);
  await page.locator('#import-plan').setInputFiles({ name: 'saved.anchor.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await page.getByText(/方案已导入/).waitFor();
  await page.waitForFunction(() => !document.querySelector('#copy-all').disabled);
  assert.match(await page.locator('#brief').inputValue(), /区域 04/);
  await page.locator('#import-plan').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.getByText(/原有图片和设置已保留/).waitFor();
  assert.match(await page.locator('#brief').inputValue(), /区域 04/);
  await page.locator('[data-upload=base]').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') });
  await page.locator('#feedback').filter({ hasText: /已保留之前的图片/ }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#copy-all').disabled);
  // Edits invalidate the previous board immediately; copying can never use stale settings.
  await page.locator('[name=note]').fill('最新要求'.repeat(150));
  assert.ok(await page.locator('#copy-all').isDisabled());
  await page.waitForFunction(() => !document.querySelector('#copy-all').disabled);
  await page.locator('#copy-all').click();
  await page.getByText(/参考板与文字版提示词已写入剪贴板/).waitFor();
  assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('最新要求'.repeat(150)));
  await page.locator('[name=note]').fill('道路为黑色，植物稀疏；保留塔楼之间的弧形连接。');
  await page.waitForFunction(() => !document.querySelector('#copy-all').disabled);
  await page.screenshot({ path: fileURLToPath(new URL('../.qa/desktop.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: fileURLToPath(new URL('../.qa/mobile.png', import.meta.url)), fullPage: true });
  // Denied permissions must never report success or silently copy text instead.
  await page.evaluate(() => { navigator.clipboard.write = () => Promise.reject(new DOMException('Denied for test', 'NotAllowedError')); });
  await page.locator('#copy-all').click();
  await page.getByText(/本次未确认复制成功/).waitFor();
  assert.ok(!await page.locator('#copy-all').isDisabled());
  await page.locator('[data-role=base] .remove').click();
  assert.ok(await page.locator('#copy-all').isDisabled());
  assert.ok(await page.locator('#download-board').isDisabled());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, clipboard: { ...copied, text: '[full prompt verified]' }, paste: { types: pasted.types, files: pasted.files }, checks: 'Real browser clipboard write/read/paste; board and plan download; import; edits; invalid uploads; permission denial; mobile overflow. Does not verify ChatGPT paste handling.' }));
} finally { await browser.close(); }

