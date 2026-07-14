const MODULE_NAME = 'story_app_interface';
const ROOT_ID = 'story-app-interface-root';

const DEFAULT_SETTINGS = {
    enabled: true,
    showLauncher: true,
    autoOpenFreshChat: false,
    appTitle: 'STORY STUDIO',
    subtitle: 'PRIVATE SESSION',
    accent: '#a82736',
    openingTitles: {},
};

let root;
let activePage = 'home';
let selectedOpening = 0;
let audioObjectUrl = null;

function context() {
    return globalThis.SillyTavern?.getContext?.();
}

function settings() {
    const ctx = context();
    if (!ctx) return structuredClone(DEFAULT_SETTINGS);
    const current = ctx.extensionSettings?.[MODULE_NAME] || {};
    const lodash = globalThis.SillyTavern?.libs?.lodash;

    // Shared libraries live on SillyTavern.libs in 1.18.x, not on getContext().
    // Keep a dependency-free fallback so a delayed library load cannot prevent
    // the launcher from being created.
    if (lodash?.merge) {
        ctx.extensionSettings[MODULE_NAME] = lodash.merge(
            structuredClone(DEFAULT_SETTINGS),
            current,
        );
    } else {
        ctx.extensionSettings[MODULE_NAME] = {
            ...structuredClone(DEFAULT_SETTINGS),
            ...current,
            openingTitles: {
                ...DEFAULT_SETTINGS.openingTitles,
                ...(current.openingTitles || {}),
            },
        };
    }
    return ctx.extensionSettings[MODULE_NAME];
}

function saveSettings() {
    context()?.saveSettingsDebounced?.();
}

function currentCharacter() {
    const ctx = context();
    if (!ctx || ctx.characterId === undefined || ctx.characterId === null) return null;
    return ctx.characters?.[ctx.characterId] || null;
}

function characterKey() {
    const ctx = context();
    const character = currentCharacter();
    return String(character?.avatar || character?.data?.name || ctx?.characterId || 'none');
}

function characterName() {
    const character = currentCharacter();
    return character?.data?.name || character?.name || '尚未選擇角色';
}

function avatarUrl() {
    const character = currentCharacter();
    const avatar = character?.avatar;
    if (!avatar) return '';
    return `/characters/${encodeURIComponent(avatar)}`;
}

function getGreetings() {
    const character = currentCharacter();
    if (!character) return [];

    const primary = character?.data?.first_mes ?? character?.first_mes ?? '';
    const alternates = character?.data?.alternate_greetings ?? character?.alternate_greetings ?? [];
    return [primary, ...(Array.isArray(alternates) ? alternates : [])]
        .filter(item => typeof item === 'string');
}

function openingTitle(index) {
    const custom = settings().openingTitles?.[characterKey()]?.[index];
    return custom?.trim() || `開場情節 ${index + 1}`;
}

