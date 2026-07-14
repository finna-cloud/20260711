const MODULE_ID = 'midnight_signal_app';
const ROOT_ID = 'msa-root';
const TOKEN_SETTINGS_KEY = 'token_usage_panel';
const TOKEN_CHAT_KEY = 'token_usage_panel_data';
const TOKEN_FETCH_GUARD = '__midnightSignalTokenFetchPatched';
const DEFAULT_SETTINGS = Object.freeze({
    autoOpen: false,
    favorites: [],
    relationshipNotes: {},
    memories: {},
    compactMode: false,
});

let coreModulePromise;
let activeView = 'home';
let selectedCharacterId = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function context() {
    return globalThis.SillyTavern?.getContext?.();
}

function settings() {
    const ctx = context();
    if (!ctx) return structuredClone(DEFAULT_SETTINGS);

    ctx.extensionSettings[MODULE_ID] ??= structuredClone(DEFAULT_SETTINGS);
    const value = ctx.extensionSettings[MODULE_ID];
    for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(value, key)) value[key] = structuredClone(fallback);
    }
    return value;
}

function saveSettings() {
    context()?.saveSettingsDebounced?.();
}

function notify(message, type = 'info') {
    const toast = globalThis.toastr;
    if (toast?.[type]) toast[type](message, 'Midnight Signal');
    else console[type === 'error' ? 'error' : 'log'](`[Midnight Signal] ${message}`);
}

function escapeHtml(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function excerpt(value = '', length = 64) {
    const plain = String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\{\{[^}]+\}\}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return plain.length > length ? `${plain.slice(0, length)}…` : plain;
}

function fullMessageText(value = '') {
    return String(value)
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/p\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/\r\n?/g, '\n')
        .trim();
}

function emptyTokenUsage() {
    return {
        input: 0,
        output: 0,
        total: 0,
        requests: 0,
        userMessages: 0,
        lastInput: 0,
        lastOutput: 0,
        lastTotal: 0,
        status: '等待生成',
    };
}

function ensureTokenUsage(value) {
    const defaults = emptyTokenUsage();
    for (const [key, fallback] of Object.entries(defaults)) {
        if (!Object.hasOwn(value, key)) value[key] = fallback;
    }
    return value;
}

function getGlobalTokenUsage() {
    const ctx = context();
    if (!ctx?.extensionSettings) return emptyTokenUsage();
    ctx.extensionSettings[TOKEN_SETTINGS_KEY] ??= emptyTokenUsage();
    return ensureTokenUsage(ctx.extensionSettings[TOKEN_SETTINGS_KEY]);
}

function getChatTokenUsage() {
    const ctx = context();
    if (!ctx?.chatMetadata) return emptyTokenUsage();
    ctx.chatMetadata[TOKEN_CHAT_KEY] ??= emptyTokenUsage();
    return ensureTokenUsage(ctx.chatMetadata[TOKEN_CHAT_KEY]);
}

function tokenNumberFrom(object, keys) {
    for (const key of keys) {
        const value = Number(object?.[key]);
        if (Number.isFinite(value) && value >= 0) return value;
    }
    return null;
}

function normalizeTokenUsage(object) {
    if (!object || typeof object !== 'object') return null;
    const input = tokenNumberFrom(object, ['prompt_tokens', 'input_tokens', 'promptTokenCount', 'prompt_eval_count']);
    const output = tokenNumberFrom(object, ['completion_tokens', 'output_tokens', 'candidatesTokenCount', 'eval_count']);
    let total = tokenNumberFrom(object, ['total_tokens', 'totalTokenCount']);
    if (input === null || output === null) return null;
    if (total === null) total = input + output;
    return { input, output, total };
}

function findTokenUsage(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    const direct = normalizeTokenUsage(value.usage ?? value.usageMetadata ?? value.timings ?? value);
    if (direct) return direct;
    for (const child of Object.values(value)) {
        const found = findTokenUsage(child, seen);
        if (found) return found;
    }
    return null;
}

