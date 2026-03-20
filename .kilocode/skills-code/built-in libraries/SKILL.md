### Skill 名称：Project Library Expert (全量库专家)

#### Skill 描述：

深度理解项目中已集成的所有第三方库（包括 jQuery 插件体系和 Webpack 打包的现代 JS 库）。能够根据需求精准调用最合适的工具，避免重复造轮子，并确保代码符合项目的架构规范。

---

#### 核心知识库（分类索引）：

**1. 数据处理与工具 (Utilities):**
- **lodash:** 全能型函数工具库。
- **moment:** 日期和时间处理。
- **localforage:** 强大的离线存储（IndexedDB/WebSQL 封装）。
- **seedrandom:** 可预测的随机数生成器。
- **yaml:** YAML 格式解析与字符串化。
- **chalk:** 终端/控制台颜色输出（用于调试）。

**2. UI 交互与动画 (UI & Interaction):**

- **jQuery (v3.5.1) 系列:** 包含 jQuery UI (拖拽/排序)、Touch Punch (触摸支持)、Transit (CSS3 动画)。
- **Popper.js:** 弹窗、工具提示（Tooltips）的定位引擎。
- **slidetoggle:** 平滑的滑动切换效果。
- **morphdom:** 高性能 DOM 差异比对与更新（类似 Virtual DOM）。
- **Toastr:** 弹出式通知提醒。
- **Pagination.js:** 分页组件。
- **Toolcool Color Picker:** 颜色选择器。
- **Swiped Events:** 移动端滑动（Swipe）手势监听。

**3. 内容解析与渲染 (Parsing & Rendering):**

- **showdown:** Markdown 转 HTML 转换器。
- **Readability (@mozilla):** 提取网页正文内容（阅读模式算法）。
- **Handlebars:** 语义化模板引擎。
- **highlight.js (hljs):** 代码高亮。
- **DOMPurify:** 安全的 HTML XSS 过滤器。
- **SVGInject:** 将 .svg 文件注入为内联 SVG 元素。
- **chevrotain:** 高性能解析器构建工具（Lexer/Parser）。
- **@adobe/css-tools:** CSS 解析与处理。

**4. 搜索与比对 (Search & Diff):**
- **Fuse.js:** 轻量级模糊搜索库。
- **diff-match-patch:** 文本差异比对、匹配和打补丁。

**5. 媒体与特定格式处理 (Media & Specialized):**
- **Cropper.js & jQuery Cropper:** 图片裁剪专家。
- **PDF.js:** 浏览器原生 PDF 渲染。
- **epub.js:** ePub 电子书解析与阅读。
- **JSZip:** 在 JS 中创建和解压 .zip 文件。
- **iZoomify:** 图片放大镜效果。
- **droll:** 骰子滚动（Dice rolling）逻辑工具。

**6. 兼容性与环境 (Compatibility):**

- **Bowser:** 浏览器和操作系统检测。
- **Polyfills:** ~~`structured-clone` (深拷贝),~~ `dialog-polyfill` (HTML5 对话框), `polyfill.js` (数组新方法)。

---

#### 交互规范与调用指南：

1.  **引用路径说明**：
    *   **模块化引用**：现代库已通过 Webpack 暴露在 `lib.js` 中。新功能应优先使用 `import { lodash, Fuse, moment } from '@st/lib.js';`。
    *   **全局调用 (Shims)**：对于老旧代码或扩展，以下库已挂载至 `window` 全局对象，可直接访问：`window.Fuse`, `window.DOMPurify`, `window.hljs`, `window.localforage`, `window.Handlebars`, `window.diff_match_patch`, `window.SVGInject`, `window.showdown`, `window.moment`, `window.Popper`, `window.droll`，`window._`，`window.$`，`window.jQuery`等。

2.  **最佳实践**：
    *   **安全第一**：处理用户输入的 HTML 时，**必须**调用 `DOMPurify.sanitize()`。
    *   **性能优化**：实现搜索功能时，优先使用 `Fuse.js`；实现复杂动画时，优先使用 `$.transit` 或 `slidetoggle`。
    *   **存储建议**：涉及持久化数据时，优先使用 `localforage` 而非原生 `localStorage`。
    *   **DOM 操作**：如果是大规模 DOM 更新，建议结合 `morphdom` 或 `Handlebars` 模板，避免频繁的 jQuery `.html()` 覆盖。

3.  **约束**：
    *   禁止引入与上述功能重复的第三方库（例如：禁止在已有 `moment` 的情况下引入 `dayjs`）。
    *   在编写涉及移动端手势的代码时，自动集成 `swiped-events.js`。

