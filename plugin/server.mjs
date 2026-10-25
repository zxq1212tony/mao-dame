import { renderTool, prepareRender } from './render-brief.mjs';
export const VERSION = '0.1.4';
const emptyInput = { type: 'object', properties: {}, additionalProperties: false };
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
export function toolList(panelUri) {
  return [
    renderTool,
    { name: 'open_anchor_panel', title: '打开锚点建筑渲染面板', description: 'Open an interactive architectural rendering brief panel. Users upload a Rhino white-model image and optional facade, atmosphere and planting references, then submit an explicit request to the current chat. This tool only opens the panel; it does not generate images, access ChatGPT quota, or call a paid image API. Native generation is a separate host capability.', inputSchema: emptyInput, annotations, _meta: { ui: { resourceUri: panelUri }, 'openai/outputTemplate': panelUri, 'openai/toolInvocation/invoking': '正在打开锚点面板', 'openai/toolInvocation/invoked': '锚点面板已打开' } },
    { name: 'anchor_status', title: '检查锚点连接', description: 'Read-only diagnostic of Anchor version and recorded test scope. Report portable-bundle generation separately from panel upload and current-client capability. Does not access user images, usage or private project data.', inputSchema: emptyInput, annotations, outputSchema: { type: 'object', properties: { status: { type: 'string' }, version: { type: 'string' }, generationMode: { type: 'string' }, nativeGenerationVerified: { type: 'boolean' }, panelGenerationVerified: { type: 'boolean' }, verificationScope: { type: 'string' } }, required: ['status','version','generationMode','nativeGenerationVerified','panelGenerationVerified','verificationScope'], additionalProperties: false } },
  ];
}
export async function handleMcp(request, { panelHtml, panelUri }) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  const error = (id, code, message, status = 200) => json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status);
  if (!request.headers.get('content-type')?.includes('application/json')) return error(null, -32600, 'Content-Type must be application/json', 415);
  // Only protocol requests and image metadata are accepted; image bytes stay with the host.
  const reader = request.body?.getReader(); const chunks = []; let size = 0;
  if (reader) { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); return error(null, -32600, 'Request too large', 413); } chunks.push(value); } }
  let body;
  try { const raw = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; } body = JSON.parse(new TextDecoder().decode(raw)); }
  catch { return error(null, -32700, 'Parse error', 400); }
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || (body.id !== undefined && typeof body.id !== 'string' && typeof body.id !== 'number')) return error(null, -32600, 'Invalid request', 400);
  if (body.id === undefined) return new Response(null, { status: 202 });
  const { id, method, params = {} } = body;
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return error(id, -32602, 'Invalid params');
  const ok = result => json({ jsonrpc: '2.0', id, result });
  if (method === 'server/discover') return ok({ supportedVersions: ['2026-07-28'], capabilities: { tools: {}, resources: {} } });
  if (method === 'initialize') return ok({ protocolVersion: ['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25', capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }, serverInfo: { name: 'anchor-render-studio', title: '锚点 · 建筑图像工作台', version: VERSION }, instructions: 'Open the Anchor panel when requested. This service assembles references and constraints; it has no image generation backend. After the user submits an explicit rendering request, use native image generation if available with the supplied image roles. Say when images or generation are unavailable. Do not claim geometry is strictly locked or an image has been produced before the generation tool succeeds.' });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: toolList(panelUri) });
  if (method === 'resources/list') return ok({ resources: [{ uri: panelUri, name: '锚点渲染面板', mimeType: 'text/html;profile=mcp-app' }] });
  if (method === 'resources/templates/list') return ok({ resourceTemplates: [] });
  if (method === 'resources/read') {
    // Existing conversations may retain a prior content-hashed tool descriptor after deployment.
    // Serve the current public panel for our own old template URIs, never arbitrary resources.
    const ownPreviousPanel = typeof params.uri === 'string' && /^ui:\/\/anchor\/panel-[a-f0-9]{1,8}\.html$/.test(params.uri);
    if (params.uri !== panelUri && !ownPreviousPanel) return error(id, -32002, 'Unknown resource');
    console.info(JSON.stringify({ scope: 'anchor-ui', event: 'panel-resource-read', version: VERSION, cachedReference: params.uri !== panelUri }));
    return ok({ contents: [{ uri: params.uri, mimeType: 'text/html;profile=mcp-app', text: panelHtml, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, 'openai/widgetDescription': '锚点：上传白模与分类参考，设置约束，然后提交给当前聊天。', 'openai/widgetPrefersBorder': true } }] });
  }
  if (method === 'tools/call') {
    if (params.name === 'prepare_anchor_render') {
      try { return ok(prepareRender(params.arguments)); }
      catch (failure) { return ok({ isError: true, content: [{ type: 'text', text: failure.message }] }); }
    }
    if (params.arguments !== undefined && (params.arguments === null || typeof params.arguments !== 'object' || Array.isArray(params.arguments) || Object.keys(params.arguments).length)) return error(id, -32602, 'This tool accepts an empty argument object');
    if (params.name === 'open_anchor_panel') {
      console.info(JSON.stringify({ scope: 'anchor-ui', event: 'panel-tool-called', version: VERSION }));
      return ok({ content: [{ type: 'text', text: '锚点面板请求已完成。只有客户端实际显示面板且顶部为“已连接聊天”，才能直接提交图片；工具调用成功不代表界面已经显示。若面板不可用，请让用户直接在聊天中附图，使用 prepare_anchor_render 整理角色和要求后继续调用原生生图。此步骤没有生成图片。' }] });
    }
    if (params.name === 'anchor_status') {
      const status = {
        status: 'ready', version: VERSION, generationMode: 'host-native-panel-or-chat-attachments',
        nativeGenerationVerified: true, panelGenerationVerified: false,
        verificationScope: '2026-10-20: local web panel selected four authorized images, exported a ZIP with byte-identical originals, extracted in Codex, prepared a brief with the shared tool handler, and native image generation produced one image. This does not verify host UI upload, automatic ZIP attachment, every device, or the current client quota.',
      };
      return ok({ structuredContent: status, content: [{ type: 'text', text: '已实测：网页选择四张图 → 导出生图包 → Codex 读取原图和要求 → 原生生图成功。面板按钮直接上传到真实宿主、手机实机与当前客户端额度尚未确认。' }] });
    }
    return error(id, -32602, 'Unknown tool');
  }
  return error(id, -32601, 'Method not found');
}
