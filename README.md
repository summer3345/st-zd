# RP Coach - SillyTavern 场外复盘指导插件

> 让另一个大模型定期复盘你的RP对话，自动注入指导建议，解决AI角色过于激进/OOC/崩坏等问题。

## 功能特性

- **独立API调用**：使用与主对话不同的LLM API进行复盘（如主用Gemini RP，复盘用GPT-4/Claude）
- **自动触发**：每N轮对话自动执行场外复盘
- **手动触发**：支持 `/rp_coach` 命令随时复盘
- **智能注入**：支持宏变量 `{{rp_coach}}` 或 Author's Note 注入指导内容
- **JSON结构化输出**：要求复盘模型输出 analysis / suggestions / injection 三段式结果

## 安装方法

### 方式一：酒馆扩展界面安装（推荐）
1. 打开 SillyTavern → Extensions → Install Extension
2. 输入本仓库URL（如 `https://github.com/yourname/rp-coach`）
3. 点击 Install，酒馆会自动下载并加载

### 方式二：手动安装
1. 下载本仓库 ZIP 或 `git clone` 到本地
2. 将 `rp-coach` 文件夹复制到：
   - **用户级**：`SillyTavern/data/<用户名>/extensions/rp-coach/`
   - **全局级**：`SillyTavern/public/scripts/extensions/third-party/rp-coach/`
3. 重启酒馆或刷新扩展列表

## 配置说明

### 1. API配置
- **API URL**：填写兼容OpenAI格式的API端点，如：
  - OpenAI: `https://api.openai.com/v1/chat/completions`
  - Claude (通过兼容层): `https://api.anthropic.com/v1/chat/completions`
  - 本地模型: `http://localhost:5000/v1/chat/completions`
- **API Key**：对应服务的密钥
- **模型名称**：如 `gpt-4o-mini`, `claude-3-haiku-20240307`, `qwen2.5-7b-instruct`

### 2. 触发配置
- **每N轮触发**：默认20轮，对话轮次达到此值时自动触发复盘
- **触发模式**：
  - `自动`：达到轮次自动后台复盘
  - `手动`：仅通过按钮或命令触发

### 3. 提示词配置
默认提示词要求模型输出JSON格式：
```json
{
    "analysis": "问题分析...",
    "suggestions": "改进建议...",
    "injection": "要注入到对话中的指导文本..."
}
```

`injection` 字段的内容会被注入到宏变量或Author's Note中，直接影响下一轮AI生成。

### 4. 输出注入方式

#### 方式A：宏变量（推荐）
在角色卡的 **System Prompt** 或 **Main Prompt** 中插入：
```
[场外指导]
{{rp_coach}}
```
每次复盘后，`{{rp_coach}}` 会自动更新为最新的 `injection` 内容。

#### 方式B：Author's Note
直接注入到SillyTavern内置的Author's Note中，通过深度(Depth)控制插入位置。

## 使用命令

| 命令 | 说明 |
|------|------|
| `/rp_coach` | 立即手动执行复盘 |
| `/rp_coach_status` | 查看当前轮次、上次触发、剩余轮次等状态 |
| `/rp_coach_set 15` | 将自动触发轮次改为15轮 |

## 使用场景示例

**场景**：使用Gemini进行RP，但角色经常过于激进、OOC或推进过快。

**解决方案**：
1. 安装本插件，API配置填入GPT-4o-mini或Claude Haiku
2. 在角色卡System Prompt中加入 `{{rp_coach}}`
3. 设置每15轮自动复盘
4. 复盘提示词中要求："指出角色是否过于激进，给出缓和建议，injection中写一段让角色放慢节奏、注意情感铺垫的引导文本"
5. 当达到15轮时，插件自动调用GPT-4分析对话，将指导文本注入 `{{rp_coach}}`
6. 下一轮Gemini生成时，会读取到这段指导，自动调整行为

## 文件结构

```
rp-coach/
├── manifest.json      # 扩展元数据（酒馆识别用）
├── index.js           # 主逻辑代码
├── settings.html      # 设置面板HTML模板
└── style.css          # 样式文件
```

## 注意事项

1. **API Key安全**：Key存储在酒馆的 `extensionSettings` 中（服务器端明文存储），建议使用本地模型或专用Key
2. **Token消耗**：复盘会消耗外部API的token，建议用便宜模型（如GPT-4o-mini、Haiku）
3. **对话长度**：复盘默认取最近40条消息，避免超长历史导致token爆炸
4. **酒馆版本**：要求 SillyTavern >= 1.12.0

## License

AGPL-3.0
