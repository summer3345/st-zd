/**
 * Claude Review - AI场外复盘指导插件
 * 
 * 功能：每N轮对话后，调用Claude API进行场外复盘，
 * 将指导内容注入世界书或作为宏变量使用。
 */

// ==================== 模块导入 ====================
import { renderExtensionTemplateAsync } from '../../../../script.js';

// ==================== 常量定义 ====================
const MODULE_NAME = 'claude_review';
const REVIEW_ENTRY_UID = 999999001; // 世界书条目固定UID

const defaultSettings = Object.freeze({
    enabled: true,
    // API设置
    apiBaseUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: 'claude-3-5-sonnet-20241022',
    customModel: '',
    maxTokens: 2048,
    temperature: 0.7,

    // 触发设置
    triggerInterval: 20,           // 轮次间隔
    includeUserMessages: true,     // 是否包含用户消息
    contextRounds: 10,             // 复盘时取最近N轮
    autoTrigger: true,             // 自动触发
    manualTriggerOnly: false,      // 仅手动触发

    // 提示词设置
    systemPrompt: `你是一位专业的RP（角色扮演）场外指导。请基于提供的最近对话内容，分析角色扮演的表现，并给出指导建议。

你的任务：
1. 分析角色行为是否过于激进、OOC（脱离角色）或缺乏深度
2. 指出对话中的亮点和不足
3. 给出3-5条具体的改进建议
4. 总结当前剧情走向和角色关系状态

请以第三人称、专业但友善的语气撰写。输出格式：
【行为分析】...
【剧情评估】...
【改进建议】...
【关系状态】...`,

    userPromptTemplate: `请复盘以下最近{contextRounds}轮对话：

角色名称：{charName}
用户名称：{userName}
当前轮次：{currentTurn}

对话内容：
{chatHistory}

请给出专业的复盘指导。`,

    // 输出设置
    outputMode: 'world_info',      // 'world_info' | 'macro' | 'both'
    worldInfoBook: '',             // 目标世界书名称
    worldInfoEntryName: 'Claude复盘指导',
    worldInfoPosition: 0,          // @Depth 0
    worldInfoOrder: 100,
    worldInfoConstant: true,
    macroName: 'claude_review',

    // 高级设置
    showNotification: true,
    injectAsSystemMessage: false,  // 是否作为系统消息插入聊天
    reviewLockRP: true,            // 复盘时是否暂停RP
    debugMode: false,
});

// ==================== 状态管理 ====================
let settings = {};
let turnCounter = 0;
let isReviewing = false;
let lastReviewContent = '';
let reviewHistory = []; // 存储历史复盘

// ==================== 工具函数 ====================
function log(...args) {
    console.log(`[${MODULE_NAME}]`, ...args);
}

function debug(...args) {
    if (settings.debugMode) {
        console.debug(`[${MODULE_NAME}]`, ...args);
    }
}

function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    // 合并默认值（处理更新后新增字段）
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(context.extensionSettings[MODULE_NAME], key)) {
            context.extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    return context.extensionSettings[MODULE_NAME];
}

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

// ==================== 聊天数据处理 ====================
function getRecentChatHistory(rounds) {
    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    const charName = context.characters[context.characterId]?.name || '角色';
    const userName = context.name1 || '用户';

    // 过滤出AI和用户的对话（排除系统消息）
    const messages = chat.filter(m => !m.is_system && !m.extra?.type === 'system');

    // 取最近N轮
    const recentMessages = messages.slice(-rounds * 2);

    let history = '';
    recentMessages.forEach((msg, idx) => {
        const name = msg.is_user ? userName : (msg.name || charName);
        const content = msg.mes || '';
        history += `[${name}]: ${content}\n\n`;
    });

    return { history, charName, userName, currentTurn: messages.length };
}

