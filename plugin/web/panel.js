(() => {
  const $ = selector => document.querySelector(selector);
  const form = $('#anchor-form');
  const images = {};
  const selecting = new Set();
  const selectionIds = {};
  const slotMessages = {};
  const settings = { ...DEFAULT_SETTINGS };
  let busy = false, busyLabel = '正在提交…', lastSubmitted = '', bridgeReady = false, sequence = 0, hostContext = {};
  const pending = new Map();
  const notify = (method, params = {}) => window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
  function request(method, params, timeout = 12000) {
    if (window.parent === window) return Promise.reject(new Error('没有聊天连接'));
    return new Promise((resolve, reject) => {
      const id = `anchor-${++sequence}`;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('聊天没有及时回应。请先查看聊天中是否已提交，避免重复生成。')); }, timeout);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
    const message = event.data;
    if (pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) { const error = new Error(message.error.message || '聊天请求失败'); error.code = message.error.code; entry.reject(error); }
      else entry.resolve(message.result);
    } else if (message.method === 'ui/notifications/host-context-changed') {
      hostContext = { ...hostContext, ...message.params }; update();
    } else if (message.method === 'ping' && message.id !== undefined) {
      window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
    }
  });
  function canSend() {
    const needsUpload = Object.values(images).some(item => !item.fileId);
    return !!((!needsUpload || window.openai?.uploadFile) && window.openai?.setWidgetState &&
      (bridgeReady || window.openai?.sendFollowUpMessage));
  }
  function imageMetadata() {
    return Object.fromEntries(ROLES.filter(role => images[role.id]?.fileId).map(role => [role.id, { fileId: images[role.id].fileId, name: images[role.id].name }]));
  }
  function persist() {
    if (!window.openai?.setWidgetState) return;
    const metadata = imageMetadata();
    window.openai.setWidgetState({
      modelContent: { workflow: 'anchor-render', brief: buildRequest(settings, metadata), imageRoles: ROLES.filter(role => metadata[role.id]).map(role => ({ role: role.label, ...metadata[role.id] })) },
      privateContent: { schemaVersion: 1, settings: { ...settings }, images: metadata },
      imageIds: ROLES.map(role => metadata[role.id]?.fileId).filter(Boolean),
    });
  }
  function feedback(text) { $('#feedback').textContent = text; }
  function update() {
    const connected = canSend();
    const embedded = bridgeReady || !!window.openai?.sendFollowUpMessage;
    $('#host-mode').textContent = connected
      ? '已连接聊天 · 点击提交后，所选图片将交给 ChatGPT。'
      : embedded ? '当前聊天暂未提供完整的图片提交功能 · 可以保存方案，或复制要求并在聊天中附上原图。'
      : '网页准备模式 · 图片仅在本页；准备好后，点击“在聊天中继续”查看提交步骤。';
    $('#expand').hidden = !(bridgeReady && hostContext.availableDisplayModes?.includes('fullscreen')) && !window.openai?.requestDisplayMode;
    $('#brief').value = buildRequest(settings, images);
    $('#readiness').textContent = images.base ? `已选择 ${Object.keys(images).length} 张图片 · 白模优先` : '先放入一张白模底图';
    for (const element of form.elements) element.disabled = busy;
    $('#send').disabled = busy || selecting.size > 0 || !images.base;
    $('#send').textContent = busy ? busyLabel : selecting.size ? '正在读取图片…' : connected ? '提交给 ChatGPT ↗' : '在聊天中继续 →';
    $('#submit-hint').textContent = connected ? '提交后由 ChatGPT 处理，结果显示在聊天中。' : '此页未连接聊天；继续按钮会显示操作步骤，不会发送图片。';
    $('#save-plan').disabled = busy || selecting.size > 0 || !images.base;
    $('#download-bundle').disabled = busy || selecting.size > 0 || !images.base;
    $('#handoff-reason').textContent = embedded ? '当前聊天缺少图片上传或提交能力。可保存方案后换到支持的聊天，或用下方的手动提交方式。' : '这个网页没有聊天连接，所选图片尚未提交。';
    if (connected) $('#handoff').hidden = true;
  }
  for (const role of ROLES) {
    const slot = document.createElement('article'); slot.className = 'slot'; slot.dataset.role = role.id;
    slot.innerHTML = `<label class="upload"><span class="plus">＋</span><img hidden alt="${role.label}预览"><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传${role.label}" data-upload="${role.id}"></label><h3>${role.label}</h3><small>${role.hint}</small><span class="file-name">未选择</span><p class="slot-status"></p><button type="button" class="remove" hidden>移除</button>`;
    $('#image-slots').append(slot);
    const input = slot.querySelector('input');
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file || busy) return;
      const selectionId = (selectionIds[role.id] || 0) + 1;
      selectionIds[role.id] = selectionId; selecting.add(role.id);
      slotMessages[role.id] = '正在读取图片…'; showSlot(role.id); feedback('正在读取所选图片…'); update();
      try {
        const prepared = await createLocalPreview(file);
        if (selectionIds[role.id] !== selectionId) return;
        images[role.id] = { name: file.name, ...prepared };
        delete slotMessages[role.id]; showSlot(role.id); lastSubmitted = '';
        feedback(canSend() ? '图片已在本地预览，点击提交时上传。' : '图片已在本页准备好，尚未发送。点击“在聊天中继续”查看下一步。');
        try { persist(); } catch { /* Selection remains available for the explicit submission. */ }
      } catch (error) {
        if (selectionIds[role.id] !== selectionId) return;
        slotMessages[role.id] = `${error.message || '图片读取失败，请重试。'}${images[role.id] ? ' 已保留之前的图片。' : ''}`;
        showSlot(role.id); feedback(slotMessages[role.id]); input.value = '';
      } finally {
        if (selectionIds[role.id] === selectionId) { selecting.delete(role.id); update(); }
      }
    });
    slot.querySelector('.remove').addEventListener('click', () => {
      if (busy) return;
      selectionIds[role.id] = (selectionIds[role.id] || 0) + 1; selecting.delete(role.id); delete slotMessages[role.id];
      delete images[role.id]; input.value = ''; showSlot(role.id); lastSubmitted = ''; feedback('图片已移除。'); update();
      try { persist(); } catch { feedback('聊天状态暂时无法更新，请在提交时重试。'); }
    });
  }
  function showSlot(id) {
    const slot = $(`[data-role="${id}"]`), item = images[id], img = slot.querySelector('img');
    img.hidden = !item?.preview;
    if (item?.preview) img.src = item.preview; else img.removeAttribute('src');
    slot.querySelector('.plus').hidden = !!item?.preview;
    slot.querySelector('.file-name').textContent = item?.name || '未选择';
    slot.querySelector('.slot-status').textContent = slotMessages[id] || (item?.fileId ? '已上传到聊天' : item ? '等待提交' : '');
    slot.querySelector('.remove').hidden = !item;
  }
  function readSettings() {
    for (const key of ['mass', 'camera', 'site']) settings[key] = form.elements.namedItem(key).checked;
    for (const key of ['material', 'light', 'note']) settings[key] = form.elements.namedItem(key).value;
    lastSubmitted = ''; update();
    try { persist(); } catch { /* A failed persistence call is surfaced on submit. */ }
  }
  form.addEventListener('input', event => { if (event.target.name) readSettings(); });
  form.addEventListener('change', event => { if (event.target.name) readSettings(); });
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(buildRequest(settings, images)); feedback('要求已复制。若手动提交，请同时附上对应图片。'); }
    catch { $('#brief').closest('details').open = true; $('#brief').focus(); $('#brief').select(); feedback('请复制已选中的要求，并同时附上对应图片。'); }
  };
  $('#save-plan').onclick = () => {
    if (busy || selecting.size) return;
    let href;
    try {
      href = URL.createObjectURL(new Blob([exportPlan(settings, images)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = href; link.download = '锚点方案.anchor.json';
      document.body.append(link); link.click(); link.remove();
      feedback('已发起方案下载。请确认文件已保存，再切换页面；在聊天面板点“导入方案”即可恢复。此操作没有提交图片。');
    } catch (error) { feedback(`保存未完成：${error.message}`); }
    finally { if (href) setTimeout(() => URL.revokeObjectURL(href), 60000); }
  };
  $('#download-bundle').onclick = async () => {
    if (busy || selecting.size || !images.base) return;
    let href;
    busy = true; busyLabel = '正在打包…'; update();
    try {
      // Let the busy state paint before assembling potentially large original files.
      await new Promise(resolve => setTimeout(resolve, 30));
      href = URL.createObjectURL(new Blob([createRenderBundle(settings, images)], { type: 'application/zip' }));
      const link = document.createElement('a'); link.href = href; link.download = '锚点生图包.zip';
      document.body.append(link); link.click(); link.remove();
      feedback('已发起生图包下载。将 ZIP 附在 Codex 聊天中，发送“使用锚点插件读取生图包并生成一张效果图”。下载不等于已上传或已生成。');
    } catch (error) { feedback(`打包未完成：${error.message}`); }
    finally { if (href) setTimeout(() => URL.revokeObjectURL(href), 60000); busy = false; busyLabel = '正在提交…'; update(); }
  };
  $('#import-plan').onchange = async event => {
    const file = event.target.files[0]; if (!file || busy || selecting.size) { event.target.value = ''; return; }
    busy = true; busyLabel = '正在导入方案…'; update(); feedback('正在读取方案，现有图片会在检查通过后替换…');
    try {
      const restored = await importPlan(file);
      for (const role of ROLES) { delete images[role.id]; delete slotMessages[role.id]; }
      Object.assign(images, restored.images); Object.assign(settings, restored.settings);
      applySettings();
      for (const role of ROLES) { $(`[data-upload="${role.id}"]`).value = ''; showSlot(role.id); }
      lastSubmitted = '';
      try { persist(); } catch { /* Import is local and can still be submitted explicitly. */ }
      feedback('方案已导入，原图、分类与选项已恢复。请确认后再提交；导入不会自动发送。');
    } catch (error) { feedback(`导入未完成：${error.message} 原有图片和设置已保留。`); }
    finally { event.target.value = ''; busy = false; busyLabel = '正在提交…'; update(); }
  };
  $('#expand').onclick = async () => {
    try {
      if (bridgeReady && hostContext.availableDisplayModes?.includes('fullscreen')) await request('ui/request-display-mode', { mode: 'fullscreen' });
      else await window.openai?.requestDisplayMode?.({ mode: 'fullscreen' });
    } catch (error) { feedback(error.message); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || selecting.size || !images.base) return;
    if (!canSend()) {
      $('#handoff').hidden = false; $('#handoff-title').focus();
      $('#handoff').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      feedback('请按上方步骤进入聊天面板。当前图片仍留在本页，没有发送。');
      return;
    }
    if (lastSubmitted === buildRequest(settings, images)) { feedback('这一组要求已提交。请先查看聊天中的结果；修改选项后可以再次提交。'); return; }
    busy = true; update(); feedback('正在上传所选图片…');
    try {
      for (const role of ROLES) {
        const item = images[role.id]; if (!item || item.fileId) continue;
        const uploaded = await window.openai.uploadFile(item.file);
        if (!uploaded?.fileId) throw new Error('聊天未返回图片标识，请重试。');
        item.fileId = uploaded.fileId; showSlot(role.id);
      }
      const prompt = buildRequest(settings, images);
      persist();
      if (bridgeReady) {
        try { await request('ui/update-model-context', { content: [{ type: 'text', text: prompt }] }); }
        catch (error) { if (error.code !== -32601) throw error; }
        try { await request('ui/message', { role: 'user', content: [{ type: 'text', text: prompt }] }); }
        catch (error) {
          // Retry only an explicit unsupported format/method response, never a timeout.
          if (error.code === -32602) await request('ui/message', { role: 'user', content: { type: 'text', text: prompt } });
          else if (error.code === -32601 && window.openai?.sendFollowUpMessage) await window.openai.sendFollowUpMessage({ prompt });
          else throw error;
        }
      } else await window.openai.sendFollowUpMessage({ prompt });
      lastSubmitted = prompt;
      feedback('图片和要求已提交给聊天。请到聊天中查看处理结果；此提示不代表图片已经生成。');
    } catch (error) { feedback(`提交未确认：${error.message || '请稍后重试。'}`); }
    finally { busy = false; update(); }
  };
  function restore() {
    const saved = window.openai?.widgetState?.privateContent;
    if (saved?.schemaVersion !== 1) return;
    for (const key of ['mass','camera','site']) if (typeof saved.settings?.[key] === 'boolean') settings[key] = saved.settings[key];
    for (const key of ['material','light']) if ([...form.elements.namedItem(key).options].some(option => option.value === saved.settings?.[key])) settings[key] = saved.settings[key];
    if (typeof saved.settings?.note === 'string') settings.note = saved.settings.note.slice(0,600);
    applySettings();
    for (const role of ROLES) {
      const item = saved.images?.[role.id];
      if (typeof item?.fileId === 'string' && typeof item?.name === 'string') { images[role.id] = { fileId: item.fileId, name: item.name }; showSlot(role.id); }
    }
  }
  function applySettings() {
    for (const key of Object.keys(settings)) {
      const control = form.elements.namedItem(key);
      if (typeof settings[key] === 'boolean') control.checked = settings[key]; else control.value = settings[key];
    }
  }
  restore(); update();
  window.addEventListener('openai:set_globals', () => update());
  if (window.parent !== window) {
    request('ui/initialize', { appInfo: { name: 'anchor-render-panel', version: ANCHOR_VERSION }, appCapabilities: { availableDisplayModes: ['inline','fullscreen'] }, protocolVersion: '2026-01-26' }, 6000)
      .then(result => { bridgeReady = true; hostContext = result?.hostContext || {}; notify('ui/notifications/initialized'); update();
        let lastHeight = 0;
        new ResizeObserver(() => { const height = Math.ceil(document.body.getBoundingClientRect().height); if (height !== lastHeight) { lastHeight = height; notify('ui/notifications/size-changed', { height }); } }).observe(document.body);
      }).catch(() => update());
  }
})();