function plainText(value, maxLength = 180) {
    const holder = document.createElement('div');
    holder.innerHTML = String(value || '');
    const text = (holder.textContent || '')
        .replace(/\{\{[^}]+\}\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = String(value ?? '');
    return span.innerHTML;
}

function isFreshChat() {
    const chat = context()?.chat || [];
    return chat.length === 1 && !chat[0]?.is_user;
}

function currentGreetingIndex() {
    const first = context()?.chat?.[0];
    return Number.isInteger(first?.swipe_id) ? first.swipe_id : 0;
}

function memoStorageKey() {
    const ctx = context();
    const chatKey = ctx?.chatId || ctx?.chat?.[0]?.send_date || 'default';
    return `${MODULE_NAME}:memo:${characterKey()}:${chatKey}`;
}

function template() {
    return `
        <button id="story-app-launcher" class="story-app-launcher" type="button" aria-label="開啟故事介面">
            <i class="fa-solid fa-mobile-screen-button"></i>
        </button>

        <div class="story-app-shell" aria-hidden="true">
            <header class="story-app-topbar">
                <button class="story-icon-button" type="button" data-action="home" aria-label="首頁">
                    <i class="fa-solid fa-bars"></i>
                </button>
                <div class="story-brand">
                    <strong data-bind="app-title"></strong>
                    <small data-bind="subtitle"></small>
                </div>
                <button class="story-icon-button" type="button" data-action="close" aria-label="關閉">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </header>

            <main class="story-app-main">
                <section class="story-page" data-page="home"></section>
                <section class="story-page" data-page="opening"></section>
                <section class="story-page" data-page="profile"></section>
                <section class="story-page" data-page="memo"></section>
                <section class="story-page" data-page="journal"></section>
                <section class="story-page" data-page="music"></section>
                <section class="story-page" data-page="settings"></section>
            </main>

            <nav class="story-bottom-nav" aria-label="APP 導覽">
                <button type="button" data-nav="home"><i class="fa-solid fa-house"></i><span>首頁</span></button>
                <button type="button" data-nav="profile"><i class="fa-solid fa-address-card"></i><span>人設</span></button>
                <button type="button" data-action="continue"><i class="fa-solid fa-comments"></i><span>聊天</span></button>
                <button type="button" data-nav="memo"><i class="fa-solid fa-note-sticky"></i><span>備忘錄</span></button>
                <button type="button" data-nav="settings"><i class="fa-solid fa-gear"></i><span>設定</span></button>
            </nav>
        </div>
    `;
}

function renderHome() {
    const page = root.querySelector('[data-page="home"]');
    const avatar = avatarUrl();
    const hasCharacter = Boolean(currentCharacter());

    page.innerHTML = `
        <div class="story-home-grid">
            <article class="story-hero ${avatar ? '' : 'is-empty'}" ${avatar ? `style="--story-avatar:url('${avatar.replaceAll("'", "%27")}')"` : ''}>
                <div class="story-camera-marks"><span>STUDIO 09</span><span>INPUT / ACTIVE</span></div>
                <div class="story-hero-copy">
                    <small>最近故事</small>
                    <h1>${escapeHtml(characterName())}</h1>
                    <p>${hasCharacter ? '故事資料已連接' : '請先在 SillyTavern 選擇角色'}</p>
                    <div class="story-hero-actions">
                        <button class="story-primary-button" type="button" data-action="continue" ${hasCharacter ? '' : 'disabled'}>繼續聊天</button>
                        <button class="story-secondary-button" type="button" data-nav="opening" ${hasCharacter ? '' : 'disabled'}>選擇開場</button>
                    </div>
                </div>
            </article>

            <div class="story-dashboard">
                <section class="story-contact-panel">
                    <div class="story-section-heading"><span>專屬聯絡人</span><small>CURRENT CHARACTER</small></div>
                    <div class="story-contact">
                        <div class="story-contact-avatar">${avatar ? `<img src="${avatar}" alt="">` : '<i class="fa-solid fa-user"></i>'}</div>
                        <div><strong>${escapeHtml(characterName())}</strong><small>${getGreetings().length} 個開場情節</small></div>
                        <span class="story-online-dot" aria-label="目前角色"></span>
                    </div>
                </section>

                <section class="story-feature-grid">
                    <button type="button" data-action="continue"><i class="fa-regular fa-comment-dots"></i><span>聊天室</span></button>
                    <button type="button" data-nav="profile"><i class="fa-regular fa-address-card"></i><span>我的人設</span></button>
                    <button type="button" data-nav="memo"><i class="fa-regular fa-note-sticky"></i><span>備忘錄</span></button>
                    <button type="button" data-nav="journal"><i class="fa-solid fa-book-open"></i><span>日誌</span></button>
                    <button type="button" data-nav="music"><i class="fa-solid fa-music"></i><span>音樂</span></button>
                </section>

                <section class="story-status-strip">
                    <div><small>聊天訊息</small><strong>${context()?.chat?.length || 0}</strong></div>
                    <div><small>開場數量</small><strong>${getGreetings().length}</strong></div>
                    <div><small>當前狀態</small><strong>${isFreshChat() ? '尚未開始' : '進行中'}</strong></div>
                </section>
            </div>
        </div>
    `;
}

function renderOpening() {
    const page = root.querySelector('[data-page="opening"]');
    const greetings = getGreetings();
    selectedOpening = Math.min(currentGreetingIndex(), Math.max(0, greetings.length - 1));

    if (!currentCharacter()) {
        page.innerHTML = emptyState('尚未選擇角色', '請先返回 SillyTavern 選擇一張角色卡。');
        return;
    }

    page.innerHTML = `
        <div class="story-page-header">
            <button class="story-back-button" type="button" data-nav="home"><i class="fa-solid fa-arrow-left"></i> 返回</button>
            <small>OPENING SCENE</small>
            <h2>選擇開場情節</h2>
            <p>選項來自角色卡的主要開場白與替代開場白，按鈕名稱可在設定頁自訂。</p>
        </div>
        ${isFreshChat() ? '' : `
            <div class="story-warning"><i class="fa-solid fa-triangle-exclamation"></i><span>目前對話已經開始。為保護聊天紀錄，請先使用 SillyTavern 的「開始新聊天」，再回來切換開場。</span></div>
        `}
        <div class="story-opening-list">
            ${greetings.map((greeting, index) => `
                <button class="story-opening-option ${index === selectedOpening ? 'is-selected' : ''}" type="button" data-opening-index="${index}" ${isFreshChat() ? '' : 'disabled'}>
                    <span class="story-opening-number">${String(index + 1).padStart(2, '0')}</span>
                    <span class="story-opening-copy"><strong>${escapeHtml(openingTitle(index))}</strong><small>${escapeHtml(plainText(greeting) || '空白開場')}</small></span>
                    <i class="fa-solid fa-circle-check"></i>
                </button>
            `).join('') || emptyState('沒有開場白', '請在角色卡中加入主要開場白或替代開場白。')}
        </div>
        <button class="story-start-button" type="button" data-action="start-story" ${isFreshChat() && greetings.length ? '' : 'disabled'}>
            開始故事
        </button>
    `;
}

function renderProfile() {
    const page = root.querySelector('[data-page="profile"]');
    const character = currentCharacter();
    if (!character) {
        page.innerHTML = emptyState('尚未選擇角色', '選擇角色後即可在這裡閱讀人物資料。');
        return;
    }

    const data = character.data || character;
    const sections = [
        ['人物描述', data.description],
        ['性格摘要', data.personality],
        ['故事情境', data.scenario],
        ['創作者備註', data.creator_notes],
    ].filter(([, value]) => String(value || '').trim());

    page.innerHTML = `
        <div class="story-page-header"><small>CHARACTER PROFILE</small><h2>${escapeHtml(characterName())}</h2><p>資料直接讀取自目前角色卡。</p></div>
        <div class="story-profile-layout">
            <div class="story-profile-photo">${avatarUrl() ? `<img src="${avatarUrl()}" alt="${escapeHtml(characterName())}">` : '<i class="fa-solid fa-user"></i>'}</div>
            <div class="story-profile-sections">
                ${sections.map(([title, value]) => `<details open><summary>${escapeHtml(title)}</summary><p>${escapeHtml(String(value)).replaceAll('\n', '<br>')}</p></details>`).join('') || '<p class="story-muted">角色卡沒有可顯示的人物資料。</p>'}
            </div>
        </div>
    `;
}

function renderMemo() {
    const page = root.querySelector('[data-page="memo"]');
    page.innerHTML = `
        <div class="story-page-header"><small>PRIVATE MEMO</small><h2>備忘錄</h2><p>內容只保存在目前瀏覽器，不會自動送給 AI。</p></div>
        <label class="story-field story-memo-field">
            <span>${escapeHtml(characterName())}／目前聊天</span>
            <textarea id="story-memo-input" placeholder="記下關係變化、約定、重要物品或下一步安排……"></textarea>
        </label>
        <div class="story-inline-actions"><button class="story-primary-button" type="button" data-action="save-memo">儲存備忘錄</button><small id="story-memo-status"></small></div>
    `;
    page.querySelector('#story-memo-input').value = localStorage.getItem(memoStorageKey()) || '';
}

function renderJournal() {
    const page = root.querySelector('[data-page="journal"]');
    const chat = context()?.chat || [];
    const messages = chat.slice(-40).reverse();
    page.innerHTML = `
        <div class="story-page-header"><small>CHAT JOURNAL</small><h2>聊天日誌</h2><p>顯示目前聊天最近 40 則訊息，不另外複製聊天內容。</p></div>
        <div class="story-journal-list">
            ${messages.map((message, reverseIndex) => {
                const originalIndex = chat.length - 1 - reverseIndex;
                const speaker = message.is_user ? (context()?.name1 || '玩家') : (message.name || characterName());
                return `<article><span>${String(originalIndex).padStart(3, '0')}</span><div><strong>${escapeHtml(speaker)}</strong><p>${escapeHtml(plainText(message.mes, 300))}</p></div></article>`;
            }).join('') || emptyState('日誌尚未建立', '開始聊天後，訊息會顯示在這裡。')}
        </div>
    `;
}

function renderMusic() {
    const page = root.querySelector('[data-page="music"]');
    page.innerHTML = `
        <div class="story-page-header"><small>LOCAL AUDIO</small><h2>音樂</h2><p>選擇你裝置上的音訊檔播放；檔案不會上傳或寫入聊天。</p></div>
        <div class="story-music-card">
            <i class="fa-solid fa-compact-disc"></i>
            <label class="story-file-button">選擇音樂<input id="story-audio-file" type="file" accept="audio/*"></label>
            <strong id="story-audio-name">尚未選擇音樂</strong>
            <audio id="story-audio-player" controls></audio>
        </div>
    `;
}

function renderSettings() {
    const page = root.querySelector('[data-page="settings"]');
    const cfg = settings();
    const greetings = getGreetings();
    page.innerHTML = `
        <div class="story-page-header"><small>INTERFACE SETTINGS</small><h2>介面設定</h2><p>開場名稱以角色分開保存，不會修改角色卡原文。</p></div>
        <div class="story-settings-card">
            <label class="story-field"><span>APP 標題</span><input data-setting="appTitle" value="${escapeHtml(cfg.appTitle)}"></label>
            <label class="story-field"><span>副標題</span><input data-setting="subtitle" value="${escapeHtml(cfg.subtitle)}"></label>
            <label class="story-field"><span>強調色</span><input data-setting="accent" type="color" value="${escapeHtml(cfg.accent)}"></label>
            <label class="story-toggle"><input data-setting="showLauncher" type="checkbox" ${cfg.showLauncher ? 'checked' : ''}><span>顯示右下角 APP 按鈕</span></label>
            <label class="story-toggle"><input data-setting="autoOpenFreshChat" type="checkbox" ${cfg.autoOpenFreshChat ? 'checked' : ''}><span>新聊天時自動開啟 APP</span></label>
        </div>
        <div class="story-settings-card">
            <h3>${escapeHtml(characterName())}／開場按鈕名稱</h3>
            ${greetings.map((_, index) => `<label class="story-field"><span>開場 ${index + 1}</span><input data-opening-title="${index}" value="${escapeHtml(openingTitle(index))}"></label>`).join('') || '<p class="story-muted">目前角色沒有開場白。</p>'}
            <button class="story-primary-button" type="button" data-action="save-settings">儲存設定</button>
        </div>
    `;
}

function emptyState(title, message) {
    return `<div class="story-empty"><i class="fa-regular fa-folder-open"></i><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
}