// ==================== Claude API调用 ====================
async function callClaudeAPI(systemPrompt, userPrompt) {
    const model = settings.customModel || settings.model;
    const apiKey = settings.apiKey?.trim();

    if (!apiKey) {
        throw new Error('API Key未设置，请在插件设置中配置');
    }

    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/v1/messages`;

    const body = {
        model: model,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        system: systemPrompt,
        messages: [
            { role: 'user', content: userPrompt }
        ]
    };

    debug('调用Claude API:', { url, model, body });

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API请求失败 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || data.completion || '';
}

// ==================== 世界书操作 ====================
async function getWorldInfoData() {
    try {
        const response = await fetch('/api/worldinfo/get');
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        debug('获取世界书数据失败:', e);
        return null;
    }
}

async function updateWorldInfoEntry(content) {
    const targetBook = settings.worldInfoBook?.trim();

    // 如果没有指定世界书，使用默认世界书
    const worldInfoData = await getWorldInfoData();
    if (!worldInfoData) {
        throw new Error('无法获取世界书数据');
    }

    // 找到目标世界书
    let targetBookName = targetBook;
    if (!targetBookName) {
        // 使用当前激活的世界书，或第一个世界书
        const books = Object.keys(worldInfoData);
        if (books.length === 0) {
            throw new Error('没有可用的世界书，请先创建一本世界书');
        }
        targetBookName = books[0];
    }

    const book = worldInfoData[targetBookName];
    if (!book) {
        throw new Error(`未找到世界书: ${targetBookName}`);
    }

    // 查找或创建复盘条目
    let entry = book.entries?.find(e => e.uid === REVIEW_ENTRY_UID);

    if (!entry) {
        entry = {
            uid: REVIEW_ENTRY_UID,
            comment: settings.worldInfoEntryName,
            key: ['复盘', 'review', '指导'],
            keysecondary: [],
            content: content,
            position: settings.worldInfoPosition,
            order: settings.worldInfoOrder,
            constant: settings.worldInfoConstant,
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            displayIndex: 0,
            excludeRecursion: false,
            preventRecursion: false,
            delayUntilRecursion: false,
            probability: 100,
            useProbability: true,
            depth: settings.worldInfoPosition,
            group: '',
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            automationId: '',
            role: 0, // system role
            sticky: 0,
            cooldown: 0,
            delay: 0,
        };
        if (!book.entries) book.entries = [];
        book.entries.push(entry);
    } else {
        entry.content = content;
        entry.comment = settings.worldInfoEntryName;
        entry.position = settings.worldInfoPosition;
        entry.order = settings.worldInfoOrder;
        entry.constant = settings.worldInfoConstant;
        entry.depth = settings.worldInfoPosition;
    }

    // 保存世界书
    const response = await fetch('/api/worldinfo/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: targetBookName,
            entries: book.entries,
        }),
    });

    if (!response.ok) {
        throw new Error('保存世界书失败');
    }

    // 触发世界书更新事件
    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.emit(event_types.WORLDINFO_UPDATED);

    return targetBookName;
}

// ==================== 宏变量 ====================
function registerReviewMacro() {
    const { macros } = SillyTavern.getContext();

    macros.register(settings.macroName, {
        description: 'Claude复盘指导内容',
        category: macros.category.UTILITY,
        handler: () => {
            return lastReviewContent || '（暂无复盘内容）';
        },
    });

    log('宏变量已注册:', `{{${settings.macroName}}}`);
}

function unregisterReviewMacro() {
    try {
        const { macros } = SillyTavern.getContext();
        macros.registry.unregisterMacro(settings.macroName);
    } catch (e) {
        debug('注销宏失败:', e);
    }
}

// ==================== 核心复盘逻辑 ====================
async function performReview(force = false) {
    if (isReviewing) {
        log('复盘正在进行中，跳过');
        return;
    }

    if (!settings.enabled) {
        log('插件已禁用');
        return;
    }

    if (!force && settings.manualTriggerOnly) {
        log('仅手动触发模式，跳过自动复盘');
        return;
    }

    isReviewing = true;
    const { loader, toastr } = SillyTavern.getContext();

    let loaderHandle = null;

    try {
        if (settings.showNotification) {
            loaderHandle = loader.show({
                message: 'Claude正在进行场外复盘...',
                blocking: settings.reviewLockRP,
                toastMode: 'stoppable',
            });
        }

        // 获取对话历史
        const { history, charName, userName, currentTurn } = getRecentChatHistory(settings.contextRounds);

        if (!history.trim()) {
            log('没有足够的历史对话用于复盘');
            return;
        }

        // 构建提示词
        const userPrompt = settings.userPromptTemplate
            .replace(/{contextRounds}/g, settings.contextRounds)
            .replace(/{charName}/g, charName)
            .replace(/{userName}/g, userName)
            .replace(/{currentTurn}/g, currentTurn)
            .replace(/{chatHistory}/g, history);

        debug('复盘提示词:', { system: settings.systemPrompt, user: userPrompt });

        // 调用Claude
        const reviewContent = await callClaudeAPI(settings.systemPrompt, userPrompt);

        if (!reviewContent.trim()) {
            throw new Error('Claude返回空内容');
        }

        lastReviewContent = reviewContent;

        // 保存到历史
        reviewHistory.push({
            turn: currentTurn,
            timestamp: Date.now(),
            content: reviewContent,
        });

        // 限制历史记录数量
        if (reviewHistory.length > 50) {
            reviewHistory = reviewHistory.slice(-50);
        }

        // 输出到世界书
        if (settings.outputMode === 'world_info' || settings.outputMode === 'both') {
            try {
                const bookName = await updateWorldInfoEntry(reviewContent);
                log(`复盘已写入世界书: ${bookName}`);
                if (settings.showNotification) {
                    toastr.success(`复盘已更新至世界书「${bookName}」`);
                }
            } catch (e) {
                log('写入世界书失败:', e);
                if (settings.showNotification) {
                    toastr.warning(`世界书写入失败: ${e.message}`);
                }
            }
        }

        // 输出到宏变量
        if (settings.outputMode === 'macro' || settings.outputMode === 'both') {
            registerReviewMacro();
            log(`复盘已更新至宏变量: {{${settings.macroName}}}`);
        }

        // 作为系统消息插入（可选）
        if (settings.injectAsSystemMessage) {
            const context = SillyTavern.getContext();
            context.chat.push({
                is_user: false,
                is_system: true,
                name: 'Claude Review',
                mes: `📋 **场外复盘指导**（第${currentTurn}轮）\n\n${reviewContent}`,
                send_date: Date.now(),
                extra: {
                    type: 'system',
                    model: 'claude-review',
                },
            });
            context.saveChat();
        }

        // 显示完成通知
        if (settings.showNotification && !settings.injectAsSystemMessage) {
            toastr.success(`第${currentTurn}轮复盘完成`);
        }

        // 重置计数器
        turnCounter = 0;

    } catch (error) {
        log('复盘失败:', error);
        if (settings.showNotification) {
            toastr.error(`复盘失败: ${error.message}`);
        }
    } finally {
        isReviewing = false;
        if (loaderHandle) {
            await loaderHandle.hide();
        }
    }
}

// ==================== 事件处理 ====================
function onMessageReceived(data) {
    if (!settings.enabled || settings.manualTriggerOnly) return;
    if (isReviewing) return;

    const context = SillyTavern.getContext();
    const message = context.chat[data];

    // 只统计AI消息（角色回复）
    if (message && !message.is_user && !message.is_system) {
        turnCounter++;
        debug(`AI回复计数: ${turnCounter}/${settings.triggerInterval}`);

        if (turnCounter >= settings.triggerInterval) {
            log(`达到触发轮次 (${turnCounter}/${settings.triggerInterval})，开始复盘`);
            // 延迟一点执行，避免阻塞当前消息渲染
            setTimeout(() => performReview(), 500);
        }
    }
}

function onChatChanged() {
    // 切换聊天时重置计数器
    turnCounter = 0;
    lastReviewContent = '';
    debug('聊天切换，计数器重置');
}

// ==================== UI设置面板 ====================
async function setupSettingsPanel() {
    const context = SillyTavern.getContext();
    const settingsHtml = await renderExtensionTemplateAsync(
        `third-party/${MODULE_NAME}`,
        'settings',
        { MODULE_NAME }
    );

    $('#extensions_settings2').append(settingsHtml);

    // 绑定UI事件
    bindSettingsUI();

    // 加载当前设置到UI
    loadSettingsToUI();
}

function bindSettingsUI() {
    // 启用/禁用
    $(`#${MODULE_NAME}_enabled`).on('change', function() {
        settings.enabled = $(this).prop('checked');
        saveSettings();
    });

    // API设置
    $(`#${MODULE_NAME}_api_key`).on('input', function() {
        settings.apiKey = $(this).val();
        saveSettings();
    });

    $(`#${MODULE_NAME}_api_base`).on('input', function() {
        settings.apiBaseUrl = $(this).val();
        saveSettings();
    });

    $(`#${MODULE_NAME}_model`).on('change', function() {
        settings.model = $(this).val();
        saveSettings();
    });

    $(`#${MODULE_NAME}_custom_model`).on('input', function() {
        settings.customModel = $(this).val();
        saveSettings();
    });

    $(`#${MODULE_NAME}_max_tokens`).on('input', function() {
        settings.maxTokens = parseInt($(this).val()) || 2048;
        saveSettings();
    });

    $(`#${MODULE_NAME}_temperature`).on('input', function() {
        settings.temperature = parseFloat($(this).val()) || 0.7;
        saveSettings();
    });

    // 触发设置
    $(`#${MODULE_NAME}_interval`).on('input', function() {
        settings.triggerInterval = parseInt($(this).val()) || 20;
        saveSettings();
    });

    $(`#${MODULE_NAME}_context_rounds`).on('input', function() {
        settings.contextRounds = parseInt($(this).val()) || 10;
        saveSettings();
    });

    $(`#${MODULE_NAME}_auto_trigger`).on('change', function() {
        settings.autoTrigger = $(this).prop('checked');
        saveSettings();
    });

    $(`#${MODULE_NAME}_manual_only`).on('change', function() {
        settings.manualTriggerOnly = $(this).prop('checked');
        saveSettings();
    });

    // 提示词
    $(`#${MODULE_NAME}_system_prompt`).on('input', function() {
        settings.systemPrompt = $(this).val();
        saveSettings();
    });

    $(`#${MODULE_NAME}_user_prompt`).on('input', function() {
        settings.userPromptTemplate = $(this).val();
        saveSettings();
    });

    // 输出设置
    $(`#${MODULE_NAME}_output_mode`).on('change', function() {
        settings.outputMode = $(this).val();
        updateOutputUI();
        saveSettings();
    });

    $(`#${MODULE_NAME}_wi_book`).on('input', function() {
        settings.worldInfoBook = $(this).val();
        saveSettings();
    });

    $(`#${MODULE_NAME}_wi_entry_name`).on('input', function() {
        settings.worldInfoEntryName = $(this).val();
        saveSettings();
    });

    $(`#${MODULE_NAME}_wi_position`).on('input', function() {
        settings.worldInfoPosition = parseInt($(this).val()) || 0;
        saveSettings();
    });

    $(`#${MODULE_NAME}_macro_name`).on('input', function() {
        // 注销旧宏，注册新宏
        unregisterReviewMacro();
        settings.macroName = $(this).val() || 'claude_review';
        registerReviewMacro();
        saveSettings();
    });

    // 高级设置
    $(`#${MODULE_NAME}_show_notif`).on('change', function() {
        settings.showNotification = $(this).prop('checked');
        saveSettings();
    });

    $(`#${MODULE_NAME}_inject_system`).on('change', function() {
        settings.injectAsSystemMessage = $(this).prop('checked');
        saveSettings();
    });

    $(`#${MODULE_NAME}_lock_rp`).on('change', function() {
        settings.reviewLockRP = $(this).prop('checked');
        saveSettings();
    });

    $(`#${MODULE_NAME}_debug`).on('change', function() {
        settings.debugMode = $(this).prop('checked');
        saveSettings();
    });

    // 手动触发按钮
    $(`#${MODULE_NAME}_manual_review`).on('click', async function() {
        $(this).prop('disabled', true).text('复盘中...');
        await performReview(true);
        $(this).prop('disabled', false).text('立即复盘');
    });

    // 测试API按钮
    $(`#${MODULE_NAME}_test_api`).on('click', async function() {
        $(this).prop('disabled', true).text('测试中...');
        try {
            const result = await callClaudeAPI(
                '你是一个测试助手，请回复"API连接成功"。',
                '测试连接'
            );
            toastr.success(`API测试成功: ${result.substring(0, 50)}...`);
        } catch (e) {
            toastr.error(`API测试失败: ${e.message}`);
        }
        $(this).prop('disabled', false).text('测试API连接');
    });

    // 重置计数器
    $(`#${MODULE_NAME}_reset_counter`).on('click', function() {
        turnCounter = 0;
        toastr.info('计数器已重置');
    });

    // 查看上次复盘
    $(`#${MODULE_NAME}_view_last`).on('click', function() {
        if (!lastReviewContent) {
            toastr.warning('暂无复盘内容');
            return;
        }
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        Popup.show(POPUP_TYPE.DISPLAY, lastReviewContent, {
            title: '上次复盘内容',
            wide: true,
            large: true,
        });
    });
}

function loadSettingsToUI() {
    $(`#${MODULE_NAME}_enabled`).prop('checked', settings.enabled);
    $(`#${MODULE_NAME}_api_key`).val(settings.apiKey || '');
    $(`#${MODULE_NAME}_api_base`).val(settings.apiBaseUrl);
    $(`#${MODULE_NAME}_model`).val(settings.model);
    $(`#${MODULE_NAME}_custom_model`).val(settings.customModel || '');
    $(`#${MODULE_NAME}_max_tokens`).val(settings.maxTokens);
    $(`#${MODULE_NAME}_temperature`).val(settings.temperature);
    $(`#${MODULE_NAME}_interval`).val(settings.triggerInterval);
    $(`#${MODULE_NAME}_context_rounds`).val(settings.contextRounds);
    $(`#${MODULE_NAME}_auto_trigger`).prop('checked', settings.autoTrigger);
    $(`#${MODULE_NAME}_manual_only`).prop('checked', settings.manualTriggerOnly);
    $(`#${MODULE_NAME}_system_prompt`).val(settings.systemPrompt);
    $(`#${MODULE_NAME}_user_prompt`).val(settings.userPromptTemplate);
    $(`#${MODULE_NAME}_output_mode`).val(settings.outputMode);
    $(`#${MODULE_NAME}_wi_book`).val(settings.worldInfoBook || '');
    $(`#${MODULE_NAME}_wi_entry_name`).val(settings.worldInfoEntryName);
    $(`#${MODULE_NAME}_wi_position`).val(settings.worldInfoPosition);
    $(`#${MODULE_NAME}_macro_name`).val(settings.macroName);
    $(`#${MODULE_NAME}_show_notif`).prop('checked', settings.showNotification);
    $(`#${MODULE_NAME}_inject_system`).prop('checked', settings.injectAsSystemMessage);
    $(`#${MODULE_NAME}_lock_rp`).prop('checked', settings.reviewLockRP);
    $(`#${MODULE_NAME}_debug`).prop('checked', settings.debugMode);

    updateOutputUI();
}

