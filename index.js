/*
 * 场外导演 - 计数器修复与破甲优化版
 * SillyTavern 插件 - 引入第二模型进行复盘和场外指导
 * 优化：合并为单条 user 消息发送，提升破甲成功率
 */

const EXT_NAME = "director-review";
const DEFAULTS = {
    enabled: false,
    apiEndpoint: "",
    apiKey: "",
    model: "",
    readChar: true,
    readLorebook: true,
    readDepth: 10,
    triggerRounds: 5,
    systemPrompt: "你是资深RP导演。请仔细阅读以下人设、世界书和聊天记录。找出Gemini在扮演中可能存在的OOC（人设崩塌）、逻辑漏洞或剧情拖沓问题。然后，给出具体、简短的下一步修正指导和剧情推进建议。只输出指导内容，不要废话。",
    userMessageCount: 0
};

let pendingAnalysis = false;

function ctx() {
    return SillyTavern.getContext();
}

function loadSettings() {
    const es = ctx().extensionSettings;
    if (!es[EXT_NAME]) es[EXT_NAME] = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (es[EXT_NAME][k] === undefined) es[EXT_NAME][k] = v;
    }
    return es[EXT_NAME];
}

function save(key, val) {
    ctx().extensionSettings[EXT_NAME][key] = val;
    ctx().saveSettingsDebounced();
}

function getProgress() {
    const settings = ctx().extensionSettings[EXT_NAME];
    const trigger = settings.triggerRounds || 1;
    let count = settings.userMessageCount || 0;
    let progress = count % trigger;
    if (progress === 0 && count > 0) progress = trigger;
    return progress;
}

function getStatusText() {
    return `当前进度：${getProgress()} / ${ctx().extensionSettings[EXT_NAME].triggerRounds}`;
}

function normalizeApiBase(base) {
    let url = (base || "").trim();
    if (!url) return "";
    while (url.length > 1 && url.charAt(url.length - 1) === "/") url = url.slice(0, -1);
    if (url.indexOf("/chat/completions") >= 0) url = url.replace(/\/chat\/completions\/?$/, "");
    if (url.indexOf("/models") >= 0) url = url.replace(/\/models\/?$/, "");
    if (!url.endsWith("/v1")) url += "/v1";
    return url;
}

