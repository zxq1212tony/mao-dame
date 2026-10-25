import template from './web/panel.html?raw';
import styles from './web/panel.css?raw';
import workflow from './web/workflow.js?raw';
import clipboard from './web/clipboard.js?raw';
import view from './web/panel.js?raw';

// Layout, style and workflow edits automatically invalidate the host's resource cache.
export const panelHtml = template.replace('/* ANCHOR_STYLES */', styles)
  .replace('/* ANCHOR_SCRIPT */', () => [workflow, clipboard, view].map(source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n'));
let hash = 2166136261;
for (let i = 0; i < panelHtml.length; i++) hash = Math.imul(hash ^ panelHtml.charCodeAt(i), 16777619);
export const panelUri = `ui://anchor/panel-${(hash >>> 0).toString(16)}.html`;
