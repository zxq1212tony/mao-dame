import { ROLES, DEFAULT_SETTINGS, buildRequest } from './web/workflow.js';

const fileSchema = {
  type: 'object',
  properties: {
    download_url: { type: 'string' }, file_id: { type: 'string' },
    mime_type: { type: 'string' }, file_name: { type: 'string' },
  },
  required: ['download_url', 'file_id'], additionalProperties: false,
};
const namesSchema = {
  type: 'object',
  description: 'Fallback for clients whose attachments are local files rather than host file IDs. Use exact names or paths of images actually attached by the user. This does not upload or verify their contents.',
  properties: Object.fromEntries(ROLES.map(r => [r.id, { type: 'string', minLength: 1, maxLength: 1024 }])),
  required: ['base'], additionalProperties: false,
};
export const renderTool = {
  name: 'prepare_anchor_render',
  title: '整理锚点图片并准备生图',
  description: 'Prepare a rendering brief from the user’s actual white-model image and optional facade, atmosphere and planting references. Works in ChatGPT and Codex without opening a panel. Prefer host file inputs; if attachments are local files, pass their exact names/paths in image_names and verify those images separately. Returns constraints and an ordered image list, NOT generated pixels. When the user asked for a render, continue with the current chat’s native image generation using the actual images and returned brief. Do not stop at returning a prompt. If images or image generation are unavailable, say so; never invent file IDs or claim success.',
  inputSchema: {
    type: 'object', $defs: { OpenAIFile: fileSchema },
    properties: {
      ...Object.fromEntries(ROLES.map(r => [r.id, { $ref: '#/$defs/OpenAIFile', description: `${r.label}：${r.instruction}` }])),
      image_names: namesSchema,
      settings: {
        type: 'object', additionalProperties: false,
        properties: {
          mass: { type: 'boolean', default: true }, camera: { type: 'boolean', default: true },
          site: { type: 'boolean', default: true },
          material: { type: 'string', enum: ['跟随立面参考', '中性透明玻璃', '低反射灰色玻璃', '金属竖向构件'] },
          light: { type: 'string', enum: ['跟随氛围参考', '阴天柔光', '晴天自然光', '黄昏暖光', '夜景'] },
          note: { type: 'string', maxLength: 600 },
        },
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  _meta: { 'openai/fileParams': ROLES.map(r => r.id) },
};

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\r\n\0]/.test(value);
export function prepareRender(args) {
  const allowed = [...ROLES.map(r => r.id), 'image_names', 'settings'];
  if (!object(args) || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('请提供白模图片和支持的锚点选项。');
  if (args.image_names !== undefined && (!object(args.image_names) || !args.image_names.base ||
      Object.entries(args.image_names).some(([key, value]) => !ROLES.some(r => r.id === key) || !boundedText(value, 1024)))) throw new Error('图片名称必须对应实际附件，并包含白模底图。');
  const settings = { ...DEFAULT_SETTINGS };
  if (args.settings !== undefined) {
    if (!object(args.settings)) throw new Error('设置格式错误。');
    for (const [key, value] of Object.entries(args.settings)) {
      const schema = renderTool.inputSchema.properties.settings.properties[key];
      if (!schema || typeof value !== schema.type || (schema.enum && !schema.enum.includes(value)) || (key === 'note' && value.length > 600)) throw new Error('包含不支持的设置。');
      settings[key] = value;
    }
  }
  const images = {};
  for (const role of ROLES) {
    const file = args[role.id];
    if (file !== undefined) {
      if (!object(file) || Object.keys(file).some(key => !(key in fileSchema.properties)) ||
          !boundedText(file.file_id, 256) || !boundedText(file.download_url, 8192) ||
          (file.file_name !== undefined && !boundedText(file.file_name, 1024))) throw new Error(`${role.label}缺少有效文件引用。`);
      let url;
      try { url = new URL(file.download_url); } catch { throw new Error('图片下载地址无效。'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('图片引用必须使用 HTTPS。');
      if (file.mime_type !== undefined && !['image/png', 'image/jpeg', 'image/webp'].includes(file.mime_type)) throw new Error('只支持 PNG、JPG、WebP 参考图。');
      images[role.id] = { name: file.file_name || `${role.label}图片`, fileId: file.file_id };
    } else if (args.image_names?.[role.id]) images[role.id] = { name: args.image_names[role.id] };
  }
  if (!images.base) throw new Error('请先在聊天中附上白模底图，再提供它的文件引用或实际文件名。');
  const brief = buildRequest(settings, images);
  const references = ROLES.filter(r => images[r.id]).map(r => ({ role: r.id, label: r.label, ...images[r.id] }));
  // Do not fetch, store, log, or echo signed download URLs. Images remain with the host.
  return {
    content: [{ type: 'text', text: JSON.stringify({
      status: 'brief_ready', brief, references,
      imageContentsVerified: false, generated: false,
      nextStep: '核对这些参考图片实际可见后，用原生生图工具生成一张图片；只提供名称并不等于已上传。若用户只要求整理方案，则不生图。',
    }) }],
  };
}