function extractTokenUsage(text) {
    if (!text) return null;
    try {
        const found = findTokenUsage(JSON.parse(text));
        if (found) return found;
    } catch { /* Streaming or non-JSON response. */ }

    let latest = null;
    for (const rawLine of text.split(/\r?\n/)) {
        let line = rawLine.trim();
        if (line.startsWith('data:')) line = line.slice(5).trim();
        if (!line || line === '[DONE]') continue;
        try {
            const found = findTokenUsage(JSON.parse(line));
            if (found) latest = found;
        } catch { /* Ordinary streamed text. */ }
    }
    return latest;
}

function isTokenGenerationRequest(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    return method === 'POST' && /(?:\/generate(?:\?|$)|chat-completions\/generate|text-completions\/generate)/i.test(url);
}

function formatToken(value) {
    return Number(value || 0).toLocaleString('zh-TW');
}

function refreshTokenUi() {
    const chat = getChatTokenUsage();
    const global = getGlobalTokenUsage();
    const values = {
        'msa-token-home-chat': chat.total,
        'msa-token-home-last': chat.lastTotal,
        'msa-token-last-input': chat.lastInput,
        'msa-token-last-output': chat.lastOutput,
        'msa-token-last-total': chat.lastTotal,
        'msa-token-chat-total': chat.total,
        'msa-token-global-total': global.total,
        'msa-token-requests': chat.requests,
        'msa-token-user-messages': chat.userMessages,
    };
    for (const [id, value] of Object.entries(values)) {
        const element = document.getElementById(id);
        if (element) element.textContent = formatToken(value);
    }
    const status = document.getElementById('msa-token-status');
    if (status) status.textContent = chat.status;
}

async function saveTokenState() {
    const ctx = context();
    ctx?.saveSettingsDebounced?.();
    await ctx?.saveMetadata?.();
}

async function recordTokenUsage(usage) {
    const global = getGlobalTokenUsage();
    const chat = getChatTokenUsage();
    for (const target of [global, chat]) {
        target.input += usage.input;
        target.output += usage.output;
        target.total += usage.total;
        target.requests += 1;
        target.lastInput = usage.input;
        target.lastOutput = usage.output;
        target.lastTotal = usage.total;
        target.status = 'API 精確數據';
    }
    await saveTokenState();
    refreshTokenUi();
}

async function recordTokenUserMessage() {
    getGlobalTokenUsage().userMessages += 1;
    getChatTokenUsage().userMessages += 1;
    await saveTokenState();
    refreshTokenUi();
}

function markTokenUnavailable() {
    getGlobalTokenUsage().status = 'API 未回傳 usage';
    getChatTokenUsage().status = 'API 未回傳 usage';
    context()?.saveSettingsDebounced?.();
    refreshTokenUi();
}

function installTokenTracker() {
    if (globalThis[TOKEN_FETCH_GUARD]) return;

    const existingTokenPanel = document.getElementById('token-usage-panel');
    const existingTokenFetch = String(globalThis.fetch?.name || '').includes('tokenUsageFetch');
    if (existingTokenPanel || existingTokenFetch) {
        console.info('[Midnight Signal] Reusing API Token 用量面板 data.');
        return;
    }

    const originalFetch = globalThis.fetch?.bind(globalThis);
    if (typeof originalFetch !== 'function') return;
    globalThis[TOKEN_FETCH_GUARD] = true;

    globalThis.fetch = async function midnightSignalTokenFetch(input, init) {
        const response = await originalFetch(input, init);
        if (!isTokenGenerationRequest(input, init)) return response;

        response.clone().text()
            .then(extractTokenUsage)
            .then(usage => usage ? recordTokenUsage(usage) : markTokenUnavailable())
            .catch(markTokenUnavailable);
        return response;
    };

    const ctx = context();
    const messageSent = ctx?.event_types?.MESSAGE_SENT;
    if (messageSent) ctx.eventSource?.on?.(messageSent, recordTokenUserMessage);
}

function getCharacters() {
    return (context()?.characters || [])
        .map((character, id) => ({ character, id }))
        .filter(({ character }) => character && (character.name || character.data?.name));
}

function getCurrentCharacter() {
    const ctx = context();
    const hasCharacterId = ctx?.characterId !== undefined && ctx?.characterId !== null && Number.isInteger(Number(ctx.characterId));
    const id = hasCharacterId ? Number(ctx.characterId) : selectedCharacterId;
    return ctx?.characters?.[id] ? { character: ctx.characters[id], id } : null;
}