async function fetchModels() {
    const settings = ctx().extensionSettings[EXT_NAME];
    if (!settings.apiEndpoint) return alert("请先填写 API 地址");
    const url = normalizeApiBase(settings.apiEndpoint) + "/models";
    try {
        $("#dr-model").empty().append('<option value="">加载中...</option>');
        const res = await fetch(url, {
            method: "GET",
            headers: settings.apiKey ? { "Authorization": "Bearer " + settings.apiKey } : {}
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const models = data.data ? data.data.map(m => m.id) : (data.models ? data.models.map(m => m.id) : []);
        $("#dr-model").empty().append('<option value="">请选择模型</option>');
        models.forEach(id => {
            $("#dr-model").append(`<option value="${id}" ${id === settings.model ? 'selected' : ''}>${id}</option>`);
        });
    } catch (e) {
        console.error("[Director] Fetch models error:", e);
        alert("拉取模型失败: " + e.message);
    }
}

function getActiveWorldInfo() {
    const c = ctx();
    if (!c.chat || c.chat.length === 0) return "";

    const lastMsg = c.chat[c.chat.length - 1];
    const activeUids = lastMsg?.extra?.world_info;
    if (!activeUids || (typeof activeUids !== 'object' && !Array.isArray(activeUids))) return "";

    const worldInfo = c.world_info;
    if (!worldInfo) return "";

    let text = "";

    if (typeof worldInfo === 'object' && !Array.isArray(worldInfo)) {
        const entries = worldInfo.entries || worldInfo;
        for (const uid in activeUids) {
            const entry = entries[uid];
            if (entry && entry.content) {
                text += entry.content + "\n\n";
            }
        }
    }
    else if (Array.isArray(worldInfo)) {
        for (const uid in activeUids) {
            const entry = worldInfo.find(e => e.uid == uid || e.id == uid);
            if (entry && entry.content) {
                text += entry.content + "\n\n";
            }
        }
    }

    return text.trim();
}

function getChatHistory(depth) {
    const c = ctx();
    if (!c.chat) return "";
    let history = [];
    const startIdx = depth > 0 ? Math.max(0, c.chat.length - depth) : 0;

    for (let i = startIdx; i < c.chat.length; i++) {
        const msg = c.chat[i];
        if (msg.is_system) continue;
        if (msg.is_user || (!msg.is_user && !msg.is_hidden)) {
            const role = msg.is_user ? "User" : c.name2;
            history.push(`${role}: ${msg.mes}`);
        }
    }
    return history.join("\n\n");
}

async function callAPI(prompt) {
    const settings = ctx().extensionSettings[EXT_NAME];
    if (!settings.apiEndpoint || !settings.model) throw new Error("请先配置 API 和模型");
    const url = normalizeApiBase(settings.apiEndpoint) + "/chat/completions";

    // 核心破甲优化：将所有内容合并为一条 user 消息发送，避开 system 角色的严格审查
    const body = {
        model: settings.model,
        messages: [
            { role: "user", content: prompt }
        ],
        temperature: 0.6, // 稍微提高一点随机性，有时有助于绕过死板的拦截
        max_tokens: 2000, // 确保输出长度
        top_p: 0.95,
        stream: false
    };

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + settings.apiKey
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error("API Error: " + res.status + " " + (await res.text()).slice(0, 100));
    const data = await res.json();
    return data.choices[0].message.content.trim();
}

async function runAnalysis(isRefresh = false) {
    const settings = ctx().extensionSettings[EXT_NAME];
    if (!settings.enabled && !isRefresh) return;

    $("#dr-btn-analyze, #dr-btn-refresh").prop("disabled", true);
    $("#dr-status").html('<span class="dr-loader"></span> 正在分析上下文并生成指导...');

    try {
        // 1. 破甲提示词必须放在最前面
        let prompt = `${settings.systemPrompt}\n\n---\n\n`;
        
        // 2. 紧跟上下文信息
        if (settings.readChar) {
            const char = ctx().characters[ctx().characterId];
            if (char) prompt += `【角色设定】\n${char.description || ""}\n${char.personality || ""}\n\n`;
        }
        if (settings.readLorebook) {
            const wi = getActiveWorldInfo();
            if (wi) prompt += `【激活的世界书】\n${wi}\n\n`;
        }
        prompt += `【最近聊天记录】\n${getChatHistory(settings.readDepth)}`;

        const result = await callAPI(prompt);

        const chat = ctx().chat;
        if (chat.length > 0) {
            const lastIdx = chat.length - 1;
            const msg = chat[lastIdx];

            const tag = `\n\n[System Note: 以下是被系统注入的场外导演指导，请参考修正，严禁你自己生成此标签]\n<details class="dr-details"><summary>🎬 场外指导</summary>\n\n${result}\n\n</details>`;
            msg.mes = String(msg.mes || "").trimEnd() + tag;
            ctx().saveChat();

            const el = $(`#chat .mes[mesid="${lastIdx}"] .mes_text`);
            if (el.length) {
                const formatted = ctx().messageFormatting
                    ? ctx().messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user)
                    : msg.mes;
                el.html(formatted);
            }
        }

        resetCounter(true);
        $("#dr-status").text(getStatusText() + " | 上次分析已完成。");
    } catch (e) {
        console.error("[Director] Analysis error:", e);
        $("#dr-status").text("分析失败: " + e.message);
        pendingAnalysis = false;
    } finally {
        $("#dr-btn-analyze, #dr-btn-refresh").prop("disabled", false);
    }
}

function resetCounter(clearPending = false) {
    const settings = ctx().extensionSettings[EXT_NAME];
    settings.userMessageCount = 0;
    save("userMessageCount", 0);
    if (clearPending) pendingAnalysis = false;
    $("#dr-status").text(getStatusText());
}

function onUserMessage() {
    const settings = ctx().extensionSettings[EXT_NAME];
    if (!settings.enabled) return;

    settings.userMessageCount = (settings.userMessageCount || 0) + 1;
    save("userMessageCount", settings.userMessageCount);

    $("#dr-status").text(getStatusText());

    if (settings.userMessageCount >= settings.triggerRounds) {
        pendingAnalysis = true;
    }
}

function onMessageReceived(idx) {
    const settings = ctx().extensionSettings[EXT_NAME];
    if (!settings.enabled || !pendingAnalysis) return;

    const msg = ctx().chat[idx];
    if (!msg || msg.is_user || msg.is_system || msg.is_hidden) return;

    pendingAnalysis = false;

    setTimeout(() => {
        runAnalysis(false);
    }, 3000);
}

function createUI() {
    const settings = ctx().extensionSettings[EXT_NAME];
    const html = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🎬 场外导演</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content dr-panel">
            <div style="margin-bottom: 10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="dr-enabled" ${settings.enabled ? 'checked' : ''}>
                    <span>启用自动纠偏</span>
                </label>
            </div>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>API 配置</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content dr-section">
                    <label>API 地址</label>
                    <input type="text" id="dr-api-endpoint" class="text_pole" value="${settings.apiEndpoint}" placeholder="https://api.openai.com/v1">
                    <label>API 密钥</label>
                    <input type="password" id="dr-api-key" class="text_pole" value="${settings.apiKey}" placeholder="sk-...">
                    <label>模型</label>
                    <select id="dr-model" class="text_pole">
                        <option value="${settings.model}">${settings.model ? settings.model + ' (已保存)' : '请先拉取模型'}</option>
                    </select>
                    <div class="dr-btn-group">
                        <input type="button" id="dr-btn-models" class="menu_button" value="拉取模型">
                        <input type="button" id="dr-btn-test" class="menu_button" value="测试连接">
                    </div>
                </div>
            </div>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>读取信息设置</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content dr-section">
                    <label class="checkbox_label"><input type="checkbox" id="dr-read-char" ${settings.readChar ? 'checked' : ''}><span>读取角色设定</span></label>
                    <label class="checkbox_label"><input type="checkbox" id="dr-read-lore" ${settings.readLorebook ? 'checked' : ''}><span>读取激活的蓝灯世界书</span></label>
                    <label>读取聊天深度 (留空=全部未隐藏)</label>
                    <input type="number" id="dr-read-depth" class="text_pole" value="${settings.readDepth}" min="0" placeholder="如 10">
                </div>
            </div>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>触发设置</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content dr-section">
                    <label>触发轮次 轮)</label>
                    <input type="number" id="dr-trigger-rounds" class="text_pole" value="${settings.triggerRounds}" min="1">
                    <div class="dr-status" id="dr-status">${getStatusText()}</div>
                    <div style="margin-top: 10px;">
                        <input type="button" id="dr-btn-reset-counter" class="menu_button" value="重置计数器" title="手动重置进度计数">
                    </div>
                </div>
            </div>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>纠偏提示词</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content dr-section">
                    <textarea id="dr-system-prompt" class="text_pole" rows="6" placeholder="对第二模型下达的指令">${settings.systemPrompt}</textarea>
                </div>
            </div>

            <div class="dr-btn-group">
                <input type="button" id="dr-btn-analyze" class="menu_button" value="立即进行分析">
                <input type="button" id="dr-btn-refresh" class="menu_button" value="刷新最新纠偏">
            </div>
        </div>
    </div>`;

    $("#extensions_settings2").append(html);

    $(".inline-drawer-toggle").on("click", function() {
        $(this).parent().toggleClass("inline-drawer-expanded");
    });

    $("#dr-enabled").on("change", function() { save("enabled", this.checked); });
    $("#dr-api-endpoint").on("input", function() { save("apiEndpoint", this.value); });
    $("#dr-api-key").on("input", function() { save("apiKey", this.value); });
    $("#dr-model").on("change", function() { save("model", this.value); });
    $("#dr-read-char").on("change", function() { save("readChar", this.checked); });
    $("#dr-read-lore").on("change", function() { save("readLorebook", this.checked); });
    $("#dr-read-depth").on("input", function() { save("readDepth", parseInt(this.value) || 0); });
    $("#dr-trigger-rounds").on("input", function() {
        save("triggerRounds", parseInt(this.value) || 1);
        resetCounter();
        $("#dr-status").text(getStatusText());
    });
    $("#dr-system-prompt").on("input", function() { save("systemPrompt", this.value); });

    $("#dr-btn-reset-counter").on("click", function() {
        if (confirm("确定要手动重置计数器吗？这将把当前进度归零。")) {
            resetCounter(true);
            $("#dr-status").text(getStatusText() + " | 计数器已手动重置");
        }
    });

    $("#dr-btn-models").on("click", fetchModels);
    $("#dr-btn-test").on("click", async () => {
        save("model", $("#dr-model").val());
        try { await callAPI("Hi"); alert("连接成功"); } catch(e) { alert("连接失败: " + e.message); }
    });

    $("#dr-btn-analyze").on("click", () => {
        pendingAnalysis = false;
        runAnalysis(false);
    });
    $("#dr-btn-refresh").on("click", () => {
        pendingAnalysis = false;
        runAnalysis(true);
    });
}

function init() {
    loadSettings();
    createUI();
    ctx().eventSource.on(ctx().event_types.MESSAGE_SENT, onUserMessage);
    ctx().eventSource.on(ctx().event_types.MESSAGE_RECEIVED, onMessageReceived);
    console.log("[Director] 插件已加载 (v1.7 - 破甲优化版)");
}

const waitAndInit = setInterval(() => {
    if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
        const c = SillyTavern.getContext();
        if (c.eventSource && c.event_types && c.event_types.APP_READY) {
            clearInterval(waitAndInit);
            c.eventSource.on(c.event_types.APP_READY, init);
        }
    }
}, 300);

