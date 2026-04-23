# 设置说明文档

本文档详细说明 ST-CustomGeneration 扩展的各项设置配置。

## 目录

- [API 连接配置](#api-连接配置)
- [对话补全预设](#对话补全预设)
- [提示词](#提示词)
- [预设正则](#预设正则)
- [模板列表（用于DECORATORS）](#模板列表用于decorators)
- [工具（由AI使用）](#工具由ai使用)

---

## API 连接配置

API 连接配置用于管理与 AI 模型服务的连接。支持创建多个 API 连接配置，方便在不同服务之间切换。

### 基本设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | string | `http://localhost:8080/v1` | API 端点基础 URL（兼容 OpenAI 格式） |
| `apiKey` | string | `''` | API 密钥（可选） |
| `model` | string | `'None'` | 模型 ID |

### 生成参数

| 字段 | 类型 | 默认值 | 范围 | 说明 |
|------|------|--------|------|------|
| `contextSize` | number | `8192` | 1 ~ 1,000,000 | 上下文窗口大小（tokens） |
| `maxTokens` | number | `4096` | 1 ~ 1,000,000 | 最大响应长度（tokens） |
| `temperature` | number | `1` | 0 ~ 2 | 温度参数，控制输出随机性 |
| `topK` | number | `1` | 0 ~ 1,000,000 | Top-K 采样参数 |
| `topP` | number | `1` | 0 ~ 1 | Top-P（核采样）参数 |
| `frequencyPenalty` | number | `0` | -2 ~ 2 | 频率惩罚 |
| `presencePenalty` | number | `0` | -2 ~ 2 | 存在惩罚 |

### 高级设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `stream` | boolean | `false` | 是否启用流式输出 |
| `maxConcurrency` | number | `1` | 世界信息生成的最大并发数 |
| `promptPostProcessing` | string | `'none'` | 提示词后处理模式 |

#### promptPostProcessing 选项

- `none` - 不进行后处理
- `merge` - 合并模式
- `semi` - 半严格模式
- `strict` - 严格模式
- `single` - 单一模式

### 自定义请求参数

| 字段 | 类型 | 说明 |
|------|------|------|
| `includeHeaders` | Record<string, unknown> | 附加的请求头（YAML 格式） |
| `includeBody` | Record<string, unknown> | 附加的请求体字段（YAML 格式） |
| `excludeBody` | Record<string, unknown> | 需要排除的请求体字段（YAML 格式） |

### 预设关联

| 字段 | 类型 | 说明 |
|------|------|------|
| `linkedPreset` | string | 关联的预设名称，切换 API 时自动切换预设 |

### 连接管理功能

- **新建连接**：创建新的 API 连接配置
- **复制连接**：复制当前连接配置
- **重命名连接**：修改连接名称
- **删除连接**：删除当前连接（至少保留一个）
- **导入/导出**：支持 JSON 格式的配置导入导出

### 连接测试

- **获取模型列表**：从 API 端点获取可用模型列表
- **直接测试**：直接调用 `/chat/completions` 端点测试连接
- **生成测试**：通过内部生成流程测试连接

---

## 对话补全预设

预设是一组配置的集合，包含提示词、正则脚本、模板和工具设置。

### 预设结构

```typescript
interface Preset {
    name: string;                          // 预设名称
    prompts: PresetPrompt[];               // 提示词列表
    regexs: RegEx[];                       // 正则脚本列表
    templates: Record<string, Template>;   // 模板映射
    tools: Record<string, ToolSettings>;   // 工具设置
}
```

### 预设管理功能

- **新建预设**：创建新的空白预设
- **复制预设**：复制当前预设及其所有配置
- **重命名预设**：修改预设名称
- **删除预设**：删除当前预设（至少保留一个）
- **导入/导出**：支持 JSON 格式的预设导入导出

### 预设摘要

预设摘要显示当前预设的统计信息：
- 提示词数量（已启用/总数）
- 正则脚本数量（已启用/总数）
- 模板数量

### 与 API 连接的关联

API 连接可以关联到特定预设。当切换 API 连接时，如果有关联的预设，系统会自动切换到该预设。

---

## 提示词

提示词是构建发送给 AI 模型的消息内容的核心组件。

### 提示词结构

```typescript
interface PresetPrompt {
    name: string;              // 提示词名称（UI 显示）
    role: 'user' | 'assistant' | 'system';  // 消息角色
    triggers: string[];        // 触发条件
    prompt: string;            // 提示词内容
    injectionPosition: 'relative' | 'inChat';  // 注入位置
    enabled: boolean | null;   // 启用状态（null 表示不显示在列表中）
    internal: string | null;   // 内部提示词标识
    injectionDepth: number;    // 注入深度（inChat 模式）
    injectionOrder: number;    // 注入顺序
    maxDepth: number;          // 最大深度（chatHistory 使用）
}
```

### 字段说明

#### name
提示词的显示名称，用于在 UI 中标识该提示词。

#### role
消息的角色类型：
- `system` - 系统消息，通常用于设定 AI 的行为
- `user` - 用户消息
- `assistant` - 助手消息

#### triggers
触发条件数组，用于限定提示词在哪些生成场景下生效。可选值：
- `normal` - 普通生成
- `regenerate` - 重新生成
- `swipe` - 滑动切换
- `continue` - 继续生成
- 装饰器类型（如 `@@record`、`@@replace` 等）

空数组表示在所有场景下都生效。

#### prompt
提示词的实际内容。支持使用模板变量（如 `{{char}}`、`{{user}}` 等）。

#### injectionPosition
提示词的注入位置：
- `relative` - 相对位置（与其他提示词的相对顺序）
- `inChat` - 在聊天历史中的特定深度

#### enabled
启用状态：
- `true` - 启用
- `false` - 禁用
- `null` - 不显示在列表中（用于内置提示词）

#### internal
内部提示词标识，用于标识 SillyTavern 内置的提示词类型：

| 标识 | 说明 |
|------|------|
| `main` | 主提示词 |
| `personaDescription` | 人物描述 |
| `charDescription` | 角色描述 |
| `charPersonality` | 角色性格 |
| `scenario` | 场景设定 |
| `chatExamples` | 聊天示例 |
| `worldInfoBefore` | 世界信息（前） |
| `worldInfoAfter` | 世界信息（后） |
| `chatHistory` | 聊天历史 |
| `worldInfoDepth0-4` | 世界信息深度层 |
| `presetDepth0-4` | 预设深度层 |
| `authorsNote` | 作者注释 |
| `charNote` | 角色注释 |
| `lastCharMessage` | 最后一条角色消息 |
| `lastUserMessage` | 最后一条用户消息 |

当 `internal` 不为 `null` 时，`prompt` 字段的内容会替换对应的内置内容。

#### injectionDepth
在 `inChat` 模式下的注入深度：
- `0` = 在最后一条消息之后
- `1` = 在最后一条消息之前
- 以此类推

#### injectionOrder
在同一深度层的排序顺序。数值越小越靠前（顶部），越大越靠后（底部）。

#### maxDepth
用于 `chatHistory` 内部提示词，限制保留的聊天消息数量。

### 内置提示词

默认预设包含以下内置提示词（按注入顺序排列）：

1. **Main Prompt** - 主提示词（`internal: 'main'`）
2. **World Info (before)** - 世界信息前置（`internal: 'worldInfoBefore'`）
3. **Persona Description** - 人物描述（`internal: 'personaDescription'`）
4. **Char Description** - 角色描述（`internal: 'charDescription'`）
5. **Char Personality** - 角色性格（`internal: 'charPersonality'`）
6. **Scenario** - 场景设定（`internal: 'scenario'`）
7. **Enhance Definitions** - 增强定义（用户自定义）
8. **Auxiliary Prompt** - 辅助提示词（用户自定义）
9. **World Info (after)** - 世界信息后置（`internal: 'worldInfoAfter'`）
10. **Chat Examples** - 聊天示例（`internal: 'chatExamples'`）
11. **Chat History** - 聊天历史（`internal: 'chatHistory'`）
12. **Post-History Instructions** - 历史后指令（用户自定义）

### 提示词管理

- **添加提示词**：创建新的用户自定义提示词
- **编辑提示词**：修改现有提示词的配置
- **删除提示词**：删除用户自定义提示词
- **启用/禁用**：通过复选框快速切换启用状态
- **拖拽排序**：通过拖拽调整提示词顺序
- **导入/导出**：支持 JSON 格式的提示词导入导出

---

## 预设正则

正则脚本用于在生成前后对文本进行处理。

### 正则结构

```typescript
interface RegEx {
    name: string;           // 脚本名称
    regex: string;          // 匹配正则表达式
    replace: string;        // 替换文本
    userInput: boolean;     // 应用于用户输入
    aiOutput: boolean;      // 应用于 AI 输出
    worldInfo: boolean;     // 应用于世界信息
    enabled: boolean;       // 启用状态
    minDepth: number | null;  // 最小深度
    maxDepth: number | null;  // 最大深度
    ephemerality: boolean;  // 临时性（不修改原始文本）
    request: boolean;       // 应用于请求
    response: boolean;      // 应用于响应
}
```

### 字段说明

#### name
正则脚本的显示名称。

#### regex
正则表达式模式。支持标准 JavaScript 正则语法，可以使用 `/pattern/flags` 格式或纯文本。

#### replace
替换文本。可以使用 `$1`、`$2` 等引用捕获组。

#### 应用范围

| 字段 | 说明 |
|------|------|
| `userInput` | 应用于用户输入的消息 |
| `aiOutput` | 应用于 AI 生成的输出 |
| `worldInfo` | 应用于世界信息内容 |
| `request` | 应用于生成请求阶段 |
| `response` | 应用于生成响应阶段 |

#### 深度限制

- `minDepth` - 最小深度限制（-1 表示不限制）
- `maxDepth` - 最大深度限制（0 表示不限制）

深度限制仅在 `inChat` 模式下有效，用于限定正则应用于哪些深度的消息。

#### ephemerality
临时性标志。当设置为 `true` 时，正则匹配的结果仅用于当前处理，不会修改存储的原始文本。

### 正则管理

- **添加正则**：创建新的正则脚本
- **编辑正则**：修改现有正则脚本的配置
- **删除正则**：删除正则脚本
- **启用/禁用**：通过复选框快速切换启用状态
- **拖拽排序**：通过拖拽调整正则执行顺序
- **导入/导出**：支持 JSON 格式的正则导入导出

---

## 模板列表（用于DECORATORS）

模板是用于处理世界信息中装饰器（Decorators）的配置。装饰器以 `@@` 开头，用于触发特定的生成行为。

### 模板结构

```typescript
interface Template {
    decorator: string;       // 装饰器类型（如 '@@record'）
    tag: string;             // 标签（可选）
    prompts: PresetPrompt[]; // 模板提示词列表
    regex: string;           // 输出匹配正则
    findRegex: string;       // 查找触发正则
    filters: string[];       // 禁用的提示词过滤器
    retryCount: number;      // 重试次数
    retryInterval: number;   // 重试间隔（毫秒）
}
```

### 字段说明

#### decorator
装饰器类型，必须是已知的装饰器之一：

| 装饰器 | 说明 |
|--------|------|
| `@@record` | 记录生成 |
| `@@replace` | 替换生成 |
| `@@replace_diff` | Diff 替换生成 |
| `@@replace_search` | 搜索替换生成 |
| `@@variables_json` | JSON 变量生成 |
| `@@variables_yaml` | YAML 变量生成 |
| `@@variables_jsonpatch` | JSON Patch 变量生成 |
| `@@evaluate_ejs` | EJS 评估生成 |
| `@@replace_ejs` | EJS 替换生成 |
| `@@append_output` | 追加输出 |
| `@@append_output_ejs` | EJS 追加输出 |

#### tag
标签用于进一步区分同类型装饰器的不同实例。格式为 `@@decorator tag`，例如 `@@record status`。

#### prompts
模板提示词列表。结构与预设提示词相同，但用于模板生成场景。

#### regex
输出匹配正则。用于从 AI 生成结果中提取所需内容。如果设置，系统会使用捕获组 1 的内容作为最终结果。

#### findRegex
查找触发正则。当设置时，只有匹配此正则的内容才会触发模板处理，匹配的捕获组 1 会作为 `{{lastCharMessage}}` 使用。

#### filters
禁用的提示词过滤器数组。用于在模板生成时禁用特定的内置提示词类型：

| 过滤器 | 说明 |
|--------|------|
| `main` | 主提示词 |
| `personaDescription` | 人物描述 |
| `charDescription` | 角色描述 |
| `charPersonality` | 角色性格 |
| `scenario` | 场景设定 |
| `chatExamples` | 聊天示例 |
| `worldInfoBefore` | 世界信息（前） |
| `worldInfoAfter` | 世界信息（后） |
| `chatHistory` | 聊天历史 |
| `worldInfoDepth` | 世界信息深度层 |
| `authorsNoteDepth` | 作者注释深度层 |
| `presetDepth` | 预设深度层 |
| `charDepth` | 角色深度层 |

#### retryCount
重试次数。当生成结果不匹配 `regex` 时，自动重试的最大次数。

#### retryInterval
重试间隔（毫秒）。两次重试之间的等待时间。

### 默认模板

默认预设包含以下预配置模板：

#### @@replace
基础替换模板。使用 `<doc>` 标签包裹的输出格式。

#### @@replace_diff
Diff 格式替换模板。使用 Unified Diff 格式进行增量更新。

#### @@replace_search
搜索替换模板。使用 Git conflict 语法进行内容替换。

#### @@variables_json
JSON 变量模板。使用 JSON Merge Patch 格式更新变量。

#### @@variables_yaml
YAML 变量模板。使用 YAML 格式更新变量。

#### @@variables_jsonpatch
JSON Patch 变量模板。使用 RFC 6902 JSON Patch 格式更新变量。

#### @@evaluate_ejs
EJS 评估模板。生成并执行 EJS 代码。

#### @@replace_ejs
EJS 替换模板。生成 EJS 代码并替换原内容。

#### @@append_output
追加输出模板。将生成内容追加到指定位置。

#### @@append_output_ejs
EJS 追加输出模板。生成 EJS 代码并追加执行。

### 模板管理

- **添加模板**：创建新的模板配置
- **编辑模板**：修改现有模板的配置
- **复制模板**：复制模板的装饰器标签到剪贴板
- **删除模板**：删除模板
- **导入/导出**：支持 JSON 格式的模板导入导出

---

## 工具（由AI使用）

工具（Tools）是 AI 可以调用的功能扩展。通过 Function Calling 机制，AI 可以主动调用预定义的工具来执行特定操作。

### 工具设置结构

```typescript
interface ToolSettings {
    enabled: boolean;           // 启用状态
    triggers: string[];         // 触发条件
    parameters: Record<string, string>;  // 参数描述
    description: string;        // 工具描述
}
```

### 字段说明

#### enabled
工具的启用状态。只有启用的工具才会被注册到 AI 模型。

#### triggers
触发条件数组。用于限定工具在哪些生成场景下可用。格式与提示词的 `triggers` 相同。

#### parameters
参数描述映射。键为参数名，值为参数的描述文本。这些描述会传递给 AI 模型，帮助 AI 正确使用参数。

#### description
工具的整体描述。向 AI 解释工具的用途和使用方式。

### 内置工具

工具由系统预定义，用户可以配置每个工具的启用状态和参数描述。具体的工具列表由 [`TOOL_DEFINITION`](src/features/tool-manager.ts) 定义。

### 工具管理

- **启用/禁用**：通过复选框快速切换工具启用状态
- **编辑工具**：修改工具的触发条件、参数描述和工具描述
- **导入/导出**：支持 JSON 格式的工具设置导入导出

### 工具调用流程

1. AI 模型根据工具描述决定是否需要调用工具
2. 如果需要调用，AI 会生成工具调用请求（包含工具名和参数）
3. 系统执行工具并返回结果
4. AI 根据工具结果继续生成响应

---

## 导入导出格式

### 预设导出格式

```json
{
    "version": "1.0.0",
    "presets": [/* Preset 对象数组 */],
    "currentPreset": 0,
    "apiConnection": { /* 可选的 API 连接配置 */ }
}
```

### API 连接导出格式

```json
{
    "version": "1.0.0",
    "apis": { /* ApiSettings 映射 */ },
    "currentApi": "连接名称"
}
```

### 列表导出格式

```json
{
    "version": "1.0.0",
    "kind": "prompt" | "regex" | "template" | "tool",
    "items": [/* 对应类型的对象数组 */]
}
```

---

## 相关文档

- [API 文档](API.md) - API 调用接口说明
- [装饰器文档](DECORATORS.md) - 装饰器详细使用指南
- [教程](TUTORIAL.md) - 快速入门教程