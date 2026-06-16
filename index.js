
/*
 * Arrebol Director Room 暗河红霞 Arrebol D v1.0.5.6.5.3
 * 抽屉内嵌稳定版：
 * - 情感导演 / 剧情导演 双页面
 * - 双 API / 双模型 / 双预设
 * - 拉取模型
 * - 本地测试
 * - 生成方向
 * - 自动注入到当前聊天，下一轮可读到
 */

(function () {
    "use strict";

    var EXT = "arrebol-d-final-v1040-stable-settings";
    var EMOTION_PRESET = "你是 RP 情感导演。请阅读最近的聊天内容和用户补充信息，只分析情感曲线与人设稳定，不写正文。\n\n你需要判断：\n1. 当前关系阶段是什么。\n2. 情绪温度是否过热、过冷、空转或错拍。\n3. 角色是否出现 OOC 风险。\n4. 是否存在秒爱、秒软、秒承诺、隐藏深情化。\n5. 是否把照顾误写成占有，把心疼误写成告白。\n6. 是否过度代演用户的心理与选择。\n7. 当前角色根据人设应该如何承接情绪。\n8. 下一阶段情感应该升温、降温、维持、错拍，还是延迟。\n\n输出必须短，不超过 300 字。不要写分析过程。不要写正文。只给下一阶段情感方向，要给可执行动作与明确禁区。\n\n固定输出格式：\n【情感方向】\n……\n\n【人设边界】\n……\n\n【避免】\n……";
    var PLOT_PRESET = "你是 RP 剧情导演。请阅读最近的聊天内容和用户补充信息，只分析剧情推进、事件张力、伏笔与场景调度，不写正文。\n\n你需要判断：\n1. 当前剧情是否停滞、空转或重复。\n2. 场景是否需要推进、转场、插入事件、制造阻碍，还是维持压抑。\n3. 哪些伏笔可以轻轻回收，哪些伏笔不能急着揭开。\n4. NPC、环境、现实阻尼是否应该介入。\n5. 当前剧情的下一步应该发生什么“可执行事件”。\n6. 避免强行相遇、强行表白、强行救场、巧合堆叠。\n7. 不要替用户决定行动，只给世界和角色侧的推进方向。\n\n输出必须短，不超过 300 字。不要写正文。不要写分析过程。只给下一阶段剧情方向。\n\n固定输出格式：\n【剧情推进】\n……\n\n【事件抓手】\n……\n\n【避免】\n……";

    var DEFAULTS = {
        activeTab: "emotion",
        autoInjectEmotion: true,
        autoInjectPlot: true,
        injectMode: "visible",
        showFloatingWindow: true,
        autoTriggerEmotion: false,
        autoTriggerPlot: false,
        autoTriggerEmotionRange: "20",
        autoTriggerPlotRange: "10",
        autoTriggerEmotionCustomRange: 0,
        autoTriggerPlotCustomRange: 0,
        lastAutoTriggerChatKey: "",
        lastAutoTriggerEmotionCount: -1,
        lastAutoTriggerPlotCount: -1,

        range: "30",
        customRange: 0,
        supplementMemory: "",

        emotionApiEndpoint: "",
        emotionApiKey: "",
        emotionModel: "",
        emotionPreset: EMOTION_PRESET,
        emotionPreview: "",

        plotApiEndpoint: "",
        plotApiKey: "",
        plotModel: "",
        plotPreset: PLOT_PRESET,
        plotPreview: ""
    };

    var initialized = false;
    var processing = false;
    var aborter = null;

    function rootWin() {
        try {
            if (window.top && window.top.document) return window.top;
        } catch (e) {}
        return window;
    }

    function rootDoc() {
        try {
            var w = rootWin();
            if (w && w.document) return w.document;
        } catch (e) {}
        return document;
    }

    function ctx() {
        return SillyTavern.getContext();
    }

    function q(sel) {
        var d = rootDoc();
        try {
            var el = d.querySelector(sel);
            if (el) return el;
        } catch (e) {}
        try { return document.querySelector(sel); } catch (e2) {}
        return null;
    }

    function esc(s) {
        var d = rootDoc();
        var div = d.createElement("div");
        div.textContent = s == null ? "" : String(s);
        return div.innerHTML;
    }


    var ADR_D_LOCAL_BACKUP_KEY = "arrebol_d_settings_stable_v1";
    var ADR_D_OLD_BACKUP_KEYS = [
        "arrebol_d_final_v1035_settings_backup",
        "arrebol_d_final_v1036_settings_backup",
        "arrebol_d_final_v1037_settings_backup",
        "arrebol_d_final_v1038_settings_backup",
        "arrebol_d_final_v1039_settings_backup",
        "arrebol_d_final_v1035_save_fix_settings_backup",
        "arrebol_d_final_v1036_fold_br_fix_settings_backup",
        "arrebol_d_final_v1037_mystery_sync_fix_settings_backup",
        "arrebol_d_final_v1038_comment_only_inject_settings_backup",
        "arrebol_d_final_v1039_plain_marker_inject_settings_backup"
    ];

    function adrDLoadLocalBackup() {
        try {
            var raw = rootWin().localStorage.getItem(ADR_D_LOCAL_BACKUP_KEY);
            if (raw) {
                var obj = JSON.parse(raw);
                return obj && typeof obj === "object" ? obj : {};
            }

            // 迁移旧版备份：以后升级插件不再丢 API / 模型 / 预设。
            for (var i = 0; i < ADR_D_OLD_BACKUP_KEYS.length; i++) {
                var oldRaw = rootWin().localStorage.getItem(ADR_D_OLD_BACKUP_KEYS[i]);
                if (!oldRaw) continue;
                try {
                    var oldObj = JSON.parse(oldRaw);
                    if (oldObj && typeof oldObj === "object") {
                        rootWin().localStorage.setItem(ADR_D_LOCAL_BACKUP_KEY, JSON.stringify(oldObj));
                        return oldObj;
                    }
                } catch (e0) {}
            }
        } catch (e) {}
        return {};
    }

    function adrDSaveLocalBackup(obj) {
        try {
            rootWin().localStorage.setItem(ADR_D_LOCAL_BACKUP_KEY, JSON.stringify(obj || {}));
        } catch (e) {}
    }

    function settings() {
        var c = ctx();
        if (!c.extensionSettings[EXT]) c.extensionSettings[EXT] = {};

        var backup = adrDLoadLocalBackup();
        var st = c.extensionSettings[EXT];

        if (backup && typeof backup === "object") {
            for (var bk in backup) {
                if (st[bk] === undefined || st[bk] === "") {
                    st[bk] = backup[bk];
                }
            }
        }

        for (var k in DEFAULTS) {
            if (st[k] === undefined) st[k] = DEFAULTS[k];
        }
        if (!st.emotionPreset) st.emotionPreset = EMOTION_PRESET;
        if (!st.plotPreset) st.plotPreset = PLOT_PRESET;
        return st;
    }

    function save(key, val) {
        try {
            settings()[key] = val;
            var c = ctx();
            if (typeof c.saveSettingsDebounced === "function") c.saveSettingsDebounced();
        } catch (e) {}
    }

    function saveNow() {
        try { adrDSaveLocalBackup(settings()); } catch (e0) {}

        try {
            var c = ctx();
            if (typeof c.saveSettings === "function") c.saveSettings();
            if (typeof c.saveSettingsDebounced === "function") c.saveSettingsDebounced();
        } catch (e) {}
    }

    function status(type, text, color) {
        var el = qForm("adr044-" + type + "-status");
        if (el) {
            el.textContent = text;
            if (color) el.style.color = color;
        }
    }

    function currentType() {
        var st = settings();
        return st.activeTab === "plot" ? "plot" : "emotion";
    }

    function labelOf(type) {
        return type === "plot" ? "剧情导演" : "情感导演";
    }

    function prefixOf(type) {
        return type === "plot" ? "plot" : "emotion";
    }

    function field(type, name) {
        var p = prefixOf(type);
        return p + name.charAt(0).toUpperCase() + name.slice(1);
    }

    function setPreview(type, text) {
        var pv = qForm("adr044-" + type + "-preview");
        if (pv) pv.value = text || "";
        save(field(type, "preview"), text || "");
    }

    function normalizeBase(base) {
        var url = (base || "").trim();
        if (!url) return "";
        while (url.length > 1 && url.charAt(url.length - 1) === "/") url = url.slice(0, -1);
        if (url.indexOf("/chat/completions") >= 0) url = url.replace(/\/chat\/completions\/?$/, "");
        if (url.indexOf("/models") >= 0) url = url.replace(/\/models\/?$/, "");
        if (!url.endsWith("/v1")) url += "/v1";
        return url;
    }

    function chatUrl(base) {
        var b = normalizeBase(base);
        return b ? b + "/chat/completions" : "";
    }

    function modelsUrl(base) {
        var b = normalizeBase(base);
        return b ? b + "/models" : "";
    }

    function activeRange() {
        var st = settings();
        if (String(st.range) === "custom") {
            var n = Number(st.customRange || 0);
            return n > 0 ? n : 30;
        }
        var r = Number(st.range || 30);
        return r > 0 ? r : 30;
    }

    function autoTriggerRange(type) {
        var st = settings();
        var key = type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange";
        var customKey = type === "plot" ? "autoTriggerPlotCustomRange" : "autoTriggerEmotionCustomRange";
        var val = String(st[key] || (type === "plot" ? "10" : "20"));

        if (val === "off") return 0;
        if (val === "custom") {
            var n = Number(st[customKey] || 0);
            return n > 0 ? n : 10;
        }

        var r = Number(val || 0);
        return r > 0 ? r : 10;
    }

    function cleanMessage(text) {
        text = String(text || "").trim();
        text = text.replace(/image###[\s\S]*?###/g, "").trim();
        text = text.replace(/<!--ARREBOL_DIRECTOR_START-->[\s\S]*?<!--ARREBOL_DIRECTOR_END-->/g, "").trim();
        text = text.replace(/<!--\s*ARREBOL_D_START:(?:emotion|plot)\s*-->[\s\S]*?<!--\s*ARREBOL_D_END:(?:emotion|plot)\s*-->/g, "").trim();
        text = text.replace(/<!--\s*ARREBOL_D_START:(?:emotion|plot)[\s\S]*?ARREBOL_D_END:(?:emotion|plot)\s*-->/g, "").trim();
        text = text.replace(/<details[^>]*class=["']arrebol-d-(?:injection|card)["'][^>]*>[\s\S]*?<\/details>/g, "").trim();
        text = text.replace(/\n?arrebol_d(?:_visible)?###[\s\S]*?###/g, "").trim();
        return text;
    }

    function recentChat(rounds) {
        var chat;
        try { chat = ctx().chat; } catch (e) { return ""; }
        if (!chat || !chat.length) return "";

        var limit = rounds * 2;
        var arr = [];
        var count = 0;

        for (var i = chat.length - 1; i >= 0 && count < limit; i--) {
            var m = chat[i];
            if (!m || m.is_system) continue;

            var role = m.is_user ? "用户" : (m.name || "角色");
            var text = cleanMessage(m.mes);
            if (!text) continue;

            arr.unshift("[" + role + "] " + text);
            count++;
        }

        return arr.join("\n\n");
    }

    function syncShared() {
        var st = settings();

        var range = qForm("adr044-range");
        if (range) save("range", range.value || "30");

        var custom = qForm("adr044-custom");
        if (custom) save("customRange", Number(custom.value || 0));

        var memory = qForm("adr044-memory");
        if (memory) save("supplementMemory", memory.value || "");

        var mode = qForm("adr044-inject-mode");
        if (mode) save("injectMode", mode.value || "visible");

        var aiE = qForm("adr044-auto-inject-emotion");
        if (aiE) save("autoInjectEmotion", !!aiE.checked);

        var aiP = qForm("adr044-auto-inject-plot");
        if (aiP) save("autoInjectPlot", !!aiP.checked);

        var sfw = qForm("adr044-show-floating-window");
        if (sfw) save("showFloatingWindow", !!sfw.checked);

        saveNow();
    }

    function syncType(type) {
        var p = prefixOf(type);

        var endpoint = qForm("adr044-" + type + "-endpoint");
        var key = qForm("adr044-" + type + "-key");
        var model = qForm("adr044-" + type + "-model");
        var preset = qForm("adr044-" + type + "-preset");
        var preview = qForm("adr044-" + type + "-preview");

        if (endpoint) save(p + "ApiEndpoint", endpoint.value || "");
        if (key) save(p + "ApiKey", key.value || "");
        if (model) save(p + "Model", model.value || "");
        if (preset) save(p + "Preset", preset.value || "");
        if (preview) save(p + "Preview", preview.value || "");

        var autoTrigger = qForm("adr044-auto-trigger-" + type);
        if (autoTrigger) save(type === "plot" ? "autoTriggerPlot" : "autoTriggerEmotion", !!autoTrigger.checked);

        var autoRange = qForm("adr044-auto-trigger-range-" + type);
        if (autoRange) save(type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange", autoRange.value || (type === "plot" ? "10" : "20"));

        var autoCustom = qForm("adr044-auto-trigger-custom-" + type);
        if (autoCustom) save(type === "plot" ? "autoTriggerPlotCustomRange" : "autoTriggerEmotionCustomRange", Number(autoCustom.value || 0));

        saveNow();
    }

    function syncAll() {
        syncShared();
        syncType("emotion");
        syncType("plot");
    }

    function adrDForceSaveSettings(type) {
        adrDBlurActiveElement();

        try {
            syncShared();
            if (type === "emotion" || type === "plot") syncType(type);
            else syncAll();

            // 强制读取当前面板字段，写入设置与本地备份。
            ["emotion", "plot"].forEach(function (t) {
                var p = prefixOf(t);
                var endpoint = qForm("adr044-" + t + "-endpoint");
                var key = qForm("adr044-" + t + "-key");
                var model = qForm("adr044-" + t + "-model");
                var preset = qForm("adr044-" + t + "-preset");

                if (endpoint) save(p + "ApiEndpoint", endpoint.value || "");
                if (key) save(p + "ApiKey", key.value || "");
                if (model) save(p + "Model", model.value || "");
                if (preset) save(p + "Preset", preset.value || "");
            });

            adrDSaveLocalBackup(settings());
            saveNow();
            adrDRefreshAllFieldsFromSettings();
            adrDToast("暗河红霞设置已保存");
            return true;
        } catch (e) {
            console.error("[Arrebol D] force save failed", e);
            return false;
        }
    }

    function getCurrentCharacterObject() {
        var c;
        try { c = ctx(); } catch (e) { return null; }

        var id = null;
        try {
            if (c.characterId !== undefined && c.characterId !== null) id = c.characterId;
            else if (c.this_chid !== undefined && c.this_chid !== null) id = c.this_chid;
            else if (c.chid !== undefined && c.chid !== null) id = c.chid;
        } catch (e1) {}

        try {
            if (c.characters && id !== null && id !== undefined && c.characters[id]) return c.characters[id];
        } catch (e2) {}

        try {
            if (c.character) return c.character;
        } catch (e3) {}

        try {
            if (c.characters && Array.isArray(c.characters) && c.name1) {
                for (var i = 0; i < c.characters.length; i++) {
                    if (c.characters[i] && c.characters[i].name === c.name1) return c.characters[i];
                }
            }
        } catch (e4) {}

        return null;
    }

    function asCleanText(v, max) {
        if (v === undefined || v === null) return "";
        var s = "";
        if (typeof v === "string") s = v;
        else {
            try { s = JSON.stringify(v, null, 2); }
            catch (e) { s = String(v); }
        }
        s = s.replace(/\r/g, "").trim();
        if (!s) return "";
        if (max && s.length > max) s = s.slice(0, max) + "…";
        return s;
    }

    function getNested(obj, path) {
        try {
            var cur = obj;
            for (var i = 0; i < path.length; i++) {
                if (!cur) return undefined;
                cur = cur[path[i]];
            }
            return cur;
        } catch (e) { return undefined; }
    }

    function extractCharacterCardText() {
        var ch = getCurrentCharacterObject();
        if (!ch) return "";

        var parts = [];
        var seen = {};

        function add(label, value, max) {
            var s = asCleanText(value, max || 6000);
            if (!s) return;
            var key = label + "::" + s.slice(0, 80);
            if (seen[key]) return;
            seen[key] = true;
            parts.push("【" + label + "】\n" + s);
        }

        add("角色名称", ch.name || getNested(ch, ["data", "name"]), 500);
        add("角色描述", ch.description || getNested(ch, ["data", "description"]), 9000);
        add("角色性格", ch.personality || getNested(ch, ["data", "personality"]), 5000);
        add("场景设定", ch.scenario || getNested(ch, ["data", "scenario"]), 5000);
        add("首条消息", ch.first_mes || getNested(ch, ["data", "first_mes"]), 2500);
        add("示例对话", ch.mes_example || getNested(ch, ["data", "mes_example"]), 5000);
        add("创作者注释", ch.creatorcomment || ch.creator_notes || getNested(ch, ["data", "creator_notes"]) || getNested(ch, ["data", "creatorcomment"]), 3000);
        add("系统提示", ch.system_prompt || getNested(ch, ["data", "system_prompt"]), 3000);
        add("后历史指令", ch.post_history_instructions || getNested(ch, ["data", "post_history_instructions"]), 3000);

        return parts.join("\n\n");
    }

    function extractCharacterBookText() {
        var ch = getCurrentCharacterObject();
        if (!ch) return "";

        var candidates = [];

        function pushCandidate(label, obj) {
            if (obj !== undefined && obj !== null) candidates.push({ label: label, obj: obj });
        }

        pushCandidate("data.character_book", getNested(ch, ["data", "character_book"]));
        pushCandidate("character_book", ch.character_book);
        pushCandidate("json_data.data.character_book", getNested(ch, ["json_data", "data", "character_book"]));
        pushCandidate("json_data.character_book", getNested(ch, ["json_data", "character_book"]));
        pushCandidate("data.extensions.character_book", getNested(ch, ["data", "extensions", "character_book"]));
        pushCandidate("data.extensions.world", getNested(ch, ["data", "extensions", "world"]));
        pushCandidate("data.extensions.world_info", getNested(ch, ["data", "extensions", "world_info"]));
        pushCandidate("data.extensions.lorebook", getNested(ch, ["data", "extensions", "lorebook"]));

        var parts = [];

        function entryText(entry, i) {
            if (!entry) return "";
            var keys = entry.keys || entry.key || entry.keywords || entry.primary_keys || [];
            if (Array.isArray(keys)) keys = keys.join(", ");
            var comment = entry.comment || entry.name || entry.title || "";
            var content = entry.content || entry.text || entry.value || entry.entry || "";
            var enabled = entry.enabled;
            if (enabled === false || entry.disable === true) return "";

            var s = "";
            if (comment) s += "条目 " + (i + 1) + "｜" + comment + "\n";
            else s += "条目 " + (i + 1) + "\n";
            if (keys) s += "关键词：" + keys + "\n";
            if (content) s += asCleanText(content, 3000);
            return s.trim();
        }

        candidates.forEach(function (cand) {
            var obj = cand.obj;
            if (!obj) return;

            var entries = null;
            if (Array.isArray(obj)) entries = obj;
            else if (Array.isArray(obj.entries)) entries = obj.entries;
            else if (obj.entries && typeof obj.entries === "object") {
                entries = [];
                Object.keys(obj.entries).forEach(function (k) { entries.push(obj.entries[k]); });
            }

            if (entries && entries.length) {
                var texts = [];
                entries.forEach(function (e, i) {
                    var t = entryText(e, i);
                    if (t) texts.push(t);
                });
                if (texts.length) {
                    parts.push("【角色卡世界书：" + cand.label + "】\n" + texts.join("\n\n"));
                }
            } else {
                var raw = asCleanText(obj, 3000);
                if (raw && raw !== "{}" && raw !== "[]") {
                    parts.push("【角色卡世界书候选：" + cand.label + "】\n" + raw);
                }
            }
        });

        return parts.join("\n\n");
    }

    function extractPersonaText() {
        var c;
        try { c = ctx(); } catch (e) { return ""; }

        var parts = [];

        function add(label, value) {
            var s = asCleanText(value, 3000);
            if (!s) return;
            // 过滤掉探针里出现的 jQuery 事件对象这类误判。
            if (s.indexOf("jQuery") >= 0 && s.indexOf("events") >= 0) return;
            if (s === "{}" || s === "[]") return;
            parts.push("【" + label + "】\n" + s);
        }

        add("用户名称", c.name2);

        try {
            var p = c.powerUserSettings || {};
            add("powerUserSettings.persona_description", p.persona_description);
            add("powerUserSettings.personaDescription", p.personaDescription);
            add("powerUserSettings.user_description", p.user_description);
            add("powerUserSettings.userDescription", p.userDescription);
        } catch (e1) {}

        try {
            var rw = rootWin();
            if (typeof rw.persona_description === "string") add("window.persona_description", rw.persona_description);
            if (typeof rw.user_description === "string") add("window.user_description", rw.user_description);
            if (rw.power_user) {
                add("window.power_user.persona_description", rw.power_user.persona_description);
                add("window.power_user.user_description", rw.power_user.user_description);
            }
        } catch (e2) {}

        return parts.join("\n\n");
    }

    function recentContentBlocks(rounds) {
        var chat;
        try { chat = ctx().chat; } catch (e) { return ""; }
        if (!chat || !chat.length) return "";

        var limit = rounds * 2;
        var arr = [];
        var count = 0;

        for (var i = chat.length - 1; i >= 0 && count < limit; i--) {
            var m = chat[i];
            if (!m || m.is_system) continue;

            var role = m.is_user ? "用户" : (m.name || "角色");
            var text = String(m.mes || "");
            text = cleanMessage(text);

            var blocks = [];
            var re = /<content\b[^>]*>([\s\S]*?)<\/content>/gi;
            var match;
            while ((match = re.exec(text)) !== null) {
                var v = (match[1] || "").trim();
                if (v) blocks.push(v);
            }

            // 用户消息通常没有 <content>，保留用户原文作为必要上下文，但限制长度。
            if (!blocks.length && m.is_user) {
                var u = text.trim();
                if (u) blocks.push(u.length > 1200 ? u.slice(0, 1200) + "…" : u);
            }

            if (blocks.length) {
                arr.unshift("[" + role + "]\n" + blocks.join("\n\n"));
            }

            count++;
        }

        return arr.join("\n\n---\n\n");
    }

    function buildPreciseContext() {
        var parts = [];
        var charText = extractCharacterCardText();
        var bookText = extractCharacterBookText();
        var personaText = extractPersonaText();
        var st = settings();

        if (charText) parts.push("【当前角色卡】\n" + charText);
        if (bookText) parts.push("【角色卡世界书 / Lorebook】\n" + bookText);
        if (personaText) parts.push("【User 人设 / Persona】\n" + personaText);
        if (st.supplementMemory && st.supplementMemory.trim()) {
            parts.push("【手动补充】\n" + st.supplementMemory.trim());
        }

        return parts.join("\n\n");
    }


    function buildPrompt(type, extra) {
        var r = activeRange();
        var out = "";

        var contextText = buildPreciseContext();
        if (contextText) {
            out += contextText + "\n\n";
        }

        var recent = recentContentBlocks(r);
        out += "【最近 " + r + " 轮正文｜精准读取】\n" + (recent || "（未提取到 <content> 正文；用户消息会作为上下文保留）") + "\n\n";

        if (extra && extra.trim()) {
            out += "【本次额外指令】\n" + extra.trim() + "\n\n";
        }

        if (type === "plot") {
            out += "请根据以上内容输出剧情导演方向。只输出方向结果，不要复述分析过程，不要写正文。";
        } else {
            out += "请根据以上内容输出情感导演方向。只输出方向结果，不要复述分析过程，不要写正文。";
        }

        return out;
    }

    function parseResponse(data) {
        if (!data) return "";

        if (data.choices && data.choices[0]) {
            var ch = data.choices[0];

            if (ch.message) {
                var msg = ch.message;
                if (typeof msg.content === "string" && msg.content.trim()) return msg.content.trim();

                if (msg.content && Array.isArray(msg.content)) {
                    var parts = [];
                    msg.content.forEach(function (p) {
                        if (!p) return;
                        if (typeof p === "string") parts.push(p);
                        else if (p.text) parts.push(p.text);
                        else if (p.type === "text" && p.text) parts.push(p.text);
                    });
                    if (parts.join("").trim()) return parts.join("\n").trim();
                }
            }

            if (ch.text) return String(ch.text).trim();
        }

        if (data.response) return String(data.response).trim();
        if (data.text) return String(data.text).trim();
        return "";
    }

    async function callAPI(type, extra) {
        var st = settings();
        var p = prefixOf(type);

        var endpoint = st[p + "ApiEndpoint"] || "";
        var key = st[p + "ApiKey"] || "";
        var model = st[p + "Model"] || "";
        var preset = st[p + "Preset"] || (type === "plot" ? PLOT_PRESET : EMOTION_PRESET);

        if (!endpoint) throw new Error("请先填写 " + labelOf(type) + " API 地址");
        if (!model) throw new Error("请先填写 " + labelOf(type) + " 模型名");

        var url = chatUrl(endpoint);
        if (!url) throw new Error("API 地址无效");

        var headers = { "Content-Type": "application/json" };
        if (key) headers.Authorization = "Bearer " + key;

        if (typeof AbortController !== "undefined") aborter = new AbortController();
        else aborter = null;

        var body = {
            model: model,
            messages: [
                { role: "system", content: preset },
                { role: "user", content: buildPrompt(type, extra || "") }
            ],
            temperature: 0.6,
            stream: false
        };

        var opts = {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body)
        };
        if (aborter) opts.signal = aborter.signal;

        var res = await fetch(url, opts);
        var raw = await res.text();

        if (!res.ok) throw new Error("API " + res.status + "：" + raw.slice(0, 220));

        var data;
        try { data = JSON.parse(raw); }
        catch (e) { throw new Error("API 返回非 JSON：" + raw.slice(0, 180)); }

        var out = parseResponse(data);
        if (!out) throw new Error("无法解析响应：" + raw.slice(0, 220));
        return out;
    }

    function setButtons(type) {
        ["emotion", "plot"].forEach(function (t) {
            var g = qForm("adr044-" + t + "-generate");
            var r = qForm("adr044-" + t + "-reroll");
            var s = qForm("adr044-" + t + "-stop");
            var c = qForm("adr044-" + t + "-copy");
            var inj = qForm("adr044-" + t + "-inject");
            var pv = qForm("adr044-" + t + "-preview");
            var has = pv && pv.value;

            if (g) g.disabled = processing;
            if (r) r.disabled = processing;
            if (s) s.disabled = !processing;
            if (c) c.disabled = !has;
            if (inj) inj.disabled = !has;
        });
    }

    async function run(type, extra) {
        if (processing) return;

        syncShared();
        syncType(type);

        processing = true;
        setButtons(type);
        status(type, "正在分析…", "#8ed99d");

        try {
            var out = await callAPI(type, extra || "");
            setPreview(type, out);
            status(type, "分析完成 ✓", "#8ed99d");

            var st = settings();
            var autoKey = type === "plot" ? "autoInjectPlot" : "autoInjectEmotion";
            if (st[autoKey]) {
                var ok = injectDirector(type, out);
                if (ok) status(type, "分析完成并已注入当前聊天 ✓", "#8ed99d");
                else status(type, "分析完成，但自动注入失败，请手动复制", "#d6b177");
            }
        } catch (e) {
            var msg = e && e.name === "AbortError" ? "请求已打断" : (e.message || String(e));
            status(type, "失败：" + msg, "#d4726a");
        }

        processing = false;
        aborter = null;
        setButtons(type);
    }

    function abortRun(type) {
        try {
            if (aborter) aborter.abort();
            status(type, "已打断请求", "#d4726a");
        } catch (e) {
            status(type, "打断失败：" + e.message, "#d4726a");
        }
        processing = false;
        aborter = null;
        setButtons(type);
    }

    function copyText(type) {
        var pv = qForm("adr044-" + type + "-preview");
        var text = pv ? pv.value : "";
        if (!text) {
            status(type, "没有内容可复制", "#d4726a");
            return;
        }

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
            else {
                pv.focus();
                pv.select();
                document.execCommand("copy");
            }
            status(type, "已复制 ✓", "#8ed99d");
        } catch (e) {
            status(type, "复制失败", "#d4726a");
        }
    }

    function escapeHtmlForDetails(s) {
        s = String(s || "");
        return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function plainMarkerInjection(type, title, body) {
        // 像生图 image###...### 一样的纯文本包裹。
        // 不使用任何 HTML 标签/注释，避免干扰酒馆美化正则。
        return "\n\narrebol_d###\n"
            + "【暗河红霞 Arrebol D｜" + title + "】\n"
            + String(body || "").trim()
            + "\n###";
    }

    function injectionText(type, text) {
        var title = type === "plot" ? "剧情导演" : "情感导演";
        var mode = settings().injectMode || "visible";
        var body = String(text || "").trim();

        if (mode === "hidden" || mode === "folded") {
            return plainMarkerInjection(type, title, body);
        }

        return "\n\narrebol_d_visible###\n【暗河红霞 Arrebol D｜" + title + "】\n" + body + "\n###";
    }

    function findLastMessageIndex(chat) {
        if (!chat || !chat.length) return -1;

        for (var i = chat.length - 1; i >= 0; i--) {
            var m = chat[i];
            if (!m || m.is_system) continue;
            if (m.mes && String(m.mes).trim()) return i;
        }

        return chat.length - 1;
    }

    function saveChatSafe() {
        try {
            var c = ctx();
            if (typeof c.saveChat === "function") {
                c.saveChat();
                return;
            }
        } catch (e) {}

        try {
            var rw = rootWin();
            if (typeof rw.saveChatConditional === "function") rw.saveChatConditional();
            else if (typeof rw.saveChat === "function") rw.saveChat();
        } catch (e2) {}
    }

    function refreshMessageDom(index) {
        try {
            var rw = rootWin();

            if (typeof rw.reloadCurrentChat === "function") {
                // 太重，先不用。优先改 DOM。
            }

            var d = rootDoc();
            var msg = null;
            var sels = [
                '#chat .mes[mesid="' + index + '"] .mes_text',
                '#chat .mes[mesid="' + index + '"] .mes_block .mes_text',
                '#chat .mes[mesid="' + index + '"]',
                '#chat .mes[data-mesid="' + index + '"] .mes_text',
                '#chat .mes[data-mesid="' + index + '"]'
            ];

            for (var i = 0; i < sels.length; i++) {
                msg = d.querySelector(sels[i]);
                if (msg) break;
            }

            if (msg) {
                var chat = ctx().chat;
                var content = chat && chat[index] ? chat[index].mes : "";
                msg.innerHTML = content;
            }
        } catch (e) {}
    }


    function adrDNativeRedrawNow() {
        try {
            var rw = rootWin();
            var c = ctx();

            try {
                if (typeof rw.reloadCurrentChat === "function") {
                    rw.reloadCurrentChat();
                    return true;
                }
            } catch (e1) {}

            try {
                if (typeof c.reloadCurrentChat === "function") {
                    c.reloadCurrentChat();
                    return true;
                }
            } catch (e2) {}

            try {
                if (c.eventSource && c.event_types && c.event_types.CHAT_CHANGED) {
                    c.eventSource.emit(c.event_types.CHAT_CHANGED);
                    return true;
                }
            } catch (e3) {}

            try {
                if (rw.eventSource && rw.event_types && rw.event_types.CHAT_CHANGED) {
                    rw.eventSource.emit(rw.event_types.CHAT_CHANGED);
                    return true;
                }
            } catch (e4) {}
        } catch (e) {}

        return false;
    }

    function adrDSaveThenRedrawAfterInject() {
        try {
            var c = ctx();
            var done = false;

            function redrawLater(ms) {
                setTimeout(function () {
                    if (done) return;
                    done = true;
                    adrDNativeRedrawNow();
                }, ms);
            }

            try {
                if (c && typeof c.saveChat === "function") {
                    var ret = c.saveChat();
                    if (ret && typeof ret.then === "function") {
                        ret.then(function () {
                            redrawLater(180);
                        }).catch(function () {
                            redrawLater(1200);
                        });
                        return;
                    }
                }
            } catch (e1) {}

            // 如果 saveChat 不是 Promise，就给移动端文件保存/IndexedDB 一点时间。
            redrawLater(1200);
        } catch (e) {
            console.warn("[Arrebol D] save then redraw failed", e);
            setTimeout(function () { adrDNativeRedrawNow(); }, 1500);
        }
    }


    function adrDBlurActiveElement() {
        try {
            var d = rootDoc();
            if (d && d.activeElement && typeof d.activeElement.blur === "function") {
                d.activeElement.blur();
                return true;
            }
        } catch (e1) {}

        try {
            var rw = rootWin();
            if (rw && rw.document && rw.document.activeElement && typeof rw.document.activeElement.blur === "function") {
                rw.document.activeElement.blur();
                return true;
            }
        } catch (e2) {}

        return false;
    }

    function injectDirector(type, text) {
        if (!text || !text.trim()) return false;

        try {
            var c = ctx();
            var chat = c.chat;
            if (!chat || !chat.length) return false;

            var idx = findLastMessageIndex(chat);
            if (idx < 0 || !chat[idx]) return false;

            var add = injectionText(type, text);

            // 移除同类型旧注入，避免最后一条消息越堆越多。
            var mes = String(chat[idx].mes || "");
            var startMark = "<!-- ARREBOL_D_START:" + type + " -->";
            var endMark = "<!-- ARREBOL_D_END:" + type + " -->";

            var startAt = mes.indexOf(startMark);
            while (startAt >= 0) {
                var endAt = mes.indexOf(endMark, startAt);
                if (endAt < 0) break;
                mes = mes.slice(0, startAt).trimEnd() + mes.slice(endAt + endMark.length);
                startAt = mes.indexOf(startMark);
            }

            var startMark2 = "<!-- ARREBOL_D_START:" + type;
            var endMark2 = "ARREBOL_D_END:" + type + " -->";
            var startAt2 = mes.indexOf(startMark2);
            while (startAt2 >= 0) {
                var endAt2 = mes.indexOf(endMark2, startAt2);
                if (endAt2 < 0) break;
                mes = mes.slice(0, startAt2).trimEnd() + mes.slice(endAt2 + endMark2.length);
                startAt2 = mes.indexOf(startMark2);
            }

            var visibleName = type === "plot" ? "剧情导演" : "情感导演";
            var reOldVisible = new RegExp("\\n\\n【(?:红霞导演室|暗河红霞 Arrebol D)(?:｜|\\|)" + visibleName + "】[\\s\\S]*$", "m");
            mes = mes.replace(reOldVisible, "");

            // 移除旧版纯文本标记注入，避免堆叠。
            mes = mes.replace(/\n?arrebol_d(?:_visible)?###[\s\S]*?###/g, "").trimEnd();

            chat[idx].mes = mes.trimEnd() + add;

            // v1.0.5.6.5.3：先保存，保存完成/延迟足够后再原生重绘，避免 reload 抢跑导致注入消失。
            adrDSaveThenRedrawAfterInject();
            return true;
        } catch (e) {
            console.error("[Arrebol D] inject failed", e);
            return false;
        }
    }

    function localTest(type) {
        syncAll();
        var r = activeRange();
        var title = type === "plot" ? "剧情本地测试" : "情感本地测试";
        var text = "【" + title + "】\n按钮、读取聊天、写入结果框链路可用。\n\n【读取最近 " + r + " 轮】\n" + (recentChat(r).slice(0, 1200) || "（未读取到聊天内容）");
        setPreview(type, text);
        status(type, "本地测试成功 ✓", "#8ed99d");
        setButtons(type);
    }

    function pushModel(list, m) {
        if (!m) return;
        if (typeof m === "string") { list.push(m); return; }
        if (m.id) list.push(m.id);
        else if (m.name) list.push(m.name);
        else if (m.model) list.push(m.model);
        else if (m.slug) list.push(m.slug);
    }

    function extractModels(data) {
        var list = [];

        if (!data) return list;

        if (Array.isArray(data)) data.forEach(function (m) { pushModel(list, m); });
        else if (Array.isArray(data.data)) data.data.forEach(function (m) { pushModel(list, m); });
        else if (Array.isArray(data.models)) data.models.forEach(function (m) { pushModel(list, m); });
        else if (data.id) pushModel(list, data);

        var seen = {};
        var out = [];
        list.forEach(function (x) {
            x = String(x || "").trim();
            if (!x || seen[x]) return;
            seen[x] = true;
            out.push(x);
        });
        out.sort();
        return out;
    }

    function fillModelSelect(type, models) {
        var st = settings();
        var modelKey = field(type, "model");
        var current = st[modelKey] || "";

        var sel = qForm("adr044-" + type + "-model-select");
        if (!sel) return;

        var html = "";
        if (current) html += '<option value="' + esc(current) + '">' + esc(current) + '（当前）</option>';
        else html += '<option value="">加载后选择模型</option>';

        models.forEach(function (m) {
            if (m === current) return;
            html += '<option value="' + esc(m) + '">' + esc(m) + '</option>';
        });

        sel.innerHTML = html;
        if (current) sel.value = current;
    }

    async function loadModels(type) {
        syncType(type);

        var st = settings();
        var p = prefixOf(type);
        var endpoint = st[p + "ApiEndpoint"] || "";
        var key = st[p + "ApiKey"] || "";

        if (!endpoint) {
            status(type, "请先填写 API 地址", "#d4726a");
            return;
        }

        var url = modelsUrl(endpoint);
        if (!url) {
            status(type, "API 地址无效", "#d4726a");
            return;
        }

        var btn = qForm("adr044-" + type + "-load-models");
        if (btn) {
            btn.disabled = true;
            btn.textContent = "加载中…";
        }

        status(type, "正在拉取模型列表…", "#8ed99d");

        try {
            var headers = {};
            if (key) headers.Authorization = "Bearer " + key;

            var res = await fetch(url, { method: "GET", headers: headers });
            var raw = await res.text();

            if (!res.ok) throw new Error("模型接口 " + res.status + "：" + raw.slice(0, 220));

            var data;
            try { data = JSON.parse(raw); }
            catch (e) { throw new Error("模型接口返回非 JSON：" + raw.slice(0, 180)); }

            var models = extractModels(data);
            if (!models.length) throw new Error("没有解析到模型名");

            fillModelSelect(type, models);
            status(type, "已加载 " + models.length + " 个模型 ✓", "#8ed99d");
        } catch (e2) {
            status(type, "加载模型失败：" + (e2.message || String(e2)), "#d4726a");
        }

        if (btn) {
            btn.disabled = false;
            btn.textContent = "加载模型";
        }
    }

    function safeType(v) {
        if (v === null) return "null";
        if (v === undefined) return "undefined";
        if (Array.isArray(v)) return "array(" + v.length + ")";
        return typeof v;
    }

    function shortText(v, max) {
        max = max || 500;
        try {
            var s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
            if (!s) return "";
            if (s.length > max) return s.slice(0, max) + "…";
            return s;
        } catch (e) {
            try { return String(v).slice(0, max); } catch (_) { return ""; }
        }
    }

    function listKeys(obj, max) {
        max = max || 80;
        try {
            if (!obj) return "（无）";
            var keys = Object.keys(obj);
            return keys.slice(0, max).join(", ") + (keys.length > max ? " … 共" + keys.length + "项" : "");
        } catch (e) {
            return "（无法读取 keys：" + e.message + "）";
        }
    }

    function getCurrentCharacterProbe() {
        var c;
        try { c = ctx(); } catch (e) { return { error: e.message }; }

        var info = {
            chid: null,
            characterId: null,
            name1: null,
            charObj: null,
            source: ""
        };

        var ids = ["characterId", "this_chid", "chid", "currentCharacterId"];
        ids.forEach(function (k) {
            if (c[k] !== undefined && info[k === "characterId" ? "characterId" : "chid"] === null) {
                if (k === "characterId") info.characterId = c[k];
                else info.chid = c[k];
            }
        });

        var id = info.characterId;
        if (id === null || id === undefined) id = info.chid;

        try {
            if (c.characters && id !== null && id !== undefined && c.characters[id]) {
                info.charObj = c.characters[id];
                info.source = "ctx.characters[id]";
            }
        } catch (e1) {}

        try {
            if (!info.charObj && c.character) {
                info.charObj = c.character;
                info.source = "ctx.character";
            }
        } catch (e2) {}

        try {
            if (!info.charObj && c.characters && Array.isArray(c.characters) && c.name1) {
                for (var i = 0; i < c.characters.length; i++) {
                    if (c.characters[i] && c.characters[i].name === c.name1) {
                        info.charObj = c.characters[i];
                        info.source = "ctx.characters by name1";
                        break;
                    }
                }
            }
        } catch (e3) {}

        try { info.name1 = c.name1 || (info.charObj && info.charObj.name) || ""; } catch (e4) {}

        return info;
    }

    function extractCoreCharacterText(ch) {
        if (!ch) return "";
        var parts = [];
        var fields = [
            ["name", "名称"],
            ["description", "描述"],
            ["personality", "性格"],
            ["scenario", "场景"],
            ["first_mes", "首条消息"],
            ["mes_example", "示例对话"],
            ["creator_notes", "创作者注释"],
            ["system_prompt", "系统提示"],
            ["post_history_instructions", "后历史指令"]
        ];

        fields.forEach(function (pair) {
            var k = pair[0], label = pair[1];
            if (ch[k]) parts.push("【" + label + "】\n" + String(ch[k]).trim());
        });

        try {
            if (ch.data) {
                fields.forEach(function (pair) {
                    var k = pair[0], label = pair[1];
                    if (ch.data[k] && !ch[k]) parts.push("【data." + label + "】\n" + String(ch.data[k]).trim());
                });
            }
        } catch (e) {}

        return parts.join("\n\n");
    }

    function findPersonaProbe() {
        var c;
        try { c = ctx(); } catch (e) { return { error: e.message }; }

        var candidates = [];
        var keys = [
            "persona",
            "persona_description",
            "personaDescription",
            "user_description",
            "userDescription",
            "power_user",
            "name2"
        ];

        keys.forEach(function (k) {
            try {
                if (c[k] !== undefined) candidates.push({ key: "ctx." + k, type: safeType(c[k]), value: shortText(c[k], 600) });
            } catch (e) {}
        });

        try {
            var rw = rootWin();
            ["persona_description", "power_user", "selected_persona", "name2", "user_avatar"].forEach(function (k) {
                if (rw[k] !== undefined) candidates.push({ key: "window." + k, type: safeType(rw[k]), value: shortText(rw[k], 600) });
            });
        } catch (e2) {}

        return candidates;
    }

    function findWorldProbe() {
        var c;
        try { c = ctx(); } catch (e) { return [{ key: "ctx", error: e.message }]; }

        var out = [];
        var ctxKeys = [
            "world_info",
            "worldInfo",
            "worldInfos",
            "world_names",
            "worldNames",
            "chat_metadata",
            "chatMetadata",
            "characters",
            "groups",
            "extensionSettings"
        ];

        ctxKeys.forEach(function (k) {
            try {
                if (c[k] !== undefined) out.push({ key: "ctx." + k, type: safeType(c[k]), keys: listKeys(c[k], 40), value: shortText(c[k], 500) });
            } catch (e) {}
        });

        try {
            var rw = rootWin();
            [
                "world_info",
                "worldInfo",
                "world_names",
                "world_names_data",
                "selected_world_info",
                "chat_metadata",
                "getWorldInfoPrompt",
                "getWorldInfoPromptData",
                "getWorldInfoSettings",
                "world_info_data"
            ].forEach(function (k) {
                if (rw[k] !== undefined) out.push({ key: "window." + k, type: safeType(rw[k]), keys: listKeys(rw[k], 40), value: shortText(rw[k], 500) });
            });
        } catch (e2) {}

        return out;
    }

    function extractContentBlocksFromText(text) {
        text = String(text || "");
        text = cleanMessage(text);

        var blocks = [];
        var re = /<content\b[^>]*>([\s\S]*?)<\/content>/gi;
        var m;
        while ((m = re.exec(text)) !== null) {
            var v = (m[1] || "").trim();
            if (v) blocks.push(v);
        }

        return blocks;
    }

    function contentBlocksProbe(rounds) {
        var chat;
        try { chat = ctx().chat; } catch (e) { return { error: e.message, blocks: [] }; }
        if (!chat || !chat.length) return { blocks: [], lines: ["（未读取到聊天）"] };

        var limit = rounds * 2;
        var lines = [];
        var blocks = [];
        var count = 0;

        for (var i = chat.length - 1; i >= 0 && count < limit; i--) {
            var msg = chat[i];
            if (!msg || msg.is_system) continue;

            var role = msg.is_user ? "用户" : (msg.name || "角色");
            var found = extractContentBlocksFromText(msg.mes);

            if (found.length) {
                for (var j = 0; j < found.length; j++) {
                    blocks.unshift({
                        index: i,
                        role: role,
                        text: found[j]
                    });
                }
                lines.unshift("消息 #" + i + " [" + role + "] 提取到 " + found.length + " 段 <content>");
            } else {
                lines.unshift("消息 #" + i + " [" + role + "] 无 <content>");
            }

            count++;
        }

        return { blocks: blocks, lines: lines };
    }

    function runContextProbe() {
        syncAll();

        var c;
        try { c = ctx(); } catch (e) {
            setPreview(currentType(), "读取 ctx 失败：" + e.message);
            return;
        }

        var charInfo = getCurrentCharacterProbe();
        var ch = charInfo.charObj;
        var persona = findPersonaProbe();
        var worlds = findWorldProbe();
        var content = contentBlocksProbe(activeRange());

        var out = "";
        out += "【红霞探针 v1.0.5.6.5.3.2】\n";
        out += "目的：检测酒馆 1.81 当前环境里角色卡 / 世界书 / user 人设 / <content> 所在字段。\n\n";

        out += "【Context 顶层 keys】\n";
        out += listKeys(c, 120) + "\n\n";

        out += "【当前角色定位】\n";
        out += "characterId: " + shortText(charInfo.characterId, 100) + "\n";
        out += "chid/this_chid: " + shortText(charInfo.chid, 100) + "\n";
        out += "name1/角色名: " + shortText(charInfo.name1, 100) + "\n";
        out += "角色来源: " + (charInfo.source || "未定位") + "\n";
        out += "角色对象类型: " + safeType(ch) + "\n";
        out += "角色对象 keys: " + listKeys(ch, 100) + "\n\n";

        out += "【角色卡核心字段预览】\n";
        var core = extractCoreCharacterText(ch);
        out += (core ? core.slice(0, 1800) : "（未提取到常见角色卡字段）") + "\n\n";

        out += "【User 人设 / Persona 候选】\n";
        if (persona.length) {
            persona.forEach(function (p) {
                out += "- " + p.key + " | " + p.type + "\n";
                if (p.value) out += p.value.slice(0, 500) + "\n";
            });
        } else {
            out += "（未找到明显 persona 字段）\n";
        }
        out += "\n";

        out += "【世界书 / Lorebook 候选】\n";
        if (worlds.length) {
            worlds.forEach(function (w) {
                out += "- " + w.key + " | " + w.type + "\n";
                out += "  keys: " + (w.keys || "（无）") + "\n";
                if (w.value) out += "  preview: " + String(w.value).replace(/\n/g, " ").slice(0, 500) + "\n";
            });
        } else {
            out += "（未找到明显 world/lorebook 字段）\n";
        }
        out += "\n";

        out += "【<content> 提取概览】\n";
        if (content.error) out += "错误：" + content.error + "\n";
        out += "提取段数: " + (content.blocks ? content.blocks.length : 0) + "\n";
        if (content.lines) out += content.lines.slice(0, 80).join("\n") + "\n";

        setPreview(currentType(), out);
        status(currentType(), "上下文探针完成 ✓ 请复制结果给小g", "#8ed99d");
        setButtons(currentType());
    }

    function runContentProbe() {
        syncAll();

        var result = contentBlocksProbe(activeRange());
        var out = "";
        out += "【<content> 精准提取测试】\n";
        out += "范围：最近 " + activeRange() + " 轮，按消息倒序扫描后恢复顺序。\n\n";

        if (result.error) out += "错误：" + result.error + "\n\n";

        out += "【扫描概览】\n";
        out += (result.lines && result.lines.length ? result.lines.join("\n") : "（无扫描结果）") + "\n\n";

        out += "【提取正文】\n";
        if (result.blocks && result.blocks.length) {
            result.blocks.forEach(function (b, i) {
                out += "\n--- content #" + (i + 1) + " / 消息#" + b.index + " / " + b.role + " ---\n";
                out += b.text + "\n";
            });
        } else {
            out += "未提取到 <content>...</content>。如果你的正文没有 content 标签，正式版需要 fallback 策略。\n";
        }

        setPreview(currentType(), out);
        status(currentType(), "<content> 提取测试完成 ✓", "#8ed99d");
        setButtons(currentType());
    }


    function opt(cur, val, label) {
        return '<option value="' + val + '"' + (String(cur) === String(val) ? " selected" : "") + '>' + label + '</option>';
    }

    function pageHTML(type) {
        var st = settings();
        var p = prefixOf(type);
        var title = type === "plot" ? "剧情导演" : "情感导演";
        var autoKey = type === "plot" ? "autoInjectPlot" : "autoInjectEmotion";

        return '<div class="adr044-page" id="adr044-page-' + type + '"' + (st.activeTab === type ? '' : ' style="display:none"') + '>'
            + '<details open><summary>' + title + '配置</summary>'
            + '<label>API 地址</label><input type="text" id="adr044-' + type + '-endpoint" value="' + esc(st[p + "ApiEndpoint"] || "") + '" placeholder="https://openrouter.ai/api/v1">'
            + '<label>API 密钥</label><input type="password" id="adr044-' + type + '-key" value="' + esc(st[p + "ApiKey"] || "") + '" placeholder="sk-...">'
            + '<label>模型</label><input type="text" id="adr044-' + type + '-model" value="' + esc(st[p + "Model"] || "") + '" placeholder="可以手填，或加载模型">'
            + '<select id="adr044-' + type + '-model-select"><option value="' + esc(st[p + "Model"] || "") + '">' + (st[p + "Model"] ? esc(st[p + "Model"]) + "（当前）" : "加载后选择模型") + '</option></select>'
            + '<div class="adr044-actions"><button id="adr044-' + type + '-load-models" type="button">加载模型</button><button id="adr044-' + type + '-save" type="button">保存设置</button></div>'
            + '<label class="adr044-check"><input type="checkbox" id="adr044-auto-inject-' + type + '"' + (st[autoKey] ? " checked" : "") + '> 生成后自动注入当前聊天</label>'
            + '<label class="adr044-check"><input type="checkbox" id="adr044-auto-trigger-' + type + '"' + (st[type === "plot" ? "autoTriggerPlot" : "autoTriggerEmotion"] ? " checked" : "") + '> 启用自动触发</label>'
            + '<label>自动触发间隔</label>'
            + '<select id="adr044-auto-trigger-range-' + type + '">'
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "10", "每 10 个助手正文轮次")
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "20", "每 20 个助手正文轮次")
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "30", "每 30 个助手正文轮次")
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "50", "每 50 个助手正文轮次")
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "custom", "自定义")
            + '</select>'
            + '<input type="number" id="adr044-auto-trigger-custom-' + type + '" placeholder="自定义自动触发轮次" value="' + esc(st[type === "plot" ? "autoTriggerPlotCustomRange" : "autoTriggerEmotionCustomRange"] || "") + '" style="display:' + (String(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"]) === "custom" ? "block" : "none") + '">'
            + '<div class="adr044-auto-counter" id="adr044-auto-counter-' + type + '">自动触发计数：打开面板后刷新</div>'
            + '</details>'

            + '<details><summary>' + title + '预设</summary>'
            + '<div class="adr044-template-compact">'
            + '<select id="adr044-template-select-' + type + '">' + adrDTemplateOptions(type) + '</select>'
            + '<input id="adr044-template-name-' + type + '" placeholder="新模板名 / 当前模板名">'
            + '<div class="adr044-template-mini-actions">'
            + '<button type="button" id="adr044-template-save-' + type + '">保存当前为模板</button>'
            + '<button type="button" id="adr044-template-delete-' + type + '">删除模板</button>'
            + '</div>'
            + '<div class="adr044-template-status" id="adr044-template-status-' + type + '"></div>'
            + '</div>'
            + '<textarea id="adr044-' + type + '-preset" rows="8">' + esc(st[p + "Preset"] || "") + '</textarea>'
            + '</details>'

            + '<details open><summary>' + title + '结果</summary>'
            + '<div id="adr044-' + type + '-status">请先本地测试，或直接生成方向。</div>'
            + '<textarea id="adr044-' + type + '-preview" rows="8" placeholder="生成结果显示在这里">' + esc(st[p + "Preview"] || "") + '</textarea>'
            + '<label>补充指令</label><input type="text" id="adr044-' + type + '-extra" placeholder="只影响本次重新分析">'
            + '<div class="adr044-actions"><button id="adr044-' + type + '-local" type="button">本地测试</button><button id="adr044-' + type + '-generate" type="button">生成方向</button></div>'
            + '<div class="adr044-actions"><button id="adr044-' + type + '-reroll" type="button">重新分析</button><button id="adr044-' + type + '-stop" type="button" disabled>打断</button><button id="adr044-' + type + '-copy" type="button">复制</button></div>'
            + '<div class="adr044-actions"><button id="adr044-' + type + '-inject" type="button">手动注入当前聊天</button></div>'
            + '</details>'
            + '</div>';
    }

    function drawerHTML() {
        var st = settings();

        return '<div id="adr044-drawer"><div class="inline-drawer">'
            + '<div class="inline-drawer-toggle inline-drawer-header"><b>🎬 Arrebol D 暗河红霞导演系统 v1.0.5.6.5.3</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>'
            + '<div class="inline-drawer-content">'
            + '<div class="adr044-box">'
            + '<div class="adr044-note">灵魂共鸣者Arrebol在线检测</div>'

            + '<details open><summary>共享设置</summary>'
            + '<label>复盘范围</label><select id="adr044-range">'
            + opt(st.range, "10", "最近 10 轮")
            + opt(st.range, "20", "最近 20 轮")
            + opt(st.range, "30", "最近 30 轮")
            + opt(st.range, "50", "最近 50 轮")
            + opt(st.range, "custom", "自定义")
            + '</select>'
            + '<input type="number" id="adr044-custom" placeholder="自定义轮数" value="' + esc(st.customRange || "") + '" style="display:' + (String(st.range) === "custom" ? "block" : "none") + '">'
            + '<label>角色卡要点 / 世界书 / 当前担心</label>'
            + '<textarea id="adr044-memory" rows="5" placeholder="这里会同时发给情感导演和剧情导演">' + esc(st.supplementMemory || "") + '</textarea>'
            + '<div class="adr044-actions"><button id="adr044-probe-context" type="button" onclick="window.ADR044_probeContext&&window.ADR044_probeContext();return false;">检测上下文</button><button id="adr044-probe-content" type="button" onclick="window.ADR044_probeContent&&window.ADR044_probeContent();return false;">测试 &lt;content&gt; 提取</button></div>'
            + '<div class="adr044-actions"><button id="adr044-preview-precise" type="button">预览精准读取</button></div>'
            + '<label>注入方式</label><select id="adr044-inject-mode">'
            + opt(st.injectMode, "visible", "可见文本注入（直接显示）")
            + opt(st.injectMode, "folded", "纯文本标记注入（推荐外挂正则）")
            + opt(st.injectMode, "hidden", "纯文本标记注入（推荐外挂正则）")
            + '</select>'
            + '<label class="adr044-check"><input type="checkbox" id="adr044-show-floating-window"' + (st.showFloatingWindow ? " checked" : "") + '> 显示小红霞浮窗</label>'
            + '</details>'

            + '<div class="adr044-tabs">'
            + '<button id="adr044-tab-emotion" type="button" class="' + (st.activeTab === "plot" ? "" : "active") + '">情感导演</button>'
            + '<button id="adr044-tab-plot" type="button" class="' + (st.activeTab === "plot" ? "active" : "") + '">剧情导演</button>'
            + '</div>'

            + pageHTML("emotion")
            + pageHTML("plot")
            + '</div>'
            + '</div></div></div>';
    }

    function mountDrawer() {
        if (q("#adr044-drawer")) return;

        var html = drawerHTML();

        try {
            var jq = rootWin().jQuery || rootWin().$ || window.jQuery || window.$;
            if (jq) {
                var target = jq("#extensions_settings2");
                if (target && target.length) {
                    target.append(html);
                    return;
                }
            }
        } catch (e) {}

        var d = rootDoc();
        var el = d.querySelector("#extensions_settings2");
        if (el) {
            var wrap = d.createElement("div");
            wrap.innerHTML = html;
            el.appendChild(wrap.firstChild);
        }
    }

    function switchTab(type) {
        type = type === "plot" ? "plot" : "emotion";
        save("activeTab", type);

        try {
            var d = rootDoc();

            // 抽屉与浮窗会同时存在，且内部 id 重复。
            // 所以这里必须同步所有同名节点，不能只 q("#id")。
            Array.prototype.slice.call(d.querySelectorAll("#adr044-page-emotion, #adr048-page-emotion")).forEach(function (el) {
                el.style.display = type === "emotion" ? "" : "none";
            });

            Array.prototype.slice.call(d.querySelectorAll("#adr044-page-plot, #adr048-page-plot")).forEach(function (el) {
                el.style.display = type === "plot" ? "" : "none";
            });

            Array.prototype.slice.call(d.querySelectorAll("#adr044-tab-emotion")).forEach(function (el) {
                el.classList.toggle("active", type === "emotion");
            });

            Array.prototype.slice.call(d.querySelectorAll("#adr044-tab-plot")).forEach(function (el) {
                el.classList.toggle("active", type === "plot");
            });

            adrDRefreshAllFieldsFromSettings();
        } catch (e) {
            console.warn("[Arrebol D] switchTab failed", e);
        }
    }


    function adrDSetAllById(id, value, checked) {
        try {
            var nodes = Array.prototype.slice.call(rootDoc().querySelectorAll("#" + id));
            nodes.forEach(function (el) {
                if (!el) return;
                if (el.type === "checkbox") {
                    el.checked = !!checked;
                } else {
                    el.value = value == null ? "" : value;
                }
            });
        } catch (e) {}
    }

    function adrDRefreshAllFieldsFromSettings() {
        try {
            var st = settings();

            adrDSetAllById("adr044-range", st.range || "30");
            adrDSetAllById("adr044-custom", st.customRange || "");
            adrDSetAllById("adr044-memory", st.supplementMemory || "");
            adrDSetAllById("adr044-inject-mode", st.injectMode || "visible");
            adrDSetAllById("adr044-show-floating-window", "", st.showFloatingWindow);

            ["emotion", "plot"].forEach(function (type) {
                var p = prefixOf(type);
                adrDSetAllById("adr044-" + type + "-endpoint", st[p + "ApiEndpoint"] || "");
                adrDSetAllById("adr044-" + type + "-key", st[p + "ApiKey"] || "");
                adrDSetAllById("adr044-" + type + "-model", st[p + "Model"] || "");
                adrDSetAllById("adr044-" + type + "-preset", st[p + "Preset"] || "");
                adrDSetAllById("adr044-" + type + "-preview", st[p + "Preview"] || "");
                adrDSetAllById("adr044-auto-inject-" + type, "", type === "plot" ? st.autoInjectPlot : st.autoInjectEmotion);
                adrDSetAllById("adr044-auto-trigger-" + type, "", type === "plot" ? st.autoTriggerPlot : st.autoTriggerEmotion);
                adrDSetAllById("adr044-auto-trigger-range-" + type, st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"] || (type === "plot" ? "10" : "20"));
                adrDSetAllById("adr044-auto-trigger-custom-" + type, st[type === "plot" ? "autoTriggerPlotCustomRange" : "autoTriggerEmotionCustomRange"] || "");
            });
            adrDUpdateAutoCounters();
        } catch (e) {
            console.warn("[Arrebol D] refresh fields failed", e);
        }
    }


    var ADR_D_TEMPLATE_KEY = "arrebol_d_prompt_templates_v1";
    var ADR_D_SELECTED_TEMPLATE_KEY = "arrebol_d_selected_prompt_templates_v1";

    function adrDLoadSelectedTemplates() {
        try {
            var s = rootWin().localStorage.getItem(ADR_D_SELECTED_TEMPLATE_KEY) || "";
            if (!s) return {};
            return JSON.parse(s) || {};
        } catch (e) {
            return {};
        }
    }

    function adrDSaveSelectedTemplate(type, name) {
        try {
            var obj = adrDLoadSelectedTemplates();
            obj[type] = String(name || "");
            rootWin().localStorage.setItem(ADR_D_SELECTED_TEMPLATE_KEY, JSON.stringify(obj));
        } catch (e) {}
    }

    function adrDSelectedTemplateName(type) {
        try {
            var obj = adrDLoadSelectedTemplates();
            return String(obj[type] || "");
        } catch (e) {
            return "";
        }
    }


    function adrDDefaultTemplateText(type) {
        try {
            var st = settings();
            return String(type === "plot" ? (st.plotPreset || "") : (st.emotionPreset || ""));
        } catch (e) {
            return "";
        }
    }

    function adrDDefaultTemplates() {
        return {
            emotion: [
                { name: "默认情感导演", text: adrDDefaultTemplateText("emotion") || "你是 RP 情感导演。请阅读最近的聊天内容和用户补充信息，只分析情感曲线与人写正文。" }
            ],
            plot: [
                { name: "默认剧情导演", text: adrDDefaultTemplateText("plot") || "你是 RP 编剧顾问。请阅读角色卡、世界书、记忆与最近聊天内容，分析剧情节奏、事件张力、伏笔管理与场景调度，给出下一阶段的剧情推进方向。你不写正文，只做剧情导航。" }
            ]
        };
    }

    function adrDNormalizeTemplates(raw) {
        var def = adrDDefaultTemplates();
        var out = { emotion: [], plot: [] };

        ["emotion", "plot"].forEach(function (type) {
            var arr = raw && Array.isArray(raw[type]) ? raw[type] : [];
            arr.forEach(function (it) {
                if (!it) return;
                var name = String(it.name || "").trim();
                var text = String(it.text || "");
                if (name) out[type].push({ name: name, text: text });
            });
            if (!out[type].length) out[type] = def[type];
        });

        return out;
    }

    function adrDLoadTemplates() {
        try {
            var rw = rootWin();
            if (rw.__adrDPromptTemplatesCache) return adrDNormalizeTemplates(rw.__adrDPromptTemplatesCache);

            var s = "";
            try { s = rw.localStorage.getItem(ADR_D_TEMPLATE_KEY) || ""; } catch (e1) {}

            if (!s) {
                rw.__adrDPromptTemplatesCache = adrDDefaultTemplates();
                adrDSaveTemplates(rw.__adrDPromptTemplatesCache);
                return adrDNormalizeTemplates(rw.__adrDPromptTemplatesCache);
            }

            rw.__adrDPromptTemplatesCache = adrDNormalizeTemplates(JSON.parse(s));
            return adrDNormalizeTemplates(rw.__adrDPromptTemplatesCache);
        } catch (e) {
            return adrDDefaultTemplates();
        }
    }

    function adrDSaveTemplates(obj) {
        try {
            var rw = rootWin();
            var normalized = adrDNormalizeTemplates(obj);
            rw.__adrDPromptTemplatesCache = normalized;
            rw.localStorage.setItem(ADR_D_TEMPLATE_KEY, JSON.stringify(normalized));
            return true;
        } catch (e) {
            console.warn("[Arrebol D] save templates failed", e);
            return false;
        }
    }

    function adrDTemplateOptions(type) {
        var data = adrDLoadTemplates();
        var arr = data[type] || [];
        var selectedName = adrDSelectedTemplateName(type);
        return arr.map(function (it, idx) {
            var name = String(it.name || ("模板 " + (idx + 1)));
            var selected = selectedName && name === selectedName ? ' selected' : '';
            return '<option value="' + idx + '"' + selected + '>' + esc(name) + '</option>';
        }).join("");
    }

    function adrDRefreshTemplateSelects(type, selectedName) {
        try {
            if (!selectedName) selectedName = adrDSelectedTemplateName(type);
            var html = adrDTemplateOptions(type);
            Array.prototype.slice.call(rootDoc().querySelectorAll("#adr044-template-select-" + type)).forEach(function (sel) {
                sel.innerHTML = html;
                var matched = false;
                if (selectedName) {
                    for (var i = 0; i < sel.options.length; i++) {
                        if (sel.options[i].textContent === selectedName) {
                            sel.value = String(i);
                            matched = true;
                            break;
                        }
                    }
                }
                if (!matched) sel.value = "0";
            });
        } catch (e) {}
    }

    function adrDTemplateStatus(type, text, color) {
        try {
            Array.prototype.slice.call(rootDoc().querySelectorAll("#adr044-template-status-" + type)).forEach(function (el) {
                el.textContent = text || "";
                if (color) el.style.color = color;
            });
        } catch (e) {}
    }

    function adrDGetPresetBox(type) { return qForm("adr044-" + type + "-preset"); }
    function adrDGetTemplateSelect(type) { return qForm("adr044-template-select-" + type); }
    function adrDGetTemplateName(type) { return qForm("adr044-template-name-" + type); }

    function adrDApplyTemplate(type) {
        var data = adrDLoadTemplates();
        var sel = adrDGetTemplateSelect(type);
        var idx = sel ? Number(sel.value) : 0;
        var item = data[type] && data[type][idx];

        if (!item) {
            adrDTemplateStatus(type, "没有找到模板", "#e28a9c");
            return;
        }

        var preset = adrDGetPresetBox(type);
        if (preset) {
            preset.value = String(item.text || "");
            try { preset.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
        }

        var name = adrDGetTemplateName(type);
        if (name) name.value = String(item.name || "");

        try {
            syncType(type);
            adrDSaveLocalBackup(settings());
        } catch (e2) {}

        adrDSaveSelectedTemplate(type, item.name);
        adrDTemplateStatus(type, "已切换：" + item.name, "#8ed99d");
    }

    function adrDSaveCurrentTemplate(type) {
        var nameBox = adrDGetTemplateName(type);
        var preset = adrDGetPresetBox(type);
        var name = nameBox ? String(nameBox.value || "").trim() : "";
        var text = preset ? String(preset.value || "") : "";

        if (!name) {
            adrDTemplateStatus(type, "请先写模板名", "#e28a9c");
            return;
        }

        var data = adrDLoadTemplates();
        var arr = data[type] || [];
        var found = -1;

        arr.forEach(function (it, idx) {
            if (String(it.name || "") === name) found = idx;
        });

        if (found >= 0) arr[found] = { name: name, text: text };
        else arr.push({ name: name, text: text });

        data[type] = arr;
        adrDSaveTemplates(data);
        adrDSaveSelectedTemplate(type, name);
        adrDRefreshTemplateSelects(type, name);
        adrDTemplateStatus(type, found >= 0 ? "已更新：" + name : "已新增：" + name, "#8ed99d");
    }

    function adrDDeleteCurrentTemplate(type) {
        var data = adrDLoadTemplates();
        var sel = adrDGetTemplateSelect(type);
        var idx = sel ? Number(sel.value) : -1;
        var arr = data[type] || [];

        if (!arr[idx]) {
            adrDTemplateStatus(type, "没有选中的模板", "#e28a9c");
            return;
        }

        if (arr.length <= 1) {
            adrDTemplateStatus(type, "至少保留一个模板", "#e28a9c");
            return;
        }

        var name = arr[idx].name;
        arr.splice(idx, 1);
        data[type] = arr;
        adrDSaveTemplates(data);
        adrDSaveSelectedTemplate(type, arr[0] ? arr[0].name : "");
        adrDRefreshTemplateSelects(type);
        adrDTemplateStatus(type, "已删除：" + name, "#f0b36a");
    }

    function adrDBindCompactTemplateControls() {
        try {
            ["emotion", "plot"].forEach(function (type) {
                Array.prototype.slice.call(rootDoc().querySelectorAll("#adr044-template-select-" + type)).forEach(function (sel) {
                    if (!sel) return;
                    try {
                        var data = adrDLoadTemplates();
                        var item = data[type] && data[type][Number(sel.value)];
                        var nameInput = adrDGetTemplateName(type);
                        if (nameInput && item && !nameInput.value) nameInput.value = item.name || "";
                    } catch (e0) {}

                    if (sel.__adrDTemplateSelectBound) return;
                    sel.__adrDTemplateSelectBound = true;
                    sel.addEventListener("change", function () {
                        adrDApplyTemplate(type);
                    }, true);
                });

                Array.prototype.slice.call(rootDoc().querySelectorAll("#adr044-template-save-" + type)).forEach(function (btn) {
                    if (!btn || btn.__adrDTemplateSaveBound) return;
                    btn.__adrDTemplateSaveBound = true;
                    btn.addEventListener("click", function (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        adrDSaveCurrentTemplate(type);
                    }, true);
                    btn.addEventListener("touchend", function (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        adrDSaveCurrentTemplate(type);
                    }, true);
                });

                Array.prototype.slice.call(rootDoc().querySelectorAll("#adr044-template-delete-" + type)).forEach(function (btn) {
                    if (!btn || btn.__adrDTemplateDeleteBound) return;
                    btn.__adrDTemplateDeleteBound = true;
                    btn.addEventListener("click", function (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        adrDDeleteCurrentTemplate(type);
                    }, true);
                    btn.addEventListener("touchend", function (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        adrDDeleteCurrentTemplate(type);
                    }, true);
                });
            });
        } catch (e) {}
    }

    function bindDirect() {
        try {
            if (!rootWin().adrDStableAutoSaveBound) {
                rootWin().adrDStableAutoSaveBound = true;
                rootDoc().addEventListener("input", function (ev) {
                    var t = ev && ev.target;
                    if (!t || !t.id || t.id.indexOf("adr044-") !== 0) return;
                    try {
                        syncShared();
                        if (t.id.indexOf("adr044-emotion-") === 0) syncType("emotion");
                        if (t.id.indexOf("adr044-plot-") === 0) syncType("plot");
                        adrDSaveLocalBackup(settings());
                        adrDUpdateAutoCounters();
                    } catch (e) {}
                }, true);
                rootDoc().addEventListener("change", function (ev) {
                    var t = ev && ev.target;
                    if (!t || !t.id || t.id.indexOf("adr044-") !== 0) return;
                    try {
                        syncShared();
                        if (t.id.indexOf("adr044-emotion-") === 0) syncType("emotion");
                        if (t.id.indexOf("adr044-plot-") === 0) syncType("plot");
                        adrDSaveLocalBackup(settings());
                        adrDUpdateAutoCounters();
                    } catch (e) {}
                }, true);
            }
        } catch (eStableBind) {}

        var ids = {};

        ids["adr044-tab-emotion"] = function () { switchTab("emotion"); };
        ids["adr044-tab-plot"] = function () { switchTab("plot"); };
        ids["adr044-probe-context"] = function () { runContextProbe(); };
        ids["adr044-probe-content"] = function () { runContentProbe(); };
        ids["adr044-preview-precise"] = function () { runPrecisePreview(); };

        ["emotion", "plot"].forEach(function (type) {
            ids["adr044-" + type + "-local"] = function () { localTest(type); };
            ids["adr044-" + type + "-generate"] = function () { run(type, ""); };
            ids["adr044-" + type + "-reroll"] = function () {
                var extra = qForm("adr044-" + type + "-extra");
                run(type, extra ? extra.value : "");
            };
            ids["adr044-" + type + "-stop"] = function () { abortRun(type); };
            ids["adr044-" + type + "-copy"] = function () { copyText(type); };
            ids["adr044-" + type + "-load-models"] = function () { loadModels(type); };
            ids["adr044-" + type + "-save"] = function () {
                adrDForceSaveSettings(type);
                status(type, "设置已保存 ✓", "#8ed99d");
            };
            ids["adr044-" + type + "-inject"] = function () {
                syncType(type);
                var pv = qForm("adr044-" + type + "-preview");
                var text = pv ? pv.value : "";
                if (!text) {
                    status(type, "没有内容可注入", "#d4726a");
                    return;
                }
                var ok = injectDirector(type, text);
                status(type, ok ? "已注入当前聊天 ✓" : "注入失败", ok ? "#8ed99d" : "#d4726a");
            };
        });

        Object.keys(ids).forEach(function (id) {
            var nodes = [];
            try {
                nodes = Array.prototype.slice.call(rootDoc().querySelectorAll("#" + id));
            } catch (e) {
                var one = q("#" + id);
                if (one) nodes = [one];
            }

            nodes.forEach(function (el) {
                if (!el || el.__adr044Bound) return;
                el.__adr044Bound = true;
                el.addEventListener("click", function (ev) {
                    try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
                    adrDBlurActiveElement();
                    ids[id]();
                }, true);
                el.addEventListener("touchend", function (ev) {
                    try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
                    adrDBlurActiveElement();
                    ids[id]();
                }, true);
            });
        });

        var range = qForm("adr044-range");
        if (range && !range.__adr044Bound) {
            range.__adr044Bound = true;
            range.addEventListener("change", function () {
                save("range", range.value);
                var custom = qForm("adr044-custom");
                if (custom) custom.style.display = range.value === "custom" ? "block" : "none";
                saveNow();
            });
        }

        var mode = qForm("adr044-inject-mode");
        if (mode && !mode.__adr044Bound) {
            mode.__adr044Bound = true;
            mode.addEventListener("change", function () {
                save("injectMode", mode.value || "visible");
                saveNow();
            });
        }

        var showFab = qForm("adr044-show-floating-window");
        if (showFab && !showFab.__adr044Bound) {
            showFab.__adr044Bound = true;
            showFab.addEventListener("change", function () {
                save("showFloatingWindow", !!showFab.checked);
                saveNow();
                if (showFab.checked) adr048EnsureFabLater();
                else adr048RemoveFab();
            });
        }

        ["emotion", "plot"].forEach(function (type) {
            var modelSelect = qForm("adr044-" + type + "-model-select");
            if (modelSelect && !modelSelect.__adr044Bound) {
                modelSelect.__adr044Bound = true;
                modelSelect.addEventListener("change", function () {
                    var modelInput = qForm("adr044-" + type + "-model");
                    if (modelInput) modelInput.value = modelSelect.value;
                    save(field(type, "model"), modelSelect.value || "");
                    saveNow();
                    status(type, "已选择模型：" + (modelSelect.value || "空"), "#8ed99d");
                });
            }

            var auto = qForm("adr044-auto-inject-" + type);
            if (auto && !auto.__adr044Bound) {
                auto.__adr044Bound = true;
                auto.addEventListener("change", function () {
                    save(type === "plot" ? "autoInjectPlot" : "autoInjectEmotion", !!auto.checked);
                    saveNow();
                });
            }

            var autoTrigger = qForm("adr044-auto-trigger-" + type);
            if (autoTrigger && !autoTrigger.__adr044Bound) {
                autoTrigger.__adr044Bound = true;
                autoTrigger.addEventListener("change", function () {
                    save(type === "plot" ? "autoTriggerPlot" : "autoTriggerEmotion", !!autoTrigger.checked);
                    saveNow();
                    adrDResetAutoTriggerBaseline("toggle-" + type);
                    adrDScheduleAutoTriggerCheck("toggle-" + type);
                });
            }

            var autoRange = qForm("adr044-auto-trigger-range-" + type);
            if (autoRange && !autoRange.__adr044Bound) {
                autoRange.__adr044Bound = true;
                autoRange.addEventListener("change", function () {
                    save(type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange", autoRange.value || (type === "plot" ? "10" : "20"));
                    var custom = qForm("adr044-auto-trigger-custom-" + type);
                    if (custom) custom.style.display = autoRange.value === "custom" ? "block" : "none";
                    saveNow();
                    adrDResetAutoTriggerBaseline("range-" + type);
                    adrDScheduleAutoTriggerCheck("range-" + type);
                });
            }

            var autoCustom = qForm("adr044-auto-trigger-custom-" + type);
            if (autoCustom && !autoCustom.__adr044Bound) {
                autoCustom.__adr044Bound = true;
                autoCustom.addEventListener("input", function () {
                    save(type === "plot" ? "autoTriggerPlotCustomRange" : "autoTriggerEmotionCustomRange", Number(autoCustom.value || 0));
                    saveNow();
                });
                autoCustom.addEventListener("change", function () {
                    adrDResetAutoTriggerBaseline("custom-" + type);
                    adrDScheduleAutoTriggerCheck("custom-" + type);
                });
            }
        });

        var map = {
            "adr044-custom": "customRange",
            "adr044-memory": "supplementMemory"
        };

        ["emotion", "plot"].forEach(function (type) {
            map["adr044-" + type + "-endpoint"] = field(type, "apiEndpoint");
            map["adr044-" + type + "-key"] = field(type, "apiKey");
            map["adr044-" + type + "-model"] = field(type, "model");
            map["adr044-" + type + "-preset"] = field(type, "preset");
            map["adr044-" + type + "-preview"] = field(type, "preview");
        });

        Object.keys(map).forEach(function (id) {
            var el = qForm(id);
            if (!el || el.__adr044InputBound) return;
            el.__adr044InputBound = true;
            el.addEventListener("input", function () {
                if (map[id] === "customRange") save(map[id], Number(el.value || 0));
                else save(map[id], el.value || "");
            });
        });
    }

    function runPrecisePreview() {
        syncAll();
        var out = "";
        out += "【红霞精准读取预览 v1.0.5.6.5.3.2】\n";
        out += "以下内容就是下一次发送给副 API 的主要上下文来源。\n\n";
        out += buildPreciseContext() || "（未读取到角色卡 / 世界书 / user 人设补充）";
        out += "\n\n【最近 " + activeRange() + " 轮正文｜<content>精准读取】\n";
        out += recentContentBlocks(activeRange()) || "（未提取到正文）";
        setPreview(currentType(), out);
        status(currentType(), "精准读取预览完成 ✓", "#8ed99d");
        setButtons(currentType());
    }


    function installProbeGlobals() {
        try {
            var w = rootWin();
            w.ADR044_probeContext = function () {
                try { runContextProbe(); } catch (e) {
                    try { alert("检测上下文失败：" + (e.message || String(e))); } catch (_) {}
                }
            };
            w.ADR044_previewPrecise = function () { try { runPrecisePreview(); } catch (e) { try { alert("预览精准读取失败：" + (e.message || String(e))); } catch (_) {} } };
            w.ADR044_probeContent = function () {
                try { runContentProbe(); } catch (e) {
                    try { alert("测试 content 失败：" + (e.message || String(e))); } catch (_) {}
                }
            };
        } catch (e) {}
    }

    function installProbeDelegation() {
        try {
            var d = rootDoc();
            if (d.__adr044ProbeDelegated) return;
            d.__adr044ProbeDelegated = true;

            function handle(ev) {
                var t = ev.target;
                if (!t) return;

                var hit = null;
                try { hit = t.closest("#adr044-probe-context,#adr044-probe-content"); }
                catch (e) { hit = null; }

                if (!hit) return;

                try { ev.preventDefault(); ev.stopPropagation(); } catch (_) {}

                if (hit.id === "adr044-probe-context") runContextProbe();
                if (hit.id === "adr044-probe-content") runContentProbe();
            }

            d.addEventListener("click", handle, true);
            d.addEventListener("touchend", handle, true);
            d.addEventListener("pointerup", handle, true);
        } catch (e) {}
    }


    function adr048IsPopupOpen() {
        try {
            var p = rootDoc().querySelector("#adr048-popup-panel");
            return !!(p && p.getAttribute("data-open") === "1");
        } catch (e) { return false; }
    }

    function qForm(id) {
        try {
            if (adr048IsPopupOpen()) {
                var p = rootDoc().querySelector("#adr048-popup-panel");
                if (p) {
                    var el = p.querySelector("#" + id);
                    if (el) return el;
                }
            }
        } catch (e) {}

        try {
            var el2 = rootDoc().querySelector("#" + id);
            if (el2) return el2;
        } catch (e2) {}

        try { return document.querySelector("#" + id); } catch (e3) {}
        return null;
    }


    function adr048PageHTML(type) {
        var st = settings();
        var p = prefixOf(type);
        var title = type === "plot" ? "剧情导演" : "情感导演";
        var autoKey = type === "plot" ? "autoInjectPlot" : "autoInjectEmotion";

        return '<div class="adr048-page" id="adr048-page-' + type + '"' + (st.activeTab === type ? '' : ' style="display:none"') + '>'
            + '<div class="adr048-section"><div class="adr048-summary">' + title + '配置</div>'
            + '<label>API 地址</label><input type="text" id="adr044-' + type + '-endpoint" value="' + esc(st[p + "ApiEndpoint"] || "") + '" placeholder="https://openrouter.ai/api/v1">'
            + '<label>API 密钥</label><input type="password" id="adr044-' + type + '-key" value="' + esc(st[p + "ApiKey"] || "") + '" placeholder="sk-...">'
            + '<label>模型</label><input type="text" id="adr044-' + type + '-model" value="' + esc(st[p + "Model"] || "") + '" placeholder="可以手填，或加载模型">'
            + '<select id="adr044-' + type + '-model-select"><option value="' + esc(st[p + "Model"] || "") + '">' + (st[p + "Model"] ? esc(st[p + "Model"]) + "（当前）" : "加载后选择模型") + '</option></select>'
            + '<div class="adr048-actions"><button id="adr044-' + type + '-load-models" type="button">加载模型</button><button id="adr044-' + type + '-save" type="button">保存设置</button></div>'
            + '<label class="adr048-check"><input type="checkbox" id="adr044-auto-inject-' + type + '"' + (st[autoKey] ? " checked" : "") + '> 生成后自动注入当前聊天</label>'
            + '<label class="adr048-check"><input type="checkbox" id="adr044-auto-trigger-' + type + '"' + (st[type === "plot" ? "autoTriggerPlot" : "autoTriggerEmotion"] ? " checked" : "") + '> 启用自动触发</label>'
            + '<label>自动触发间隔</label>'
            + '<select id="adr044-auto-trigger-range-' + type + '">'
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "10", "每 10 个助手正文轮次")
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "20", "每 20 个助手正文轮次")
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "30", "每 30 个助手正文轮次")
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "50", "每 50 个助手正文轮次")
            + opt(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"], "custom", "自定义")
            + '</select>'
            + '<input type="number" id="adr044-auto-trigger-custom-' + type + '" placeholder="自定义自动触发轮次" value="' + esc(st[type === "plot" ? "autoTriggerPlotCustomRange" : "autoTriggerEmotionCustomRange"] || "") + '" style="display:' + (String(st[type === "plot" ? "autoTriggerPlotRange" : "autoTriggerEmotionRange"]) === "custom" ? "block" : "none") + '">'
            + '<div class="adr044-auto-counter" id="adr044-auto-counter-' + type + '">自动触发计数：打开面板后刷新</div>'
            + '</div>'

            + '<div class="adr048-section"><div class="adr048-summary">' + title + '预设</div>'
            + '<div class="adr044-template-compact">'
            + '<select id="adr044-template-select-' + type + '">' + adrDTemplateOptions(type) + '</select>'
            + '<input id="adr044-template-name-' + type + '" placeholder="新模板名 / 当前模板名">'
            + '<div class="adr044-template-mini-actions">'
            + '<button type="button" id="adr044-template-save-' + type + '">保存当前为模板</button>'
            + '<button type="button" id="adr044-template-delete-' + type + '">删除模板</button>'
            + '</div>'
            + '<div class="adr044-template-status" id="adr044-template-status-' + type + '"></div>'
            + '</div>'
            + '<textarea id="adr044-' + type + '-preset" rows="8">' + esc(st[p + "Preset"] || "") + '</textarea>'
            + '</div>'

            + '<div class="adr048-section"><div class="adr048-summary">' + title + '结果</div>'
            + '<div id="adr044-' + type + '-status" class="adr048-status">请先本地测试，或直接生成方向。</div>'
            + '<textarea id="adr044-' + type + '-preview" rows="8" placeholder="生成结果显示在这里">' + esc(st[p + "Preview"] || "") + '</textarea>'
            + '<label>补充指令</label><input type="text" id="adr044-' + type + '-extra" placeholder="只影响本次重新分析">'
            + '<div class="adr048-actions"><button id="adr044-' + type + '-local" type="button">本地测试</button><button id="adr044-' + type + '-generate" type="button">生成方向</button></div>'
            + '<div class="adr048-actions"><button id="adr044-' + type + '-reroll" type="button">重新分析</button><button id="adr044-' + type + '-stop" type="button" disabled>打断</button><button id="adr044-' + type + '-copy" type="button">复制</button></div>'
            + '<div class="adr048-actions"><button id="adr044-' + type + '-inject" type="button">手动注入当前聊天</button></div>'
            + '</div>'
            + '</div>';
    }

    function adr048PanelHTML() {
        var st = settings();

        return '<div id="adr048-popup-panel" data-open="0">'
            + '<div id="adr048-popup-shell">'
            + '<div id="adr048-popup-head">'
            + '<div><b>🎬 Arrebol D 暗河红霞导演系统</b><div id="adr048-popup-sub">灵魂共鸣者Arrebol在线检测</div></div>'
            + '<button type="button" id="adr048-popup-close">×</button>'
            + '</div>'
            + '<div id="adr048-popup-body">'
            + '<div class="adr048-note">暗河红霞 Arrebol D 已就绪。情感/剧情可分别设置自动触发间隔；纯文本标记注入；设置保存改为稳定仓库 arrebol_d_settings_stable_v1，更新插件不再丢 API。</div>'

            + '<div class="adr048-section"><div class="adr048-summary">共享设置</div>'
            + '<label>复盘范围</label><select id="adr044-range">'
            + opt(st.range, "10", "最近 10 轮")
            + opt(st.range, "20", "最近 20 轮")
            + opt(st.range, "30", "最近 30 轮")
            + opt(st.range, "50", "最近 50 轮")
            + opt(st.range, "custom", "自定义")
            + '</select>'
            + '<input type="number" id="adr044-custom" placeholder="自定义轮数" value="' + esc(st.customRange || "") + '" style="display:' + (String(st.range) === "custom" ? "block" : "none") + '">'
            + '<label>角色卡要点 / 世界书 / 当前担心</label>'
            + '<textarea id="adr044-memory" rows="5" placeholder="这里会同时发给情感导演和剧情导演">' + esc(st.supplementMemory || "") + '</textarea>'
            + '<div class="adr048-actions"><button id="adr044-probe-context" type="button">检测上下文</button><button id="adr044-probe-content" type="button">测试 &lt;content&gt; 提取</button></div>'
            + '<div class="adr048-actions"><button id="adr044-preview-precise" type="button">预览精准读取</button></div>'
            + '<label>注入方式</label><select id="adr044-inject-mode">'
            + opt(st.injectMode, "visible", "可见文本注入（直接显示）")
            + opt(st.injectMode, "folded", "纯文本标记注入（推荐外挂正则）")
            + opt(st.injectMode, "hidden", "纯文本标记注入（推荐外挂正则）")
            + '</select>'
            + '<label class="adr048-check"><input type="checkbox" id="adr044-show-floating-window"' + (st.showFloatingWindow ? " checked" : "") + '> 显示小红霞浮窗</label>'
            + '</div>'

            + '<div class="adr048-tabs">'
            + '<button id="adr044-tab-emotion" type="button" class="' + (st.activeTab === "plot" ? "" : "active") + '">情感导演</button>'
            + '<button id="adr044-tab-plot" type="button" class="' + (st.activeTab === "plot" ? "active" : "") + '">剧情导演</button>'
            + '</div>'

            + adr048PageHTML("emotion")
            + adr048PageHTML("plot")
            + '</div>'
            + '</div>'
            + '</div>';
    }


    function adr048CreatePopupPanel() {
        try {
            var d = rootDoc();
            if (!d) return;

            var old = d.querySelector("#adr048-popup-panel");
            if (old) return;

            var wrap = d.createElement("div");
            wrap.innerHTML = adr048PanelHTML();
            var panel = wrap.firstChild;

            (d.body || d.documentElement).appendChild(panel);

            adr048BindPopupPanel();
            bindDirect();
        } catch (e) {
            console.error("[ADR0483] create popup panel failed", e);
        }
    }


    function adr048OpenPopupPanel() {
        try { switchTab(settings().activeTab || "emotion"); adrDRefreshAllFieldsFromSettings(); } catch (eOpenRefresh) {}

        try {
            var d = rootDoc();

            // 每次打开浮窗前重建面板，避免抽屉/浮窗两套 DOM 不同步。
            try {
                var oldPanel = d.querySelector("#adr048-popup-panel");
                if (oldPanel && oldPanel.parentNode) oldPanel.parentNode.removeChild(oldPanel);
            } catch (e0) {}

            adr048CreatePopupPanel();
            setTimeout(adrDBindCompactTemplateControls, 120);
            adrDRefreshAllFieldsFromSettings();

            var p = d.querySelector("#adr048-popup-panel");
            var shell = d.querySelector("#adr048-popup-shell");
            var body = d.querySelector("#adr048-popup-body");

            if (!p || !shell) {
                try { alert("暗河红霞面板壳未创建成功"); } catch (_) {}
                return;
            }

            p.setAttribute("data-open", "1");

            adr048SetImportant(p, "display", "block");
            adr048SetImportant(p, "visibility", "visible");
            adr048SetImportant(p, "opacity", "1");
            adr048SetImportant(p, "pointer-events", "auto");
            adr048SetImportant(p, "position", "fixed");
            adr048SetImportant(p, "left", "0");
            adr048SetImportant(p, "right", "0");
            adr048SetImportant(p, "top", "0");
            adr048SetImportant(p, "bottom", "0");
            adr048SetImportant(p, "width", "100vw");
            adr048SetImportant(p, "height", "100vh");
            adr048SetImportant(p, "z-index", "2147483646");
            adr048SetImportant(p, "background", "rgba(0,0,0,.25)");

            adr048SetImportant(shell, "display", "flex");
            adr048SetImportant(shell, "flex-direction", "column");
            adr048SetImportant(shell, "visibility", "visible");
            adr048SetImportant(shell, "opacity", "1");
            adr048SetImportant(shell, "pointer-events", "auto");
            adr048SetImportant(shell, "position", "fixed");
            adr048SetImportant(shell, "left", "10px");
            adr048SetImportant(shell, "right", "10px");
            adr048SetImportant(shell, "top", "64px");
            adr048SetImportant(shell, "bottom", "64px");
            adr048SetImportant(shell, "width", "auto");
            adr048SetImportant(shell, "height", "auto");
            adr048SetImportant(shell, "min-height", "360px");
            adr048SetImportant(shell, "max-height", "calc(100vh - 128px)");
            adr048SetImportant(shell, "z-index", "2147483647");
            adr048SetImportant(shell, "overflow", "hidden");
            adr048SetImportant(shell, "background", "rgba(31,31,35,.98)");
            adr048SetImportant(shell, "color", "#f2f2f2");
            adr048SetImportant(shell, "border", "1px solid rgba(255,255,255,.18)");
            adr048SetImportant(shell, "border-radius", "14px");
            adr048SetImportant(shell, "box-shadow", "0 14px 42px rgba(0,0,0,.48)");

            if (body) {
                adr048SetImportant(body, "display", "block");
                adr048SetImportant(body, "visibility", "visible");
                adr048SetImportant(body, "opacity", "1");
                adr048SetImportant(body, "flex", "1 1 auto");
                adr048SetImportant(body, "overflow", "auto");
                adr048SetImportant(body, "-webkit-overflow-scrolling", "touch");
                adr048SetImportant(body, "padding", "10px 12px 16px");
                adr048SetImportant(body, "min-height", "260px");
            }

            adr048BindPopupPanel();
            bindDirect();

            try { if (body) body.scrollTop = 0; } catch (e1) {}
        } catch (e) {
            console.error("[ADR0483] open popup failed", e);
            try { alert("暗河红霞面板打开失败：" + (e.message || String(e))); } catch (_) {}
        }
    }

    function adr048ClosePopupPanel() {
        try {
            var p = rootDoc().querySelector("#adr048-popup-panel");
            if (!p) return;
            p.setAttribute("data-open", "0");
            adr048SetImportant(p, "display", "none");
            adr048SetImportant(p, "visibility", "hidden");
            adr048SetImportant(p, "opacity", "0");
            adr048SetImportant(p, "pointer-events", "none");
        } catch (e) {}
    }

    function adr048BindPopupPanel() {
        try {
            var d = rootDoc();
            var close = d.querySelector("#adr048-popup-close");
            if (close && !close.__adr048Bound) {
                close.__adr048Bound = true;
                close.addEventListener("click", function (ev) {
                    try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
                    adr048ClosePopupPanel();
                }, true);
                close.addEventListener("touchend", function (ev) {
                    try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
                    adr048ClosePopupPanel();
                }, true);
            }
        } catch (e) {}
    }

    function adr048RemoveOldFloatingBits() {
        try {
            var d = rootDoc();
            var old = d.querySelectorAll("#adr048-fab");
            for (var i = 0; i < old.length; i++) {
                try { old[i].remove(); } catch (e) {}
            }
        } catch (e2) {}
    }

    function adr048SetImportant(el, key, value) {
        try { el.style.setProperty(key, value, "important"); }
        catch(e) { try { el.style[key] = value; } catch(_) {} }
    }



    function adr048RemoveFab() {
        try {
            var d = rootDoc();
            var btn = d.querySelector("#adr048-fab");
            if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
        } catch (e) {}
    }

    function adr048ShouldShowFab() {
        try {
            return settings().showFloatingWindow !== false;
        } catch (e) {
            return true;
        }
    }

    function adr048CreateFab() {
        try {
            var d = rootDoc();
            if (!d) return;

            if (!adr048ShouldShowFab()) {
                adr048RemoveFab();
                return;
            }

            var btn = d.querySelector("#adr048-fab");
            if (!btn) {
                btn = d.createElement("button");
                btn.id = "adr048-fab";
                btn.type = "button";
                btn.textContent = "🎬 红霞";
                btn.title = "Arrebol D 暗河红霞导演系统";

                var dragging = false;
                var moved = false;
                var sx = 0, sy = 0, sl = 0, st = 0;

                function point(ev) {
                    if (ev.touches && ev.touches.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
                    if (ev.changedTouches && ev.changedTouches.length) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
                    return { x: ev.clientX || 0, y: ev.clientY || 0 };
                }

                function imp(k, v) {
                    try { btn.style.setProperty(k, v, "important"); }
                    catch(e) { try { btn.style[k] = v; } catch(_) {} }
                }

                function clamp(l, t) {
                    var win = d.defaultView || window;
                    var rect = btn.getBoundingClientRect();
                    var w = rect.width || 88;
                    var h = rect.height || 42;
                    return {
                        left: Math.max(4, Math.min((win.innerWidth || 360) - w - 4, l)),
                        top: Math.max(4, Math.min((win.innerHeight || 640) - h - 4, t))
                    };
                }

                function startDrag(ev) {
                    var p = point(ev);
                    var r = btn.getBoundingClientRect();
                    dragging = true;
                    moved = false;
                    sx = p.x; sy = p.y; sl = r.left; st = r.top;
                    imp("cursor", "grabbing");
                    try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
                }

                function moveDrag(ev) {
                    if (!dragging) return;
                    var p = point(ev);
                    var dx = p.x - sx;
                    var dy = p.y - sy;
                    if (Math.abs(dx) + Math.abs(dy) > 10) moved = true;
                    var pos = clamp(sl + dx, st + dy);
                    imp("left", pos.left + "px");
                    imp("top", pos.top + "px");
                    imp("right", "auto");
                    imp("bottom", "auto");
                    btn.setAttribute("data-user-moved", "1");
                    try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
                }

                function endDrag(ev) {
                    if (!dragging) return;
                    dragging = false;
                    imp("cursor", "grab");

                    // 移动端没有可靠 click，所以轻点在 touchend/mouseup 打开；
                    // 但只要移动超过阈值，就认定为拖动，绝不打开。
                    if (!moved) {
                        setTimeout(function () {
                            try { adr048OpenPopupPanel(); } catch (e) { console.error(e); }
                        }, 30);
                    }

                    try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
                }

                btn.addEventListener("mousedown", startDrag, { passive: false });
                btn.addEventListener("touchstart", startDrag, { passive: false });
                d.addEventListener("mousemove", moveDrag, { passive: false });
                d.addEventListener("mouseup", endDrag, { passive: false });
                d.addEventListener("touchmove", moveDrag, { passive: false });
                d.addEventListener("touchend", endDrag, { passive: false });
                d.addEventListener("touchcancel", endDrag, { passive: false });

                (d.body || d.documentElement).appendChild(btn);
            }

            function setImp(k, v) {
                try { btn.style.setProperty(k, v, "important"); }
                catch(e) { try { btn.style[k] = v; } catch(_) {} }
            }

            // 关键：优先贴着已经成功显示的 IPE 浮窗。
            var ipe = null;
            try { ipe = d.querySelector("#ipe-chat-quick-entry"); } catch (e0) {}

            setImp("position", "fixed");
            setImp("z-index", "2147483647");
            setImp("display", "inline-flex");
            setImp("align-items", "center");
            setImp("justify-content", "center");
            setImp("height", "34px");
            setImp("min-height", "34px");
            setImp("min-width", "88px");
            setImp("padding", "0 11px");
            setImp("border-radius", "999px");
            setImp("border", "1px solid rgba(255,255,255,.32)");
            setImp("background", "linear-gradient(135deg, rgba(214,122,106,.98), rgba(166,84,114,.98))");
            setImp("color", "#ffffff");
            setImp("font-size", "13px");
            setImp("font-weight", "800");
            setImp("line-height", "1");
            setImp("box-shadow", "0 8px 22px rgba(0,0,0,.35)");
            setImp("cursor", "grab");
            setImp("pointer-events", "auto");
            setImp("user-select", "none");
            setImp("-webkit-user-select", "none");
            setImp("touch-action", "none");
            setImp("white-space", "nowrap");
            setImp("visibility", "visible");
            setImp("opacity", "1");
            setImp("transform", "translateZ(0)");

            if (ipe && btn.getAttribute("data-user-moved") !== "1") {
                try {
                    var r = ipe.getBoundingClientRect();
                    var win = d.defaultView || window;
                    var left = Math.max(4, Math.min((win.innerWidth || 360) - 96, r.left));
                    var top = r.bottom + 8;

                    // 如果 IPE 下方空间不够，就贴到它上方。
                    if (top > (win.innerHeight || 640) - 48) top = Math.max(4, r.top - 44);

                    setImp("left", Math.round(left) + "px");
                    setImp("top", Math.round(top) + "px");
                    setImp("right", "auto");
                    setImp("bottom", "auto");
                    btn.setAttribute("data-anchor", "ipe");
                } catch(e1) {}
            } else if (btn.getAttribute("data-user-moved") !== "1") {
                setImp("right", "12px");
                setImp("bottom", "148px");
                setImp("left", "auto");
                setImp("top", "auto");
                btn.setAttribute("data-anchor", "fallback");
            }

            // 点击兜底：如果拖拽事件没触发，普通 click 也能打开。
            if (!btn.__adr048ClickBound) {
                btn.__adr048ClickBound = true;

                function hardOpen(ev) {
                    try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
                    setTimeout(function () {
                        try { adr048OpenPopupPanel(); } catch (e2) { console.error(e2); }
                    }, 20);
                    return false;
                }

                // 桌面 click 兜底；移动端主要走 endDrag 的轻点判断。
                btn.onclick = hardOpen;
                btn.addEventListener("click", hardOpen, true);
            }
        } catch (e2) {
            console.error("[ADR0481] create anchored fab failed", e2);
        }
    }

    function adr048EnsureFabLater() {
        adr048CreatePopupPanel();
            setTimeout(adrDBindCompactTemplateControls, 120);
        if (!adr048ShouldShowFab()) {
            adr048RemoveFab();
            return;
        }
        adr048CreateFab();
        setTimeout(adr048CreateFab, 400);
        setTimeout(adr048CreateFab, 900);
        setTimeout(adr048CreateFab, 1600);
        setTimeout(adr048CreateFab, 2600);
        setTimeout(adr048CreateFab, 4200);

        try {
            var w = rootWin();
            if (!w.__adr0481AnchorTimer) {
                w.__adr0481AnchorTimer = setInterval(function () {
                    try { adr048CreateFab(); } catch (e) {}
                }, 2500);
            }
        } catch (e2) {}
    }



    var adrDAutoTriggerTimer = null;
    var adrDLastChatLengthSeen = -1;
    var adrDAutoTriggerRunning = false;

    function adrDChatKey() {
        try {
            var c = ctx();
            if (typeof c.getCurrentChatId === "function") {
                var x = c.getCurrentChatId();
                if (x) return String(x);
            }
            if (c.chatId) return String(c.chatId);
            return String(c.characterId || "char") + "::" + String(c.name1 || "chat");
        } catch (e) {
            return "unknown-chat";
        }
    }


    function adrDIsUnstableChatKey(key) {
        var k = String(key || "");
        if (!k) return true;
        if (k === "unknown-chat") return true;
        if (k === "char::chat") return true;
        if (k.indexOf("undefined") >= 0) return true;
        if (k.indexOf("null") >= 0) return true;
        return false;
    }

    function adrDAssistantRoundCount() {
        var chat;
        try { chat = ctx().chat; } catch (e) { return 0; }
        if (!chat || !chat.length) return 0;

        var n = 0;
        for (var i = 0; i < chat.length; i++) {
            var m = chat[i];
            if (!m || m.is_system || m.is_user) continue;
            var text = cleanMessage(m.mes || "");
            if (!text.trim()) continue;
            n++;
        }
        return n;
    }


    function adrDSetCounterText(type, text) {
        try {
            var d = rootDoc();
            var id = "adr044-auto-counter-" + type;
            var nodes = Array.prototype.slice.call(d.querySelectorAll("#" + id));
            nodes.forEach(function (el) {
                if (el) el.textContent = text;
            });
        } catch (e) {}
    }


    var ADR_D_AUTO_STATE_KEY = "arrebol_d_auto_trigger_state_v1";

    function adrDAutoStateAll() {
        try {
            var s = rootWin().localStorage.getItem(ADR_D_AUTO_STATE_KEY) || "{}";
            var obj = JSON.parse(s);
            return obj && typeof obj === "object" ? obj : {};
        } catch (e) {
            return {};
        }
    }

    function adrDSaveAutoStateAll(obj) {
        try {
            rootWin().localStorage.setItem(ADR_D_AUTO_STATE_KEY, JSON.stringify(obj || {}));
        } catch (e) {}
    }

    function adrDAutoStateKey(type) {
        return String(adrDChatKey ? adrDChatKey() : "chat") + "::" + String(type || "emotion");
    }

    function adrDGetAutoState(type, count) {
        var all = adrDAutoStateAll();
        var key = adrDAutoStateKey(type);
        var item = all[key];

        if (!item || typeof item !== "object" || !Number.isFinite(Number(item.base))) {
            item = { base: Number(count) || 0, updatedAt: Date.now() };
            all[key] = item;
            adrDSaveAutoStateAll(all);
        }

        return item;
    }

    function adrDSetAutoBaseline(type, count) {
        var all = adrDAutoStateAll();
        var key = adrDAutoStateKey(type);
        all[key] = { base: Number(count) || 0, updatedAt: Date.now() };
        adrDSaveAutoStateAll(all);
    }

    function adrDAdvanceAutoBaseline(type, count) {
        adrDSetAutoBaseline(type, count);
    }

    function adrDAutoCounterText(type) {
        try {
            var st = settings();
            var enabled = type === "plot" ? !!st.autoTriggerPlot : !!st.autoTriggerEmotion;
            var label = type === "plot" ? "剧情导演" : "情感导演";
            var count = adrDAssistantRoundCount();
            var n = autoTriggerRange(type);

            if (!enabled) {
                return label + "：自动触发未开启｜当前有效角色回复 " + count + " 条";
            }

            if (!Number.isFinite(n) || n <= 0) {
                return label + "：自动触发间隔未设置｜当前有效角色回复 " + count + " 条";
            }

            var state = adrDGetAutoState(type, count);
            var base = Number(state.base);
            if (!Number.isFinite(base) || base < 0 || base > count) {
                base = count;
                adrDSetAutoBaseline(type, count);
            }

            var passed = Math.max(0, count - base);
            var left = Math.max(0, n - passed);
            return label + "：已新增 " + passed + " / " + n + " 条角色回复｜距离下次还差 " + left + " 条｜当前总数 " + count;
        } catch (e) {
            return "自动触发计数：读取失败";
        }
    }

    function adrDUpdateAutoCounters() {
        try {
            adrDSetCounterText("emotion", adrDAutoCounterText("emotion"));
            adrDSetCounterText("plot", adrDAutoCounterText("plot"));
        } catch (e) {}
    }


    function adrDPersistAutoBaselineFields(source) {
        try {
            var st = source || settings();
            var backup = {};
            try { backup = adrDLoadLocalBackup ? (adrDLoadLocalBackup() || {}) : {}; } catch (e0) { backup = {}; }

            [
                "lastAutoTriggerChatKey",
                "lastAutoTriggerEmotionCount",
                "lastAutoTriggerPlotCount",
                "lastAutoTriggerAt",
                "lastAutoTriggerEmotionAt",
                "lastAutoTriggerPlotAt"
            ].forEach(function (k) {
                if (Object.prototype.hasOwnProperty.call(st, k)) backup[k] = st[k];
            });

            adrDSaveLocalBackup(backup);
            return true;
        } catch (e) {
            try { adrDSaveLocalBackup(settings()); } catch (e2) {}
            return false;
        }
    }

    function adrDResetAutoTriggerBaseline(reason) {
        try {
            var st = settings();
            var key = adrDChatKey();
            var count = adrDAssistantRoundCount();

            st.lastAutoTriggerChatKey = key;

            if (!Number.isFinite(Number(st.lastAutoTriggerEmotionCount)) || Number(st.lastAutoTriggerEmotionCount) < 0) {
                st.lastAutoTriggerEmotionCount = count;
                adrDAdvanceAutoBaseline("emotion", count);
            }
            if (!Number.isFinite(Number(st.lastAutoTriggerPlotCount)) || Number(st.lastAutoTriggerPlotCount) < 0) {
                st.lastAutoTriggerPlotCount = count;
                adrDAdvanceAutoBaseline("plot", count);
            }

            saveNow();
            adrDPersistAutoBaselineFields(st);
            adrDUpdateAutoCounters();
            console.log("[Arrebol D] auto trigger baseline", reason, key, count);
        } catch (e) {}
    }

    function adrDScheduleAutoTriggerCheck(reason) {
        try {
            if (adrDAutoTriggerTimer) clearTimeout(adrDAutoTriggerTimer);
            adrDAutoTriggerTimer = setTimeout(function () {
                adrDCheckAutoTrigger(reason || "scheduled");
            }, 4200);
        } catch (e) {}
    }

    async function adrDCheckAutoTrigger(reason) {
        if (adrDAutoTriggerRunning || processing) return;

        try {
            var st = settings();
            if (!st.autoTriggerEmotion && !st.autoTriggerPlot) return;

            var key = adrDChatKey();
            var count = adrDAssistantRoundCount();
            var nEmotion = autoTriggerRange("emotion");
            var nPlot = autoTriggerRange("plot");

            if (st.lastAutoTriggerChatKey !== key) {
                var oldKey = String(st.lastAutoTriggerChatKey || "");

                // v1.0.5.6.5：刷新页面/初始加载时，chat key 可能短暂不稳定。
                // 这种情况只更新显示，不重置基线，避免“已新增”每次刷新归零。
                if (adrDIsUnstableChatKey(key)) {
                    adrDUpdateAutoCounters();
                    return;
                }

                st.lastAutoTriggerChatKey = key;

                var oldWasStable = oldKey && !adrDIsUnstableChatKey(oldKey);
                var emotionBad = !Number.isFinite(Number(st.lastAutoTriggerEmotionCount)) || Number(st.lastAutoTriggerEmotionCount) < 0;
                var plotBad = !Number.isFinite(Number(st.lastAutoTriggerPlotCount)) || Number(st.lastAutoTriggerPlotCount) < 0;

                // 只有真正从一个稳定聊天切到另一个稳定聊天时，才重置基线。
                // 如果只是页面刷新后重新识别到同一聊天，保留原基线。
                if (oldWasStable && oldKey !== key) {
                    st.lastAutoTriggerEmotionCount = count;
                adrDAdvanceAutoBaseline("emotion", count);
                    st.lastAutoTriggerPlotCount = count;
                adrDAdvanceAutoBaseline("plot", count);
                    console.log("[Arrebol D] real chat changed, reset auto trigger baseline", oldKey, "=>", key, count);
                } else {
                    if (emotionBad) st.lastAutoTriggerEmotionCount = count;
                    if (plotBad) st.lastAutoTriggerPlotCount = count;
                    console.log("[Arrebol D] chat key restored without baseline reset", key, count);
                }

                saveNow();
                adrDPersistAutoBaselineFields(st);
                adrDUpdateAutoCounters();
                return;
            }

            if (!Number.isFinite(Number(st.lastAutoTriggerEmotionCount)) || Number(st.lastAutoTriggerEmotionCount) < 0) {
                st.lastAutoTriggerEmotionCount = count;
                adrDAdvanceAutoBaseline("emotion", count);
            }
            if (!Number.isFinite(Number(st.lastAutoTriggerPlotCount)) || Number(st.lastAutoTriggerPlotCount) < 0) {
                st.lastAutoTriggerPlotCount = count;
                adrDAdvanceAutoBaseline("plot", count);
            }

            var toRun = [];

            if (st.autoTriggerEmotion && nEmotion > 0 && count - Number(st.lastAutoTriggerEmotionCount) >= nEmotion) {
                toRun.push({ type: "emotion", n: nEmotion });
                st.lastAutoTriggerEmotionCount = count;
                adrDAdvanceAutoBaseline("emotion", count);
            }

            if (st.autoTriggerPlot && nPlot > 0 && count - Number(st.lastAutoTriggerPlotCount) >= nPlot) {
                toRun.push({ type: "plot", n: nPlot });
                st.lastAutoTriggerPlotCount = count;
                adrDAdvanceAutoBaseline("plot", count);
            }

            saveNow();
            adrDPersistAutoBaselineFields(st);
            adrDUpdateAutoCounters();

            if (!toRun.length) return;

            adrDAutoTriggerRunning = true;
            for (var i = 0; i < toRun.length; i++) {
                var item = toRun[i];
                var type = item.type;
                var n = item.n;
                var extra = "自动触发：已新增约 " + n + " 个助手正文轮次。请基于当前精准读取上下文输出下一阶段方向。";
                console.log("[Arrebol D] auto triggering", type, "reason=", reason, "count=", count, "N=", n);
                await run(type, extra);
            }
        } catch (e) {
            console.error("[Arrebol D] auto trigger check failed", e);
        }

        adrDAutoTriggerRunning = false;
    }

    function adrDInstallAutoTriggerWatchers() {
        try {
            var c = ctx();
            var es = c.eventSource;
            var types = c.event_types || c.eventTypes || {};

            function on(name) {
                try {
                    var ev = types[name];
                    if (es && ev && typeof es.on === "function") {
                        es.on(ev, function () { adrDScheduleAutoTriggerCheck(name); });
                    }
                } catch (e) {}
            }

            ["MESSAGE_RECEIVED", "MESSAGE_SENT", "GENERATION_ENDED", "CHAT_CHANGED", "CHAT_LOADED"].forEach(on);
        } catch (e) {}

        try {
            if (!rootWin().__arrebolDAutoTriggerPoll) {
                rootWin().__arrebolDAutoTriggerPoll = setInterval(function () {
                    try {
                        var chat = ctx().chat || [];
                        var len = chat.length || 0;
                        if (adrDLastChatLengthSeen >= 0 && len !== adrDLastChatLengthSeen) {
                            adrDScheduleAutoTriggerCheck("poll-chat-length");
                        }
                        adrDLastChatLengthSeen = len;
                        adrDUpdateAutoCounters();
                    } catch (e) {}
                }, 9000);
            }
        } catch (e2) {}

        // v1.0.5.6.5：页面刷新/插件重新挂载时不主动重置自动触发基线。
        // 基线只在开关/间隔改变或真正切换聊天时重置。
        setTimeout(adrDUpdateAutoCounters, 1200);
    }


    function adrDInstallTabFallbackOnly() {
        try {
            if (rootWin().__adrDTabFallbackOnlyInstalled) return;
            rootWin().__adrDTabFallbackOnlyInstalled = true;

            function handle(ev) {
                try {
                    var t = ev.target;
                    while (t && t !== rootDoc()) {
                        if (t.id === "adr044-tab-emotion" || t.id === "adr044-tab-plot") {
                            ev.preventDefault();
                            ev.stopPropagation();
                            switchTab(t.id === "adr044-tab-plot" ? "plot" : "emotion");
                            return false;
                        }
                        t = t.parentNode;
                    }
                } catch (e) {}
            }

            rootDoc().addEventListener("click", handle, true);
            rootDoc().addEventListener("touchend", handle, true);
        } catch (e2) {
            console.warn("[Arrebol D] install tab fallback failed", e2);
        }
    }


    function adrDTypeFromButtonId(id) {
        if (!id) return settings().activeTab || "emotion";
        if (id.indexOf("adr044-plot-") === 0 || id.indexOf("-plot") >= 0) return "plot";
        if (id.indexOf("adr044-emotion-") === 0 || id.indexOf("-emotion") >= 0) return "emotion";
        return settings().activeTab || "emotion";
    }

    function adrDHandleAnyButtonId(id) {
        try {
            if (!id || id.indexOf("adr044-") !== 0) return false;

            // tab 已由 tab fallback 处理，这里也兜底一次。
            if (id === "adr044-tab-emotion") {
                switchTab("emotion");
                return true;
            }
            if (id === "adr044-tab-plot") {
                switchTab("plot");
                return true;
            }

            if (id === "adr044-probe-context") {
                runContextProbe();
                return true;
            }
            if (id === "adr044-probe-content") {
                runContentProbe();
                return true;
            }
            if (id === "adr044-preview-precise") {
                runPrecisePreview();
                return true;
            }

            var type = adrDTypeFromButtonId(id);

            if (id === "adr044-" + type + "-local") {
                localTest(type);
                return true;
            }

            if (id === "adr044-" + type + "-generate") {
                syncAll();
                run(type, "");
                return true;
            }

            if (id === "adr044-" + type + "-reroll") {
                syncType(type);
                var extra = qForm("adr044-" + type + "-extra");
                run(type, extra ? extra.value : "");
                return true;
            }

            if (id === "adr044-" + type + "-stop") {
                abortRun(type);
                return true;
            }

            if (id === "adr044-" + type + "-copy") {
                copyText(type);
                return true;
            }

            if (id === "adr044-" + type + "-load-models") {
                syncType(type);
                loadModels(type);
                return true;
            }

            if (id === "adr044-" + type + "-save") {
                adrDForceSaveSettings(type);
                status(type, "设置已保存 ✓", "#8ed99d");
                return true;
            }

            if (id === "adr044-" + type + "-inject") {
                syncType(type);
                var pv = qForm("adr044-" + type + "-preview");
                var text = pv ? pv.value : "";
                if (!text) {
                    status(type, "没有内容可注入", "#d4726a");
                    return true;
                }
                var ok = injectDirector(type, text);
                status(type, ok ? "已注入当前聊天 ✓" : "注入失败", ok ? "#8ed99d" : "#d4726a");
                return true;
            }
        } catch (e) {
            console.error("[Arrebol D] all-button fallback failed", e);
            try {
                var t2 = id && id.indexOf("plot") >= 0 ? "plot" : "emotion";
                status(t2, "按钮执行失败：" + (e.message || e), "#d4726a");
            } catch (e2) {}
            return true;
        }

        return false;
    }

    function adrDInstallAllButtonFallback() {
        try {
            if (rootWin().__adrDAllButtonFallbackInstalled) return;
            rootWin().__adrDAllButtonFallbackInstalled = true;

            function handle(ev) {
                try {
                    var t = ev.target;
                    while (t && t !== rootDoc()) {
                        if (t.id && t.id.indexOf("adr044-") === 0) {
                            var tag = String(t.tagName || "").toLowerCase();
                            // 输入框/选择框不拦截，否则会影响输入。
                            if (tag === "input" || tag === "textarea" || tag === "select" || tag === "option") return;

                            var ok = adrDHandleAnyButtonId(t.id);
                            if (ok) {
                                ev.preventDefault();
                                ev.stopPropagation();
                                return false;
                            }
                        }
                        t = t.parentNode;
                    }
                } catch (e) {
                    console.warn("[Arrebol D] all-button fallback listener failed", e);
                }
            }

            rootDoc().addEventListener("click", handle, true);
            rootDoc().addEventListener("touchend", handle, true);
        } catch (e2) {
            console.warn("[Arrebol D] install all-button fallback failed", e2);
        }
    }

    function init() {
        if (initialized) return;
        initialized = true;

        try {
            settings();
            mountDrawer();
            installProbeGlobals();
            installProbeDelegation();
            bindDirect();
            adrDBindCompactTemplateControls();
            adrDInstallTabFallbackOnly();
            adrDInstallAllButtonFallback();
            switchTab(settings().activeTab || "emotion");
            adr048CreatePopupPanel();
            setTimeout(adrDBindCompactTemplateControls, 120);
            adr048EnsureFabLater();
            adrDInstallAutoTriggerWatchers();
            adrDUpdateAutoCounters();
            setTimeout(adrDUpdateAutoCounters, 800);
            setTimeout(bindDirect, 500);
            setTimeout(adrDBindCompactTemplateControls, 650);
            setTimeout(bindDirect, 1500);
            setTimeout(bindDirect, 3000);
            console.log("[ADR044] dual drawer loaded");
        } catch (e) {
            console.error("[ADR044] init failed", e);
        }
    }

    function wait() {
        if (typeof SillyTavern === "undefined" || !SillyTavern.getContext) {
            setTimeout(wait, 300);
            return;
        }

        try {
            var c = SillyTavern.getContext();
            if (c.eventSource && c.event_types && c.event_types.APP_READY) {
                c.eventSource.on(c.event_types.APP_READY, function () {
                    setTimeout(init, 100);
                });
            }
            setTimeout(init, 1800);
        } catch (e) {
            setTimeout(init, 1200);
        }
    }

    wait();
})();