function characterName(character) {
    return character?.name || character?.data?.name || '尚未選擇角色';
}

function characterKey(character) {
    return character?.avatar || character?.data?.avatar || characterName(character);
}

function avatarUrl(character) {
    const avatar = character?.avatar || character?.data?.avatar;
    if (!avatar || avatar === 'none') return '';
    return `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`;
}

function getGreetings(character) {
    if (!character) return [];
    const first = character.first_mes ?? character.data?.first_mes ?? '';
    const alternates = character.data?.alternate_greetings ?? character.alternate_greetings ?? [];
    return [first, ...(Array.isArray(alternates) ? alternates : [])].filter(value => String(value).trim());
}

function getLatestMessage() {
    const chat = context()?.chat || [];
    return [...chat].reverse().find(message => !message?.is_system)?.mes || '選擇角色，開始一段新的對話。';
}

function getCoreModule() {
    coreModulePromise ??= import('/script.js').catch(error => {
        console.warn('[Midnight Signal] Unable to import core module.', error);
        return {};
    });
    return coreModulePromise;
}

async function selectCharacter(id) {
    const ctx = context();
    if (!ctx?.characters?.[id]) throw new Error('找不到所選角色。');
    if (ctx.groupId) throw new Error('目前是群組聊天，請先切換到單人角色聊天。');

    selectedCharacterId = Number(id);
    if (Number(ctx.characterId) === Number(id)) return;

    let select = ctx.selectCharacterById;
    if (typeof select !== 'function') {
        const core = await getCoreModule();
        select = core.selectCharacterById;
    }
    if (typeof select === 'function') {
        await select.call(ctx, Number(id));
    } else {
        const card = document.querySelector(`.character_select[chid="${id}"], .character_select[data-chid="${id}"]`);
        if (!card) throw new Error('這個 SillyTavern 版本沒有提供角色切換介面。');
        card.click();
    }

    for (let attempt = 0; attempt < 12; attempt++) {
        if (Number(context()?.characterId) === Number(id)) break;
        await sleep(100);
    }
}

async function applyGreeting(index) {
    const current = getCurrentCharacter();
    const ctx = context();
    if (!current) throw new Error('請先選擇一名角色。');

    const greetings = getGreetings(current.character);
    const greeting = greetings[index];
    if (!greeting) throw new Error('找不到這個開場白。');
    if (!ctx.chat?.[0] || ctx.chat[0].is_user) throw new Error('目前聊天沒有可替換的角色開場白。');

    const firstMessage = ctx.chat[0];
    firstMessage.swipes = [...greetings];
    firstMessage.swipe_id = Number(index);
    firstMessage.mes = greeting;
    firstMessage.name = characterName(current.character);

    let core = {};
    let save = ctx.saveChat;
    if (typeof save !== 'function') {
        core = await getCoreModule();
        save = core.saveChatConditional;
    }
    if (typeof save === 'function') await save.call(ctx);

    let reload = ctx.reloadCurrentChat || core.reloadCurrentChat;
    if (typeof reload !== 'function') {
        core = await getCoreModule();
        reload = core.reloadCurrentChat;
    }
    if (typeof reload === 'function') {
        await reload.call(ctx);
    } else {
        const text = document.querySelector('#chat .mes[mesid="0"] .mes_text');
        if (text) text.textContent = greeting;
        ctx.eventSource?.emit?.(ctx.event_types?.MESSAGE_SWIPED, 0);
    }
}

