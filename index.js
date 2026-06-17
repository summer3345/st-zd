/*
 * 场外导演
 * SillyTavern 插件 - 引入第二模型进行复盘和场外指导 (最终版)
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
    systemPrompt: "你是资深RP导演。请仔细阅读以下人设、世界书和聊天记录。找出Gemini在扮演中可能存在的OOC（人设崩塌）、逻辑漏洞或剧情拖沓问题。然后，给出具体、简短的下一步修正指导和剧情推进建议。只输出指导内容，不要废话。"
};

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

// 统计新发送的user消息（排除编辑后重新发送的），计算进度
function getProgress() {
    const c = ctx();
    if (!c.chat) return 0;
    const trigger = ctx().extensionSettings[EXT_NAME].triggerRounds || 1;

    // 只统计最新发送的user消息，排除编辑后重新发送的
    let newUserCount = 0;
    const seenMessages = new Set();

    for (let i = c.chat.length - 1; i >= 0; i--) {
        const msg = c.chat[i];
        if (msg.is_user && !seenMessages.has(msg.id)) {
            seenMessages.add(msg.id);
            newUserCount++;
        }
    }

    let progress = newUserCount % trigger;
    if (progress === 0 && newUserCount > 0) progress = trigger;
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
    const c = ctx().extensionSettings[EXT_NAME];
    if (!c.apiEndpoint) return alert("请先填写 API 地址");
    const url = normalizeApiBase(c.apiEndpoint) + "/models";
    try {
        $("#dr-model").empty().append('<option value="">加载中...</option>');
        const res = await fetch(url, { method: "GET", headers: c.apiKey ? { "Authorization": "Bearer " + c.apiKey } : {} });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const models = data.data ? data.data.map(m => m.id) : (data.models ? data.models.map(m => m.id) : []);
        $("#dr-model").empty().append('<option value="">请选择模型</option>');
        models.forEach(id => {
            $("#dr-model").append(`<option value="${id}" ${id === c.model ? 'selected' : ''}>${id}</option>`);
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
    if (lastMsg && lastMsg.extra && lastMsg.extra.world_info) {
        let text = "";
        const wInfo = lastMsg.extra.world_info;
        for (const uid in wInfo) {
            const entry = c.world_info ? c.world_info[uid] : null;
            if (entry && entry.content) {
                text += entry.content + "\n\n";
            }
        }
        return text.trim();
    }
    return "";
}

// 修正后的getChatHistory函数：读取所有user输入和100层以内未被隐藏的AI消息
function getChatHistory(depth) {
    const c = ctx();
    if (!c.chat) return "";
    let history = [];
    const startIdx = depth > 0 ? Math.max(0, c.chat.length - depth) : 0;

    for (let i = startIdx; i < c.chat.length; i++) {
        const msg = c.chat[i];
        // 过滤系统消息
        if (msg.is_system) continue;
        // 保留user输入和未隐藏的AI消息
        if (msg.is_user || (!msg.is_user && !msg.is_hidden)) {
            const role = msg.is_user ? "User" : c.name2;
            history.push(`${role}: ${msg.mes}`);
        }
    }
    return history.join("\n\n");
}

async function callAPI(prompt) {
    const c = ctx().extensionSettings[EXT_NAME];
    if (!c.apiEndpoint || !c.model) throw new Error("请先配置 API 和模型");
    const url = normalizeApiBase(c.apiEndpoint) + "/chat/completions";

    const body = {
        model: c.model,
        messages: [
            { role: "system", content: c.systemPrompt },
            { role: "user", content: prompt }
        ],
        temperature: 0.4,
        stream: false
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.apiKey },
        body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error("API Error: " + res.status + " " + (await res.text()).slice(0, 100));
    const data = await res.json();
    return data.choices[0].message.content.trim();
}

async function runAnalysis(isRefresh = false) {
    const c = ctx().extensionSettings[EXT_NAME];
    if (!c.enabled && !isRefresh) return;

    $("#dr-btn-analyze, #dr-btn-refresh").prop("disabled", true);
    $("#dr-status").html('<span class="dr-loader"></span> 正在分析上下文并生成指导...');

    try {
        let prompt = "";
        if (c.readChar) {
            const char = ctx().characters[ctx().characterId];
            if (char) prompt += `【角色设定】\n${char.description || ""}\n${char.personality || ""}\n\n`;
        }
        if (c.readLorebook) {
            const wi = getActiveWorldInfo();
            if (wi) prompt += `【激活的世界书】\n${wi}\n\n`;
        }
        prompt += `【最近聊天记录】\n${getChatHistory(c.readDepth)}`;

        const result = await callAPI(prompt);

        const chat = ctx().chat;
        if (chat.length > 0) {
            const lastIdx = chat.length - 1;
            const msg = chat[lastIdx];

            // 防污染：明确告知主模型这是系统插入的指导，禁止自己生成
            const tag = `\n\n[System Note: 以下是被系统注入的场外导演指导，请参考修正，严禁你自己生成此标签]\n<details class="dr-details"><summary>🎬 场外指导</summary>\n\n${result}\n\n</details>`;

            msg.mes = String(msg.mes || "").trimEnd() + tag;
            ctx().saveChat();

            // 安全刷新 DOM，使用酒馆原生格式化渲染
            const el = $(`#chat .mes[mesid="${lastIdx}"] .mes_text`);
            if (el.length) {
                // 优先使用酒馆自带的消息格式化函数，确保 markdown 和 html 正常解析
                const formatted = ctx().messageFormatting ? ctx().messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user) : msg.mes;
                el.html(formatted);
            }
        }

        // 分析完成后重置计数器
        resetCounter();

        $("#dr-status").text(getStatusText() + " | 上次分析已完成。");
    } catch (e) {
        console.error("[Director] Analysis error:", e);
        $("#dr-status").text("分析失败: " + e.message);
    } finally {
        $("#dr-btn-analyze, #dr-btn-refresh").prop("disabled", false);
    }
}

// 重置计数器函数
function resetCounter() {
    // 在分析完成后重置计数器，确保下一次触发能正确计算
    // 这里我们不需要显式重置任何变量，因为计数器是基于聊天记录实时计算的
    // 但是我们需要确保UI显示正确
    $("#dr-status").text(getStatusText());
}

function onMessageReceived(idx) {
    const c = ctx().extensionSettings[EXT_NAME];
    if (!c.enabled) return;

    const msg = ctx().chat[idx];
    if (!msg || msg.is_user || msg.is_system || msg.is_hidden) return;

    // 更新进度显示
    $("#dr-status").text(getStatusText());

    const trigger = c.triggerRounds || 1;
    const newUserCount = ctx().chat.filter(m => m.is_user && !m.is_hidden).length;

    // 检查是否到达触发条件
    if (newUserCount > 0 && newUserCount % trigger === 0) {
        // 延迟 3 秒执行，确保主模型流式输出完全结束且 DOM 渲染完毕
        setTimeout(() => {
            runAnalysis(false);
        }, 3000);
    }
}

function createUI() {
    const c = ctx().extensionSettings[EXT_NAME];
    const html = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🎬 场外导演</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content dr-panel">
            <div style="margin-bottom: 10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="dr-enabled" ${c.enabled ? 'checked' : ''}>
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
                    <input type="text" id="dr-api-endpoint" class="text_pole" value="${c.apiEndpoint}" placeholder="https://api.openai.com/v1">
                    <label>API 密钥</label>
                    <input type="password" id="dr-api-key" class="text_pole" value="${c.apiKey}" placeholder="sk-...">
                    <label>模型</label>
                    <select id="dr-model" class="text_pole">
                        <option value="${c.model}">${c.model ? c.model + ' (已保存)' : '请先拉取模型'}</option>
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
                    <label class="checkbox_label"><input type="checkbox" id="dr-read-char" ${c.readChar ? 'checked' : ''}><span>读取角色设定</span></label>
                    <label class="checkbox_label"><input type="checkbox" id="dr-read-lore" ${c.readLorebook ? 'checked' : ''}><span>读取激活的蓝灯世界书</span></label>
                    <label>读取聊天深度 (留空=全部未隐藏)</label>
                    <input type="number" id="dr-read-depth" class="text_pole" value="${c.readDepth}" min="0" placeholder="如 10">
                </div>
            </div>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>触发设置</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content dr-section">
                    <label>触发轮次 (User输入几次后触发)</label>
                    <input type="number" id="dr-trigger-rounds" class="text_pole" value="${c.triggerRounds}" min="1">
                    <div class="dr-status" id="dr-status">${getStatusText()}</div>
                </div>
            </div>

            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>纠偏提示词</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content dr-section">
                    <textarea id="dr-system-prompt" class="text_pole" rows="6" placeholder="对第二模型下达的指令">${c.systemPrompt}</textarea>
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
    $("#dr-trigger-rounds").on("input", function() { save("triggerRounds", parseInt(this.value) || 1); $("#dr-status").text(getStatusText()); });
    $("#dr-system-prompt").on("input", function() { save("systemPrompt", this.value); });

    $("#dr-btn-models").on("click", fetchModels);
    $("#dr-btn-test").on("click", async () => {
        save("model", $("#dr-model").val());
        try { await callAPI("Hi"); alert("连接成功"); } catch(e) { alert("连接失败: " + e.message); }
    });

    $("#dr-btn-analyze").on("click", () => runAnalysis(false));
    $("#dr-btn-refresh").on("click", () => runAnalysis(true));
}

function init() {
    loadSettings();
    createUI();
    ctx().eventSource.on(ctx().event_types.MESSAGE_RECEIVED, onMessageReceived);
    console.log("[Director] 插件已加载 (v1.5)");
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
