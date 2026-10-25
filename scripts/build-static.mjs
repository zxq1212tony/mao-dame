import fs from 'node:fs/promises';
const read = name => fs.readFile(new URL(`../plugin/web/${name}`, import.meta.url), 'utf8');
const [html, css, workflow, clipboard, view] = await Promise.all(
  ['panel.html', 'panel.css', 'workflow.js', 'clipboard.js', 'panel.js'].map(read));
const scripts = [workflow, clipboard, view].map(source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
const output = html.replace('/* ANCHOR_STYLES */', () => css).replace('/* ANCHOR_SCRIPT */', () => scripts);
await fs.mkdir(new URL('../dist-static/plugin/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../dist-static/plugin/index.html', import.meta.url), output);
console.log('Built dist-static/plugin/index.html (no dependencies).');