function updateOutputUI() {
    const mode = $(`#${MODULE_NAME}_output_mode`).val();
    $(`.${MODULE_NAME}_wi_settings`).toggle(mode === 'world_info' || mode === 'both');
    $(`.${MODULE_NAME}_macro_settings`).toggle(mode === 'macro' || mode === 'both');
}

// ==================== 斜杠命令 ====================
function registerSlashCommands() {
    const { SlashCommandParser, SlashCommand, ARGUMENT_TYPE } = SillyTavern.getContext();

    // /claude-review 手动触发复盘
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'claude-review',
        callback: async () => {
            await performReview(true);
            return '复盘完成';
        },
        aliases: ['cr'],
        returns: '复盘状态',
        helpString: `
            <div>
                手动触发Claude场外复盘。
            </div>
            <div>
                <strong>示例:</strong>
                <ul>
                    <li><pre><code class="language-stscript">/claude-review</code></pre> 立即执行复盘</li>
                </ul>
            </div>
        `,
    }));

    // /claude-review-status 查看状态
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'claude-review-status',
        callback: () => {
            const context = SillyTavern.getContext();
            const chatLen = context.chat?.filter(m => !m.is_user && !m.is_system).length || 0;
            return `当前计数: ${turnCounter}/${settings.triggerInterval} | 聊天AI消息数: ${chatLen} | 状态: ${isReviewing ? '复盘中' : '待机'}`;
        },
        aliases: ['crs'],
        returns: '当前复盘状态',
        helpString: '查看复盘插件的当前状态',
    }));

    // /claude-review-reset 重置计数器
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'claude-review-reset',
        callback: () => {
            turnCounter = 0;
            return '计数器已重置';
        },
        aliases: ['crr'],
        returns: '操作结果',
        helpString: '重置复盘轮次计数器',
    }));
}

// ==================== 生命周期钩子 ====================
export async function onInstall() {
    log('首次安装，初始化设置');
}

export async function onUpdate() {
    log('插件更新');
}

export async function onDelete() {
    log('插件删除，清理数据');
    unregisterReviewMacro();
}

export function onEnable() {
    log('插件已启用');
}

export function onDisable() {
    log('插件已禁用');
    unregisterReviewMacro();
}

export async function onActivate() {
    log('插件激活中...');

    // 加载设置
    settings = getSettings();

    // 注册事件监听
    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // 注册宏
    if (settings.outputMode === 'macro' || settings.outputMode === 'both') {
        registerReviewMacro();
    }

    // 注册斜杠命令
    registerSlashCommands();

    log('插件激活完成');
}

// ==================== 主入口 ====================
jQuery(async () => {
    log('正在加载...');

    // 等待APP_READY
    const { eventSource, event_types } = SillyTavern.getContext();

    const init = async () => {
        settings = getSettings();
        await setupSettingsPanel();
        log('设置面板已加载');
    };

    if (document.readyState === 'complete') {
        await init();
    } else {
        eventSource.on(event_types.APP_READY, init);
    }
});
