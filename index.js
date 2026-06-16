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
const REVIEW_ENTRY_UID = 999999001;

const defaultSettings = Object.freeze({
    enabled: true,
    apiBaseUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: 'claude-3-5-sonnet-20241022',
    customModel: '',
    maxTokens: 2048,
    temperature: 0.7,
    triggerInterval: 20,
    includeUserMessages: true,
    contextRounds: 10,
    autoTrigger: true,
    manualTriggerOnly: false,
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
    outputMode: 'both',
    worldInfoBook: '',
    worldInfoEntryName: 'Claude复盘指导',
    worldInfoPosition: 0,
    worldInfoOrder: 100,
    worldInfoConstant: true,
    macroName: 'claude_review',
    showNotification: true,
    injectAsSystemMessage: false,
    reviewLockRP: true,
    debugMode: false,
});

let settings = {};
let turnCounter = 0;
let isReviewing = false;
let lastReviewContent = '';
let reviewHistory = [];
let isInitialized = false;

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

function getRecentChatHistory(rounds) {
    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    const charName = context.characters[context.characterId]?.name || '角色';
    const userName = context.name1 || '用户';

    const messages = chat.filter(m => !m.is_system && !(m.extra?.type === 'system'));
    const recentMessages = messages.slice(-rounds * 2);

    let history = '';
    recentMessages.forEach((msg) => {
        const name = msg.is_user ? userName : (msg.name || charName);
        const content = msg.mes || '';
        history += `[${name}]: ${content}\n\n`;
    });

    return { history, charName, userName, currentTurn: messages.length };
}

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
        messages: [{ role: 'user', content: userPrompt }]
    };

    debug('调用Claude API:', { url, model });

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
    const worldInfoData = await getWorldInfoData();
    if (!worldInfoData) {
        throw new Error('无法获取世界书数据');
    }

    let targetBookName = targetBook;
    if (!targetBookName) {
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
            role: 0,
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

    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.emit(event_types.WORLDINFO_UPDATED);

    return targetBookName;
}

function registerReviewMacro() {
    try {
        const { macros } = SillyTavern.getContext();
        macros.register(settings.macroName, {
            description: 'Claude复盘指导内容',
            category: macros.category.UTILITY,
            handler: () => lastReviewContent || '（暂无复盘内容）',
        });
        log('宏变量已注册:', `{{${settings.macroName}}}`);
    } catch (e) {
        debug('注册宏失败:', e);
    }
}

function unregisterReviewMacro() {
    try {
        const { macros } = SillyTavern.getContext();
        macros.registry.unregisterMacro(settings.macroName);
    } catch (e) {
        debug('注销宏失败:', e);
    }
}

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

        const { history, charName, userName, currentTurn } = getRecentChatHistory(settings.contextRounds);

        if (!history.trim()) {
            log('没有足够的历史对话用于复盘');
            return;
        }

        const userPrompt = settings.userPromptTemplate
            .replace(/{contextRounds}/g, settings.contextRounds)
            .replace(/{charName}/g, charName)
            .replace(/{userName}/g, userName)
            .replace(/{currentTurn}/g, currentTurn)
            .replace(/{chatHistory}/g, history);

        debug('复盘提示词长度:', userPrompt.length);

        const reviewContent = await callClaudeAPI(settings.systemPrompt, userPrompt);

        if (!reviewContent.trim()) {
            throw new Error('Claude返回空内容');
        }

        lastReviewContent = reviewContent;

        reviewHistory.push({
            turn: currentTurn,
            timestamp: Date.now(),
            content: reviewContent,
        });

        if (reviewHistory.length > 50) {
            reviewHistory = reviewHistory.slice(-50);
        }

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

        if (settings.outputMode === 'macro' || settings.outputMode === 'both') {
            registerReviewMacro();
            log(`复盘已更新至宏变量: {{${settings.macroName}}}`);
        }

        if (settings.injectAsSystemMessage) {
            const context = SillyTavern.getContext();
            context.chat.push({
                is_user: false,
                is_system: true,
                name: 'Claude Review',
                mes: `📋 **场外复盘指导**（第${currentTurn}轮）\n\n${reviewContent}`,
                send_date: Date.now(),
                extra: { type: 'system', model: 'claude-review' },
            });
            context.saveChat();
        }

        if (settings.showNotification && !settings.injectAsSystemMessage) {
            toastr.success(`第${currentTurn}轮复盘完成`);
        }

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

function onMessageReceived(data) {
    if (!settings.enabled || settings.manualTriggerOnly) return;
    if (isReviewing) return;

    const context = SillyTavern.getContext();
    const message = context.chat[data];

    if (message && !message.is_user && !message.is_system) {
        turnCounter++;
        debug(`AI回复计数: ${turnCounter}/${settings.triggerInterval}`);

        if (turnCounter >= settings.triggerInterval) {
            log(`达到触发轮次 (${turnCounter}/${settings.triggerInterval})，开始复盘`);
            setTimeout(() => performReview(), 500);
        }
    }
}

