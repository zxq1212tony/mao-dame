import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardPrompt, wrapBoardText, referenceClipboardItem } from '../plugin/web/clipboard.js';
import { DEFAULT_SETTINGS, buildRequest } from '../plugin/web/workflow.js';

test('missing optional references retain their fixed board numbers', () => {
  const prompt = buildBoardPrompt(DEFAULT_SETTINGS, { base: { name: 'base.png' }, plants: { name: 'plants.png' } });
  assert.match(prompt, /区域 01｜白模底图/);
  assert.match(prompt, /区域 04｜植物景观/);
  assert.doesNotMatch(prompt, /区域 02|区域 03/);
  assert.match(prompt, /不要输出拼图/);
});
test('all selected constraints and long custom text survive prompt construction', () => {
  const note = '保持道路黑色，植物稀疏。'.repeat(50);
  const prompt = buildBoardPrompt({ ...DEFAULT_SETTINGS, material: '金属竖向构件', note }, { base: {} });
  assert.ok(prompt.includes(note));
  assert.match(prompt, /金属竖向构件/);
  assert.match(prompt, /保持底图的相机角度/);
  assert.doesNotMatch(buildBoardPrompt({ ...DEFAULT_SETTINGS, camera: false }, { base: {} }), /保持底图的相机角度/);
});
test('wrapping preserves Chinese, emoji, punctuation and long Latin strings', () => {
  const input = '道路保持黑色🌳。abcdefghijklmnop\n第二段，玻璃。';
  const lines = wrapBoardText(input, value => Array.from(value).length * 10, 50);
  assert.equal(lines.join(''), input.replaceAll('\n', ''));
  assert.ok(lines.every(line => Array.from(line).length <= 5));
});
test('clipboard contains a real PNG plus safe HTML and plain prompt in one item', async () => {
  class Item { constructor(data) { this.data = data; } static supports() { return true; } }
  const board = { png: new Blob(['png'], { type: 'image/png' }), prompt: '<img src=x onerror=alert(1)>\nA & B', dataUrl: 'data:image/png;base64,AAAA', width: 2400, height: 2000 };
  const item = referenceClipboardItem(board, Item);
  assert.deepEqual(Object.keys(item.data).sort(), ['image/png', 'text/html', 'text/plain']);
  assert.equal(await item.data['text/plain'].text(), board.prompt);
  const html = await item.data['text/html'].text();
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img/);
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.deepEqual(Object.keys(referenceClipboardItem(board, Item, true).data), ['image/png']);
});
test('original-file prompt refers to attachments, not a nonexistent reference board', () => {
  const prompt = buildRequest(DEFAULT_SETTINGS, { base: { name: '01-base.png' }, plants: { name: '04-plants.png' } });
  assert.match(prompt, /图 2｜植物景观｜04-plants.png/);
  assert.doesNotMatch(prompt, /参考板/);
});