function icon(name) {
    return `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
}

function launcherMarkup() {
    return `
        <button id="msa-launcher" type="button" aria-label="開啟 Midnight Signal APP" title="Midnight Signal APP">
            ${icon('mobile-screen-button')}<span>手機</span>
        </button>`;
}

function shellMarkup() {
    return `
        <div id="${ROOT_ID}" class="msa-hidden" aria-hidden="true">
            <div class="msa-backdrop" data-action="close"></div>
            <section class="msa-phone" role="dialog" aria-modal="true" aria-label="Midnight Signal APP">
                <button class="msa-close" type="button" data-action="close" aria-label="關閉">${icon('xmark')}</button>
                <div class="msa-app-scroll">
                    <header class="msa-header">
                        <button class="msa-profile" type="button" data-action="characters" aria-label="選擇對話角色">
                            <span class="msa-avatar msa-avatar-current"></span>
                            <span><strong>MIDNIGHT SIGNAL</strong><small><b></b> ONLINE</small></span>
                        </button>
                        <button class="msa-icon-button" type="button" data-action="notifications" aria-label="通知">
                            ${icon('bell')}<span class="msa-notification-dot"></span>
                        </button>
                    </header>
                    <main id="msa-content"></main>
                </div>
                <nav class="msa-bottom-nav" aria-label="APP 導覽">
                    <button type="button" data-nav="home">${icon('house')}<span>主頁</span></button>
                    <button type="button" data-nav="favorites">${icon('star')}<span>收藏</span></button>
                    <button type="button" data-nav="settings">${icon('gear')}<span>設定</span></button>
                </nav>
            </section>
            <div id="msa-sheet" class="msa-sheet msa-hidden" aria-hidden="true"></div>
        </div>`;
}

function homeMarkup() {
    const current = getCurrentCharacter();
    const character = current?.character;
    const name = characterName(character);
    const greetingCount = getGreetings(character).length;
    const tokenUsage = getChatTokenUsage();
    return `
        <section class="msa-home">
            <button class="msa-hero" type="button" data-action="characters" aria-label="選擇對話角色">
                <span class="msa-hero-art" role="img" aria-label="紅色聲波與雨夜城市"></span>
                <span class="msa-hero-shade"></span>
                <span class="msa-hero-copy">
                    <small>${icon('user-group')} 選擇對話角色</small>
                    <strong>${escapeHtml(name)}</strong>
                    <em>今晚，要和誰開始？</em>
                </span>
            </button>

            <button class="msa-opening-button" type="button" data-action="greetings">
                ${icon('heart')}<span><small>目前角色共有 ${greetingCount} 個開場</small><strong>開場白選擇</strong></span>${icon('chevron-right')}
            </button>

            <button class="msa-latest" type="button" data-action="messages">
                <span class="msa-latest-icon">${icon('message')}</span>
                <span><small>最近訊息</small><strong>${escapeHtml(excerpt(getLatestMessage(), 38))}</strong></span>
                <time>${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</time>
            </button>

            <button class="msa-token-button" type="button" data-action="tokens">
                <span class="msa-token-icon">${icon('gauge-high')}</span>
                <span class="msa-token-main"><small>目前聊天 TOKEN</small><strong id="msa-token-home-chat">${formatToken(tokenUsage.total)}</strong></span>
                <span class="msa-token-last"><small>本次</small><b id="msa-token-home-last">${formatToken(tokenUsage.lastTotal)}</b>${icon('chevron-right')}</span>
            </button>

            <div class="msa-grid">
                <button type="button" data-action="messages">${icon('message')}<span>訊息</span></button>
                <button type="button" data-action="relationship">${icon('user-group')}<span>關係</span></button>
                <button type="button" data-action="memories">${icon('image')}<span>回憶</span></button>
                <button type="button" data-action="moments">${icon('wave-square')}<span>動態</span></button>
            </div>
        </section>`;
}

function emptyMarkup(title, message) {
    return `<div class="msa-empty">${icon('moon')}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
}

function favoritesMarkup() {
    const favoriteKeys = settings().favorites;
    const matches = getCharacters().filter(({ character }) => favoriteKeys.includes(characterKey(character)));
    if (!matches.length) return emptyMarkup('還沒有收藏角色', '在角色選擇頁點擊星號，即可將角色加入收藏。');
    return `
        <section class="msa-page">
            <div class="msa-page-title"><span><small>FAVORITES</small><strong>收藏角色</strong></span></div>
            <div class="msa-character-list">${matches.map(characterCardMarkup).join('')}</div>
        </section>`;
}

function settingsMarkup() {
    const value = settings();
    return `
        <section class="msa-page">
            <div class="msa-page-title"><span><small>SETTINGS</small><strong>介面設定</strong></span></div>
            <label class="msa-setting-row">
                <span><strong>啟動時自動開啟</strong><small>載入 SillyTavern 後顯示 APP</small></span>
                <input type="checkbox" data-setting="autoOpen" ${value.autoOpen ? 'checked' : ''}>
            </label>
            <label class="msa-setting-row">
                <span><strong>緊湊模式</strong><small>縮小按鈕與區塊間距</small></span>
                <input type="checkbox" data-setting="compactMode" ${value.compactMode ? 'checked' : ''}>
            </label>
            <button class="msa-danger-button" type="button" data-action="reset-data">${icon('rotate-left')} 清除 APP 筆記資料</button>
            <p class="msa-version">Midnight Signal APP · v1.1.0</p>
        </section>`;
}

function characterCardMarkup({ character, id }) {
    const key = characterKey(character);
    const favorite = settings().favorites.includes(key);
    return `
        <div class="msa-character-card ${Number(context()?.characterId) === id ? 'is-current' : ''}">
            <button type="button" class="msa-character-main" data-character-id="${id}">
                <span class="msa-avatar" style="--msa-avatar-url:url('${escapeHtml(avatarUrl(character))}')"></span>
                <span><strong>${escapeHtml(characterName(character))}</strong><small>${getGreetings(character).length} 個開場白</small></span>
            </button>
            <button type="button" class="msa-favorite-toggle ${favorite ? 'is-favorite' : ''}" data-favorite-id="${id}" aria-label="切換收藏">${icon('star')}</button>
        </div>`;
}

function messagesMarkup() {
    const chat = context()?.chat || [];
    if (!chat.length) return emptyMarkup('尚無訊息', '選擇角色並開始聊天後，最近訊息會顯示在這裡。');
    return `
        <section class="msa-page">
            <div class="msa-page-title"><span><small>MESSAGES</small><strong>最近訊息</strong></span></div>
            <div class="msa-message-list">${chat.slice(-12).map(message => `
                <article class="msa-message ${message.is_user ? 'is-user' : 'is-character'}">
                    <small>${escapeHtml(message.name || (message.is_user ? '你' : characterName(getCurrentCharacter()?.character)))}</small>
                    <p>${escapeHtml(fullMessageText(message.mes))}</p>
                </article>`).join('')}</div>
        </section>`;
}

function relationshipMarkup() {
    const character = getCurrentCharacter()?.character;
    if (!character) return emptyMarkup('請先選擇角色', '關係筆記會分別儲存在每一名角色之下。');
    const key = characterKey(character);
    const value = settings().relationshipNotes[key] || '';
    return `
        <section class="msa-page">
            <div class="msa-page-title"><span><small>RELATIONSHIP</small><strong>與 ${escapeHtml(characterName(character))} 的關係</strong></span></div>
            <div class="msa-stat-card"><span>對話回合</span><strong>${Math.max(0, (context()?.chat?.length || 1) - 1)}</strong></div>
            <label class="msa-textarea-label">關係備忘錄
                <textarea id="msa-relationship-note" rows="9" placeholder="例如：目前互相信任、約定下次去看海……">${escapeHtml(value)}</textarea>
            </label>
            <button class="msa-save-button" type="button" data-action="save-relationship">${icon('floppy-disk')} 儲存關係筆記</button>
        </section>`;
}

function memoriesMarkup() {
    const character = getCurrentCharacter()?.character;
    if (!character) return emptyMarkup('請先選擇角色', '你可以為不同角色保存獨立的回憶。');
    const key = characterKey(character);
    const list = settings().memories[key] || [];
    return `
        <section class="msa-page">
            <div class="msa-page-title"><span><small>MEMORIES</small><strong>和 ${escapeHtml(characterName(character))} 的回憶</strong></span></div>
            <div class="msa-add-row"><input id="msa-memory-input" type="text" maxlength="240" placeholder="記下一件重要的事"><button type="button" data-action="add-memory">${icon('plus')}</button></div>
            <div class="msa-memory-list">${list.length ? list.map((item, index) => `
                <article><span>${icon('heart')}<p>${escapeHtml(item)}</p></span><button type="button" data-delete-memory="${index}" aria-label="刪除">${icon('trash')}</button></article>`).join('') : '<p class="msa-list-hint">尚未新增回憶。</p>'}</div>
        </section>`;
}

function momentsMarkup() {
    const chat = (context()?.chat || []).filter(message => !message.is_user && !message.is_system).slice(-6).reverse();
    if (!chat.length) return emptyMarkup('尚無角色動態', '角色回覆後，近期片段會自動整理在這裡。');
    return `
        <section class="msa-page">
            <div class="msa-page-title"><span><small>MOMENTS</small><strong>角色動態</strong></span></div>
            <div class="msa-moment-list">${chat.map((message, index) => `
                <article><span class="msa-moment-head"><b></b><strong>${escapeHtml(message.name || characterName(getCurrentCharacter()?.character))}</strong><time>#${chat.length - index}</time></span><p>${escapeHtml(excerpt(message.mes, 220))}</p></article>`).join('')}</div>
        </section>`;
}

function tokensMarkup() {
    const chat = getChatTokenUsage();
    const global = getGlobalTokenUsage();
    return `
        <section class="msa-page msa-token-page">
            <div class="msa-page-title"><span><small>TOKEN USAGE</small><strong>Token 使用量</strong></span></div>
            <div class="msa-token-summary">
                <small>目前聊天累計</small>
                <strong id="msa-token-chat-total">${formatToken(chat.total)}</strong>
                <span>TOKENS</span>
            </div>
            <div class="msa-token-rows">
                <div><span>本次輸入</span><strong id="msa-token-last-input">${formatToken(chat.lastInput)}</strong></div>
                <div><span>本次回覆</span><strong id="msa-token-last-output">${formatToken(chat.lastOutput)}</strong></div>
                <div class="is-total"><span>本次合計</span><strong id="msa-token-last-total">${formatToken(chat.lastTotal)}</strong></div>
                <div><span>API 呼叫次數</span><strong id="msa-token-requests">${formatToken(chat.requests)}</strong></div>
                <div><span>玩家傳送訊息</span><strong id="msa-token-user-messages">${formatToken(chat.userMessages)}</strong></div>
                <div><span>全部聊天累計</span><strong id="msa-token-global-total">${formatToken(global.total)}</strong></div>
            </div>
            <div id="msa-token-status" class="msa-token-status">${escapeHtml(chat.status)}</div>
            <p class="msa-token-help">數字取自模型 API 回傳的 usage 欄位；若供應商沒有回傳 usage，狀態會顯示無法取得。</p>
            <div class="msa-token-reset-row">
                <button type="button" data-action="reset-chat-tokens">重設目前聊天</button>
                <button type="button" data-action="reset-all-tokens">重設全部累計</button>
            </div>
        </section>`;
}

function render(view = activeView) {
    activeView = view;
    const root = document.getElementById(ROOT_ID);
    const content = document.getElementById('msa-content');
    if (!root || !content) return;
    root.classList.toggle('msa-compact', settings().compactMode);

    const markup = {
        home: homeMarkup,
        favorites: favoritesMarkup,
        settings: settingsMarkup,
        messages: messagesMarkup,
        relationship: relationshipMarkup,
        memories: memoriesMarkup,
        moments: momentsMarkup,
        tokens: tokensMarkup,
    }[view]?.() || homeMarkup();

    content.innerHTML = markup;
    document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('is-active', button.dataset.nav === view));
    updateCurrentAvatar();
}

function updateCurrentAvatar() {
    const character = getCurrentCharacter()?.character;
    const url = avatarUrl(character);
    document.querySelectorAll('.msa-avatar-current').forEach(node => {
        node.style.setProperty('--msa-avatar-url', url ? `url("${url}")` : 'none');
    });
}

function showApp(view = 'home') {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.classList.remove('msa-hidden');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('msa-open');
    render(view);
}

function hideApp() {
    closeSheet();
    const root = document.getElementById(ROOT_ID);
    root?.classList.add('msa-hidden');
    root?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('msa-open');
}

function showSheet(title, content) {
    const sheet = document.getElementById('msa-sheet');
    if (!sheet) return;
    sheet.innerHTML = `<div class="msa-sheet-backdrop" data-action="close-sheet"></div><section><header><span><small>MIDNIGHT SIGNAL</small><strong>${escapeHtml(title)}</strong></span><button type="button" data-action="close-sheet">${icon('xmark')}</button></header><div class="msa-sheet-content">${content}</div></section>`;
    sheet.classList.remove('msa-hidden');
    sheet.setAttribute('aria-hidden', 'false');
}

function closeSheet() {
    const sheet = document.getElementById('msa-sheet');
    sheet?.classList.add('msa-hidden');
    sheet?.setAttribute('aria-hidden', 'true');
}

function openCharacterSheet() {
    const characters = getCharacters();
    const content = characters.length
        ? `<div class="msa-character-list">${characters.map(characterCardMarkup).join('')}</div>`
        : `<div class="msa-sheet-empty">尚未匯入任何角色卡。</div>`;
    showSheet('選擇對話角色', content);
}

function openGreetingSheet() {
    const current = getCurrentCharacter();
    if (!current) {
        openCharacterSheet();
        return;
    }
    const greetings = getGreetings(current.character);
    const currentSwipe = Number(context()?.chat?.[0]?.swipe_id || 0);
    const content = greetings.length
        ? `<div class="msa-greeting-list">${greetings.map((greeting, index) => `
            <button type="button" data-greeting-index="${index}" class="${currentSwipe === index ? 'is-current' : ''}">
                <span><small>${index === 0 ? '預設開場白' : `開場白 ${index + 1}`}</small><strong>${escapeHtml(excerpt(greeting, 110))}</strong></span>${icon(currentSwipe === index ? 'check' : 'chevron-right')}
            </button>`).join('')}</div>`
        : `<div class="msa-sheet-empty">這張角色卡沒有設定開場白。</div>`;
    showSheet('開場白選擇', content);
}

function openNotifications() {
    showSheet('通知', `<div class="msa-notice-card">${icon('circle-check')}<span><strong>APP 已與 SillyTavern 連線</strong><small>角色、聊天與開場白資料會隨目前對話更新。</small></span></div>`);
}

function toggleFavorite(id) {
    const character = context()?.characters?.[id];
    if (!character) return;
    const value = settings();
    const key = characterKey(character);
    const index = value.favorites.indexOf(key);
    if (index >= 0) value.favorites.splice(index, 1);
    else value.favorites.push(key);
    saveSettings();
    if (!document.getElementById('msa-sheet')?.classList.contains('msa-hidden')) openCharacterSheet();
    else render();
}

function saveRelationship() {
    const character = getCurrentCharacter()?.character;
    const textarea = document.getElementById('msa-relationship-note');
    if (!character || !textarea) return;
    settings().relationshipNotes[characterKey(character)] = textarea.value.trim();
    saveSettings();
    notify('關係筆記已儲存。', 'success');
}

function addMemory() {
    const character = getCurrentCharacter()?.character;
    const input = document.getElementById('msa-memory-input');
    if (!character || !input?.value.trim()) return;
    const key = characterKey(character);
    settings().memories[key] ??= [];
    settings().memories[key].unshift(input.value.trim());
    saveSettings();
    render('memories');
}

function deleteMemory(index) {
    const character = getCurrentCharacter()?.character;
    if (!character) return;
    const list = settings().memories[characterKey(character)] || [];
    list.splice(Number(index), 1);
    saveSettings();
    render('memories');
}

async function handleClick(event) {
    const button = event.target.closest('button, [data-action], [data-nav]');
    if (!button) return;

    if (button.dataset.nav) {
        render(button.dataset.nav);
        return;
    }
    if (button.dataset.characterId !== undefined) {
        button.disabled = true;
        try {
            await selectCharacter(Number(button.dataset.characterId));
            closeSheet();
            render('home');
            notify(`已切換至 ${characterName(getCurrentCharacter()?.character)}。`, 'success');
        } catch (error) {
            notify(error.message || '角色切換失敗。', 'error');
        } finally {
            button.disabled = false;
        }
        return;
    }
    if (button.dataset.favoriteId !== undefined) {
        toggleFavorite(Number(button.dataset.favoriteId));
        return;
    }
    if (button.dataset.greetingIndex !== undefined) {
        button.disabled = true;
        try {
            await applyGreeting(Number(button.dataset.greetingIndex));
            closeSheet();
            render('home');
            notify('已套用新的開場白。', 'success');
        } catch (error) {
            notify(error.message || '開場白切換失敗。', 'error');
        } finally {
            button.disabled = false;
        }
        return;
    }
    if (button.dataset.deleteMemory !== undefined) {
        deleteMemory(button.dataset.deleteMemory);
        return;
    }

    const actions = {
        close: hideApp,
        'close-sheet': closeSheet,
        characters: openCharacterSheet,
        greetings: openGreetingSheet,
        notifications: openNotifications,
        tokens: () => render('tokens'),
        messages: () => render('messages'),
        relationship: () => render('relationship'),
        memories: () => render('memories'),
        moments: () => render('moments'),
        'save-relationship': saveRelationship,
        'add-memory': addMemory,
        'reset-chat-tokens': async () => {
            const ctx = context();
            if (!ctx?.chatMetadata) return;
            ctx.chatMetadata[TOKEN_CHAT_KEY] = emptyTokenUsage();
            await ctx.saveMetadata?.();
            render('tokens');
            notify('目前聊天的 Token 統計已重設。', 'success');
        },
        'reset-all-tokens': async () => {
            if (!confirm('確定要清除全部 Token 累計嗎？')) return;
            const ctx = context();
            ctx.extensionSettings[TOKEN_SETTINGS_KEY] = emptyTokenUsage();
            ctx.saveSettingsDebounced?.();
            render('tokens');
            notify('全部 Token 累計已重設。', 'success');
        },
        'reset-data': async () => {
            if (!confirm('確定要清除 Midnight Signal 的收藏、關係筆記與回憶嗎？')) return;
            context().extensionSettings[MODULE_ID] = structuredClone(DEFAULT_SETTINGS);
            saveSettings();
            render('settings');
            notify('APP 筆記資料已清除。', 'success');
        },
    };
    actions[button.dataset.action]?.();
}

function handleChange(event) {
    const input = event.target.closest('[data-setting]');
    if (!input) return;
    settings()[input.dataset.setting] = input.type === 'checkbox' ? input.checked : input.value;
    saveSettings();
    render('settings');
}

function mount() {
    if (document.getElementById(ROOT_ID)) return;
    document.body.insertAdjacentHTML('beforeend', launcherMarkup());
    document.body.insertAdjacentHTML('beforeend', shellMarkup());

    document.getElementById('msa-launcher').addEventListener('click', () => showApp('home'));
    document.getElementById(ROOT_ID).addEventListener('click', handleClick);
    document.getElementById(ROOT_ID).addEventListener('change', handleChange);
    document.getElementById(ROOT_ID).addEventListener('keydown', event => {
        if (event.key === 'Escape') hideApp();
        if (event.key === 'Enter' && event.target.id === 'msa-memory-input') addMemory();
    });

    const extensionsMenu = document.querySelector('#extensionsMenu');
    if (extensionsMenu && !document.getElementById('msa-extension-menu-button')) {
        extensionsMenu.insertAdjacentHTML('beforeend', `<div id="msa-extension-menu-button" class="list-group-item flex-container flexGap5 interactable" tabindex="0">${icon('mobile-screen-button')}<span>Midnight Signal APP</span></div>`);
        document.getElementById('msa-extension-menu-button').addEventListener('click', () => showApp('home'));
    }

    const ctx = context();
    installTokenTracker();
    const refresh = () => {
        const currentId = context()?.characterId;
        selectedCharacterId = currentId !== undefined && currentId !== null && Number.isInteger(Number(currentId)) ? Number(currentId) : selectedCharacterId;
        if (!document.getElementById(ROOT_ID)?.classList.contains('msa-hidden')) render(activeView);
    };
    ['CHAT_CHANGED', 'CHARACTER_EDITED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_SWIPED'].forEach(name => {
        const eventName = ctx?.event_types?.[name];
        if (eventName) ctx.eventSource?.on?.(eventName, refresh);
    });

    selectedCharacterId = ctx?.characterId !== undefined && ctx?.characterId !== null && Number.isInteger(Number(ctx.characterId)) ? Number(ctx.characterId) : null;
    if (settings().autoOpen) setTimeout(() => showApp('home'), 350);
    console.info('[Midnight Signal] Extension loaded.');
}

async function initialize() {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (globalThis.SillyTavern?.getContext && document.body) {
            mount();
            return;
        }
        await sleep(100);
    }
    console.error('[Midnight Signal] SillyTavern context was not available.');
}

initialize();
