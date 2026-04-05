# Custom Generation

[![Version](https://img.shields.io/badge/version-0.9.4.1-blue.svg)](https://github.com/zonde306/ST-CustomGeneration)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Language](https://img.shields.io/badge/语言-简体中文%20%7C%20繁體中文-orange.svg)](locales/)

一个功能强大的 SillyTavern 扩展插件，提供自定义 API 连接、预设管理、提示词管理、正则处理、模板系统和 World Info 增强功能。

## 目录

- [功能特性](#功能特性)
- [安装方法](#安装方法)
- [快速开始](#快速开始)
- [功能说明](#功能说明)
  - [自定义 API 连接](#自定义-api-连接)
  - [预设系统](#预设系统)
  - [提示词管理](#提示词管理)
  - [正则处理](#正则处理)
  - [模板系统](#模板系统)
  - [World Info 增强](#world-info-增强)
- [装饰器参考](#装饰器参考)
- [API 参考](#api-参考)
- [事件系统](#事件系统)
- [贡献指南](#贡献指南)
- [许可证](#许可证)
- [致谢](#致谢)

## 功能特性

### 核心功能

- **自定义 API 连接** - 支持 OpenAI 兼容的 API 端点配置，灵活连接各种后端服务
- **预设系统** - 多预设管理，支持导入/导出，快速切换不同配置
- **提示词管理** - 灵活的提示词列表，支持拖拽排序、深度注入
- **正则处理** - 请求/响应时的文本替换规则，自动处理文本格式
- **模板系统** - 基于装饰器的后处理模板，支持多种数据处理方式
- **World Info 增强** - 支持变量存储和动态更新，增强世界信息管理

### 后处理器装饰器

提供 10 种装饰器用于后处理：

| 装饰器 | 用途 |
|--------|------|
| `@@append_output` | 追加内容到消息末尾 |
| `@@append_output_ejs` | EJS 模板追加 |
| `@@evaluate_ejs` | EJS 代码执行 |
| `@@replace_ejs` | EJS 替换 WI 内容 |
| `@@replace` | 直接替换 WI 内容 |
| `@@replace_diff` | Git Diff 格式更新 |
| `@@replace_search` | 搜索替换 |
| `@@variables_json` | JSON Merge Patch |
| `@@variables_yaml` | YAML Merge Patch |
| `@@variables_jsonpatch` | JSON Patch (RFC 6902) |

## 安装方法

### 方法一：通过 SillyTavern 扩展市场安装

1. 打开 SillyTavern
2. 进入扩展管理页面
3. 搜索 "Custom Generation"
4. 点击安装

### 方法二：手动安装

1. 克隆或下载本项目到 SillyTavern 的扩展目录：

```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/zonde306/ST-CustomGeneration.git
```

2. 重启 SillyTavern

### 方法三：下载 ZIP 安装

1. 从 [Releases](https://github.com/zonde306/ST-CustomGeneration/releases) 下载最新版本
2. 解压到 `SillyTavern/public/scripts/extensions/third-party/ST-CustomGeneration/`
3. 重启 SillyTavern

## 快速开始

### 基本配置

1. **启用扩展**：在 SillyTavern 的扩展管理页面启用 "Custom Generation"

2. **配置 API**：
   - 打开扩展设置面板
   - 输入 API 端点地址
   - 配置 API 密钥
   - 选择模型

3. **创建预设**：
   - 点击"新建预设"按钮
   - 配置生成参数
   - 保存预设

4. **配置提示词**：
   - 添加系统提示词
   - 调整提示词顺序
   - 设置注入深度

### 使用示例

```javascript
// 获取全局上下文
const ctx = globalContext();

// 构建消息
const messages = await buildMessages(ctx);

// 监听生成事件
eventSource.on(eventTypes.cg_generate_done, (data) => {
    console.log('生成完成:', data);
});
```

## 功能说明

### 自定义 API 连接

支持连接任何 OpenAI 兼容的 API 端点：

- 自定义 API 端点 URL
- 支持Bearer Token 认证
- 可配置请求头
- 支持流式响应

### 预设系统

多预设管理功能：

- 创建、编辑、删除预设
- 预设导入/导出（JSON 格式）
- 快速切换预设
- 预设参数包括：温度、Top-P、最大令牌数等

### 提示词管理

灵活的提示词配置：

- 拖拽排序提示词
- 设置注入深度
- 支持条件注入
- 提示词模板变量

### 正则处理

请求/响应时的文本替换：

- 支持正则表达式匹配
- 多条规则管理
- 可配置执行顺序
- 支持捕获组替换

### 模板系统

基于装饰器的后处理模板，详见 [装饰器参考](#装饰器参考)。

### World Info 增强

增强的世界信息管理：

- 变量存储功能
- 动态更新 WI 内容
- 支持多种数据格式（JSON、YAML）
- 与装饰器配合使用

## 装饰器参考

### `@@append_output`

追加内容到消息末尾。

```
@@append_output
要追加的内容
@@end
```

### `@@append_output_ejs`

使用 EJS 模板追加内容。

```
@@append_output_ejs
<%= message.content %>
@@end
```

### `@@evaluate_ejs`

执行 EJS 代码，不输出内容。

```
@@evaluate_ejs
// 执行任意 JavaScript 代码
const result = someOperation();
@@end
```

### `@@replace_ejs`

使用 EJS 模板替换 WI 内容。

```
@@replace_ejs
新的 WI 内容：<%= newContent %>
@@end
```

### `@@replace`

直接替换 WI 内容。

```
@@replace
新的 WI 内容
@@end
```

### `@@replace_diff`

使用 Git Diff 格式更新 WI 内容。

```
@@replace_diff
--- original
+++ modified
@@ -1 +1 @@
-old content
+new content
@@end
```

### `@@replace_search`

搜索并替换文本。

```
@@replace_search
搜索文本|||替换文本
@@end
```

### `@@variables_json`

使用 JSON Merge Patch 更新变量。

```
@@variables_json
{
  "key": "value",
  "nested": {
    "property": "updated"
  }
}
@@end
```

### `@@variables_yaml`

使用 YAML Merge Patch 更新变量。

```
@@variables_yaml
key: value
nested:
  property: updated
@@end
```

### `@@variables_jsonpatch`

使用 JSON Patch (RFC 6902) 更新变量。

```
@@variables_jsonpatch
[
  { "op": "replace", "path": "/key", "value": "new value" },
  { "op": "add", "path": "/newKey", "value": "added" }
]
@@end
```

## API 参考

### 全局对象

#### `Context`

上下文管理类，管理生成过程中的上下文信息。

```javascript
const ctx = new Context();
```

#### `DataOverride`

数据覆盖类，用于覆盖默认的生成参数。

```javascript
const override = new DataOverride({
    temperature: 0.8,
    max_tokens: 2000
});
```

#### `PromptContext`

提示词上下文类，管理提示词的构建和处理。

```javascript
const promptCtx = new PromptContext();
```

#### `MessageBuilder`

消息构建器类，用于构建发送给 API 的消息列表。

```javascript
const builder = new MessageBuilder();
builder.addSystem('系统提示');
builder.addUser('用户消息');
```

### 全局函数

#### `globalContext()`

获取全局上下文实例。

```javascript
const ctx = globalContext();
```

#### `buildMessages(context)`

构建消息的异步方法。

```javascript
const messages = await buildMessages(ctx);
```

#### `runAfterGenerates(context, result)`

执行后处理生成。

```javascript
await runAfterGenerates(ctx, generateResult);
```

### 常量

#### `eventTypes`

事件类型常量对象。

```javascript
const { eventTypes } = window.customGeneration;
```

## 事件系统

扩展提供以下事件类型，可用于监听生成过程：

| 事件名 | 触发时机 | 数据 |
|--------|----------|------|
| `cg_generate_start` | 生成开始时 | 请求参数 |
| `cg_generate_chunk` | 流式生成收到数据块时 | 数据块内容 |
| `cg_generate_done` | 生成完成时 | 完整响应 |
| `cg_generate_before` | 生成前处理 | 上下文信息 |
| `cg_generate_after` | 生成后处理 | 生成结果 |

### 事件使用示例

```javascript
// 监听生成开始
eventSource.on(eventTypes.cg_generate_start, (data) => {
    console.log('开始生成:', data);
});

// 监听流式数据
eventSource.on(eventTypes.cg_generate_chunk, (chunk) => {
    console.log('收到数据块:', chunk);
});

// 监听生成完成
eventSource.on(eventTypes.cg_generate_done, (result) => {
    console.log('生成完成:', result);
});

// 取消监听
eventSource.off(eventTypes.cg_generate_done, listenerFunction);
```

## 项目结构

```
ST-CustomGeneration/
├── src/
│   ├── index.ts              # 入口初始化
│   ├── settings.ts           # 设置 UI 和事件处理
│   ├── features/
│   │   ├── context.ts        # 上下文管理
│   │   ├── override.ts       # 数据覆盖
│   │   ├── generate-processor.ts  # 生成处理器
│   │   ├── generate-logger.ts     # 生成日志
│   │   └── after-generates/  # 后处理器模块
│   ├── functions/
│   │   ├── message-builder.ts # 消息构建器
│   │   ├── generate.ts       # 生成函数
│   │   ├── worldinfo.ts      # World Info 处理
│   │   ├── template.ts       # 模板处理
│   │   └── prompt-context.ts # 提示词上下文
│   └── utils/
│       ├── defines.ts        # 类型定义
│       ├── events.ts         # 事件定义
│       └── ...               # 其他工具
├── locales/
│   ├── zh-cn.json            # 简体中文
│   └── zh-tw.json            # 繁体中文
├── manifest.json             # 扩展清单
├── settings.html             # 设置界面
└── README.md                 # 本文档
```

## 贡献指南

欢迎参与项目开发！

### 开发环境设置

1. 克隆仓库：

```bash
git clone https://github.com/zonde306/ST-CustomGeneration.git
cd ST-CustomGeneration
```

2. 安装依赖：

```bash
npm install
```

3. 构建项目：

```bash
npm run build
```

4. 开发模式（监听文件变化）：

```bash
npm run watch
```

### 代码规范

- 使用 TypeScript 编写代码
- 遵循 ESLint 配置
- 提交前请确保代码通过 lint 检查

### 提交 Pull Request

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

### 报告问题

如遇到问题，请在 [Issues](https://github.com/zonde306/ST-CustomGeneration/issues) 页面提交，包含以下信息：

- SillyTavern 版本
- 扩展版本
- 问题描述
- 复现步骤
- 相关日志

## 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。

```
MIT License

Copyright (c) 2024 zonde306

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR