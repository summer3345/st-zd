const MODULE_NAME = 'rp_coach';

// ==================== 默认设置 ====================
const defaultSettings = Object.freeze({
    enabled: true,
    // API 配置
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o-mini',
    // 触发配置
    triggerRounds: 20,
    triggerMode: 'auto',       // auto | manual
    // 提示词
    systemPrompt: `你是一位专业的RP（角色扮演）场外指导。请分析以下对话历史，然后：
1. 指出当前角色扮演中存在的问题（如OOC、逻辑矛盾、节奏过快、角色崩坏等）
2. 给出具体的改进建议
3. 提供一段"指导注入文本"，这段文本将被用于在下一轮引导AI角色调整行为

请严格用以下JSON格式输出，不要输出其他内容：
{
    "analysis": "问题分析...",
    "suggestions": "改进建议...",
    "injection": "要注入的指导文本..."
}`,
    // 输出配置
    outputMode: 'macro',      // macro | authorsnote
    macroName: 'rp_coach',
    authorsNotePosition: 1,   // Author's Note深度
    // 状态
    lastTriggerRound: 0,
    totalRounds: 0,
    isProcessing: false,
    lastInjection: ''
});

let settings = null;
let messageListener = null;

// ==================== 设置管理 ====================
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    // 合并默认键（处理更新后新增的配置项）
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    settings = extensionSettings[MODULE_NAME];
    return settings;
}

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

// ==================== 对话历史构建 ====================
function buildChatHistoryForReview(maxMessages = 40) {
    const { chat } = SillyTavern.getContext();
    const recentMessages = chat.slice(-maxMessages);

    let history = '';
    for (const msg of recentMessages) {
        const name = msg.name || (msg.is_user ? 'User' : 'AI');
        const content = msg.mes || '';
        history += `[${name}]: ${content}\n\n`;
    }
    return history.trim();
}

// ==================== 外部API调用 ====================
async function callExternalAPI(systemPrompt, userPrompt) {
    const { apiUrl, apiKey, model } = settings;

    if (!apiUrl) {
        throw new Error('API URL未配置');
    }
    if (!apiKey) {
        throw new Error('API Key未配置');
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 2000,
            response_format: { type: 'json_object' }
        })
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API请求失败 [${response.status}]: ${errorText || response.statusText}`);
    }

    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('API返回格式异常');
    }
    return data.choices[0].message.content;
}

// ==================== 结果解析 ====================
function parseCoachResult(rawJson) {
    try {
        const result = JSON.parse(rawJson);
        return {
            analysis: result.analysis || '无分析内容',
            suggestions: result.suggestions || '无建议内容',
            injection: result.injection || ''
        };
    } catch (e) {
        console.warn(`[${MODULE_NAME}] JSON解析失败，尝试提取文本:`, e);
        // Fallback：直接返回原始文本作为injection
        return {
            analysis: '解析失败（模型未按JSON格式输出）',
            suggestions: rawJson.substring(0, 500),
            injection: rawJson
        };
    }
}

// ==================== 注入方式 ====================
function injectToMacro(injectionText) {
    const { macros } = SillyTavern.getContext();

    // 注销旧宏（忽略错误）
    try {
        macros.registry.unregisterMacro(settings.macroName);
    } catch (e) { /* ignore */ }

    // 注册新宏（handler必须是同步函数）
    macros.register(settings.macroName, {
        description: 'RP Coach场外指导注入内容',
        handler: () => injectionText
    });

    settings.lastInjection = injectionText;
    console.log(`[${MODULE_NAME}] 宏 {{${settings.macroName}}} 已更新 (${injectionText.length}字符)`);
}

function injectToAuthorsNote(injectionText) {
    const { extensionSettings } = SillyTavern.getContext();

    // 使用内置的Author's Note扩展配置
    const anKey = 'authors_note';
    if (!extensionSettings[anKey]) {
        extensionSettings[anKey] = {};
    }

    const anSettings = extensionSettings[anKey];
    anSettings.note = injectionText;
    anSettings.depth = settings.authorsNotePosition;
    anSettings.frequency = 1; // 每轮都插入

    // 确保Author's Note扩展启用（如果UI有开关的话）
    if (typeof anSettings.enabled !== 'undefined') {
        anSettings.enabled = true;
    }

    settings.lastInjection = injectionText;
    saveSettings();

    console.log(`[${MODULE_NAME}] Author's Note已更新 (深度:${settings.authorsNotePosition})`);
}

// ==================== 核心复盘逻辑 ====================
export async function performReview() {
    const { chat } = SillyTavern.getContext();

    if (settings.isProcessing) {
        toastr.warning('RP Coach正在处理中，请稍候...');
        return;
    }

    if (chat.length < 4) {
        toastr.info('对话历史太短（少于4条），暂不需要复盘');
        return;
    }

    settings.isProcessing = true;
    saveSettings();

    const { loader } = SillyTavern.getContext();
    const loadHandle = loader.show({
        message: 'RP Coach正在场外复盘...',
        blocking: true,
        toastMode: 'stoppable'
    });

    try {
        // 1. 构建对话历史
        const chatHistory = buildChatHistoryForReview();

        // 2. 构建用户提示词
        const userPrompt = `请分析以下最近的角色扮演对话历史，给出指导建议：\n\n${chatHistory}`;

        // 3. 调用外部API
        const rawResult = await callExternalAPI(settings.systemPrompt, userPrompt);

        // 4. 解析结果
        const result = parseCoachResult(rawResult);

        // 5. 根据配置注入
        if (settings.outputMode === 'macro') {
            injectToMacro(result.injection);
            toastr.success(`场外指导已注入宏 {{${settings.macroName}}}`);
        } else if (settings.outputMode === 'authorsnote') {
            injectToAuthorsNote(result.injection);
            toastr.success('场外指导已注入Author\'s Note');
        }

        // 6. 记录状态
        settings.lastTriggerRound = chat.length;
        settings.totalRounds++;
        saveSettings();

        // 7. 显示详细结果（在控制台）
        console.log(`[${MODULE_NAME}] ====== 复盘结果 #${settings.totalRounds} ======`);
        console.log(`[${MODULE_NAME}] 分析:`, result.analysis);
        console.log(`[${MODULE_NAME}] 建议:`, result.suggestions);
        console.log(`[${MODULE_NAME}] 注入:`, result.injection.substring(0, 200) + '...');

        // 8. 弹出简要分析
        toastr.info(`分析: ${result.analysis.substring(0, 80)}${result.analysis.length > 80 ? '...' : ''}`, 'RP Coach复盘完成');

    } catch (error) {
        console.error(`[${MODULE_NAME}] 复盘失败:`, error);
        toastr.error(`复盘失败: ${error.message}`, 'RP Coach错误');
    } finally {
        settings.isProcessing = false;
        saveSettings();
        await loadHandle.hide();
    }
}

// ==================== 自动触发监听 ====================
function onMessageReceived(data) {
    if (!settings || !settings.enabled) return;
    if (settings.triggerMode !== 'auto') return;
    if (settings.isProcessing) return;

    const { chat } = SillyTavern.getContext();
    const currentRound = chat.length;
    const roundsSinceLastTrigger = currentRound - settings.lastTriggerRound;

    if (roundsSinceLastTrigger >= settings.triggerRounds) {
        console.log(`[${MODULE_NAME}] 达到触发阈值 (${settings.triggerRounds}轮)，当前${currentRound}轮，开始复盘`);
        performReview();
    }
}

// ==================== 斜杠命令 ====================
function registerSlashCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandNamedArgument, SlashCommandArgument, ARGUMENT_TYPE } = SillyTavern.getContext();

    // /rp_coach - 手动触发
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rp_coach',
        callback: async () => {
            await performReview();
            return 'RP Coach复盘完成';
        },
        returns: '复盘状态文本',
        helpString: '手动触发RP Coach场外复盘',
    }));

    // /rp_coach_status - 查看状态
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rp_coach_status',
        callback: () => {
            const { chat } = SillyTavern.getContext();
            const current = chat.length;
            const nextTrigger = settings.lastTriggerRound + settings.triggerRounds;
            const remain = Math.max(0, nextTrigger - current);
            return `当前${current}轮 | 上次${settings.lastTriggerRound}轮 | 距下次${remain}轮 | 总复盘${settings.totalRounds}次`;
        },
        returns: '状态文本',
        helpString: '查看RP Coach当前状态',
    }));

    // /rp_coach_set - 设置触发轮次
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rp_coach_set',
        callback: (namedArgs, unnamedArgs) => {
            const val = parseInt(unnamedArgs.toString());
            if (isNaN(val) || val < 1) {
                return '错误：请提供有效的正整数轮次，如 /rp_coach_set 20';
            }
            settings.triggerRounds = val;
            saveSettings();
            // 同步更新UI
            const input = document.getElementById('rp_coach_trigger_rounds');
            if (input) input.value = val;
            return `触发轮次已设置为 ${val} 轮`;
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: '触发轮次数（正整数）',
                typeList: ARGUMENT_TYPE.NUMBER,
                isRequired: true,
            }),
        ],
        helpString: '设置自动触发复盘轮次，例如 /rp_coach_set 20',
    }));
}

// ==================== UI构建 ====================
async function buildSettingsUI() {
    const { renderExtensionTemplateAsync } = SillyTavern.getContext();

    try {
        const html = await renderExtensionTemplateAsync(`third-party/${MODULE_NAME}`, 'settings', {});
        $('#extensions_settings2').append(html);
        bindSettingsEvents();
        loadSettingsToUI();
        console.log(`[${MODULE_NAME}] 设置面板已加载`);
    } catch (e) {
        console.error(`[${MODULE_NAME}] 加载设置面板失败:`, e);
        toastr.error('RP Coach设置面板加载失败');
    }
}

function bindSettingsEvents() {
    // 启用开关
    $('#rp_coach_enabled').off('change').on('change', function() {
        settings.enabled = $(this).prop('checked');
        saveSettings();
        toastr.info(settings.enabled ? 'RP Coach已启用' : 'RP Coach已禁用');
    });

    // API URL
    $('#rp_coach_api_url').off('input').on('input', function() {
        settings.apiUrl = $(this).val().trim();
        saveSettings();
    });

    // API Key
    $('#rp_coach_api_key').off('input').on('input', function() {
        settings.apiKey = $(this).val().trim();
        saveSettings();
    });

    // 模型
    $('#rp_coach_model').off('input').on('input', function() {
        settings.model = $(this).val().trim();
        saveSettings();
    });

    // 触发轮次
    $('#rp_coach_trigger_rounds').off('input').on('input', function() {
        const val = parseInt($(this).val());
        if (!isNaN(val) && val >= 1) {
            settings.triggerRounds = val;
            saveSettings();
        }
    });

    // 触发模式
    $('#rp_coach_trigger_mode').off('change').on('change', function() {
        settings.triggerMode = $(this).val();
        saveSettings();
    });

    // 系统提示词
    $('#rp_coach_system_prompt').off('input').on('input', function() {
        settings.systemPrompt = $(this).val();
        saveSettings();
    });

    // 输出模式
    $('#rp_coach_output_mode').off('change').on('change', function() {
        settings.outputMode = $(this).val();
        updateOutputModeUI();
        saveSettings();
    });

    // 宏名称
    $('#rp_coach_macro_name').off('input').on('input', function() {
        settings.macroName = $(this).val().trim() || 'rp_coach';
        saveSettings();
    });

    // Author's Note深度
    $('#rp_coach_an_depth').off('input').on('input', function() {
        const val = parseInt($(this).val());
        if (!isNaN(val) && val >= 0) {
            settings.authorsNotePosition = val;
            saveSettings();
        }
    });

    // 手动触发按钮
    $('#rp_coach_trigger_btn').off('click').on('click', async function() {
        await performReview();
    });

    // 测试连接按钮
    $('#rp_coach_test_api').off('click').on('click', async function() {
        await testApiConnection();
    });

    // 重置统计按钮
    $('#rp_coach_reset_stats').off('click').on('click', function() {
        settings.lastTriggerRound = 0;
        settings.totalRounds = 0;
        saveSettings();
        updateStatsDisplay();
        toastr.success('统计已重置');
    });
}

function loadSettingsToUI() {
    $('#rp_coach_enabled').prop('checked', settings.enabled);
    $('#rp_coach_api_url').val(settings.apiUrl);
    $('#rp_coach_api_key').val(settings.apiKey);
    $('#rp_coach_model').val(settings.model);
    $('#rp_coach_trigger_rounds').val(settings.triggerRounds);
    $('#rp_coach_trigger_mode').val(settings.triggerMode);
    $('#rp_coach_system_prompt').val(settings.systemPrompt);
    $('#rp_coach_output_mode').val(settings.outputMode);
    $('#rp_coach_macro_name').val(settings.macroName);
    $('#rp_coach_an_depth').val(settings.authorsNotePosition);
    updateOutputModeUI();
    updateStatsDisplay();
}

function updateOutputModeUI() {
    const mode = settings.outputMode;
    $('.rp_coach_output_config').hide();
    if (mode === 'macro') $('#rp_coach_macro_config').show();
    if (mode === 'authorsnote') $('#rp_coach_an_config').show();
}

function updateStatsDisplay() {
    const { chat } = SillyTavern.getContext();
    const current = chat?.length || 0;
    const remain = Math.max(0, settings.lastTriggerRound + settings.triggerRounds - current);

    $('#rp_coach_stat_current').text(current);
    $('#rp_coach_stat_last').text(settings.lastTriggerRound);
    $('#rp_coach_stat_next').text(remain);
    $('#rp_coach_stat_total').text(settings.totalRounds);
}

// ==================== API测试 ====================
async function testApiConnection() {
    const { apiUrl, apiKey } = settings;
    if (!apiUrl || !apiKey) {
        toastr.warning('请先填写API URL和API Key');
        return;
    }

    const { loader } = SillyTavern.getContext();
    const handle = loader.show({ message: '测试API连接...', blocking: true });

    try {
        // 尝试调用models列表或发一个简单请求
        const testUrl = apiUrl.replace(/\/chat\/completions$/, '/models');
        const response = await fetch(testUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (response.ok) {
            toastr.success('API连接成功！');
        } else {
            // 如果models端点不可用，尝试发一个最小请求
            const testResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: settings.model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 5
                })
            });
            if (testResponse.ok) {
                toastr.success('API连接成功（通过chat completions测试）！');
            } else {
                const err = await testResponse.text().catch(() => '');
                toastr.error(`连接失败 [${testResponse.status}]: ${err || testResponse.statusText}`);
            }
        }
    } catch (error) {
        toastr.error(`连接错误: ${error.message}`);
    } finally {
        await handle.hide();
    }
}

// ==================== 生命周期钩子 ====================
export function onActivate() {
    console.log(`[${MODULE_NAME}] RP Coach 扩展激活中...`);

    // 同步初始化设置
    getSettings();

    // 注册斜杠命令
    registerSlashCommands();

    // 注册宏（初始状态）
    const { macros } = SillyTavern.getContext();
    try {
        macros.register(settings.macroName, {
            description: 'RP Coach场外指导（等待首次复盘）',
            handler: () => settings.lastInjection || '（暂无场外指导，请等待复盘或手动触发 /rp_coach）'
        });
    } catch (e) {
        console.warn(`[${MODULE_NAME}] 初始宏注册失败（可能已存在）:`, e);
    }

    // 异步加载UI（等待APP_READY）
    const { eventSource, event_types } = SillyTavern.getContext();

    const initUI = async () => {
        await buildSettingsUI();

        // 绑定消息监听
        messageListener = onMessageReceived;
        eventSource.on(event_types.MESSAGE_RECEIVED, messageListener);

        // 定期更新统计显示
        setInterval(updateStatsDisplay, 3000);

        console.log(`[${MODULE_NAME}] RP Coach 初始化完成 | 模式:${settings.outputMode} | 触发:${settings.triggerRounds}轮`);
        toastr.success('RP Coach 场外复盘插件已加载', '扩展就绪');
    };

    if (document.readyState === 'complete') {
        initUI();
    } else {
        eventSource.on(event_types.APP_READY, initUI);
    }
}

export function onDisable() {
    console.log(`[${MODULE_NAME}] RP Coach 扩展禁用中...`);

    const { eventSource, event_types, macros } = SillyTavern.getContext();

    // 移除消息监听
    if (messageListener) {
        eventSource.removeListener(event_types.MESSAGE_RECEIVED, messageListener);
        messageListener = null;
    }

    // 注销宏
    try {
        macros.registry.unregisterMacro(settings.macroName);
    } catch (e) { /* ignore */ }

    toastr.info('RP Coach 已禁用');
}