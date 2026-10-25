# 锚点 · 建筑提示词工作台 0.2.0

在线入口：https://zxq1212tony.github.io/mao-dame/dist-static/plugin/

上传白模及分类参考图 → 勾选设计约束 → 复制图片与提示词 → 在支持图片的聊天框中粘贴。
这是一个静态提示词整理网站，不调用生图 API，不需要登录或安装锚点插件。

## 复制方式

- 主按钮在一个 ClipboardItem 中写入 PNG、text/plain 和 text/html。
- PNG 是 2400 像素宽的参考板，包含全部已选图片、固定角色编号及完整提示词。图片按比例排版，不裁切。文字与图片都在浏览器本地处理。
- 聊天框自行决定接收哪些剪贴板格式，不能承诺多张独立附件和文字在每个客户端中一次粘贴成功。只出现图片时，要求已在图片里；只出现文字时，使用“仅复制参考板”再次粘贴。
- 保留“仅复制提示词”“下载参考板”和“下载原图包”。原图包保留原始图像字节，适合细节要求高的任务。
- 没有剪贴板权限或 API 时会明确提示下载，不会假报成功，不会静默退化为只复制文字。
- 图片和设置不会自动上传或同步。刷新前用“保存方案”；旧版 .anchor.json 可继续导入。

## 修改与发布

页面源文件位于 `plugin/web/`：

| 文件 | 用途 |
| --- | --- |
| panel.html / panel.css | 页面结构与样式 |
| panel.js | 选图、设置、导入导出、复制交互 |
| workflow.js | 提示词规则、原图包与方案数据 |
| clipboard.js | 参考板排版、PNG 与多格式剪贴板 |

安装 Node.js 22 或更新版本后，无需安装 npm 依赖：

```sh
node scripts/build-static.mjs
node scripts/preview.mjs
```

打开 http://127.0.0.1:4179/plugin/ 。每次修改源文件后重新运行 build 并刷新。

提交源文件及生成的 `dist-static/plugin/index.html`。GitHub Pages 沿用现有 main 分支发布配置，网址不变。
`dist-static/` 下原有建筑工作台文件继续保留。

## 验证

```sh
node --test tests/clipboard.test.mjs
```

浏览器测试使用 Playwright（仅开发测试需要）：

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/clipboard.smoke.mjs
```

测试前先启动本地预览。可用 ANCHOR_PLAYWRIGHT_MODULE、ANCHOR_BROWSER_CHANNEL、ANCHOR_TEST_URL 指定已有运行环境。

2026-10-25 已验证：

- 5 项单元测试通过；角色编号、长提示词、文字换行、HTML 转义、原图提示词。
- Windows Edge 浏览器实际复制、读取系统剪贴板，并在另一测试页面通过 Ctrl+V 收到 PNG 文件和完整提示词；不是模拟 clipboard.write。
- 图片替换/删除、即时修改后避免旧参考板、600 字补充、方案保存与导入、损坏文件保留原内容、参考板下载、390px 手机宽度无横向溢出。
- 剪贴板权限拒绝使用模拟异常检查，失败时不显示成功。

未验证：真实 ChatGPT 输入框对混合剪贴板的接收策略、iOS/Android 的系统剪贴板、本次任务未触发实际生图。手机宽度测试不代表移动系统剪贴板已验证。

`plugin/server.mjs` 等是早期 MCP 服务的保留源代码；GitHub Pages 不运行这些服务。此版本页面只整理提示词，不检测或连接聊天账户，也不改变原 Sites 插件的部署。

剪贴板格式依据：[MDN Clipboard.write](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write)。接收应用可以选择它支持的表示格式；多张独立图片的系统剪贴板支持不统一，因此使用单张包含全部资料的参考板。
