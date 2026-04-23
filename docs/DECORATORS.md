# 装饰器详细文档

本文档详细介绍 ST-CustomGeneration 扩展提供的所有装饰器，包括语法、参数、使用场景和完整示例。

## 目录

- [装饰器详细文档](#装饰器详细文档)
  - [目录](#目录)
  - [装饰器概述](#装饰器概述)
    - [支持的装饰器列表](#支持的装饰器列表)
  - [工作原理](#工作原理)
    - [执行流程](#执行流程)
    - [Before/After 处理流程](#beforeafter-处理流程)
    - [详细步骤说明](#详细步骤说明)
    - [Before/After 变体](#beforeafter-变体)
    - [触发条件](#触发条件)
  - [通用语法](#通用语法)
    - [基本格式](#基本格式)
    - [参数格式](#参数格式)
    - [转义](#转义)
  - [内容替换装饰器](#内容替换装饰器)
    - [@@replace](#replace)
      - [语法](#语法)
      - [参数](#参数)
      - [使用场景](#使用场景)
      - [示例](#示例)
      - [工作原理](#工作原理-1)
    - [@@replace\_diff](#replace_diff)
      - [语法](#语法-1)
      - [参数](#参数-1)
      - [使用场景](#使用场景-1)
      - [示例](#示例-1)
      - [工作原理](#工作原理-2)
    - [@@replace\_search](#replace_search)
      - [语法](#语法-2)
      - [参数](#参数-2)
      - [格式说明](#格式说明)
      - [使用场景](#使用场景-2)
      - [示例](#示例-2)
      - [工作原理](#工作原理-3)
    - [@@replace\_ejs](#replace_ejs)
      - [语法](#语法-3)
      - [参数](#参数-3)
      - [可用变量](#可用变量)
      - [使用场景](#使用场景-3)
      - [示例](#示例-3)
  - [变量更新装饰器](#变量更新装饰器)
    - [@@variables\_json](#variables_json)
      - [语法](#语法-4)
      - [参数](#参数-4)
      - [使用场景](#使用场景-4)
      - [示例](#示例-4)
      - [工作原理](#工作原理-4)
    - [@@variables\_yaml](#variables_yaml)
      - [语法](#语法-5)
      - [参数](#参数-5)
      - [使用场景](#使用场景-5)
      - [示例](#示例-5)
      - [工作原理](#工作原理-5)
    - [@@variables\_jsonpatch](#variables_jsonpatch)
      - [语法](#语法-6)
      - [参数](#参数-6)
      - [支持的操作](#支持的操作)
      - [使用场景](#使用场景-6)
      - [示例](#示例-6)
  - [输出追加装饰器](#输出追加装饰器)
    - [@@append\_output](#append_output)
      - [语法](#语法-7)
      - [参数](#参数-7)
      - [使用场景](#使用场景-7)
      - [示例](#示例-7)
      - [工作原理](#工作原理-6)
    - [@@append\_output\_ejs](#append_output_ejs)
      - [语法](#语法-8)
      - [参数](#参数-8)
      - [可用变量](#可用变量-1)
      - [使用场景](#使用场景-8)
      - [示例](#示例-8)
  - [代码执行装饰器](#代码执行装饰器)
    - [@@evaluate\_ejs](#evaluate_ejs)
      - [语法](#语法-9)
      - [参数](#参数-9)
      - [使用场景](#使用场景-9)
      - [示例](#示例-9)
  - [辅助装饰器](#辅助装饰器)
    - [@@batch\_order](#batch_order)
      - [语法](#语法-10)
      - [参数](#参数-10)
      - [顺序值](#顺序值)
      - [示例](#示例-10)
    - [@@preset](#preset)
      - [语法](#语法-11)
      - [参数](#参数-11)
      - [示例](#示例-11)
    - [@@json\_schema](#json_schema)
      - [语法](#语法-12)
      - [使用场景](#使用场景-10)
    - [@@zod\_schema](#zod_schema)
      - [语法](#语法-13)
      - [使用场景](#使用场景-11)
  - [装饰器组合使用](#装饰器组合使用)
    - [组合规则](#组合规则)
    - [示例](#示例-12)
  - [最佳实践](#最佳实践)
    - [1. 使用标签区分模板](#1-使用标签区分模板)
    - [2. 合理使用 Before/After 变体](#2-合理使用-beforeafter-变体)
    - [3. 错误处理](#3-错误处理)
    - [4. 变量命名规范](#4-变量命名规范)
    - [5. 避免过度使用](#5-避免过度使用)
    - [6. 调试技巧](#6-调试技巧)
    - [7. 性能优化](#7-性能优化)
  - [相关文档](#相关文档)
  - [参考标准](#参考标准)

---

## 装饰器概述

装饰器是 World Info 条目中的特殊标记，用于触发各种后处理操作。通过在 World Info 条目内容的开头添加装饰器，可以实现：

- **动态更新 WI 内容** - 根据生成结果自动更新 World Info
- **变量存储与管理** - 存储和更新状态变量
- **输出追加** - 在 AI 回复末尾追加额外内容
- **代码执行** - 运行自定义 EJS 代码

### 支持的装饰器列表

| 装饰器 | 功能 | 执行时机 |
|--------|------|----------|
| `@@replace` | 直接替换 WI 内容 | 生成后 |
| `@@replace_diff` | Git Diff 格式更新 | 生成后 |
| `@@replace_search` | 搜索替换文本 | 生成后 |
| `@@replace_ejs` | EJS 模板替换 | 生成后 |
| `@@variables_json` | JSON 合并更新变量 | 生成后 |
| `@@variables_yaml` | YAML 合并更新变量 | 生成后 |
| `@@variables_jsonpatch` | JSON Patch 更新变量 | 生成后 |
| `@@append_output` | 追加内容到消息末尾 | 生成后 |
| `@@append_output_ejs` | EJS 模板追加 | 生成后 |
| `@@evaluate_ejs` | 执行 EJS 代码 | 生成后 |
| `@@batch_order` | 控制执行顺序 | 解析时 |
| `@@preset` | 指定使用的预设 | 解析时 |
| `@@json_schema` | 定义 JSON Schema 验证 | 解析时 |
| `@@zod_schema` | 定义 Zod Schema 验证 | 解析时 |

---

## 工作原理

### 执行流程

```mermaid
flowchart TD
    A[用户发送消息] --> B[开始生成]
    B --> C[触发 Before 处理]
    C --> D[原始生成逻辑]
    D --> E[显示 AI 输出]
    E --> F[触发 After 处理]
    F --> G[完成]
```

### Before/After 处理流程

```mermaid
flowchart TD
    A[根据最后的 User/Char 消息触发 WI] --> B[根据 decorator 选择对应的 template]
    B --> C{验证最后一条消息<br/>User/Char 是否满足查找正则?}
    C -->|是| D[执行生成]
    C -->|否| E[跳过处理]
    D --> F[获取 AI 输出]
    F --> G{验证 AI 输出是否满足正则?}
    G -->|是| H[根据 decorator 执行对应的 processor]
    G -->|否| I{是否达到重试次数?}
    I -->|否| D
    I -->|是| J[处理失败，记录错误]
    H --> K[完成处理]
```

### 详细步骤说明

1. **触发 WI**
   - Before 处理：根据最后一条 User 消息触发
   - After 处理：根据最后一条 Char 消息触发

2. **选择模板**
   - 根据装饰器名称和标签查找匹配的模板
   - 如果没有找到模板，使用默认配置

3. **验证触发条件**
   - 使用模板的 `findRegex` 验证最后一条消息（User/Char）内容
   - 如果验证失败，跳过该装饰器的处理

4. **执行生成**
   - 构建提示词上下文
   - 应用模板配置的过滤器
   - 调用 AI API 生成内容

5. **获取 AI 输出**
   - 获取 AI 生成的结果

6. **验证生成结果**
   - 使用模板的 `regex` 验证 AI 输出
   - 如果验证失败，根据 `retryCount` 配置重新生成
   - 重试间隔由 `retryInterval` 配置决定

7. **执行处理器**
   - 根据装饰器类型执行对应的 processor
   - 更新 WI 内容、变量或追加输出

### Before/After 变体

每个装饰器都有两种执行时机：

| 变体 | 执行时机 | 用途 |
|------|----------|------|
| `@@decorator` | AI 生成后 | 处理 AI 的生成结果 |
| `@@decorator_before` | AI 生成前 | 预处理 WI 内容 |

例如：
- `@@replace` - 在 AI 生成后执行替换
- `@@replace_before` - 在 AI 生成前执行替换

### 触发条件

装饰器的触发需要满足以下条件：

1. World Info 条目已启用
2. 条目的触发关键词被匹配
3. 装饰器语法正确
4. 模板配置正确（如需要）

---

## 通用语法

### 基本格式

```
@@装饰器名称 参数1 参数2 "带空格的参数"
内容
```

### 参数格式

参数支持以下格式：

| 格式 | 示例 | 说明 |
|------|------|------|
| 无参数 | `@@replace` | 不需要额外参数 |
| 单个参数 | `@@replace tag1` | 空格分隔的参数 |
| 带引号参数 | `@@replace "tag with space"` | 包含空格的参数需要引号 |
| 多个参数 | `@@replace tag1 tag2` | 多个参数用空格分隔 |

### 转义

如果内容以 `@@` 开头但不是装饰器，可以使用 `@@@` 转义：

```
@@@这不是装饰器，是普通文本
```

---

## 内容替换装饰器

### @@replace

直接替换 World Info 条目的内容。

#### 语法

```
@@replace [tag]
新内容
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签，用于匹配特定模板 |

#### 使用场景

- 完全替换 WI 条目内容
- 更新角色状态描述
- 记录简单信息

#### 示例

**基本用法：**

```
@@replace
角色当前心情：开心
位置：花园
```

**带标签用法：**

```
@@replace mood
心情：愤怒
```

#### 工作原理

1. AI 生成新内容
2. 模板处理生成结果（如配置了匹配正则）
3. 新内容完全替换原 WI 内容
4. 覆盖记录保存在消息的 `swipe_info` 中

---

### @@replace_diff

使用 Git Diff（Unified Diff）格式更新 WI 内容。

#### 语法

```
@@replace_diff [tag]
--- original
+++ modified
@@ -1,2 +1,2 @@
-old line
+new line
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 使用场景

- 精确修改 WI 内容的特定部分
- 保留大部分内容，只修改少量文本
- 需要精确控制修改范围的场景

#### 示例

```
@@replace_diff
--- a/content.txt
+++ b/content.txt
@@ -1,3 +1,3 @@
 角色名称：Alice
-心情：开心
+心情：兴奋
 位置：花园

```

#### 工作原理

1. 获取当前 WI 内容
2. 应用 Diff 补丁
3. 更新 WI 内容

> ⚠️ **注意**：Diff 格式需要精确匹配原内容，否则可能应用失败。

---

### @@replace_search

使用搜索替换模式更新 WI 内容。支持两种格式：Git Conflict 风格和 JSON 风格。

#### 语法

**Git Conflict 风格：**

```
@@replace_search [tag]
<<<<<<< SEARCH
搜索文本
=======
替换文本
>>>>>>> REPLACE
```

**JSON 风格（单个替换）：**

```
@@replace_search [tag]
{"search": "搜索文本", "replace": "替换文本"}
```

**JSON 风格（多个替换）：**

```
@@replace_search [tag]
[
  {"search": "文本1", "replace": "替换1"},
  {"search": "文本2", "replace": "替换2"}
]
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 格式说明

**Git Conflict 风格：**
- 使用 `<<<<<<< SEARCH` 标记搜索文本开始
- 使用 `=======` 分隔搜索文本和替换文本
- 使用 `>>>>>>> REPLACE` 标记替换文本结束
- 支持多个替换块

**JSON 风格：**
- 单个替换：使用包含 `search` 和 `replace` 字段的对象
- 多个替换：使用包含多个替换对象的数组

#### 使用场景

- 简单的文本替换
- 更新特定字段值
- 修改关键词
- 批量替换多个文本

#### 示例

**Git Conflict 风格（单个替换）：**

```
@@replace_search
<<<<<<< SEARCH
开心
=======
兴奋
>>>>>>> REPLACE
```

**Git Conflict 风格（多个替换）：**

```
@@replace_search
<<<<<<< SEARCH
心情：开心
=======
心情：兴奋
>>>>>>> REPLACE
<<<<<<< SEARCH
位置：花园
=======
位置：图书馆
>>>>>>> REPLACE
```

**JSON 风格（单个替换）：**

```
@@replace_search
{"search": "开心", "replace": "兴奋"}
```

**JSON 风格（多个替换）：**

```
@@replace_search
[
  {"search": "心情：开心", "replace": "心情：兴奋"},
  {"search": "位置：花园", "replace": "位置：图书馆"}
]
```

#### 工作原理

1. 解析生成内容，识别格式类型（Git Conflict 或 JSON）
2. 在 WI 内容中搜索指定的搜索文本
3. 如果搜索文本不存在，抛出错误并记录失败
4. 将找到的文本替换为新文本
5. 更新 WI 内容

> ⚠️ **注意**：搜索文本必须在原 WI 内容中存在，否则替换会失败。

---

### @@replace_ejs

使用 EJS 模板生成替换内容。

#### 语法

```
@@replace_ejs [tag]
<%= expression %>
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 可用变量

在 EJS 模板中可以访问以下变量：

| 变量 | 类型 | 说明 |
|------|------|------|
| `variables` | Object | 当前存储的变量 |
| `char` | Object | 角色信息 |
| `user` | Object | 用户信息 |
| `message` | String | 当前消息内容 |
| `lastUserMessage` | String | 最后一条用户消息 |
| `lastCharMessage` | String | 最后一条角色消息 |
| `original` | String | 原始 WI 内容 |
| `current` | String | 当前 WI 内容（可能已被覆盖） |

#### 使用场景

- 动态生成 WI 内容
- 基于变量构建复杂文本
- 条件性内容生成

#### 示例

**基本用法：**

```
@@replace_ejs
角色状态报告：
心情：<%= variables.mood || '未知' %>
位置：<%= variables.location || '未知' %>
时间：<%= new Date().toLocaleTimeString() %>
```

**条件判断：**

```
@@replace_ejs
<% if (variables.mood === '开心') { %>
角色正在微笑，看起来很愉快。
<% } else { %>
角色的表情有些复杂。
<% } %>
```

---

## 变量更新装饰器

### @@variables_json

使用 JSON 格式合并更新变量。

#### 语法

```
@@variables_json [tag]
{
  "key": "value",
  "nested": {
    "property": "updated"
  }
}
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 使用场景

- 存储结构化数据
- 更新角色状态
- 记录对话信息

#### 示例

**基本用法：**

```
@@variables_json
{
  "mood": "开心",
  "energy": 80,
  "location": "花园"
}
```

**嵌套对象：**

```
@@variables_json
{
  "stats": {
    "health": 100,
    "mana": 50
  },
  "inventory": ["剑", "盾牌"]
}
```

#### 工作原理

使用 `_.mergeWith` 合并到现有变量：

- 新键会被添加
- 已有键会被更新
- **不支持删除**，如需删除变量请使用 `@@variables_jsonpatch`
- 数组会被完全替换（不会合并）

---

### @@variables_yaml

使用 YAML 格式更新变量。

#### 语法

```
@@variables_yaml [tag]
key: value
nested:
  property: updated
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 使用场景

- 更易读的变量格式
- 复杂嵌套结构
- 需要注释的场景

#### 示例

```
@@variables_yaml
mood: 开心
energy: 80
location: 花园
stats:
  health: 100
  mana: 50
inventory:
  - 剑
  - 盾牌
```

#### 工作原理

YAML 内容会被解析并转换为 JSON，然后使用 `_.mergeWith` 合并：

- 新键会被添加
- 已有键会被更新
- **不支持删除**，如需删除变量请使用 `@@variables_jsonpatch`
- 数组会被完全替换（不会合并）

---

### @@variables_jsonpatch

使用 JSON Patch (RFC 6902) 格式精确更新变量。

#### 语法

```
@@variables_jsonpatch [tag]
[
  { "op": "add", "path": "/newKey", "value": "newValue" },
  { "op": "replace", "path": "/existingKey", "value": "updatedValue" },
  { "op": "remove", "path": "/oldKey" }
]
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 支持的操作

| 操作 | 说明 | 示例 |
|------|------|------|
| `add` | 添加或替换值 | `{"op": "add", "path": "/name", "value": "Alice"}` |
| `replace` | 替换现有值 | `{"op": "replace", "path": "/age", "value": 25}` |
| `remove` | 删除值 | `{"op": "remove", "path": "/temp"}` |
| `move` | 移动值 | `{"op": "move", "from": "/old", "path": "/new"}` |
| `copy` | 复制值 | `{"op": "copy", "from": "/template", "path": "/new"}` |
| `test` | 测试值（用于条件） | `{"op": "test", "path": "/status", "value": "active"}` |

#### 使用场景

- 精确控制变量更新
- 数组元素操作
- 条件性更新

#### 示例

**添加和替换：**

```
@@variables_jsonpatch
[
  { "op": "add", "path": "/mood", "value": "兴奋" },
  { "op": "replace", "path": "/energy", "value": 90 }
]
```

**数组操作：**

```
@@variables_jsonpatch
[
  { "op": "add", "path": "/inventory/-", "value": "新物品" },
  { "op": "remove", "path": "/inventory/0" }
]
```

---

## 输出追加装饰器

### @@append_output

追加内容到 AI 回复的末尾。

#### 语法

```
@@append_output [tag]
要追加的内容
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 使用场景

- 添加固定的结尾文本
- 追加格式化内容
- 添加分隔符

#### 示例

```
@@append_output

---
*角色陷入了沉思...*
```

#### 工作原理

1. AI 生成回复
2. 装饰器内容追加到回复末尾
3. 用户看到完整的消息

---

### @@append_output_ejs

使用 EJS 模板动态追加内容。

#### 语法

```
@@append_output_ejs [tag]
<%= expression %>
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 可用变量

与 `@@replace_ejs` 相同，参见 [可用变量](#可用变量)。

#### 使用场景

- 动态生成追加内容
- 基于变量条件追加
- 格式化输出

#### 示例

**基本用法：**

```
@@append_output_ejs

---
*<%= char.name %> 的当前心情：<%= variables.mood || '平静' %>*
```

**条件追加：**

```
@@append_output_ejs
<% if (variables.energy < 30) { %>

*<%= char.name %> 看起来有些疲惫...*
<% } %>
```

---

## 代码执行装饰器

### @@evaluate_ejs

执行 EJS 代码，不输出任何内容。

#### 语法

```
@@evaluate_ejs [tag]
// JavaScript 代码
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| tag | 否 | 模板标签 |

#### 使用场景

- 执行复杂逻辑
- 计算变量值
- 调用外部 API（受限）

#### 示例

**计算逻辑：**

```
@@evaluate_ejs
<%
// 计算能量消耗
const currentEnergy = variables.energy || 100;
const newEnergy = Math.max(0, currentEnergy - 10);
variables.energy = newEnergy;

// 设置心情
if (newEnergy < 20) {
  variables.mood = '疲惫';
}
%>
```

**数据处理：**

```
@@evaluate_ejs
<%
// 处理数组数据
const inventory = variables.inventory || [];
const itemCount = inventory.length;
variables.itemCount = itemCount;
%>
```

> ⚠️ **注意**：此装饰器不输出任何内容，仅执行代码。

---

## 辅助装饰器

### @@batch_order

控制同一批次中装饰器的执行顺序。

#### 语法

```
@@batch_order <order>
@@其他装饰器
内容
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| order | 是 | 执行顺序 |

#### 顺序值

| 值 | 说明 |
|------|------|
| `top` | 最先执行 |
| `medium` | 中等优先级（默认） |
| `bottom` | 最后执行 |
| 数字 | 自定义顺序（小的先执行） |

#### 示例

```
@@batch_order top
@@variables_json
{
  "initialized": true
}
```

---

### @@preset

指定后处理生成时使用的预设。

#### 语法

```
@@preset <preset_name>
@@其他装饰器
内容
```

#### 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| preset_name | 是 | 预设名称 |

#### 示例

```
@@preset my_custom_preset
@@replace
新的内容
```

---

### @@json_schema

定义 JSON Schema 来验证变量。

#### 语法

```
@@json_schema
{
  "type": "object",
  "properties": {
    "key": { "type": "string" }
  }
}
```

#### 使用场景

- 验证变量结构
- 确保数据类型正确
- 提供变量文档

---

### @@zod_schema

定义 Zod Schema 来验证变量。

#### 语法

```
@@zod_schema
registerSchema(
  z.object({
    name: z.string(),
    age: z.number().optional()
  })
)
```

#### 使用场景

- 更灵活的验证规则
- 类型推断
- 复杂验证逻辑

---

## 装饰器组合使用

多个装饰器可以在同一个 World Info 条目中使用。

### 组合规则

1. 装饰器按出现顺序解析
2. 执行顺序由 `@@batch_order` 控制
3. 同一类型的装饰器按顺序执行

### 示例

**先更新变量，再追加输出：**

```
@@batch_order 0
@@variables_json
{
  "mood": "开心"
}


@@batch_order 1
@@append_output_ejs

*<%= char.name %> 看起来很<%= variables.mood %>！*
```

**条件性更新：**

```
@@evaluate_ejs
<%
if (variables.energy < 50) {
  variables.needRest = true;
}
%>


@@append_output_ejs
<% if (variables.needRest) { %>

*<%= char.name %> 需要休息一下...*
<% } %>
```

---

## 最佳实践

### 1. 使用标签区分模板

为不同用途的装饰器使用不同的标签：

```
@@replace mood
心情：开心


@@replace location
位置：花园
```

### 2. 合理使用 Before/After 变体

- **Before 变体**：用于预处理，如初始化变量
- **After 变体**：用于处理生成结果

### 3. 错误处理

在 EJS 中添加错误处理：

```
@@evaluate_ejs
<%
try {
  // 可能出错的代码
  const value = JSON.parse(someString);
  variables.parsed = value;
} catch (e) {
  console.error('解析失败:', e);
  variables.parsed = null;
}
%>
```

### 4. 变量命名规范

使用有意义的变量名：

```
@@variables_json
{
  "characterMood": "开心",
  "characterLocation": "花园",
  "conversationTurn": 1
}
```

### 5. 避免过度使用

- 不要在单个条目中使用过多装饰器
- 复杂逻辑考虑拆分到多个条目
- 使用模板配置简化重复操作

### 6. 调试技巧

使用 `console.log` 调试 EJS：

```
@@evaluate_ejs
<%
console.log('当前变量:', JSON.stringify(variables));
console.log('角色名称:', char.name);
%>
```

### 7. 性能优化

- 避免在 EJS 中进行复杂计算
- 使用 `@@batch_order` 控制执行顺序
- 合理配置模板的重试参数

---

## 相关文档

- [使用教程](./TUTORIAL.md) - 完整使用指南
- [API 参考文档](./API.md) - 编程接口文档

## 参考标准

- [JSON Patch (RFC 6902)](https://tools.ietf.org/html/rfc6902)
- [Unified Diff Format](https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html)
- [EJS Documentation](https://github.com/zonde306/ST-Prompt-Template/README.md)