function renderPage(pageName = activePage) {
    activePage = pageName;
    root.querySelectorAll('.story-page').forEach(page => page.classList.toggle('is-active', page.dataset.page === pageName));
    root.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('is-active', button.dataset.nav === pageName));

    const renderers = {
        home: renderHome,
        opening: renderOpening,
        profile: renderProfile,
        memo: renderMemo,
        journal: renderJournal,
        music: renderMusic,
        settings: renderSettings,
    };
    renderers[pageName]?.();
}

function applySettings() {
    const cfg = settings();
    root.style.setProperty('--story-accent', cfg.accent);
    root.querySelector('[data-bind="app-title"]').textContent = cfg.appTitle;
    root.querySelector('[data-bind="subtitle"]').textContent = cfg.subtitle;
    root.querySelector('#story-app-launcher').hidden = !cfg.enabled || !cfg.showLauncher;
}

function openApp(page = 'home') {
    if (!settings().enabled) return;
    applySettings();
    root.querySelector('.story-app-shell').classList.add('is-open');
    root.querySelector('.story-app-shell').setAttribute('aria-hidden', 'false');
    document.body.classList.add('story-app-open');
    renderPage(page);
}

function closeApp() {
    root.querySelector('.story-app-shell').classList.remove('is-open');
    root.querySelector('.story-app-shell').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('story-app-open');
}

