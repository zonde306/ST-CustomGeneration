# Custom Generation 使用教程

本文档提供 ST-CustomGeneration 扩展的完整使用指南，帮助您快速上手并充分利用各项功能。

## 目录

- [环境准备](#环境准备)
- [安装步骤](#安装步骤)
- [基础配置](#基础配置)
- [预设管理](#预设管理)
- [提示词管理](#提示词管理)
- [正则处理](#正则处理)
- [模板系统](#模板系统)
- [World Info 增强](#world-info-增强)
- [高级功能](#高级功能)
- [常见问题](#常见问题)

---

## 环境准备

### 系统要求

| 项目 | 要求 |
|------|------|
| SillyTavern 版本 | 最新稳定版（推荐） |
| 浏览器 | Chrome 90+、Firefox 88+、Edge 90+ 或其他现代浏览器 |
| Node.js | 仅开发时需要，v18+ |

### 兼容性说明

- 本扩展支持 OpenAI 兼容的 API 端点
- 支持流式响应和非流式响应
- 与 SillyTavern 内置功能完全兼容

### 准备工作

1. 确保您已正确安装并运行 SillyTavern
2. 准备好您的 API 端点地址和密钥（如使用自定义 API）
3. 了解基本的 SillyTavern 操作方式

---

## 安装步骤

### 方法一：通过扩展市场安装（推荐）

1. 启动 SillyTavern
2. 点击右上角的 **扩展图标**（拼图形状）
3. 在扩展市场搜索 "Custom Generation"
4. 点击 **安装** 按钮
5. 重启 SillyTavern 或刷新页面

### 方法二：手动安装

```bash
# 进入 SillyTavern 扩展目录
cd SillyTavern/public/scripts/extensions/third-party/

# 克隆仓库
git clone https://github.com/zonde306/ST-CustomGeneration.git
```

### 方法三：下载 ZIP 安装

1. 访问 [Releases 页面](https://github.com/zonde306/ST-CustomGeneration/releases)
2. 下载最新版本的 ZIP 文件
3. 解压到 `SillyTavern/public/scripts/extensions/third-party/ST-CustomGeneration/`
4. 重启 SillyTavern

### 验证安装

安装完成后，在 SillyTavern 的扩展管理页面应该能看到 "Custom Generation" 扩展，状态为已启用。

---

## 基础配置

### 打开设置面板

1. 点击 SillyTavern 右上角的 **扩展图标**
2. 找到 "Custom Generation" 扩展
3. 点击扩展名称或设置图标打开设置面板

### API 连接设置

#### 基本参数

| 参数 | 说明 | 示例 |
|------|------|------|
| Base URL | API 端点地址 | `https://api.openai.com/v1` |
| API Key | API 密钥 | `sk-xxxx...` |
| Model | 模型标识符 | `gpt-4` |

#### 生成参数

| 参数 | 范围 | 默认值 | 说明 |
|------|------|--------|------|
| Context Size | 1-128000 | 4096 | 上下文窗口大小（token） |
| Max Tokens | 1-32000 | 2048 | 最大响应长度 |
| Temperature | 0-2 | 1.0 | 生成随机性 |
| Top-K | 0-40 | 0 | Top-K 采样 |
| Top-P | 0-1 | 1.0 | Top-P 采样 |
| Frequency Penalty | -2~2 | 0 | 频率惩罚 |
| Presence Penalty | -2~2 | 0 | 存在惩罚 |

### 流式响应

启用 **Stream** 选项可以实现打字机效果的实时输出。

### 高级 API 设置

#### 自定义请求头

在 **Include Headers** 中添加自定义请求头：

```json
{
  "X-Custom-Header": "value"
}
```

#### 自定义请求体

在 **Include Body** 中添加额外参数：

```json
{
  "repetition_penalty": 1.1,
  "min_p": 0.05
}
```

#### 排除请求体字段

在 **Exclude Body** 中指定要排除的字段：

```json
["frequency_penalty", "presence_penalty"]
```

---

## 预设管理

预设是一组配置的集合，包括提示词列表、正则规则和模板。

### 创建预设

1. 在设置面板中找到 **预设管理** 区域
2. 点击 **新建预设** 按钮
3. 输入预设名称
4. 配置各项参数
5. 点击 **保存**

### 编辑预设

1. 从预设下拉列表选择要编辑的预设
2. 修改各项配置
3. 点击 **保存** 按钮保存更改

### 删除预设

1. 选择要删除的预设
2. 点击 **删除预设** 按钮
3. 确认删除操作

> ⚠️ **注意**：删除预设后无法恢复，请谨慎操作。

### 导入/导出预设

#### 导出预设

1. 点击 **导出** 按钮
2. 选择要导出的内容：
   - 预设配置
   - API 连接设置（可选）
3. 系统将下载 JSON 格式的配置文件

#### 导入预设

1. 点击 **导入** 按钮
2. 选择 JSON 配置文件
3. 确认导入内容
4. 保存设置

### 预设文件格式

```json
{
  "version": "0.9.4.1",
  "presets": [
    {
      "name": "我的预设",
      "prompts": [],
      "regexs": [],
      "templates": {}
    }
  ],
  "currentPreset": 0
}
```

---

## 提示词管理

提示词管理功能允许您自定义发送给 AI 的提示内容。

### 提示词列表

每个预设包含一个提示词列表，按顺序组成最终的提示。

### 添加提示词

1. 在预设设置中找到 **提示词列表**
2. 点击 **添加提示词**
3. 配置以下参数：

| 参数 | 说明 |
|------|------|
| 名称 | 提示词的显示名称 |
| 角色 | user / assistant / system |
| 内容 | 提示词文本 |
| 启用 | 是否启用此提示词 |
| 触发类型 | 适用的生成类型 |

### 提示词角色

| 角色 | 说明 | 使用场景 |
|------|------|----------|
| system | 系统消息 | 设定 AI 行为规则 |
| user | 用户消息 | 模拟用户输入 |
| assistant | 助手消息 | 预设 AI 回复 |

### 注入位置

提示词支持两种注入方式：

#### 相对位置（Relative）

按顺序与其他提示词组合，适用于系统提示等。

#### 聊天内位置（In Chat）

注入到聊天历史中，支持深度设置：

| 深度 | 位置 |
|------|------|
| 0 | 最后一条消息之后 |
| 1 | 最后一条消息之前 |
| 2 | 倒数第二条消息之前 |
| ... | 以此类推 |

### 内置提示词类型

| 类型 | 说明 |
|------|------|
| main | 主提示词 |
| personaDescription | 用户人设描述 |
| charDescription | 角色描述 |
| charPersonality | 角色性格 |
| scenario | 场景设定 |
| chatExamples | 对话示例 |
| worldInfoBefore | World Info（角色前） |
| worldInfoAfter | World Info（角色后） |
| chatHistory | 聊天历史 |
| charNote | 角色深度提示 |
| authorsNote | 作者注释 |
| lastCharMessage | 最后一条角色消息 |
| lastUserMessage | 最后一条用户消息 |
| worldInfoDepth0-4 | World Info 深度注入 |
| presetDepth0-4 | 预设深度注入 |
| chatDepth0-4 | 聊天深度消息 |

### 拖拽排序

在提示词列表中，可以通过拖拽调整提示词的顺序。

### 条件触发

设置 **触发类型** 可以控制提示词在哪些生成场景下生效：

- 留空：所有场景
- `normal`：普通生成
- `regenerate`：重新生成
- `swipe`：滑动切换
- `continue`：继续生成

---

## 正则处理

正则处理功能允许在请求发送前或响应接收后自动处理文本。

### 创建正则规则

1. 在预设设置中找到 **正则规则列表**
2. 点击 **添加规则**
3. 配置规则参数

### 规则参数

| 参数 | 说明 |
|------|------|
| 名称 | 规则显示名称 |
| 查找正则 | 用于匹配的正则表达式 |
| 替换文本 | 替换内容，支持 `$1`、`$2` 等捕获组 |
| 启用 | 是否启用此规则 |

### 作用范围

| 选项 | 说明 |
|------|------|
| 用户输入 | 应用于用户发送的消息 |
| AI 输出 | 应用于 AI 生成的回复 |
| World Info | 应用于 World Info 内容 |

### 深度限制

- **最小深度**：规则生效的最小消息深度
- **最大深度**：规则生效的最大消息深度

深度 0 表示最后一条消息，深度 1 表示倒数第二条，以此类推。

### 请求/响应处理

| 选项 | 说明 |
|------|------|
| 请求处理 | 在发送给 API 前处理文本 |
| 响应处理 | 在接收 API 响应后处理文本 |

### 临时处理

启用 **临时处理** 后，原始文本不会被修改，仅影响发送给 API 的内容。

### 正则表达式示例

#### 移除 HTML 标签

```
查找：<[^>]+>
替换：（留空）
```

#### 替换特定文本

```
查找：\b(old_word)\b
替换：new_word
```

#### 格式化输出

```
查找：\*\*(.+?)\*\*
替换：<b>$1</b>
```

---

## 模板系统

模板系统用于配置后处理生成器的行为，与装饰器配合使用。

### 模板结构

每个模板包含以下配置：

| 参数 | 说明 |
|------|------|
| 装饰器 | 关联的装饰器类型 |
| 标签 | 用于区分同类型装饰器 |
| 提示词 | 生成时使用的提示词列表 |
| 匹配正则 | 从生成结果中提取内容的正则 |
| 检测正则 | 触发生成的条件正则 |
| 过滤器 | 禁用特定提示词类型 |
| 重试次数 | 生成失败时的重试次数 |
| 重试间隔 | 重试间隔时间（毫秒） |

### 创建模板

1. 在预设设置中找到 **模板列表**
2. 点击 **添加模板**
3. 选择装饰器类型
4. 配置模板参数

### 匹配正则示例

从生成结果中提取内容：

```
/(?:[\s\S]*?)```json\n([\s\S]*?)\n```/
```

这将匹配 Markdown 代码块中的 JSON 内容。

### 检测正则示例

检测消息中是否包含特定内容：

```
/\{\{record::(.+?)\}\}/
```

### 过滤器选项

过滤器可以禁用特定的提示词类型：

- `main` - 主提示词
- `personaDescription` - 用户人设
- `charDescription` - 角色描述
- `charPersonality` - 角色性格
- `scenario` - 场景
- `chatExamples` - 对话示例
- `worldInfoBefore` / `worldInfoAfter` - World Info
- `chatHistory` - 聊天历史

---

## World Info 增强

本扩展为 World Info 提供了强大的增强功能。

### 装饰器概述

装饰器是 World Info 条目中的特殊标记，用于触发各种后处理操作。在 World Info 条目内容的开头添加装饰器即可启用相应功能。

### 基本语法

```
@@装饰器名称 参数
内容
@@end
```

> 💡 **提示**：详细的装饰器文档请参阅 [DECORATORS.md](./DECORATORS.md)。

### 支持的装饰器

| 装饰器 | 功能 |
|--------|------|
| `@@append_output` | 追加内容到消息末尾 |
| `@@append_output_ejs` | 使用 EJS 模板追加内容 |
| `@@evaluate_ejs` | 执行 EJS 代码 |
| `@@replace_ejs` | 使用 EJS 替换 WI 内容 |
| `@@replace` | 直接替换 WI 内容 |
| `@@replace_diff` | 使用 Git Diff 格式更新 |
| `@@replace_search` | 搜索并替换文本 |
| `@@variables_json` | 使用 JSON 更新变量 |
| `@@variables_yaml` | 使用 YAML 更新变量 |
| `@@variables_jsonpatch` | 使用 JSON Patch 更新变量 |

### Before/After 变体

每个装饰器都有 `_before` 变体，用于在生成前执行：

- `@@replace` - 生成后执行
- `@@replace_before` - 生成前执行

### 变量存储

World Info 增强支持变量存储功能：

- **消息变量**：存储在特定消息中，每条消息独立
- **聊天变量**：存储在聊天元数据中，整个聊天共享

### 使用示例

#### 使用变量存储

在 World Info 条目中使用 `@@variables_json` 存储变量：

```
@@variables_json
{
  "mood": "happy",
  "location": "garden"
}
@@end
```

#### 使用 EJS 模板

使用 `@@append_output_ejs` 动态追加内容：

```
@@append_output_ejs
<%= char.name %> 看起来很<%= variables.mood %>。
@@end
```

#### 使用搜索替换

使用 `@@replace_search` 更新 WI 内容：

```
@@replace_search
旧文本|||新文本
@@end
```

---

## 高级功能

### 并发控制

在设置中可以配置 **最大并发数**，控制 World Info 后处理生成的并发任务数量。

- 较低的值（1-2）：更稳定，但处理较慢
- 较高的值（3-5）：处理更快，但可能增加 API 负载

### 日志查看

扩展提供日志查看功能：

1. 点击扩展菜单中的 **查看日志**
2. 查看生成过程的详细信息
3. 支持过滤和搜索

### 数据覆盖

数据覆盖功能允许查看和管理 WI 内容的修改历史：

1. 点击扩展菜单中的 **查看覆盖**
2. 查看所有 WI 条目的覆盖记录
3. 支持按消息和滑动索引筛选

### 手动触发后处理

在扩展菜单中点击 **Run After Generate** 可以手动触发后处理流程。

### 提示词后处理

在设置中可以配置 **提示词后处理** 模式：

| 模式 | 说明 |
|------|------|
| none | 不处理，保持原样 |
| merge | 合并连续相同角色的消息 |
| semi | 强制 user/assistant 交替出现 |
| strict | 确保最后一条消息是 user 角色 |
| single | 合并为单个 user 消息 |

---

## 常见问题

### Q: 扩展无法加载怎么办？

**A:** 请检查以下几点：
1. 确认扩展文件完整存在于正确目录
2. 检查浏览器控制台是否有错误信息
3. 尝试清除浏览器缓存并刷新页面

### Q: API 连接失败怎么办？

**A:** 请确认：
1. API 端点地址正确（注意是否需要 `/v1` 后缀）
2. API 密钥有效
3. 网络可以访问 API 端点
4. 检查请求头和请求体配置是否正确

### Q: 装饰器不生效怎么办？

**A:** 请检查：
1. 装饰器语法是否正确
2. World Info 条目是否已启用
3. 触发条件是否满足
4. 查看日志了解详细错误信息

### Q: 如何调试模板？

**A:** 
1. 使用日志查看功能检查生成过程
2. 检查正则表达式是否正确匹配
3. 验证提示词配置是否合理

### Q: 变量存储在哪里？

**A:** 
- **消息变量**：存储在 `message.variables[swipe_id]` 中
- **聊天变量**：存储在 `chat_metadata.variables` 中

### Q: 如何在 EJS 中访问变量？

**A:** 使用 `variables` 对象：

```ejs
<%= variables.mood %>
<%= variables.location %>
```

### Q: 支持哪些 EJS 功能？

**A:** 支持标准 EJS 语法：
- `<%= %>` - 输出转义后的值
- `<%- %>` - 输出原始值
- `<% %>` - 执行代码

### Q: 如何处理生成失败？

**A:** 
1. 检查模板的重试配置
2. 查看日志了解失败原因
3. 调整匹配正则或提示词

---

## 相关文档

- [装饰器详细文档](./DECORATORS.md) - 所有装饰器的详细说明
- [API 参考文档](./API.md) - 编程接口文档

## 获取帮助

如果您遇到问题，可以通过以下方式获取帮助：

1. 查看 [GitHub Issues](https://github.com/zonde306/ST-CustomGeneration/issues)
2. 提交新的 Issue 描述您的问题
3. 参考项目 [Wiki](https://github.com/zonde306/ST-CustomGeneration/wiki)