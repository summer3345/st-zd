# Claude Review - AI场外复盘指导

SillyTavern 扩展插件，每N轮对话后自动调用 Claude API 进行场外复盘，将指导建议注入世界书或作为宏变量使用。

## 功能特性

- 🤖 **AI场外复盘**：每N轮自动触发Claude进行专业RP复盘指导
- 🔧 **灵活API配置**：支持Anthropic官方API及第三方代理
- 📊 **多模型支持**：Sonnet/Opus/Haiku，支持自定义模型ID
- 📖 **世界书注入**：自动覆盖写入指定世界书条目
- 🏷️ **宏变量支持**：注册 `{{claude_review}}` 宏，可在提示词中引用
- ⏱️ **智能触发**：自动/手动触发，支持暂停RP等待复盘
- 📝 **自定义提示词**：完全可编辑的系统提示词和用户模板
- 🎮 **斜杠命令**：`/claude-review` `/cr` 等快捷命令

## 安装方法

### 方法一：通过扩展管理器安装
1. 打开 SillyTavern → 扩展（拼图图标）
2. 在 "Install extension" 处粘贴本仓库URL
3. 点击安装并启用

### 方法二：手动安装
1. 将本仓库克隆到 `data/<user>/extensions/` 或 `public/scripts/extensions/third-party/`
2. 目录名建议为 `claude-review`
3. 在扩展管理器中启用

```bash
# 示例
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/your-username/sillytavern-claude-review.git claude-review
```

## 使用方法

### 1. 配置API
- 在插件设置面板填入 Claude API Key
- 选择模型（推荐 Claude 3.5 Sonnet）
- 点击「测试API连接」验证

### 2. 设置触发轮次
- 默认每 **20轮** AI回复后自动触发
- 可调整「轮次间隔」和「复盘上下文轮数」

### 3. 选择输出方式
- **世界书模式**：复盘内容自动写入指定世界书，常驻生效
- **宏变量模式**：在提示词中使用 `{{claude_review}}` 引用
- **两者都用**：同时生效（推荐）

### 4. 自定义提示词
- 系统提示词：定义Claude的复盘角色和输出格式
- 用户模板：支持变量替换：
  - `{charName}` - 角色名
  - `{userName}` - 用户名
  - `{currentTurn}` - 当前轮次
  - `{contextRounds}` - 上下文轮数
  - `{chatHistory}` - 对话历史

### 5. 手动触发
- 点击「立即复盘」按钮
- 或使用斜杠命令 `/claude-review` / `/cr`

## 斜杠命令

| 命令 | 别名 | 功能 |
|------|------|------|
| `/claude-review` | `/cr` | 手动触发复盘 |
| `/claude-review-status` | `/crs` | 查看当前状态 |
| `/claude-review-reset` | `/crr` | 重置轮次计数器 |

## 工作原理

```
[正常RP对话] → [AI回复计数+1] → [达到N轮?]
                                    ↓
                              [调用Claude API]
                                    ↓
                    [生成复盘指导内容]
                                    ↓
            ┌───────────────────────┼───────────────────────┐
            ↓                       ↓                       ↓
    [写入世界书]            [更新宏变量]            [插入系统消息]
            ↓                       ↓                       ↓
    [下次生成生效]          [提示词引用]          [聊天记录查看]
```

## 提示词模板示例

### 系统提示词（默认）
```
你是一位专业的RP（角色扮演）场外指导。请基于提供的最近对话内容，
分析角色扮演的表现，并给出指导建议。

你的任务：
1. 分析角色行为是否过于激进、OOC（脱离角色）或缺乏深度
2. 指出对话中的亮点和不足
3. 给出3-5条具体的改进建议
4. 总结当前剧情走向和角色关系状态

请以第三人称、专业但友善的语气撰写。
```

### 用户提示词模板（默认）
```
请复盘以下最近{contextRounds}轮对话：

角色名称：{charName}
用户名称：{userName}
当前轮次：{currentTurn}

对话内容：
{chatHistory}

请给出专业的复盘指导。
```

## 注意事项

- ⚠️ **API Key安全**：请勿在公共环境分享包含API Key的配置
- 🔄 **异步竞态**：复盘期间会自动暂停RP生成（可关闭）
- 💾 **世界书依赖**：使用世界书模式时，请确保至少存在一本世界书
- 📝 **Token消耗**：复盘会消耗Claude API的token，请注意用量

## 兼容性

- SillyTavern >= 1.12.0
- 支持 Chat Completion 和 Text Completion API

## License

AGPL-3.0