function waitForSwipe(previousIndex, timeout = 1600) {
    return new Promise(resolve => {
        const started = Date.now();
        const poll = () => {
            if (currentGreetingIndex() !== previousIndex || Date.now() - started > timeout) return resolve();
            window.setTimeout(poll, 50);
        };
        poll();
    });
}

function swipeButton(direction) {
    const selectors = direction === 'right'
        ? ['#chat .mes[mesid="0"] .swipe_right', '#chat .mes[data-message-id="0"] .swipe_right']
        : ['#chat .mes[mesid="0"] .swipe_left', '#chat .mes[data-message-id="0"] .swipe_left'];
    return selectors.map(selector => document.querySelector(selector)).find(Boolean);
}

async function switchGreeting(targetIndex) {
    if (!isFreshChat()) throw new Error('目前聊天已經開始，無法切換開場。');
    const greetings = getGreetings();
    if (targetIndex < 0 || targetIndex >= greetings.length) throw new Error('找不到選擇的開場白。');

    let guard = greetings.length + 2;
    while (currentGreetingIndex() !== targetIndex && guard-- > 0) {
        const current = currentGreetingIndex();
        const direction = targetIndex > current ? 'right' : 'left';
        const button = swipeButton(direction);
        if (!button) throw new Error('找不到 SillyTavern 的開場切換按鈕。請確認目前是剛建立的新聊天。');
        button.click();
        await waitForSwipe(current);
    }

    if (currentGreetingIndex() !== targetIndex) throw new Error('開場切換未完成，請更新 SillyTavern 後再試。');
}