function onChatChanged() {
    turnCounter = 0;
    lastReviewContent = '';
    debug('聊天切换，计数器重置');
}

async function setupSettingsPanel() {
    const context = SillyTavern.getContext();

    try {
        const settingsHtml = await renderExtensionTemplateAsync(
            `third-party/${MODULE_NAME}`,
            'settings',
            { MODULE_NAME }
        );

        // 兼容PC端和移动端 - 尝试多个可能的容器
        let $container = $('#extensions_settings2');
        if ($container.length === 0) {
            $container = $('#extensions_settings');
        }
        if ($container.length === 0) {
            $container = $('.extensions_settings').first();
        }
        if ($container.length === 0) {
            // 移动端SillyDroid可能使用不同的结构
            $container = $('[id*="extensions_settings"]').first();
        }
        if ($container.length === 0) {
            // 最后兜底：创建容器并附加到body
            const $panel = $('<div id="extensions_settings2" style="display:none;"></div>');
            $('body').append($panel);
            $container = $panel;
        }

        $container.append(settingsHtml);

        bindSettingsUI();
        loadSettingsToUI();
        initCollapsiblePanels();

    } catch (e) {
        log('设置面板加载失败:', e);
    }
}

function initCollapsiblePanels() {
    $(document).off('click.cr-drawer').on('click.cr-drawer', '.claude-review-settings .inline-drawer-toggle', function() {
        const $content = $(this).next('.inline-drawer-content');
        const $icon = $(this).find('.inline-drawer-icon');

        if ($content.is(':visible')) {
            $content.slideUp(200);
            $icon.removeClass('down').addClass('up');
        } else {
            $content.slideDown(200);
            $icon.removeClass('up').addClass('down');
        }
    });

    // 默认展开
    $('.claude-review-settings .inline-drawer-content').show();
    $('.claude-review-settings .inline-drawer-icon').addClass('down');
}

function bindSettingsUI() {
    const ns = `#${MODULE_NAME}`;

    $(`${ns}_enabled`).on('change', function() {
        settings.enabled = $(this).prop('checked');
        updateStatusBadge();
        saveSettings();
    });

    $(`${ns}_api_key`).on('input', function() {
        settings.apiKey = $(this).val();
        saveSettings();
    });

    $(`${ns}_api_base`).on('input', function() {
        settings.apiBaseUrl = $(this).val();
        saveSettings();
    });

    $(`${ns}_model`).on('change', function() {
        settings.model = $(this).val();
        saveSettings();
    });

    $(`${ns}_custom_model`).on('input', function() {
        settings.customModel = $(this).val();
        saveSettings();
    });

    $(`${ns}_max_tokens`).on('input', function() {
        settings.maxTokens = parseInt($(this).val()) || 2048;
        saveSettings();
    });

    $(`${ns}_temperature`).on('input', function() {
        settings.temperature = parseFloat($(this).val()) || 0.7;
        saveSettings();
    });

    $(`${ns}_interval`).on('input', function() {
        settings.triggerInterval = parseInt($(this).val()) || 20;
        saveSettings();
    });

    $(`${ns}_context_rounds`).on('input', function() {
        settings.contextRounds = parseInt($(this).val()) || 10;
        saveSettings();
    });

    $(`${ns}_auto_trigger`).on('change', function() {
        settings.autoTrigger = $(this).prop('checked');
        saveSettings();
    });

    $(`${ns}_manual_only`).on('change', function() {
        settings.manualTriggerOnly = $(this).prop('checked');
        saveSettings();
    });

    $(`${ns}_system_prompt`).on('input', function() {
        settings.systemPrompt = $(this).val();
        saveSettings();
    });

    $(`${ns}_user_prompt`).on('input', function() {
        settings.userPromptTemplate = $(this).val();
        saveSettings();
    });

    $(`${ns}_output_mode`).on('change', function() {
        settings.outputMode = $(this).val();
        updateOutputUI();
        saveSettings();
    });

    $(`${ns}_wi_book`).on('input', function() {
        settings.worldInfoBook = $(this).val();
        saveSettings();
    });

    $(`${ns}_wi_entry_name`).on('input', function() {
        settings.worldInfoEntryName = $(this).val();
        saveSettings();
    });

    $(`${ns}_wi_position`).on('input', function() {
        settings.worldInfoPosition = parseInt($(this).val()) || 0;
        saveSettings();
    });

    $(`${ns}_macro_name`).on('input', function() {
        unregisterReviewMacro();
        settings.macroName = $(this).val() || 'claude_review';
        registerReviewMacro();
        saveSettings();
    });

    $(`${ns}_show_notif`).on('change', function() {
        settings.showNotification = $(this).prop('checked');
        saveSettings();
    });

    $(`${ns}_inject_system`).on('change', function() {
        settings.injectAsSystemMessage = $(this).prop('checked');
        saveSettings();
    });

    $(`${ns}_lock_rp`).on('change', function() {
        settings.reviewLockRP = $(this).prop('checked');
        saveSettings();
    });

    $(`${ns}_debug`).on('change', function() {
        settings.debugMode = $(this).prop('checked');
        saveSettings();
    });

    $(`${ns}_manual_review`).on('click', async function() {
        const $btn = $(this);
        $btn.prop('disabled', true).text('复盘中...');
        await performReview(true);
        $btn.prop('disabled', false).text('立即复盘');
    });

    $(`${ns}_test_api`).on('click', async function() {
        const $btn = $(this);
        $btn.prop('disabled', true).text('测试中...');
        try {
            const result = await callClaudeAPI(
                '你是一个测试助手，请回复"API连接成功"。',
                '测试连接'
            );
            toastr.success(`API测试成功: ${result.substring(0, 50)}...`);
        } catch (e) {
            toastr.error(`API测试失败: ${e.message}`);
        }
        $btn.prop('disabled', false).text('测试API连接');
    });

    $(`${ns}_reset_counter`).on('click', function() {
        turnCounter = 0;
        toastr.info('计数器已重置');
    });

    $(`${ns}_view_last`).on('click', function() {
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
    const ns = `#${MODULE_NAME}`;

    $(`${ns}_enabled`).prop('checked', settings.enabled);
    $(`${ns}_api_key`).val(settings.apiKey || '');
    $(`${ns}_api_base`).val(settings.apiBaseUrl);
    $(`${ns}_model`).val(settings.model);
    $(`${ns}_custom_model`).val(settings.customModel || '');
    $(`${ns}_max_tokens`).val(settings.maxTokens);
    $(`${ns}_temperature`).val(settings.temperature);
    $(`${ns}_interval`).val(settings.triggerInterval);
    $(`${ns}_context_rounds`).val(settings.contextRounds);
    $(`${ns}_auto_trigger`).prop('checked', settings.autoTrigger);
    $(`${ns}_manual_only`).prop('checked', settings.manualTriggerOnly);
    $(`${ns}_system_prompt`).val(settings.systemPrompt);
    $(`${ns}_user_prompt`).val(settings.userPromptTemplate);
    $(`${ns}_output_mode`).val(settings.outputMode);
    $(`${ns}_wi_book`).val(settings.worldInfoBook || '');
    $(`${ns}_wi_entry_name`).val(settings.worldInfoEntryName);
    $(`${ns}_wi_position`).val(settings.worldInfoPosition);
    $(`${ns}_macro_name`).val(settings.macroName);
    $(`${ns}_show_notif`).prop('checked', settings.showNotification);
    $(`${ns}_inject_system`).prop('checked', settings.injectAsSystemMessage);
    $(`${ns}_lock_rp`).prop('checked', settings.reviewLockRP);
    $(`${ns}_debug`).prop('checked', settings.debugMode);

    updateOutputUI();
    updateStatusBadge();
}

function updateOutputUI() {
    const mode = $(`#${MODULE_NAME}_output_mode`).val();
    $(`.${MODULE_NAME}_wi_settings`).toggle(mode === 'world_info' || mode === 'both');
    $(`.${MODULE_NAME}_macro_settings`).toggle(mode === 'macro' || mode === 'both');
}

function updateStatusBadge() {
    const $badge = $(`#${MODULE_NAME}_status`);
    if (settings.enabled) {
        $badge.text('运行中').removeClass('inactive').addClass('active');
    } else {
        $badge.text('已停用').removeClass('active').addClass('inactive');
    }
}

function registerSlashCommands() {
    try {
        const { SlashCommandParser, SlashCommand } = SillyTavern.getContext();

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'claude-review',
            callback: async () => {
                await performReview(true);
                return '复盘完成';
            },
            aliases: ['cr'],
            returns: '复盘状态',
            helpString: '手动触发Claude场外复盘。用法: /claude-review 或 /cr',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'claude-review-status',
            callback: () => {
                const context = SillyTavern.getContext();
                const chatLen = context.chat?.filter(m => !m.is_user && !m.is_system).length || 0;
                return `计数: ${turnCounter}/${settings.triggerInterval} | AI消息: ${chatLen} | ${isReviewing ? '复盘中' : '待机'}`;
            },
            aliases: ['crs'],
            returns: '复盘状态',
            helpString: '查看当前复盘状态。用法: /crs',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'claude-review-reset',
            callback: () => {
                turnCounter = 0;
                return '计数器已重置';
            },
            aliases: ['crr'],
            returns: '操作结果',
            helpString: '重置复盘轮次计数器。用法: /crr',
        }));
    } catch (e) {
        log('斜杠命令注册失败:', e);
    }
}

// ==================== 生命周期钩子 ====================
export async function onInstall() {
    log('首次安装');
}

export async function onUpdate() {
    log('插件更新');
}

export async function onDelete() {
    log('插件删除，清理');
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
    settings = getSettings();

    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    if (settings.outputMode === 'macro' || settings.outputMode === 'both') {
        registerReviewMacro();
    }

    registerSlashCommands();
    log('插件激活完成');
}

// ==================== 主入口 ====================
jQuery(async () => {
    log('正在加载...');

    const { eventSource, event_types } = SillyTavern.getContext();

    const init = async () => {
        if (isInitialized) return;
        isInitialized = true;

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
