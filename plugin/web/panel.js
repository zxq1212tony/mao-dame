(() => {
  const $ = selector => document.querySelector(selector);
  const form = $('#anchor-form'), images = {}, settings = { ...DEFAULT_SETTINGS };
  const selecting = new Set(), selectionIds = {}, slotMessages = {};
  let busy = false, revision = 0, board = null, boardUrl = '', timer, preparing = false;
  const feedback = text => { $('#feedback').textContent = text; };
  function update() {
    for (const element of form.elements) element.disabled = busy;
    const pending = busy || selecting.size > 0;
    const ready = !!images.base && !pending;
    for (const id of ['save-plan', 'download-bundle', 'copy-text']) $('#' + id).disabled = !ready;
    for (const id of ['copy-all', 'copy-image', 'download-board']) $('#' + id).disabled = !ready || !board;
    $('#import-plan').disabled = pending;
    $('#copy-all').textContent = preparing ? '正在整理参考板…' : '复制图片＋提示词 ↗';
    $('#readiness').textContent = images.base ? Object.keys(images).length + ' 张图片 · 白模优先' : '先放入一张白模底图';
    $('#brief').value = buildBoardPrompt(settings, images);
  }
  function invalidate() {
    revision++; clearTimeout(timer); board = null; preparing = false;
    if (boardUrl) { URL.revokeObjectURL(boardUrl); boardUrl = ''; }
    $('#board-preview').removeAttribute('src'); $('#board-link').removeAttribute('href');
    $('#board-details').hidden = true; $('#board-placeholder').hidden = false;
    $('#board-placeholder').textContent = images.base ? '正在更新参考板…' : '选择白模后，这里会出现可复制的参考板。';
    update();
  }
  function scheduleBoard() {
    invalidate();
    if (!images.base || selecting.size) return;
    preparing = true; update();
    const expected = revision;
    timer = setTimeout(async () => {
      try {
        const result = await createReferenceBoard({ ...settings }, { ...images });
        if (expected !== revision) return;
        board = result; boardUrl = URL.createObjectURL(result.png);
        $('#board-preview').src = boardUrl; $('#board-link').href = boardUrl;
        $('#board-size').textContent = result.width + ' × ' + result.height;
        $('#board-details').hidden = false; $('#board-placeholder').hidden = true;
      } catch (error) {
        if (expected !== revision) return;
        $('#board-placeholder').textContent = error.message || '参考板准备失败，请重新选择图片。';
        feedback('参考板未准备完成，可以使用“下载原图包”保留原图和提示词。');
      } finally { if (expected === revision) { preparing = false; update(); } }
    }, 220);
  }
  function showSlot(id) {
    const slot = $('[data-role="' + id + '"]'), item = images[id], img = slot.querySelector('img');
    img.hidden = !item?.preview;
    if (item?.preview) img.src = item.preview; else img.removeAttribute('src');
    slot.querySelector('.plus').hidden = !!item?.preview;
    slot.querySelector('.file-name').textContent = item?.name || '未选择';
    slot.querySelector('.slot-status').textContent = slotMessages[id] || (item ? '已在本机准备好' : '');
    slot.querySelector('.remove').hidden = !item;
  }
  for (const role of ROLES) {
    const slot = document.createElement('article'); slot.className = 'slot'; slot.dataset.role = role.id;
    slot.innerHTML = '<label class="upload"><span class="plus">＋</span><img hidden alt="' + role.label + '预览"><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传' + role.label + '" data-upload="' + role.id + '"></label><h3>' + role.label + '</h3><small>' + role.hint + '</small><span class="file-name">未选择</span><p class="slot-status"></p><button type="button" class="remove" hidden>移除</button>';
    $('#image-slots').append(slot);
    const input = slot.querySelector('input');
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file || busy) return;
      const id = (selectionIds[role.id] || 0) + 1;
      selectionIds[role.id] = id; selecting.add(role.id); invalidate();
      slotMessages[role.id] = '正在读取图片…'; showSlot(role.id);
      try {
        const prepared = await createLocalPreview(file);
        if (selectionIds[role.id] !== id) return;
        images[role.id] = { name: file.name, ...prepared };
        delete slotMessages[role.id]; showSlot(role.id); feedback('图片已准备好。参考板会包含所有已选图片和完整提示词。');
      } catch (error) {
        if (selectionIds[role.id] !== id) return;
        slotMessages[role.id] = error.message + (images[role.id] ? ' 已保留之前的图片。' : '');
        showSlot(role.id); feedback(slotMessages[role.id]);
      } finally {
        if (selectionIds[role.id] === id) { input.value = ''; selecting.delete(role.id); scheduleBoard(); }
      }
    });
    slot.querySelector('.remove').onclick = () => {
      if (busy) return;
      selectionIds[role.id] = (selectionIds[role.id] || 0) + 1;
      selecting.delete(role.id); delete slotMessages[role.id]; delete images[role.id]; input.value = '';
      showSlot(role.id); scheduleBoard(); feedback('图片已移除，参考板和提示词已更新。');
    };
  }
  form.addEventListener('input', event => {
    if (!event.target.name) return;
    for (const key of ['mass', 'camera', 'site']) settings[key] = form.elements.namedItem(key).checked;
    for (const key of ['material', 'light', 'note']) settings[key] = form.elements.namedItem(key).value;
    scheduleBoard(); feedback('要求已更新，请复制最新版本。');
  });
  async function copyBoard(imageOnly = false) {
    if (!board || busy || selecting.size) return;
    if (!window.isSecureContext || !navigator.clipboard?.write || !window.ClipboardItem) {
      feedback('当前浏览器不能复制图片。请点击“下载参考板”后上传到聊天；完整提示词也在图中。'); return;
    }
    // Prepare before clicking to keep the clipboard call in the user gesture.
    const snapshot = board;
    busy = true; update();
    try {
      await navigator.clipboard.write([referenceClipboardItem(snapshot, window.ClipboardItem, imageOnly)]);
      feedback(imageOnly ? '参考板已复制（内含所有图片与完整提示词）。请回到聊天框粘贴，检查后发送。' : '参考板与文字版提示词已写入剪贴板。请回到聊天框粘贴；若只出现参考板，完整要求也在图中。若只有文字，请点“仅复制参考板”再粘贴。');
    } catch (error) {
      feedback(error.name === 'NotAllowedError'
        ? '浏览器未允许复制。请保持页面在前台并允许剪贴板权限后重试，或下载参考板上传；本次未确认复制成功。'
        : '图文复制未成功。请尝试“仅复制参考板”，或下载参考板上传；本次未确认复制成功。');
    } finally { busy = false; update(); }
  }
  form.onsubmit = event => { event.preventDefault(); copyBoard(); };
  $('#copy-image').onclick = () => copyBoard(true);
  $('#copy-text').onclick = async () => {
    if (busy || selecting.size || !images.base) return;
    try {
      await navigator.clipboard.writeText(buildBoardPrompt(settings, images));
      feedback('仅提示词已复制，请粘贴到已有参考板的聊天中。本次没有复制图片。');
    } catch {
      $('#brief-details').open = true; $('#brief').focus(); $('#brief').select();
      feedback('自动复制不可用。提示词已选中，请手动复制；本次没有复制图片。');
    }
  };
  function download(blob, name) {
    const href = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = href; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
  $('#download-board').onclick = () => {
    if (!board || busy || selecting.size) return;
    download(board.png, '锚点_参考图与提示词.png'); feedback('已发起参考板下载。请将 PNG 上传到聊天；图片内含完整提示词。');
  };
  $('#save-plan').onclick = () => {
    if (busy || selecting.size || !images.base) return;
    try { download(new Blob([exportPlan(settings, images)], { type: 'application/json' }), '锚点方案.anchor.json'); feedback('已发起方案下载，包含原图与设置。下次打开本页“导入方案”即可继续。'); }
    catch (error) { feedback('保存未完成：' + error.message); }
  };
  $('#download-bundle').onclick = () => {
    if (busy || selecting.size || !images.base) return;
    try { download(new Blob([createRenderBundle(settings, images)], { type: 'application/zip' }), '锚点_原图与提示词.zip'); feedback('已发起原图包下载。解压后上传编号图片，并粘贴 render-request.txt；原图保留原始清晰度。'); }
    catch (error) { feedback('打包未完成：' + error.message); }
  };
  $('#import-plan').onchange = async event => {
    const file = event.target.files[0]; if (!file || busy || selecting.size) { event.target.value = ''; return; }
    busy = true; update(); feedback('正在检查方案，检查通过后替换现有内容…');
    try {
      const restored = await importPlan(file);
      for (const role of ROLES) { delete images[role.id]; delete slotMessages[role.id]; }
      Object.assign(images, restored.images); Object.assign(settings, restored.settings);
      for (const key of Object.keys(settings)) {
        const control = form.elements.namedItem(key);
        if (typeof settings[key] === 'boolean') control.checked = settings[key]; else control.value = settings[key];
      }
      for (const role of ROLES) showSlot(role.id);
      scheduleBoard(); feedback('方案已导入，原图和选项已恢复。请复制更新后的参考板。');
    } catch (error) { feedback('导入未完成：' + error.message + ' 原有图片和设置已保留。'); }
    finally { event.target.value = ''; busy = false; update(); }
  };
  update();
})();