async function startStory() {
    const button = root.querySelector('[data-action="start-story"]');
    button?.setAttribute('disabled', 'disabled');
    try {
        await switchGreeting(selectedOpening);
        globalThis.toastr?.success?.(`已切換為「${openingTitle(selectedOpening)}」`);
        closeApp();
        document.querySelector('#send_textarea')?.focus();
    } catch (error) {
        console.error(`[${MODULE_NAME}]`, error);
        globalThis.toastr?.error?.(error.message || '無法切換開場。');
        button?.removeAttribute('disabled');
    }
}

function saveMemo() {
    const textarea = root.querySelector('#story-memo-input');
    localStorage.setItem(memoStorageKey(), textarea?.value || '');
    const status = root.querySelector('#story-memo-status');
    if (status) status.textContent = `已於 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 儲存`;
    globalThis.toastr?.success?.('備忘錄已儲存');
}

function saveInterfaceSettings() {
    const cfg = settings();
    root.querySelectorAll('[data-setting]').forEach(input => {
        cfg[input.dataset.setting] = input.type === 'checkbox' ? input.checked : input.value;
    });

    cfg.openingTitles[characterKey()] ||= [];
    root.querySelectorAll('[data-opening-title]').forEach(input => {
        cfg.openingTitles[characterKey()][Number(input.dataset.openingTitle)] = input.value.trim();
    });
    saveSettings();
    applySettings();
    globalThis.toastr?.success?.('介面設定已儲存');
    renderPage('settings');
}

