# API 参考文档

本文档提供 ST-CustomGeneration 扩展的完整编程接口参考。

## 目录

- [全局对象](#全局对象)
- [Context 类](#context-类)
- [DataOverride 类](#dataoverride-类)
- [PromptContext 类](#promptcontext-类)
- [MessageBuilder 类](#messagebuilder-类)
- [TemplateHandler 类](#templatehandler-类)
- [事件系统](#事件系统)
- [类型定义](#类型定义)

---

## 全局对象

扩展初始化后，会在 `globalThis` 上注册 `CustomGeneration` 对象。

### 访问方式

```javascript
// 通过 globalThis 访问
const cg = globalThis.CustomGeneration;

// 或通过 window 访问（浏览器环境）
const cg = window.CustomGeneration;
```

### 属性列表

| 属性 | 类型 | 说明 |
|------|------|------|
| `Context` | Class | 上下文管理类 |
| `DataOverride` | Class | 数据覆盖类 |
| `PromptContext` | Class | 提示词上下文类 |
| `MessageBuilder` | Class | 消息构建器类 |
| `globalContext` | Context | 全局上下文实例（只读属性） |
| `eventTypes` | Object | 事件类型常量 |
| `buildMessages` | Function | 构建消息的异步方法 |
| `runAfterGenerates` | Function | 执行后处理生成 |
| `isWorldInfoGenerating` | Function | 检查 World Info 是否正在生成 |

### 使用示例

```javascript
// 获取全局上下文
const ctx = CustomGeneration.globalContext;

// 构建消息
const messages = await CustomGeneration.buildMessages(chat, 'normal', false);

// 检查生成状态
if (CustomGeneration.isWorldInfoGenerating()) {
  console.log('World Info 正在生成中...');
}

// 获取事件类型
const { eventTypes } = CustomGeneration;
console.log(eventTypes.GENERATION_START);
```

---

## Context 类

上下文管理类，管理生成过程中的上下文信息。

### 构造函数

```typescript
constructor(chat?: ChatMessage[], metadata?: ChatMetadata)
```

**参数：**
- `chat` (可选): 聊天消息数组
- `metadata` (可选): 聊天元数据

### 静态方法

#### `Context.global()`

获取全局上下文实例。

```typescript
static global(): Context
```

**返回值：** 绑定到当前 SillyTavern 聊天的全局上下文实例。

**示例：**

```javascript
const ctx = CustomGeneration.Context.global();
console.log(ctx.chat); // 当前聊天消息
```

#### `Context.fromObject(value)`

从普通对象创建 Context 实例。

```typescript
static fromObject(value: Partial<Context>): Context
```

**参数：**
- `value`: 包含 Context 属性的对象

**返回值：** 新的 Context 实例

### 实例属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `chat` | ChatMessageEx[] | 聊天消息数组 |
| `chat_metadata` | ChatMetadataEx | 聊天元数据 |
| `isGlobal` | boolean | 是否为全局上下文 |
| `presetOverride` | string \| undefined | 预设覆盖 |
| `apiOverride` | Partial<ApiConfig> | API 配置覆盖 |
| `macroOverride` | MacroOverride | 宏覆盖 |
| `filters` | PromptFilter | 提示词过滤器 |

### 实例方法

#### `send(content, role?, name?)`

发送消息到聊天。

```typescript
async send(content: string, role?: ContextRole, name?: string): Promise<void>
```

**参数：**
- `content`: 消息内容
- `role` (可选): 消息角色，默认 `'user'`
- `name` (可选): 发送者名称

**示例：**

```javascript
const ctx = new CustomGeneration.Context();

// 发送用户消息
await ctx.send('你好！', 'user', '用户名');

// 发送系统消息
await ctx.send('系统提示', 'system');
```

#### `generate(type?, options?, dryRun?)`

执行生成操作。

```typescript
async generate(
  type?: string,
  options?: GenerateOptionsLite,
  dryRun?: boolean
): Promise<string | string[] | AsyncGenerator>
```

**参数：**
- `type`: 生成类型，可选值：`'normal'`、`'regenerate'`、`'swipe'`、`'continue'`
- `options`: 生成选项
- `dryRun`: 是否为试运行

**返回值：**
- 非流式：返回生成的文本（string 或 string[]）
- 流式：返回 AsyncGenerator

**示例：**

```javascript
const ctx = CustomGeneration.Context.global();

// 普通生成
const response = await ctx.generate('normal');

// 流式生成
const stream = await ctx.generate('normal', { streaming: true });
for await (const chunk of stream) {
  console.log(chunk);
}
```

#### `hideMessages(start, end, unhide?, nameFilter?)`

隐藏或显示消息。

```typescript
hideMessages(
  start: number,
  end?: number,
  unhide?: boolean,
  nameFilter?: string | null
): void
```

**参数：**
- `start`: 起始消息 ID
- `end`: 结束消息 ID（可选，默认等于 start）
- `unhide`: 是否取消隐藏（默认 false）
- `nameFilter`: 按名称过滤（可选）

### 计算属性

#### `lastMessage`

获取最后一条消息。

```typescript
get lastMessage(): ChatMessageEx | undefined
```

#### `lastUserMessage`

获取最后一条用户消息。

```typescript
get lastUserMessage(): ChatMessageEx | undefined
```

#### `lastAssistantMessage`

获取最后一条助手消息。

```typescript
get lastAssistantMessage(): ChatMessageEx | undefined
```

#### `variables`

获取当前消息的变量。

```typescript
get variables(): VariableData
```

#### `localVariables`

获取聊天级别的变量。

```typescript
get localVariables(): VariableData
```

#### `currentPreset`

获取当前预设。

```typescript
get currentPreset(): Preset
```

---

## DataOverride 类

数据覆盖类，用于管理 World Info 内容的覆盖。

### 构造函数

```typescript
constructor(chat: ChatMessage[], metadata: ChatMetadata)
```

### 静态方法

#### `DataOverride.global()`

获取全局 DataOverride 实例。

```typescript
static global(): DataOverride
```

### 实例方法

#### `getOverride(world, uid, mesId?, swipeId?, maxDepth?)`

获取 WI 条目的覆盖内容。

```typescript
getOverride(
  world: string,
  uid: string | number,
  mesId?: number,
  swipeId?: number,
  maxDepth?: number
): WIOverride | null
```

**参数：**
- `world`: World Info 名称
- `uid`: 条目 UID
- `mesId` (可选): 消息 ID
- `swipeId` (可选): 滑动 ID
- `maxDepth` (可选): 最大搜索深度，默认 999

**返回值：** 覆盖对象或 null

#### `setOverride(world, uid, type, content, messageId?, swipeId?)`

设置 WI 条目的覆盖内容。

```typescript
setOverride(
  world: string,
  uid: string | number,
  type: string,
  content: string,
  messageId?: number,
  swipeId?: number
): void
```

**参数：**
- `world`: World Info 名称
- `uid`: 条目 UID
- `type`: 覆盖类型
- `content`: 覆盖内容
- `messageId` (可选): 消息 ID，默认最后一条
- `swipeId` (可选): 滑动 ID，默认当前滑动

#### `getChatOverride(messageId)`

获取聊天消息的覆盖内容。

```typescript
getChatOverride(messageId: number): string | null
```

#### `setChatOverride(messageId, content)`

设置聊天消息的覆盖内容。

```typescript
setChatOverride(messageId: number, content: string): void
```

#### `lookupOverrides(depth?)`

查找所有 WI 覆盖记录。

```typescript
lookupOverrides(depth?: number): WorldInfoOverrideEntry[]
```

**参数：**
- `depth` (可选): 搜索深度，默认 9

**返回值：** 覆盖记录数组

#### `lookupChatOverrides(depth?)`

查找所有聊天消息覆盖记录。

```typescript
lookupChatOverrides(depth?: number): ChatMessageOverrideEntry[]
```

### 使用示例

```javascript
const override = CustomGeneration.DataOverride.global();

// 设置覆盖
override.setOverride('MyWorld', 123, 'replace', '新的 WI 内容');

// 获取覆盖
const content = override.getOverride('MyWorld', 123);
console.log(content);

// 查看所有覆盖
const overrides = override.lookupOverrides();
console.log(overrides);
```

---

## PromptContext 类

提示词上下文类，管理提示词的构建和处理。

### 静态方法

#### `PromptContext.create(triggerWords, type, dryRun, maxContext)`

创建提示词上下文实例。

```typescript
static async create(
  triggerWords: string[],
  type: string,
  dryRun: boolean,
  maxContext: number
): Promise<PromptContext>
```

**参数：**
- `triggerWords`: 触发词数组
- `type`: 生成类型
- `dryRun`: 是否试运行
- `maxContext`: 最大上下文大小

**返回值：** PromptContext 实例

### 实例属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `mainPrompt` | string | 主提示词 |
| `personaDescription` | string | 用户人设描述 |
| `charDescription` | string | 角色描述 |
| `charPersonality` | string | 角色性格 |
| `scenario` | string | 场景设定 |
| `chatExampleArray` | string[] | 对话示例数组 |
| `worldInfoCharBefore` | string | 角色前 World Info |
| `worldInfoCharAfter` | string | 角色后 World Info |
| `worldInfoDepth` | Array | 深度注入的 World Info |
| `worldInfoOutletEntries` | Record | Outlet 条目 |
| `charDepthPrompt` | string | 角色深度提示 |

---

## MessageBuilder 类

消息构建器类，用于构建发送给 API 的消息列表。

### 构造函数

```typescript
constructor(chat: ChatMessage[], preset?: Preset)
```

**参数：**
- `chat`: 聊天消息数组
- `preset` (可选): 预设配置

### 实例属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `filters` | PromptFilter | 提示词过滤器 |
| `macroOverride` | MacroOverride | 宏覆盖配置 |
| `regexs` | RegEx[] | 正则规则数组 |
| `prompts` | PresetPrompt[] | 提示词数组 |
| `evaluateMacro` | boolean | 是否评估宏 |
| `maxChatHistory` | number | 最大聊天历史数 |

### 实例方法

#### `build(type?, dryRun?, wiDepth?)`

构建消息列表。

```typescript
async build(
  type?: string,
  dryRun?: boolean,
  wiDepth?: number
): Promise<ChatCompletionMessage[]>
```

**参数：**
- `type`: 生成类型，默认 `'normal'`
- `dryRun`: 是否试运行，默认 `false`
- `wiDepth`: World Info 深度

**返回值：** ChatCompletion 消息数组

#### `buildFully(type?, options?, dryRun?)`

完整构建消息列表（包含事件触发）。

```typescript
async buildFully(
  type?: string,
  options?: GenerateOptionsLite,
  dryRun?: boolean
): Promise<ChatCompletionMessage[]>
```

#### `getOutletPrompt(key)`

获取 Outlet 提示词。

```typescript
getOutletPrompt(key: string): string
```

### 使用示例

```javascript
const { MessageBuilder } = CustomGeneration;
const builder = new MessageBuilder(chat);

// 设置过滤器
builder.filters = { chatHistory: false };

// 构建消息
const messages = await builder.build('normal');
console.log(messages);
```

---

## TemplateHandler 类

模板处理器类，用于处理模板匹配和内容提取。

### 静态方法

#### `TemplateHandler.find(decorator, tag)`

查找模板处理器。

```typescript
static find(decorator: string, tag: string): TemplateHandler | null
```

**参数：**
- `decorator`: 装饰器名称
- `tag`: 模板标签

**返回值：** TemplateHandler 实例或 null

### 实例方法

#### `test(content)`

测试内容是否匹配模板的检测正则。

```typescript
test(content: string): TemplateResult
```

**返回值：**
```typescript
interface TemplateResult {
  success: boolean;
  content?: string;
  arguments?: Record<string, any>;
}
```

#### `process(content, raise?)`

处理内容，提取匹配结果。

```typescript
process(content: string, raise?: boolean): TemplateResult
```

#### `buildChatHistory(chat?, type?)`

构建聊天历史。

```typescript
async buildChatHistory(chat?: ChatMessage[], type?: string): Promise<ChatMessage[]>
```

### 计算属性

#### `prompts`

获取模板的提示词列表。

```typescript
get prompts(): PresetPrompt[]
```

#### `filters`

获取模板的过滤器配置。

```typescript
get filters(): PromptFilter
```

#### `retries`

获取重试次数。

```typescript
get retries(): number
```

#### `interval`

获取重试间隔。

```typescript
get interval(): number
```

---

## 事件系统

扩展提供事件系统，允许监听生成过程的各种阶段。

### 事件类型

通过 `CustomGeneration.eventTypes` 访问事件类型常量：

```javascript
const { eventTypes } = CustomGeneration;

// 事件类型列表
console.log(eventTypes.GENERATION_START);      // 'cg_generate_start'
console.log(eventTypes.GENERATION_END);        // 'cg_generate_done'
console.log(eventTypes.GENERATION_STREAM_CHUNK); // 'cg_generate_chunk'
```

### 可用事件

| 事件名 | 常量 | 触发时机 | 数据 |
|--------|------|----------|------|
| `cg_generate_start` | `GENERATION_START` | 生成开始时 | 请求参数 |
| `cg_generate_chunk` | `GENERATION_STREAM_CHUNK` | 流式生成收到数据块时 | 数据块内容 |
| `cg_generate_done` | `GENERATION_END` | 生成完成时 | 完整响应 |
| `cg_generate_before` | `GENERATE_BEFORE` | 生成前处理 | 上下文信息 |
| `cg_generate_after` | `GENERATE_AFTER` | 生成后处理 | 生成结果 |
| `cg_message_send` | `MESSAGE_SEND` | 消息发送时 | 消息信息 |
| `cg_message_received` | `MESSAGE_RECEIVED` | 消息接收时 | 消息信息 |
| `cg_message_deleted` | `MESSAGE_DELETED` | 消息删除时 | 消息 ID |
| `cg_generate_worldinfo_start` | `GENERATION_WORLDINFO_START` | WI 生成开始时 | 任务信息 |
| `cg_generate_worldinfo_end` | `GENERATION_WORLDINFO_END` | WI 生成结束时 | 结束信息 |
| `cg_record_updating` | `RECORD_UPDATING` | 记录更新中 | 更新信息 |
| `cg_record_updated` | `RECORD_UPDATED` | 记录更新完成 | 更新结果 |

### 使用事件

#### 监听事件

```javascript
const { eventTypes } = CustomGeneration;

// 使用 SillyTavern 的 eventSource
eventSource.on(eventTypes.GENERATION_START, (data) => {
  console.log('生成开始:', data);
});
```

#### 监听流式数据

```javascript
eventSource.on(eventTypes.GENERATION_STREAM_CHUNK, (chunk) => {
  console.log('收到数据块:', chunk);
});
```

#### 监听生成完成

```javascript
eventSource.on(eventTypes.GENERATION_END, (result) => {
  console.log('生成完成:', result);
});
```

#### 取消监听

```javascript
function myListener(data) {
  console.log('处理数据:', data);
}

// 添加监听
eventSource.on(eventTypes.GENERATION_END, myListener);

// 取消监听
eventSource.off(eventTypes.GENERATION_END, myListener);
```

### 事件数据结构

#### GENERATION_START

```typescript
{
  type: string;           // 生成类型
  options: GenerateOptionsLite; // 生成选项
  messages: ChatCompletionMessage[]; // 消息列表
  abortController: AbortController; // 中断控制器
  taskId: string;         // 任务 ID
  context: Context;       // 上下文
  streaming: boolean;     // 是否流式
  apiConfig: ApiConfig;   // API 配置
}
```

#### GENERATION_END

```typescript
{
  type: string;           // 生成类型
  options: GenerateOptionsLite; // 生成选项
  taskId: string;         // 任务 ID
  error: Error | null;    // 错误信息
  responses: string[];    // 响应列表
  context: Context;       // 上下文
  streaming: boolean;     // 是否流式
  apiConfig: ApiConfig;   // API 配置
}
```

#### GENERATE_AFTER

```typescript
{
  type: string;           // 生成类型
  context: Context;       // 上下文
  error: Error | null;    // 错误信息
}
```

---

## 类型定义

### ContextRole

```typescript
type ContextRole = 'user' | 'system' | 'assistant';
```

### ChatCompletionMessage

```typescript
interface ChatCompletionMessage {
  role: ContextRole;
  content: string;
}
```

### GenerateOptionsLite

```typescript
interface GenerateOptionsLite {
  abortController?: AbortController;
  signal?: AbortSignal;
  quietName?: string;
  dontCreate?: boolean;
  allResponses?: boolean;
  apiConfig?: Partial<ApiConfig>;
  preset?: string;
  streaming?: boolean;
  context?: Context;
}
```

### ApiConfig

```typescript
interface ApiConfig {
  url: string;
  key: string;
  model: string;
  type: string;
  stream: boolean;
  max_context: number;
  max_tokens: number;
  temperature: number;
  top_k: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
}
```

### PromptFilter

```typescript
interface PromptFilter {
  main?: boolean | string | string[] | ChatCompletionMessage[];
  personaDescription?: boolean | string | string[] | ChatCompletionMessage[];
  charDescription?: boolean | string | string[] | ChatCompletionMessage[];
  charPersonality?: boolean | string | string[] | ChatCompletionMessage[];
  scenario?: boolean | string | string[] | ChatCompletionMessage[];
  chatExamples?: boolean | string | string[] | ChatCompletionMessage[];
  worldInfoBefore?: boolean | string | string[] | ChatCompletionMessage[];
  worldInfoAfter?: boolean | string | string[] | ChatCompletionMessage[];
  chatHistory?: boolean | string | string[] | ChatCompletionMessage[];
  worldInfoDepth?: boolean;
  authorsNoteDepth?: boolean;
  presetDepth?: boolean;
  charDepth?: boolean;
  worldInfoOutlet?: boolean;
}
```

### MacroOverride

```typescript
interface MacroOverride {
  user?: string;
  char?: string;
  original?: string;
  group?: string;
  macros?: Record<string, DynamicMacroValue>;
}
```

### Preset

```typescript
interface Preset {
  name: string;
  prompts: PresetPrompt[];
  regexs: RegEx[];
  templates: Record<string, Template>;
}
```

### PresetPrompt

```typescript
interface PresetPrompt {
  name: string;
  role: ContextRole;
  triggers: string[];
  prompt: string;
  injectionPosition: 'relative' | 'inChat';
  enabled: boolean | null;
  internal: string | null;
  injectionDepth: number;
  injectionOrder: number;
  maxDepth: number;
}
```

### RegEx

```typescript
interface RegEx {
  name: string;
  regex: string;
  replace: string;
  userInput: boolean;
  aiOutput: boolean;
  worldInfo: boolean;
  enabled: boolean;
  minDepth: number | null;
  maxDepth: number | null;
  ephemerality: boolean;
  request: boolean;
  response: boolean;
}
```

### Template

```typescript
interface Template {
  decorator: string;
  tag: string;
  prompts: PresetPrompt[];
  regex: string;
  findRegex: string;
  filters: (keyof PromptFilter)[];
  retryCount: number;
  retryInterval: number;
}
```

### WorldInfoEntry

```typescript
interface WorldInfoEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  vectorized: boolean;
  selective: boolean;
  selectiveLogic: number;
  addMemo: boolean;
  order: number;
  position: number;
  disable: boolean;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: boolean;
  probability: number;
  useProbability: boolean;
  depth: number;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  useGroupScoring: boolean | null;
  automationId: string;
  role: number | null;
  sticky: number;
  cooldown: number;
  delay: number;
  displayIndex: number;
  world: string;
  decorators: string[];
  extensions: WorldInfoExtension;
  hash: number | undefined;
  triggers: string[];
  outletName: string;
  characterFilter: WorldInfoFilter;
  characterFilterNames: string[];
  characterFilterTags: string[];
  characterFilterExclude: boolean;
  matchPersonaDescription: boolean;
  matchCharacterDescription: boolean;
  matchCharacterPersonality: boolean;
  matchCharacterDepthPrompt: boolean;
  matchScenario: boolean;
  matchCreatorNotes: boolean;
  ignoreBudget: boolean;
}
```

### Settings

```typescript
interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextSize: number;
  maxTokens: number;
  temperature: number;
  topK: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stream: boolean;
  includeHeaders: Record<string, unknown>;
  includeBody: Record<string, unknown>;
  excludeBody: Record<string, unknown>;
  promptPostProcessing: 'none' | 'merge' | 'semi' | 'strict' | 'single';
  presets: Record<string, Preset>;
  currentPreset: string;
  maxConcurrency: number;
}
```

---

## 相关文档

- [使用教程](./TUTORIAL.md) - 完整使用指南
- [装饰器详细文档](./DECORATORS.md) - 所有装饰器的详细说明

## 版本信息

- 扩展版本：0.9.4.1
- 最后更新：2024