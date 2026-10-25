import { ROLES, buildRequest } from './workflow.js';

export function buildBoardPrompt(settings, images) {
  return buildRequest(settings, images, { board: true });
}

export function escapeClipboardHtml(text) {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function wrapBoardText(text, measure, maxWidth) {
  const lines = [];
  for (const paragraph of text.replace(/\n{3,}/g, '\n\n').split('\n')) {
    let line = '';
    for (const char of Array.from(paragraph)) {
      if (line && measure(line + char) > maxWidth) { lines.push(line); line = char; }
      else line += char;
    }
    lines.push(line);
  }
  return lines;
}

function loadBoardImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error('参考板读取图片超时，请重新选择图片。')), 15000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('无法绘制参考板，请重新导出这张图片。')); };
    image.src = src;
  });
}

// The PNG includes every prompt character. Image-only paste targets retain the brief.
// All drawing is local; there is no image upload or generation request here.
export async function createReferenceBoard(settings, images) {
  if (!images.base?.preview) throw new Error('请先选择白模底图。');
  const active = ROLES.filter(role => images[role.id]);
  const loaded = await Promise.all(active.map(role => loadBoardImage(images[role.id].preview)));
  const prompt = buildBoardPrompt(settings, images);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法创建参考板，请换一个浏览器重试。');
  const width = 2400, padding = 64, gap = 40, textSize = 32, lineHeight = 48;
  const font = '"Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  ctx.font = `${textSize}px ${font}`;
  const columnWidth = (width - padding * 2 - gap) / 2;
  const lines = wrapBoardText(prompt, text => ctx.measureText(text).width, columnWidth);
  const rows = Math.ceil(lines.length / 2);
  const imageTop = 180, imageHeight = 1080, textTop = imageTop + imageHeight + 110;
  const height = textTop + rows * lineHeight + 90;
  if (height > 7000) throw new Error('提示词换行过多，参考板过长。请合并部分换行后重试，或下载原图包。');
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'top';
  const text = (value, x, y, size = 32, color = '#222222', bold = false) => {
    ctx.font = `${bold ? '600 ' : ''}${size}px ${font}`;
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  text('ANCHOR / 建筑效果图参考板', padding, 44, 44, '#111111', true);
  text('请按下方完整提示词生成一张效果图。编号、边框和文字仅为输入说明，不要画入结果。', padding, 110, 28, '#555555');
  function drawTile(role, image, x, y, w, h) {
    const number = String(ROLES.findIndex(item => item.id === role.id) + 1).padStart(2, '0');
    text(`${number} / ${role.label}`, x, y, 32, '#111111', true);
    const top = y + 50, available = h - 50;
    ctx.fillStyle = '#f3f3f1'; ctx.fillRect(x, top, w, available);
    const scale = Math.min(w / image.naturalWidth, available / image.naturalHeight);
    const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
    ctx.drawImage(image, x + (w - iw) / 2, top + (available - ih) / 2, iw, ih);
  }
  const references = active.length - 1;
  const contentWidth = width - padding * 2;
  const baseWidth = references ? 1490 : contentWidth;
  drawTile(active[0], loaded[0], padding, imageTop, baseWidth, imageHeight);
  if (references) {
    const refWidth = contentWidth - baseWidth - gap;
    const refHeight = (imageHeight - gap * (references - 1)) / references;
    active.slice(1).forEach((role, index) => drawTile(role, loaded[index + 1], padding + baseWidth + gap, imageTop + index * (refHeight + gap), refWidth, refHeight));
  }
  text('生成要求 / 完整提示词', padding, textTop - 64, 34, '#111111', true);
  lines.forEach((line, index) => {
    const col = index < rows ? 0 : 1, row = index % rows;
    text(line, padding + col * (columnWidth + gap), textTop + row * lineHeight, textSize);
  });
  text('只生成单幅建筑效果图 · 保留原有构图比例 · 不复刻参考板排版', padding, height - 50, 24, '#666666');
  const png = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('参考板导出失败，请重试。')), 'image/png'));
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(png);
  });
  return { png, dataUrl, prompt, width, height, count: active.length };
}

// A single ClipboardItem has multiple representations. Multiple image items are
// not portable on OS clipboards; do not silently drop reference images.
export function referenceClipboardItem(board, ClipboardItemClass = globalThis.ClipboardItem, imageOnly = false) {
  const data = { 'image/png': board.png };
  if (!imageOnly) {
    data['text/plain'] = new Blob([board.prompt], { type: 'text/plain' });
    if (!ClipboardItemClass.supports || ClipboardItemClass.supports('text/html')) {
      const html = `<div><p>${escapeClipboardHtml(board.prompt).replace(/\n/g, '<br>')}</p><img src="${board.dataUrl}" alt="锚点参考板：全部参考图及完整提示词" width="${board.width}" height="${board.height}"></div>`;
      data['text/html'] = new Blob([html], { type: 'text/html' });
    }
  }
  return new ClipboardItemClass(data);
}