function bindRootEvents() {
    root.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;

        if (button.dataset.nav) return renderPage(button.dataset.nav);
        if (button.dataset.openingIndex !== undefined) {
            selectedOpening = Number(button.dataset.openingIndex);
            root.querySelectorAll('[data-opening-index]').forEach(item => item.classList.toggle('is-selected', Number(item.dataset.openingIndex) === selectedOpening));
            return;
        }

        const actions = {
            open: () => openApp('home'),
            home: () => renderPage('home'),
            close: closeApp,
            continue: closeApp,
            'start-story': startStory,
            'save-memo': saveMemo,
            'save-settings': saveInterfaceSettings,
        };
        actions[button.dataset.action]?.();
    });

    root.addEventListener('change', event => {
        if (event.target.id !== 'story-audio-file') return;
        const file = event.target.files?.[0];
        if (!file) return;
        if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
        audioObjectUrl = URL.createObjectURL(file);
        const player = root.querySelector('#story-audio-player');
        player.src = audioObjectUrl;
        root.querySelector('#story-audio-name').textContent = file.name;
        player.play().catch(() => {});
    });

    root.querySelector('#story-app-launcher').addEventListener('click', () => openApp('home'));
}

function addExtensionSettingsPanel() {
    const container = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!container || document.querySelector('#story-app-extension-settings')) return;
    const panel = document.createElement('div');
    panel.id = 'story-app-extension-settings';
    panel.className = 'extension_container';
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Story App Interface</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p>將目前角色與聊天顯示為 APP 風格介面。</p>
                <label class="checkbox_label"><input id="story-app-enabled" type="checkbox"><span>啟用擴充</span></label>
                <input id="story-app-open-settings" class="menu_button" type="button" value="開啟 APP 設定">
            </div>
        </div>
    `;
    container.append(panel);
    panel.querySelector('#story-app-enabled').checked = settings().enabled;
    panel.querySelector('#story-app-enabled').addEventListener('change', event => {
        settings().enabled = event.target.checked;
        saveSettings();
        applySettings();
        if (!event.target.checked) closeApp();
    });
    panel.querySelector('#story-app-open-settings').addEventListener('click', () => openApp('settings'));
}

function handleChatChanged() {
    selectedOpening = currentGreetingIndex();
    if (root?.querySelector('.story-app-shell.is-open')) renderPage(activePage);
    if (settings().autoOpenFreshChat && isFreshChat()) window.setTimeout(() => openApp('home'), 250);
}

function init() {
    if (document.getElementById(ROOT_ID)) return;
    const ctx = context();
    if (!ctx) return;
    settings();

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = template();
    document.body.append(root);

    bindRootEvents();
    addExtensionSettingsPanel();
    applySettings();
    renderPage('home');

    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, handleChatChanged);
    ctx.eventSource.on(ctx.event_types.CHARACTER_EDITED, handleChatChanged);
    ctx.eventSource.on(ctx.event_types.MESSAGE_SENT, handleChatChanged);
    ctx.eventSource.on(ctx.event_types.MESSAGE_RECEIVED, handleChatChanged);
    console.log(`[${MODULE_NAME}] loaded`);
}

let bootAttempts = 0;

function scheduleInit() {
    if (document.getElementById(ROOT_ID)) return;

    const ctx = context();
    if (!document.body || !ctx?.extensionSettings || !ctx?.eventSource || !ctx?.event_types) {
        if (bootAttempts++ < 60) window.setTimeout(scheduleInit, 250);
        return;
    }

    try {
        init();
    } catch (error) {
        console.error(`[${MODULE_NAME}] initialization failed`, error);
        document.getElementById(ROOT_ID)?.remove();
        root = null;
        if (bootAttempts++ < 60) window.setTimeout(scheduleInit, 500);
    }
}

// Initialize immediately when possible and retry independently of lifecycle
// timing. This also works when an extension is enabled after APP_READY fired.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInit, { once: true });
} else {
    scheduleInit();
}

window.setTimeout(scheduleInit, 500);
window.setTimeout(scheduleInit, 2000);

const lifecycleContext = context();
if (lifecycleContext?.eventSource && lifecycleContext?.event_types) {
    if (lifecycleContext.event_types.APP_INITIALIZED) {
        lifecycleContext.eventSource.on(lifecycleContext.event_types.APP_INITIALIZED, () => window.setTimeout(scheduleInit, 0));
    }
    if (lifecycleContext.event_types.APP_READY) {
        lifecycleContext.eventSource.on(lifecycleContext.event_types.APP_READY, () => window.setTimeout(scheduleInit, 0));
    }
}
