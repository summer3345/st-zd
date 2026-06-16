
(function() {
    'use strict';

    const EXT_NAME = "ai-guidance";
    const SCRIPT_ID = `extension_${EXT_NAME}`;
    
    const defaultSettings = {
        apiUrl: '',
        apiKey: '',
        model: '',
        autoTrigger: true,         // 默认开启自动触发
        triggerInterval: 10,
        includeCharCard: true,
        includeWorldInfo: true,
        historyCount: 0,
        systemPrompt: `你是一位经验丰富的剧情顾问。你需要分析提供的RP对话片段，进行客观评估并给出纠偏建议。
你的输出必须严格遵循以下格式：
[场外指导]
1. 剧情分析：[当前剧情的问题或节奏分析]
2. 纠偏建议：[要求AI在接下来回复中必须执行的动作或情感调整]
[指导结束]`,
    };

    let settings = { ...defaultSettings };
    let isGeneratingGuidance = false;

    const getContext = () => window.SillyTavern.getContext();
    const eventSource = () => getContext().eventSource;
    const event_types = () => getContext().event_types;

    function loadSettings() {
        const saved = localStorage.getItem(SCRIPT_ID);
        if (saved) {
            settings = { ...defaultSettings, ...JSON.parse(saved) };
        }
        updateUIFromSettings();
    }

    function saveSettings() {
        localStorage.setItem(SCRIPT_ID, JSON.stringify(settings));
    }

    function updateUIFromSettings() {
        $('#guidance-api-url').val(settings.apiUrl);
        $('#guidance-api-key').val(settings.apiKey);
        
        if (settings.model) {
            $('#guidance-model-select').empty().append(new Option(settings.model, settings.model, true, true));
        } else {
            $('#guidance-model-select').empty().append(new Option('请先获取模型', ''));
        }

        $('#guidance-auto-trigger').prop('checked', settings.autoTrigger);
        $('#guidance-interval').val(settings.triggerInterval);
        $('#guidance-include-char').prop('checked', settings.includeCharCard);
        $('#guidance-include-wi').prop('checked', settings.includeWorldInfo);
        $('#guidance-history-count').val(settings.historyCount);
        $('#guidance-system-prompt').val(settings.systemPrompt);
    }

    function createUI() {
        const html = `
        <div id="${SCRIPT_ID}-settings" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🎬 AI场外指导</b>
                <div class="inline-drawer-icon fa-solid fa-circle-down down"></div>
            </div>
            <div class="inline-drawer-content">
                
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>API 配置</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <label>API URL:</label>
                        <input id="guidance-api-url" type="text" class="text_pole" placeholder="https://api.openai.com/v1">
                        <label>API Key:</label>
                        <input id="guidance-api-key" type="password" class="text_pole" placeholder="sk-...">
                        <div style="display: flex; gap: 5px; margin-top: 5px;">
                            <select id="guidance-model-select" class="text_pole" style="flex: 1;"><option value="">请先获取模型</option></select>
                            <button id="guidance-fetch-models-btn" class="menu_button" type="button" title="拉取模型列表"><i class="fa-solid fa-rotate"></i></button>
                        </div>
                    </div>
                </div>

                <div class="inline-drawer" style="margin-top: 10px;">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>触发与上下文</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <label><input id="guidance-auto-trigger" type="checkbox"> 启用自动触发</label>
                        <label>触发间隔 (消息条数):</label>
                        <input id="guidance-interval" type="number" class="text_pole" min="2" step="2">
                        <label>抓取最近聊天条数 (0=全部):</label>
                        <input id="guidance-history-count" type="number" class="text_pole" min="0">
                        <div style="display: flex; gap: 10px; margin-top: 5px;">
                            <label><input id="guidance-include-char" type="checkbox"> 包含角色卡</label>
                            <label><input id="guidance-include-wi" type="checkbox"> 包含世界书</label>
                        </div>
                    </div>
                </div>

                <div class="inline-drawer" style="margin-top: 10px;">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>指导提示词</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <textarea id="guidance-system-prompt" class="text_pole" rows="6"></textarea>
                    </div>
                </div>
                
                <hr>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <button id="guidance-save-btn" class="menu_button" type="button"><i class="fa-solid fa-save"></i> 保存设置</button>
                    <button id="guidance-manual-btn" class="menu_button" type="button" title="无视间隔，立即生成并注入一次指导"><i class="fa-solid fa-play"></i> 手动立即注入</button>
                </div>
                <span id="guidance-status" style="display: block; margin-top: 5px; font-style: italic; color: #888; text-align: center;"></span>
            </div>
        </div>`;
        
        $('#extensions_settings').append(html);
        
        // --- 事件绑定 ---
        $('#guidance-save-btn').on('click', saveAllSettings);
        $('#guidance-manual-btn').on('click', handleManualTrigger);
        $('#guidance-fetch-models-btn').on('click', fetchModels);
    }

    function saveAllSettings() {
        settings.apiUrl = $('#guidance-api-url').val().trim();
        settings.apiKey = $('#guidance-api-key').val().trim();
        settings.model = $('#guidance-model-select').val();
        settings.autoTrigger = $('#guidance-auto-trigger').prop('checked');
        settings.triggerInterval = parseInt($('#guidance-interval').val()) || 10;
        settings.includeCharCard = $('#guidance-include-char').prop('checked');
        settings.includeWorldInfo = $('#guidance-include-wi').prop('checked');
        settings.historyCount = parseInt($('#guidance-history-count').val()) || 0;
        settings.systemPrompt = $('#guidance-system-prompt').val();
        saveSettings();
        toastr.success('场外指导设置已保存');
    }

    // --- 拉取模型列表 ---
    async function fetchModels() {
        const url = $('#guidance-api-url').val().trim();
        const key = $('#guidance-api-key').val().trim();
        if (!url) return toastr.warning('请先输入 API URL');

        $('#guidance-status').text('⏳ 正在拉取模型...');
        let modelsUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        if (!modelsUrl.includes('/models') && !modelsUrl.includes('/v1')) {
            modelsUrl += '/v1/models';
        } else if (modelsUrl.includes('/v1') && !modelsUrl.includes('/models')) {
            modelsUrl += '/models';
        }

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (key) headers['Authorization'] = `Bearer ${key}`;
            const resp = await fetch(modelsUrl, { headers });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            
            const select = $('#guidance-model-select').empty();
            let models = data.data || data;
            if (!Array.isArray(models)) throw new Error('格式不正确');
            
            models.forEach(m => {
                const id = m.id || m;
                select.append(new Option(id, id));
            });
            
            // 如果之前保存过模型，尝试选中
            if (settings.model) select.val(settings.model);
            $('#guidance-status').text('✅ 模型拉取成功');
        } catch (e) {
            console.error(e);
            toastr.error('拉取模型失败: ' + e.message);
            $('#guidance-status').text('❌ 拉取失败');
        }
    }

    // --- 上下文打包 ---
    function buildContext() {
        const context = getContext();
        let promptParts = [];

        if (settings.includeCharCard && context.characters && context.characterId) {
            const char = context.characters[context.characterId];
            if (char) promptParts.push(`【角色设定】\n姓名: ${char.name}\n描述: ${char.description}\n性格: ${char.personality}`);
        }

        if (settings.includeWorldInfo && context.worldInfo) {
            let wiContent = [];
            for (const entry of Object.values(context.worldInfo)) {
                if (entry && entry.enabled && (entry.constant || entry.active)) wiContent.push(entry.content);
            }
            if (wiContent.length > 0) promptParts.push(`【世界书/背景设定】\n${wiContent.join('\n')}`);
        }

        const chat = context.chat;
        let historySlice = chat;
        if (settings.historyCount > 0) historySlice = chat.slice(-settings.historyCount);
        
        const historyText = historySlice.map(msg => {
            const name = msg.is_user ? (context.name1 || '用户') : (msg.name || '角色');
            return `${name}: ${msg.mes}`;
        }).join('\n');
        
        promptParts.push(`【最近的对话记录】\n${historyText}`);
        return promptParts.join('\n\n');
    }

    // --- 调用指导模型 API ---
    async function callGuidanceAPI(userPrompt) {
        if (!settings.apiUrl || !settings.model) {
            toastr.warning('请先配置并保存场外指导的 API 和模型');
            return null;
        }

        let fullUrl = settings.apiUrl.endsWith('/') ? settings.apiUrl.slice(0, -1) : settings.apiUrl;
        if (!fullUrl.includes('/chat/completions')) fullUrl += '/v1/chat/completions';

        const body = {
            model: settings.model,
            messages: [
                { role: "system", content: settings.systemPrompt },
                { role: "user", content: userPrompt }
            ],
            stream: false
        };

        const headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

        try {
            const response = await fetch(fullUrl, { method: 'POST', headers, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const data = await response.json();
            return data.choices[0].message.content.trim();
        } catch (e) {
            console.error("Guidance API failed:", e);
            toastr.error(`场外指导生成失败: ${e.message}`);
            return null;
        }
    }

    // --- 核心逻辑：执行生成与注入 ---
    async function executeGuidanceInjection() {
        if (isGeneratingGuidance) return;
        isGeneratingGuidance = true;
        $('#guidance-status').text('⏳ 正在生成场外指导...');
        
        const contextText = buildContext();
        const userPrompt = `请基于以下信息，对目前的剧情走向和角色情感进行复盘纠偏：\n\n${contextText}`;
        
        const result = await callGuidanceAPI(userPrompt);
        
        if (result) {
            const match = result.match(/\[场外指导\]([\s\S]*?)\[指导结束\]/);
            const guidanceText = match ? match[1].trim() : result.trim();
            
            const context = getContext();
            const guidanceMessage = {
                name: '🎬 场外指导',
                is_system: true,
                is_user: false,
                mes: guidanceText,
                extra: { type: 'guidance_card' } 
            };
            
            context.chat.push(guidanceMessage);
            context.saveChatConditional();
            
            const mesId = context.chat.length - 1;
            context.appendSystemMessage(context.chat[mesId], mesId);
            applyCardStyle(); 
            
            $('#guidance-status').text('✅ 指导已注入，下一轮将自动生效');
        } else {
            $('#guidance-status').text('❌ 生成失败');
        }
        isGeneratingGuidance = false;
    }

    // --- 自动触发逻辑 ---
    async function onMessageReceived() {
        if (!settings.autoTrigger) return; // 未开启自动则跳过
        
        const context = getContext();
        const chatLength = context.chat.length;

        if (chatLength > 0 && chatLength % settings.triggerInterval === 0) {
            await executeGuidanceInjection();
        }
    }

    // --- 手动触发逻辑 ---
    function handleManualTrigger() {
        saveAllSettings(); // 先保存设置
        executeGuidanceInjection();
    }

    // 动态为新增的卡片应用CSS类
    function applyCardStyle() {
        $('#chat .mes').each(function() {
            const nameBlock = $(this).find('.name_text');
            if (nameBlock.text().includes('🎬 场外指导') && !$(this).hasClass('guidance-card')) {
                $(this).addClass('guidance-card');
                const mesBlock = $(this).find('.mes_text');
                const text = mesBlock.text();
                mesBlock.html(`
                    <div class="guidance-card-header">🎬 场外指导指令</div>
                    <div class="guidance-card-content">${text}</div>
                `);
            }
        });
    }

    function onChatChanged() {
        setTimeout(applyCardStyle, 500);
    }

    jQuery(async () => {
        createUI();
        loadSettings();

        eventSource().on(event_types().MESSAGE_RECEIVED, onMessageReceived);
        eventSource().on(event_types().CHAT_CHANGED, onChatChanged);
        
        console.log("AI场外指导插件 v2 已加载");
    });

})();