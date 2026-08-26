import { eventSource, event_types, stopGeneration } from "../../../../script.js";

const MODULE_NAME = "st-latency-profiler";
const MODULE_DISPLAY_NAME = "鱼缸后端监控";
const BACKEND_BASE = "/api/plugins/st-latency-monitor";
const UI_STORAGE_KEY = `${MODULE_NAME}:ui`;
const UI_RETRY_MS = 3000;
const HISTORY_PAGE_SIZE = 20;
const HISTORY_PREVIEW_COUNT = 5;
const GENERATION_RECOVERY_WINDOW_MS = 15000;
const MINIMIZED_BUTTON_MARGIN = 18;
const MINIMIZED_BUTTON_SIZE = 34;
const MINIMIZED_BUTTON_DRAG_THRESHOLD = 4;
const MOBILE_OPEN_GUARD_MS = 360;
const WAITING_QUEUE_EDIT_LOCK_MS = 1500;
const PENDING_INJECTION_SOURCE_TTL_MS = 10000;
const SYNTHETIC_ESCAPE_IGNORE_WINDOW_MS = 800;
const DAILY_SUMMARY_DAY_OPTIONS = [7, 14, 30];
let stRequestHeadersFactoryPromise = null;
const THEME_MODE_SEQUENCE = ["dawn", "rose", "night", "follow_tavern"];
const ACTIONABLE_ABNORMAL_TYPES = new Set([
    "failed_without_output",
    "failed_after_partial_output",
    "failed_generation",
    "request_timeout",
    "stream_interrupted",
    "suspected_incomplete_generation",
]);

const DEFAULT_SECTION_OPEN_STATES = {
    status: true,
    settings: false,
    summary: true,
    runs: true,
    history: true,
};

const DEFAULT_OUTPUT_CARD_FIELDS = {
    showInjectionDetails: false,
    showPricingDetails: false,
    showContextVolume: false,
    showExtensionDetails: false,
    maskChatTitle: false,
};

const DEFAULT_SETTINGS_SUBSECTION_OPEN_STATES = {
    appearance_theme: false,
    appearance_minimized_color: false,
};

const RUN_CHAT_MAP_REVISION = 2;
let pendingUiSettingsMigrationSave = false;

const DEFAULT_UI_SETTINGS = {
    autoRefreshSeconds: 15,
    abnormalOnly: false,
    cacheHitOnly: false,
    currentChatOnly: false,
    dailySummaryDays: 14,
    activeRequestPurpose: "chat_main_reply",
    activeMainView: "monitor",
    settingsCategory: "none",
    keepRunningAfterClose: true,
    themeMode: "follow_tavern",
    minimizedButtonColorMode: "follow_theme",
    minimizedButtonCustomColor: "#67d98f",
    minimizedButtonStrokeColor: "#ffffff",
    minimizedButtonBackgroundMode: "mist",
    minimizedButtonPosition: null,
    runFloorMap: {},
    runChatMap: {},
    runChatMapRevision: RUN_CHAT_MAP_REVISION,
    sectionOpenStates: DEFAULT_SECTION_OPEN_STATES,
    pricingConfigByModel: {},
    pricingPanelOpenStates: {},
    pricingPeakValleyOpenStates: {},
    outputCardFields: DEFAULT_OUTPUT_CARD_FIELDS,
};

const PERMISSION_LABELS = {
    no_backend: "无后台权限",
    local_full: "本地部署完整权限",
    cloud_full: "云端部署完整权限",
};

const RUNTIME_MODE_LABELS = {
    auto: "自动选择",
    no_backend: "无后台权限",
    local_full: "本地部署完整权限",
    cloud_full: "云端部署完整权限",
};

const ENTRY_ORIGIN_LABELS = {
    main_interface_generation: "主界面生成记录",
    standalone_page: `${MODULE_DISPLAY_NAME} 独立页面`,
};

const SOURCE_LABELS = {
    custom: "自定义接口",
    openai: "OpenAI 接口",
    openrouter: "OpenRouter 接口",
    claude: "Claude 接口",
    gemini: "Gemini 接口",
    textgenerationwebui: "文本生成网页界面接口",
    koboldcpp: "KoboldCpp 接口",
    novelai: "NovelAI 接口",
};

const REQUEST_PURPOSE_LABELS = {
    chat_main_reply: "正文回复",
    non_chat_generation: "拓展调用",
    plugin_internal_request: "插件内部请求",
};

const REQUEST_PLUGIN_MATCH_MODE_LABELS = {
    explicit: "调用方显式上报",
    explicit_label_only: "仅显式上报名称",
    fingerprint: "后端指纹识别",
    learned_rule: "等待区规则复用",
    explicit_purpose_only: "仅显式上报用途",
    fallback_unknown: "未知拓展兜底",
    manual_waiting_queue: "等待区手动标注",
    none: "未识别",
};

const KNOWN_PLUGIN_LABELS = {
    "st-baibai-inkwell": "柏宝砚",
    "st-baibai-book": "柏宝书",
    "baibai_book": "柏宝书",
    "schedule-planner": "构画",
    "st-sevendayscal": "构画",
    "st-seven-days-cal": "构画",
    "unknown_plugin": "未知拓展调用",
};

const KNOWN_INJECTION_SOURCE_LABELS = {
    ...KNOWN_PLUGIN_LABELS,
    "abstract-external-phone": "Abstract外置手机",
    "abstract_external_phone": "Abstract外置手机",
    "abstract-phone": "Abstract外置手机",
    "abstract_phone": "Abstract外置手机",
};

const TRACE_SOURCE_LABELS = {
    extension_prompt: "扩展提示词",
    chat_injects: "聊天注入",
    memory_summary: "记忆摘要",
    smart_context: "智能上下文",
    chat_vectors: "聊天向量检索",
    data_bank_vectors: "资料库向量检索",
    world_info: "世界书",
    authors_note: "作者注释",
    instruct: "指令模式",
};

const ABNORMAL_TYPE_LABELS = {
    failed_without_output: "未输出即失败",
    failed_after_partial_output: "部分输出后失败",
    failed_generation: "完整生成失败",
    request_timeout: "请求超时",
    stream_interrupted: "流式中断",
    suspected_incomplete_generation: "疑似未完整生成",
};

const ABNORMAL_BILLING_STATUS_LABELS = {
    paid_incomplete: "已付费未完成",
    usage_unconfirmed: "费用未确认",
};

const FAILED_STAGE_LABELS = {
    preprocess: "预处理阶段",
    retrieval: "检索阶段",
    prompt_assembly: "提示词组装阶段",
    request_model: "请求模型阶段",
    before_first_output: "首个输出返回前",
    full_return: "完整返回阶段",
};
const COMPLETION_REASON_LABELS = {
    stop: "自然结束",
    stop_sequence: "命中停止词",
    end_turn: "自然结束",
    tool_calls: "工具调用",
    function_call: "函数调用",
    max_tokens: "达到最大输出",
    safety: "安全拦截",
    recitation: "引用拦截",
    content_filter: "内容过滤",
    blocklist: "命中拦截词",
    prohibited_content: "命中限制内容",
    spii: "敏感信息拦截",
    malformed_function_call: "函数调用异常",
    other: "其他结束原因",
    unspecified: "未说明结束原因",
};

const SUGGESTION_SCOPE_LABELS = {
    failed_generation_only: "仅生成失败/中断相关异常时显示",
    all_abnormal: "所有异常时显示",
};

const THEME_MODE_LABELS = {
    dawn: "主题：晨曦",
    rose: "主题：暮粉",
    night: "主题：夜",
    follow_tavern: "主题：跟随酒馆模式",
};

const SETTINGS_CATEGORY_LABELS = {
    none: "未展开",
    runtime: "运行与建议",
    output_card: "排障卡",
    pricing: "价格估算",
    appearance: "外观与主题",
};

const MINIMIZED_BUTTON_COLOR_PRESETS = [
    { key: "mist_blue", label: "晨雾蓝", color: "#4F6A88" },
    { key: "night_cyan", label: "夜色青", color: "#76C6D9" },
    { key: "tavern_green", label: "酒馆绿", color: "#67D98F" },
    { key: "mint", label: "薄荷绿", color: "#86F0C2" },
    { key: "seafoam", label: "海沫青", color: "#52D1C7" },
    { key: "teal", label: "青湖蓝", color: "#36C4D6" },
    { key: "sky", label: "天青", color: "#4DB4FF" },
    { key: "ice", label: "冰蓝", color: "#8FD3FF" },
    { key: "electric", label: "电蓝", color: "#3FA7FF" },
    { key: "indigo", label: "靛蓝", color: "#6F8DFF" },
    { key: "violet", label: "紫罗兰", color: "#9B8CFF" },
    { key: "lavender", label: "薰衣草", color: "#B39DFF" },
    { key: "orchid", label: "兰紫", color: "#C087FF" },
    { key: "rose_purple", label: "玫紫", color: "#E48CFF" },
    { key: "rose", label: "樱粉", color: "#FF8FB1" },
    { key: "magenta", label: "玫红", color: "#FF6FAE" },
    { key: "watermelon", label: "西瓜红", color: "#FF6B84" },
    { key: "coral", label: "珊瑚橙", color: "#FF8A7A" },
    { key: "peach", label: "蜜桃橙", color: "#FFB26B" },
    { key: "amber", label: "琥珀金", color: "#FFC857" },
    { key: "gold", label: "金砂", color: "#F4C95D" },
    { key: "lime", label: "青柠", color: "#B7E36D" },
    { key: "leaf", label: "嫩叶绿", color: "#6EE7A8" },
    { key: "sage", label: "鼠尾草", color: "#7CC5B3" },
];

const MINIMIZED_BUTTON_COLOR_MODE_LABELS = {
    follow_theme: "跟随酒馆主题配色",
    custom: "自定义颜色",
};

const MINIMIZED_BUTTON_BACKGROUND_MODE_LABELS = {
    mist: "半透明灰底",
    transparent: "透明底",
};

const PRICING_CURRENCY_LABELS = {
    usd: "美元",
    cny: "人民币",
};

const PRICING_NUMBER_FIELDS = [
    "input_price_per_million",
    "cached_input_price_per_million",
    "output_price_per_million",
    "peak_input_price_per_million",
    "peak_cached_input_price_per_million",
    "peak_output_price_per_million",
    "valley_input_price_per_million",
    "valley_cached_input_price_per_million",
    "valley_output_price_per_million",
];

const PRICING_TIME_FIELDS = [
    "peak_start_time",
    "peak_end_time",
];

const PRICING_BOOLEAN_FIELDS = [
    "peak_valley_enabled",
];

const state = {
    pageRoot: null,
    launcherRoot: null,
    uiReady: false,
    eventsBound: false,
    nativeMenuItemRegistered: false,
    uiSettings: loadUiSettings(),
    settings: null,
    status: null,
    runs: [],
    summary: null,
    dailySummary: null,
    isRefreshing: false,
    isSaving: false,
    backendReady: false,
    apiStatus: "正在连接后台监控接口",
    apiError: "",
    refreshTimerId: null,
    uiRetryTimerId: null,
    extensionDisabled: false,
    initialDataLoaded: false,
    outgoingGenerationHookInstalled: false,
    generationSettingsHookInstalled: false,
    activeGenerationRequests: new Map(),
    sillyTavernGenerationActive: false,
    sillyTavernGenerationRecoveryUntil: 0,
    pendingInjectionSource: null,
    chatWindowContext: {
        chatKey: "",
        chatName: "",
        isHome: true,
        detectedAt: 0,
        visibleFloorLabels: [],
        latestFloorLabel: "",
    },
    nativeMenuObserver: null,
    nativeMenuObserverRoot: null,
    nativeMenuRepairScheduled: false,
    nativeMenuObserverSilenced: false,
    pageOpen: false,
    pageMinimized: false,
    pageOpenRequestAt: 0,
    pageOpenGuardUntil: 0,
    syntheticEscapeIgnoreUntil: 0,
    confirmDialog: null,
    pageScrollTop: 0,
    pagePosition: null,
    pageHeight: null,
    pageDrag: null,
    pageResize: null,
    bodyScrollLocked: false,
    bodyScrollLockTop: 0,
    viewportSyncQueued: false,
    minimizedButtonDrag: null,
    minimizedButtonSuppressClickUntil: 0,
    minimizedButtonLongPressTimerId: null,
    minimizedButtonLongPressTriggered: false,
    chatUiObserver: null,
    chatUiNormalizeScheduled: false,
    historyDialogOpen: false,
    historyDeleteMode: false,
    historyAbnormalOnly: false,
    historyPage: 1,
    historyTotal: 0,
    historyRuns: [],
    historyAllRuns: [],
    historyLoading: false,
    historyError: "",
    historyScrollTop: 0,
    recentAbnormalRuns: [],
    recentAbnormalLoading: false,
    waitingQueueEntries: [],
    waitingQueueLoading: false,
    waitingQueueError: "",
    waitingQueueDrafts: {},
    waitingQueueEditLockRunId: "",
    waitingQueueEditLockUntil: 0,
    waitingQueueRenderPending: false,
    colorWheelRenderPending: false,
    pluginRules: [],
    pluginRulesLoading: false,
    pluginRulesError: "",
    selectedHistoryRunIds: new Set(),
    expandedDailySummaryDateKeys: new Set(),
    expandedWaitingQueueRunIds: new Set(),
    expandedPluginRuleIds: new Set(),
    expandedRunIds: new Set(),
    expandedSuggestionRunIds: new Set(),
    minimizedButtonFlashActive: false,
    minimizedButtonFlashTimerId: null,
    minimizedButtonAlertPending: false,
    pendingGenerationIntervention: null,
    lastDismissedGenerationInterventionKey: "",
    lastSeenAbnormalRunId: "",
    abnormalAlertInitialized: false,
    settingsSubsectionOpenStates: { ...DEFAULT_SETTINGS_SUBSECTION_OPEN_STATES },
};

function loadUiSettings() {
    try {
        const raw = localStorage.getItem(UI_STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_UI_SETTINGS };
        }

        const parsed = JSON.parse(raw);
        const parsedRunChatMapRevision = Number(parsed?.runChatMapRevision) || 0;
        const shouldResetRunChatMap = parsedRunChatMapRevision !== RUN_CHAT_MAP_REVISION;
        if (shouldResetRunChatMap) {
            pendingUiSettingsMigrationSave = true;
        }

        return {
            ...DEFAULT_UI_SETTINGS,
            ...parsed,
            dailySummaryDays: normalizeDailySummaryDays(parsed?.dailySummaryDays),
            activeRequestPurpose: normalizeRequestPurposeMode(parsed?.activeRequestPurpose),
            activeMainView: normalizeMainViewMode(parsed?.activeMainView),
            settingsCategory: normalizeSettingsCategory(parsed?.settingsCategory),
            themeMode: normalizeThemeMode(migrateLegacyThemeMode(parsed?.themeMode)),
            minimizedButtonColorMode: normalizeMinimizedButtonColorMode(parsed?.minimizedButtonColorMode),
            minimizedButtonCustomColor: normalizeMinimizedButtonCustomColor(parsed?.minimizedButtonCustomColor, parsed?.minimizedButtonColorMode),
            minimizedButtonStrokeColor: normalizeMinimizedButtonStrokeColor(parsed?.minimizedButtonStrokeColor),
            minimizedButtonBackgroundMode: normalizeMinimizedButtonBackgroundMode(parsed?.minimizedButtonBackgroundMode),
            minimizedButtonPosition: normalizeMinimizedButtonPosition(parsed?.minimizedButtonPosition),
            runFloorMap: parsed?.runFloorMap && typeof parsed.runFloorMap === "object" ? parsed.runFloorMap : {},
            runChatMap: shouldResetRunChatMap ? {} : (parsed?.runChatMap && typeof parsed.runChatMap === "object" ? parsed.runChatMap : {}),
            runChatMapRevision: RUN_CHAT_MAP_REVISION,
            sectionOpenStates: normalizeSectionOpenStates(parsed?.sectionOpenStates),
            pricingConfigByModel: normalizePricingConfigMap(parsed?.pricingConfigByModel),
            pricingPanelOpenStates: parsed?.pricingPanelOpenStates && typeof parsed.pricingPanelOpenStates === "object" ? parsed.pricingPanelOpenStates : {},
            pricingPeakValleyOpenStates: parsed?.pricingPeakValleyOpenStates && typeof parsed.pricingPeakValleyOpenStates === "object" ? parsed.pricingPeakValleyOpenStates : {},
            outputCardFields: normalizeOutputCardFields(parsed?.outputCardFields),
        };
    } catch {
        return { ...DEFAULT_UI_SETTINGS };
    }
}

function normalizeOutputCardFields(value) {
    return {
        ...DEFAULT_OUTPUT_CARD_FIELDS,
        ...(value && typeof value === "object" ? value : {}),
    };
}

function normalizeSectionOpenStates(value) {
    return {
        ...DEFAULT_SECTION_OPEN_STATES,
        ...(value && typeof value === "object" ? value : {}),
    };
}

function normalizeRequestPurposeMode(value) {
    return value === "non_chat_generation" ? "non_chat_generation" : "chat_main_reply";
}

function getRunRequestPurpose(run) {
    return normalizeRequestPurposeMode(run?.request_purpose);
}

function filterRunsByRequestPurpose(runs, requestPurpose = getActiveRequestPurpose()) {
    if (!Array.isArray(runs)) {
        return [];
    }

    const normalizedPurpose = normalizeRequestPurposeMode(requestPurpose);
    return runs.filter((run) => getRunRequestPurpose(run) === normalizedPurpose);
}

function normalizeMainViewMode(value) {
    return value === "settings" || value === "status" || value === "waiting_queue" || value === "daily_summary" ? value : "monitor";
}

function normalizeDailySummaryDays(value) {
    const parsed = Math.trunc(Number(value));
    return DAILY_SUMMARY_DAY_OPTIONS.includes(parsed) ? parsed : DEFAULT_UI_SETTINGS.dailySummaryDays;
}

function normalizeSettingsCategory(value) {
    return Object.prototype.hasOwnProperty.call(SETTINGS_CATEGORY_LABELS, value)
        ? value
        : DEFAULT_UI_SETTINGS.settingsCategory;
}

function getMinimizedButtonColorPreset(value) {
    return MINIMIZED_BUTTON_COLOR_PRESETS.find((item) => item.key === value) || null;
}

function normalizeHexColor(value, fallback) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
        return raw.toLowerCase();
    }

    return fallback;
}

function normalizeMinimizedButtonPosition(value) {
    if (!value || typeof value !== "object") {
        return null;
    }

    const left = Number(value.left);
    const top = Number(value.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
    }

    return { left, top };
}

function migrateLegacyThemeMode(value) {
    if (value === "day" || value === "day_warm" || value === "day_cool" || value === "linen") {
        return "dawn";
    }

    if (value === "night") {
        return "night";
    }
    return value;
}

function normalizeThemeMode(value) {
    return THEME_MODE_SEQUENCE.includes(value) ? value : DEFAULT_UI_SETTINGS.themeMode;
}

function normalizeMinimizedButtonColorMode(value) {
    if (value === "custom" || value === "follow_theme") {
        return value;
    }

    return getMinimizedButtonColorPreset(value)
        ? "custom"
        : DEFAULT_UI_SETTINGS.minimizedButtonColorMode;
}

function normalizeMinimizedButtonCustomColor(value, legacyMode = "") {
    const legacyPresetColor = getMinimizedButtonColorPreset(legacyMode)?.color || "";
    return normalizeHexColor(value, normalizeHexColor(legacyPresetColor, DEFAULT_UI_SETTINGS.minimizedButtonCustomColor));
}

function normalizeMinimizedButtonStrokeColor(value) {
    return normalizeHexColor(value, DEFAULT_UI_SETTINGS.minimizedButtonStrokeColor);
}

function normalizeMinimizedButtonBackgroundMode(value) {
    return Object.prototype.hasOwnProperty.call(MINIMIZED_BUTTON_BACKGROUND_MODE_LABELS, value)
        ? value
        : DEFAULT_UI_SETTINGS.minimizedButtonBackgroundMode;
}

function getThemeModeLabel(value) {
    return THEME_MODE_LABELS[normalizeThemeMode(value)] || THEME_MODE_LABELS.night;
}

function getSettingsCategoryLabel(value) {
    return SETTINGS_CATEGORY_LABELS[normalizeSettingsCategory(value)] || SETTINGS_CATEGORY_LABELS.runtime;
}

function getMinimizedButtonColorModeLabel(value) {
    return MINIMIZED_BUTTON_COLOR_MODE_LABELS[normalizeMinimizedButtonColorMode(value)] || MINIMIZED_BUTTON_COLOR_MODE_LABELS.follow_theme;
}

function getMinimizedButtonBackgroundModeLabel(value) {
    return MINIMIZED_BUTTON_BACKGROUND_MODE_LABELS[normalizeMinimizedButtonBackgroundMode(value)] || MINIMIZED_BUTTON_BACKGROUND_MODE_LABELS.mist;
}

function getMinimizedButtonConnectedColorValue() {
    const colorMode = normalizeMinimizedButtonColorMode(state.uiSettings.minimizedButtonColorMode);
    if (colorMode === "follow_theme") {
        return "var(--stlp-primary)";
    }

    return normalizeMinimizedButtonCustomColor(state.uiSettings.minimizedButtonCustomColor);
}

function getMinimizedButtonStrokeColorValue() {
    return normalizeMinimizedButtonStrokeColor(state.uiSettings.minimizedButtonStrokeColor);
}

function getMinimizedButtonBackgroundValues() {
    return {
        background: "transparent",
        hoverBackground: "transparent",
        borderColor: "transparent",
        shadow: "none",
    };
}

function clearMinimizedButtonFlashTimer() {
    if (!state.minimizedButtonFlashTimerId) {
        return;
    }

    window.clearTimeout(state.minimizedButtonFlashTimerId);
    state.minimizedButtonFlashTimerId = null;
}

function triggerMinimizedButtonFlash() {
    clearMinimizedButtonFlashTimer();
    state.minimizedButtonFlashActive = true;
    safeRenderPage();
    state.minimizedButtonFlashTimerId = window.setTimeout(() => {
        state.minimizedButtonFlashActive = false;
        state.minimizedButtonFlashTimerId = null;
        safeRenderPage();
    }, 1500);
}

function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) {
        return false;
    }

    if (element.closest(".stlp-page-host")) {
        return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.pointerEvents !== "none";
}

function findVisibleElement(selectors) {
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (isVisibleElement(element)) {
            return element;
        }
    }

    return null;
}

function findSillyTavernStopGenerationTrigger() {
    const directMatch = findVisibleElement([
        "#mes_stop",
        "#stop_generation",
        "#stopGenerate",
        '[aria-label*="stop" i]',
        '[title*="stop" i]',
        '[aria-label*="abort" i]',
        '[title*="abort" i]',
    ]);
    if (directMatch) {
        return directMatch;
    }

    const candidates = Array.from(document.querySelectorAll("button, .menu_button, [role='button'], .interactable"));
    return candidates.find((candidate) => {
        if (!(candidate instanceof HTMLElement) || !isVisibleElement(candidate)) {
            return false;
        }

        const text = [
            candidate.textContent,
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("title"),
            candidate.id,
            candidate.className,
        ].join(" ");

        return /(停止|中止|stop|abort)/i.test(text);
    }) ?? null;
}

function hasRecentGenerationRecoveryWindow() {
    return Date.now() < Number(state.sillyTavernGenerationRecoveryUntil || 0);
}

function isSillyTavernGenerationLikelyActive() {
    return Boolean(
        state.sillyTavernGenerationActive
        || hasRecentGenerationRecoveryWindow()
        || findSillyTavernStopGenerationTrigger(),
    );
}

function markSillyTavernGenerationStarted() {
    state.sillyTavernGenerationActive = true;
    state.sillyTavernGenerationRecoveryUntil = 0;
}

function markSillyTavernGenerationStopped() {
    state.sillyTavernGenerationActive = false;
    state.sillyTavernGenerationRecoveryUntil = Date.now() + GENERATION_RECOVERY_WINDOW_MS;
}

function markSillyTavernGenerationEnded() {
    state.sillyTavernGenerationActive = false;
    state.sillyTavernGenerationRecoveryUntil = 0;
}

function buildGenerationInterventionKey(kind, suffix = "") {
    return `${kind}:${suffix || "default"}`;
}

function clearPendingGenerationIntervention({ rememberDismissed = false } = {}) {
    if (rememberDismissed && state.pendingGenerationIntervention?.key) {
        state.lastDismissedGenerationInterventionKey = state.pendingGenerationIntervention.key;
    }

    state.pendingGenerationIntervention = null;
}

function ensureMinimizedButtonVisibleForAlert() {
    if (state.pageOpen || state.uiSettings.keepRunningAfterClose === false) {
        return;
    }

    state.pageOpen = true;
    state.pageMinimized = true;
    state.confirmDialog = null;
    state.historyDialogOpen = false;
    syncBodyScrollLock();
    scheduleAutoRefresh();
}

function queueGenerationInterventionAlert({
    kind,
    title,
    text,
    keySuffix = "",
    runId = "",
} = {}) {
    const normalizedKind = typeof kind === "string" && kind.trim() ? kind.trim() : "generation";
    const key = buildGenerationInterventionKey(normalizedKind, keySuffix);
    if (state.pendingGenerationIntervention?.key === key || state.lastDismissedGenerationInterventionKey === key) {
        triggerMinimizedButtonFlash();
        return;
    }

    state.pendingGenerationIntervention = {
        key,
        kind: normalizedKind,
        title: title || "这次生成大概率不会正常返回",
        text: text || "后端监控已经识别到明确异常，这次大概率不会再正常生成。要现在尝试中止酒馆当前这次生成吗？",
        runId,
    };

    if (state.pageOpen && !state.pageMinimized) {
        openPendingGenerationInterventionDialog();
        return;
    }

    ensureMinimizedButtonVisibleForAlert();
    safeRenderPage();
}

function openPendingGenerationInterventionDialog() {
    const pending = state.pendingGenerationIntervention;
    if (!pending) {
        return;
    }

    state.confirmDialog = {
        type: "generation-intervention",
        title: pending.title,
        text: pending.text,
        runId: pending.runId || "",
    };
    safeRenderPage();
}

function isMonitorRootElement(element) {
    return element instanceof Element && Boolean(element.closest("#stlp_page"));
}

function shouldIgnoreSyntheticEscapeForMonitor(event) {
    return Boolean(
        event?.key === "Escape"
        && event.isTrusted === false
        && Date.now() < Number(state.syntheticEscapeIgnoreUntil || 0)
    );
}

function dispatchEscapeStopGeneration() {
    state.syntheticEscapeIgnoreUntil = Date.now() + SYNTHETIC_ESCAPE_IGNORE_WINDOW_MS;
    const eventInit = {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
    };
    const targets = [];
    if (document.activeElement && !isMonitorRootElement(document.activeElement)) {
        targets.push(document.activeElement);
    }
    targets.push(document);

    for (const target of new Set(targets.filter(Boolean))) {
        target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    }

    if (window.jQuery) {
        window.jQuery(document).trigger(window.jQuery.Event("keydown", eventInit));
        window.jQuery(document).trigger(window.jQuery.Event("keyup", eventInit));
    }
}

function getGenerationRequestAbortSignal(input, init) {
    if (init?.signal && typeof init.signal.aborted === "boolean") {
        return init.signal;
    }

    if (input instanceof Request && input.signal && typeof input.signal.aborted === "boolean") {
        return input.signal;
    }

    return null;
}

function registerActiveGenerationRequest() {
    const requestId = `generation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const forceAbortController = typeof AbortController === "function" ? new AbortController() : null;
    const entry = {
        requestId,
        startedAt: Date.now(),
        forceAbortController,
    };

    state.activeGenerationRequests.set(requestId, entry);
    if (state.pageOpen && state.pageMinimized) {
        safeRenderPage();
    }
    return entry;
}

function removeActiveGenerationRequest(requestId) {
    if (!requestId) {
        return;
    }

    if (state.activeGenerationRequests.delete(requestId) && state.pageOpen && state.pageMinimized) {
        safeRenderPage();
    }
}

function getAbortableGenerationRequestCount() {
    if (typeof AbortController !== "function") {
        return 0;
    }

    let count = 0;
    for (const entry of state.activeGenerationRequests.values()) {
        if (entry?.forceAbortController instanceof AbortController && !entry.forceAbortController.signal.aborted) {
            count += 1;
        }
    }

    return count;
}

function hasAbortableGenerationRequest() {
    return getAbortableGenerationRequestCount() > 0;
}

function clearMinimizedButtonLongPressTimer() {
    if (!state.minimizedButtonLongPressTimerId) {
        return;
    }

    clearTimeout(state.minimizedButtonLongPressTimerId);
    state.minimizedButtonLongPressTimerId = null;
}

function buildTrackedGenerationRequestSignal(input, init, entry) {
    if (typeof AbortController !== "function" || !(entry?.forceAbortController instanceof AbortController)) {
        return getGenerationRequestAbortSignal(input, init);
    }

    const combinedController = new AbortController();
    const abortCombined = (signal) => {
        if (combinedController.signal.aborted) {
            return;
        }

        combinedController.abort(signal?.reason);
    };

    const originalSignal = getGenerationRequestAbortSignal(input, init);
    if (originalSignal) {
        if (originalSignal.aborted) {
            abortCombined(originalSignal);
        } else {
            originalSignal.addEventListener("abort", () => abortCombined(originalSignal), { once: true });
        }
    }

    entry.forceAbortController.signal.addEventListener("abort", () => abortCombined(entry.forceAbortController.signal), { once: true });
    return combinedController.signal;
}

function buildTrackedGenerationRequestInit(input, init, patchedInit, entry) {
    const nextInit = patchedInit
        ? { ...patchedInit }
        : (init && typeof init === "object" ? { ...init } : {});
    const trackedSignal = buildTrackedGenerationRequestSignal(input, init, entry);
    if (trackedSignal) {
        nextInit.signal = trackedSignal;
    }

    return nextInit;
}

function monitorGenerationResponseLifecycle(response, requestId) {
    if (!(response instanceof Response) || typeof response.clone !== "function") {
        removeActiveGenerationRequest(requestId);
        return;
    }

    let clonedResponse = null;
    try {
        clonedResponse = response.clone();
    } catch {
        removeActiveGenerationRequest(requestId);
        return;
    }

    if (!clonedResponse.body || typeof clonedResponse.body.getReader !== "function") {
        removeActiveGenerationRequest(requestId);
        return;
    }

    const reader = clonedResponse.body.getReader();
    void (async () => {
        try {
            while (true) {
                const { done } = await reader.read();
                if (done) {
                    break;
                }
            }
        } catch {
            // Ignore stream teardown here; we only use this clone to know when the request fully settles.
        } finally {
            try {
                reader.releaseLock();
            } catch {
                // Ignore release failures during teardown.
            }
            removeActiveGenerationRequest(requestId);
        }
    })();
}

function abortTrackedGenerationRequests() {
    let abortedCount = 0;
    for (const entry of state.activeGenerationRequests.values()) {
        if (typeof AbortController !== "function" || !(entry?.forceAbortController instanceof AbortController) || entry.forceAbortController.signal.aborted) {
            continue;
        }

        entry.forceAbortController.abort("st-monitor-force-abort");
        abortedCount += 1;
    }

    return abortedCount;
}

function tryStopSillyTavernGeneration(options = {}) {
    const forceProbe = options?.forceProbe === true;
    const stopTrigger = findSillyTavernStopGenerationTrigger();
    if (typeof stopGeneration === "function" && (forceProbe || state.sillyTavernGenerationActive || hasRecentGenerationRecoveryWindow() || stopTrigger instanceof HTMLElement)) {
        try {
            if (stopGeneration()) {
                return "native";
            }
        } catch {
            // Fall through to DOM/button and Escape based fallbacks.
        }
    }

    if (stopTrigger instanceof HTMLElement) {
        stopTrigger.click();
        return "click";
    }

    dispatchEscapeStopGeneration();
    return "escape";
}

function tryStopGenerationWithMonitorFallback(options = {}) {
    const stopMethod = tryStopSillyTavernGeneration(options);
    const abortedRequestCount = abortTrackedGenerationRequests();
    const postAbortEscapeDispatched = abortedRequestCount > 0;

    if (postAbortEscapeDispatched) {
        dispatchEscapeStopGeneration();
    }

    return {
        stopMethod,
        abortedRequestCount,
        postAbortEscapeDispatched,
    };
}

function executeGenerationStopAction() {
    const manualForceStopMode = state.confirmDialog?.type === "manual-force-stop-generation"
        ? state.confirmDialog.mode
        : "";
    const rescueMode = manualForceStopMode === "rescue";
    const stopResult = tryStopGenerationWithMonitorFallback({
        forceProbe: rescueMode,
    });
    if (state.pendingGenerationIntervention) {
        clearPendingGenerationIntervention();
    }
    state.confirmDialog = null;
    if (stopResult.abortedRequestCount > 0) {
        state.apiStatus = `已尝试中止当前生成，并强制切断 ${stopResult.abortedRequestCount} 条监控接管请求`;
    } else if (stopResult.stopMethod === "native") {
        state.apiStatus = "已直接调用酒馆原生终止生成";
    } else if (rescueMode) {
        state.apiStatus = "未检测到明确活跃链路，已按死锁救援模式补发原生终止探测与中止指令";
    } else {
        state.apiStatus = stopResult.stopMethod === "click"
            ? "已尝试中止当前生成"
            : "已发送中止指令";
    }
    state.apiError = "";
    safeRenderPage();
}

function openManualForceStopGenerationDialog() {
    state.confirmDialog = {
        type: "manual-force-stop-generation",
        mode: hasAbortableGenerationRequest() || isSillyTavernGenerationLikelyActive()
            ? "normal"
            : "rescue",
    };
    safeRenderPage();
}

function getLatestAbnormalRunId(runs) {
    const abnormalRun = sortRunsByStartedAtDesc(Array.isArray(runs) ? runs : []).find((run) => isAbnormalRun(run));
    return typeof abnormalRun?.id === "string" ? abnormalRun.id : "";
}

function updateMinimizedButtonAbnormalAlert(runs) {
    const sortedRuns = sortRunsByStartedAtDesc(Array.isArray(runs) ? runs : []);
    const latestAbnormalRun = sortedRuns.find((run) => isAbnormalRun(run)) ?? null;
    const latestAbnormalRunId = typeof latestAbnormalRun?.id === "string" ? latestAbnormalRun.id : "";
    if (!state.abnormalAlertInitialized) {
        state.abnormalAlertInitialized = true;
        state.lastSeenAbnormalRunId = latestAbnormalRunId;
        return;
    }

    if (!latestAbnormalRunId || latestAbnormalRunId === state.lastSeenAbnormalRunId) {
        return;
    }

    state.lastSeenAbnormalRunId = latestAbnormalRunId;
    const abnormalType = latestAbnormalRun?.abnormal_detail?.abnormal_type;
    if (ACTIONABLE_ABNORMAL_TYPES.has(abnormalType) && isSillyTavernGenerationLikelyActive()) {
        queueGenerationInterventionAlert({
            kind: "abnormal-generation",
            title: "这次生成大概率不会正常返回",
            text: "后端监控已经发现这次生成出现异常，基本不太可能再正常返回。要现在尝试中止酒馆当前这次生成吗？",
            keySuffix: latestAbnormalRunId,
            runId: latestAbnormalRunId,
        });
        return;
    }

    if (state.pageMinimized) {
        triggerMinimizedButtonFlash();
        return;
    }

    state.minimizedButtonAlertPending = true;
}

function getNextThemeMode(value) {
    const current = normalizeThemeMode(value);
    const currentIndex = THEME_MODE_SEQUENCE.indexOf(current);
    return THEME_MODE_SEQUENCE[(currentIndex + 1) % THEME_MODE_SEQUENCE.length];
}

function getHeaderIconSvg(icon, variant = "") {
    if (icon === "theme") {
        const themeMode = normalizeThemeMode(variant);
        if (themeMode === "dawn") {
            return `
                <svg class="stlp-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <circle cx="12" cy="12" r="4.25" fill="none" stroke="currentColor" stroke-width="1.9"/>
                    <path d="M12 2.75v2.5M12 18.75v2.5M21.25 12h-2.5M5.25 12h-2.5M18.54 5.46l-1.77 1.77M7.23 16.77l-1.77 1.77M18.54 18.54l-1.77-1.77M7.23 7.23L5.46 5.46" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
                </svg>
            `;
        }

        if (themeMode === "rose") {
            return `
                <svg class="stlp-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <circle cx="12" cy="12" r="2.15" fill="currentColor"/>
                    <circle cx="12" cy="6.75" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/>
                    <circle cx="17.25" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/>
                    <circle cx="12" cy="17.25" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/>
                    <circle cx="6.75" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/>
                </svg>
            `;
        }

        if (themeMode === "night") {
            return `
                <svg class="stlp-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M13.9 4.55A7.5 7.5 0 1 0 19.45 15.7A6.15 6.15 0 1 1 13.9 4.55Z" fill="currentColor"/>
                </svg>
            `;
        }

        return `
            <svg class="stlp-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" stroke-width="1.9"/>
            </svg>
        `;
    }

    if (icon === "minimize") {
        return `
            <svg class="stlp-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 12.75h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
        `;
    }

    if (icon === "close") {
        return `
            <svg class="stlp-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
        `;
    }

    if (icon === "back") {
        return `
            <svg class="stlp-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M14.5 6.5L9 12l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
    }

    return "";
}

function getChevronIconSvg() {
    return `
        <svg class="stlp-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6.75 9.5L12 14.75L17.25 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
}

function getMinimizedMonitorIconSvg() {
    return `
        <svg class="stlp-minimized-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 2.9L14.95 9.05L21.1 12L14.95 14.95L12 21.1L9.05 14.95L2.9 12L9.05 9.05Z" fill="currentColor" stroke="var(--stlp-minimized-stroke, #ffffff)" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
    `;
}

function getActiveRequestPurpose() {
    return normalizeRequestPurposeMode(state.uiSettings.activeRequestPurpose);
}

function restoreMonitorSectionLayout() {
    state.uiSettings.sectionOpenStates = normalizeSectionOpenStates(state.uiSettings.sectionOpenStates);
}

function isSettingsView() {
    return normalizeMainViewMode(state.uiSettings.activeMainView) === "settings";
}

function isStatusView() {
    return normalizeMainViewMode(state.uiSettings.activeMainView) === "status";
}

function isWaitingQueueView() {
    return normalizeMainViewMode(state.uiSettings.activeMainView) === "waiting_queue";
}

function isDailySummaryView() {
    return normalizeMainViewMode(state.uiSettings.activeMainView) === "daily_summary";
}

function isExtensionRequestView() {
    return getActiveRequestPurpose() === "non_chat_generation";
}

function getActiveRequestPurposeLabel() {
    return REQUEST_PURPOSE_LABELS[getActiveRequestPurpose()] || REQUEST_PURPOSE_LABELS.chat_main_reply;
}

function buildRequestPurposeBadgeHtml(purpose = getActiveRequestPurpose()) {
    const normalizedPurpose = normalizeRequestPurposeMode(purpose);
    const badgeClass = normalizedPurpose === "non_chat_generation"
        ? "stlp-purpose-badge stlp-purpose-badge-extension"
        : "stlp-purpose-badge stlp-purpose-badge-chat";
    return `<span class="${badgeClass}">${escapeHtml(getRequestPurposeLabel(normalizedPurpose))}</span>`;
}

function buildSectionTitleHtml(title, purpose = getActiveRequestPurpose()) {
    return `
        <span class="stlp-section-title-text">${escapeHtml(title)}</span>
        ${buildRequestPurposeBadgeHtml(purpose)}
    `;
}

function getBackendStatusIndicatorClass() {
    return state.backendReady ? "stlp-status-connected" : "stlp-status-disconnected";
}

function getRequestPurposeLabel(value) {
    return REQUEST_PURPOSE_LABELS[value] || REQUEST_PURPOSE_LABELS.chat_main_reply;
}

function getRequestPluginMatchModeLabel(value) {
    return REQUEST_PLUGIN_MATCH_MODE_LABELS[value] || REQUEST_PLUGIN_MATCH_MODE_LABELS.none;
}

function buildRunFilterQuery({ abnormalOnly = false, cacheHitOnly = state.uiSettings.cacheHitOnly } = {}) {
    const params = new URLSearchParams();
    params.set("request_purpose", getActiveRequestPurpose());
    if (abnormalOnly) {
        params.set("abnormal_only", "1");
    }
    if (cacheHitOnly) {
        params.set("cache_hit", "1");
    }
    return params.toString();
}

function buildDailySummaryQuery() {
    const params = new URLSearchParams();
    const scopeInfo = getDailySummaryScopeInfo();
    if (scopeInfo.requestPurpose) {
        params.set("request_purpose", scopeInfo.requestPurpose);
    }
    if (scopeInfo.chatKey) {
        params.set("request_chat_key", scopeInfo.chatKey);
    }
    params.set("group_by", "day");
    params.set("days", String(normalizeDailySummaryDays(state.uiSettings.dailySummaryDays)));
    return params.toString();
}

function hasLegacyUnkeyedChatRuns(runs = state.runs) {
    return Array.isArray(runs) && runs.some((run) => (
        getRunRequestPurpose(run) === "chat_main_reply"
        && !getRunChatKey(run)
    ));
}

function canUsePreciseChatScopedDailySummary() {
    return Boolean(
        getTrackedCurrentChatKey()
        && getTrackedCurrentChatWindowName()
        && getActiveRequestPurpose() === "chat_main_reply",
    );
}

function getDailySummaryScopeInfo() {
    const currentChatKey = getTrackedCurrentChatKey();
    const currentChatName = getTrackedCurrentChatWindowName();
    if (canUsePreciseChatScopedDailySummary() && currentChatKey && currentChatName) {
        return {
            mode: "chat_view",
            label: currentChatName,
            requestPurpose: "chat_main_reply",
            chatKey: currentChatKey,
        };
    }

    return {
        mode: "global",
        label: "全部用途",
        requestPurpose: "",
        chatKey: "",
    };
}

async function setActiveRequestPurpose(nextPurpose) {
    const normalizedPurpose = normalizeRequestPurposeMode(nextPurpose);
    if (normalizedPurpose === getActiveRequestPurpose()) {
        if (isSettingsView() || isStatusView() || isWaitingQueueView() || isDailySummaryView()) {
            state.uiSettings.activeMainView = "monitor";
            restoreMonitorSectionLayout();
            saveUiSettings();
            safeRenderPage();
        }
        return;
    }

    state.uiSettings.activeMainView = "monitor";
    state.uiSettings.activeRequestPurpose = normalizedPurpose;
    restoreMonitorSectionLayout();
    state.historyPage = 1;
    state.historyRuns = [];
    state.historyAllRuns = [];
    state.historyTotal = 0;
    state.historyError = "";
    saveUiSettings();
    await refreshBackendData();
}

function openMessageDialog(title, text, actions = [{ action: "dismiss-confirm-dialog", label: "知道了" }]) {
    state.confirmDialog = {
        type: "message",
        title,
        text,
        actions,
    };
    safeRenderPage();
}

function openSettingsSection() {
    if (isSettingsView()) {
        return;
    }

    state.settingsSubsectionOpenStates = { ...DEFAULT_SETTINGS_SUBSECTION_OPEN_STATES };
    state.uiSettings.activeMainView = "settings";
    saveUiSettings();
    safeRenderPage();
}

function openStatusSection() {
    if (isStatusView()) {
        return;
    }

    state.uiSettings.activeMainView = "status";
    saveUiSettings();
    safeRenderPage();
}

function openWaitingQueueSection() {
    state.uiSettings.activeMainView = "waiting_queue";
    saveUiSettings();
    safeRenderPage();
    void loadWaitingQueue({ silent: true });
    void loadPluginRules({ silent: true });
}

function openDailySummarySection() {
    if (isDailySummaryView()) {
        return;
    }

    state.uiSettings.activeMainView = "daily_summary";
    saveUiSettings();
    safeRenderPage();
    void refreshBackendData({ silent: true });
}

function getWaitingQueueDraftValue(entry) {
    if (!entry?.run_id) {
        return "";
    }

    const draftValue = state.waitingQueueDrafts?.[entry.run_id];
    if (typeof draftValue === "string") {
        return draftValue;
    }

    return entry?.plugin_label || getRunPluginLabel(entry?.run) || "";
}

function getPluginRuleById(ruleId) {
    if (typeof ruleId !== "string" || !ruleId.trim()) {
        return null;
    }

    return state.pluginRules.find((rule) => rule?.id === ruleId.trim()) ?? null;
}

function isWaitingQueueEntryExpanded(runId) {
    return typeof runId === "string" && runId
        ? state.expandedWaitingQueueRunIds.has(runId)
        : false;
}

function isPluginRuleCardExpanded(ruleId) {
    return typeof ruleId === "string" && ruleId
        ? state.expandedPluginRuleIds.has(ruleId)
        : false;
}

function syncWaitingQueueExpandedState() {
    const validRunIds = new Set(
        state.waitingQueueEntries
            .map((entry) => {
                const runId = entry?.run_id || entry?.run?.id || "";
                return typeof runId === "string" ? runId.trim() : "";
            })
            .filter(Boolean),
    );

    state.expandedWaitingQueueRunIds = new Set(
        Array.from(state.expandedWaitingQueueRunIds).filter((runId) => validRunIds.has(runId)),
    );
}

function syncPluginRuleExpandedState() {
    const validRuleIds = new Set(
        state.pluginRules
            .map((rule) => (typeof rule?.id === "string" ? rule.id.trim() : ""))
            .filter(Boolean),
    );

    state.expandedPluginRuleIds = new Set(
        Array.from(state.expandedPluginRuleIds).filter((ruleId) => validRuleIds.has(ruleId)),
    );
}

function isSettingsSubsectionOpen(key) {
    return Boolean(state.settingsSubsectionOpenStates?.[key]);
}

function buildSettingsSubsectionHtml(key, title, summary, body) {
    const isOpen = isSettingsSubsectionOpen(key);
    return `
        <section class="stlp-settings-subsection ${isOpen ? "is-open" : ""}">
            <button class="stlp-settings-subsection-button" type="button" data-action="toggle-settings-subsection" data-settings-subsection="${escapeHtml(key)}" aria-expanded="${isOpen ? "true" : "false"}">
                <span class="stlp-settings-subsection-copy">
                    <span class="stlp-settings-subsection-title">${escapeHtml(title)}</span>
                    ${summary ? `<span class="stlp-settings-subsection-summary">${escapeHtml(summary)}</span>` : ""}
                </span>
                <span class="stlp-settings-subsection-chevron" aria-hidden="true">▾</span>
            </button>
            <div class="stlp-settings-subsection-body ${isOpen ? "" : "stlp-hidden"}">
                ${body}
            </div>
        </section>
    `;
}

function cycleThemeMode() {
    state.uiSettings.themeMode = getNextThemeMode(state.uiSettings.themeMode);
    saveUiSettings();
    safeRenderPage();
}

function minimizePage() {
    state.pageMinimized = true;
    state.confirmDialog = null;
    state.historyDialogOpen = false;
    state.minimizedButtonAlertPending = false;
    triggerMinimizedButtonFlash();
    safeRenderPage();
}

function restoreMinimizedPage() {
    if (!state.pageOpen) {
        openMonitorPage();
        return;
    }

    state.pageMinimized = false;
    state.confirmDialog = null;
    if (state.pendingGenerationIntervention) {
        openPendingGenerationInterventionDialog();
        return;
    }
    safeRenderPage();
}

function saveUiSettings() {
    try {
        localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state.uiSettings));
    } catch {
        // Ignore storage failures so the extension never blocks the page.
    }
}

function clampMinimizedButtonPosition(position, rect = {}) {
    const width = Number(rect.width) || MINIMIZED_BUTTON_SIZE;
    const height = Number(rect.height) || MINIMIZED_BUTTON_SIZE;
    const maxLeft = Math.max(MINIMIZED_BUTTON_MARGIN, window.innerWidth - MINIMIZED_BUTTON_MARGIN - width);
    const maxTop = Math.max(MINIMIZED_BUTTON_MARGIN, window.innerHeight - MINIMIZED_BUTTON_MARGIN - height);

    return {
        left: Math.round(Math.max(MINIMIZED_BUTTON_MARGIN, Math.min(Number(position?.left) || maxLeft, maxLeft))),
        top: Math.round(Math.max(MINIMIZED_BUTTON_MARGIN, Math.min(Number(position?.top) || maxTop, maxTop))),
    };
}

function buildMinimizedButtonStyle() {
    const colorValue = getMinimizedButtonConnectedColorValue();
    const strokeColorValue = getMinimizedButtonStrokeColorValue();
    const backgroundValues = getMinimizedButtonBackgroundValues();
    const baseStyle = `--stlp-minimized-connected:${colorValue};--stlp-minimized-stroke:${strokeColorValue};--stlp-minimized-bg:${backgroundValues.background};--stlp-minimized-bg-hover:${backgroundValues.hoverBackground};--stlp-minimized-border:${backgroundValues.borderColor};--stlp-minimized-shadow:${backgroundValues.shadow};`;

    const position = normalizeMinimizedButtonPosition(state.uiSettings.minimizedButtonPosition);
    if (!position) {
        return ` style="${baseStyle}"`;
    }

    const clampedPosition = clampMinimizedButtonPosition(position);
    state.uiSettings.minimizedButtonPosition = clampedPosition;
    return ` style="${baseStyle}left:${clampedPosition.left}px;top:${clampedPosition.top}px;right:auto;bottom:auto;"`;
}

function clearRefreshTimer() {
    if (!state.refreshTimerId) {
        return;
    }

    clearInterval(state.refreshTimerId);
    state.refreshTimerId = null;
}

function clearUiRetryTimer() {
    if (!state.uiRetryTimerId) {
        return;
    }

    clearInterval(state.uiRetryTimerId);
    state.uiRetryTimerId = null;
}

function disableExtension(reason) {
    if (state.extensionDisabled) {
        return;
    }

    state.extensionDisabled = true;
    clearRefreshTimer();
    clearUiRetryTimer();

    if (state.pageRoot instanceof HTMLElement) {
        state.pageRoot.remove();
    }

    if (state.launcherRoot instanceof HTMLElement) {
        state.launcherRoot.remove();
    }

    state.pageRoot = null;
    state.launcherRoot = null;
    state.uiReady = false;

    console.error(`[${MODULE_NAME}] 已停用独立页面入口：${reason}`);
}

function reportExtensionError(action, error, { disable = false } = {}) {
    const message = error instanceof Error ? error.message : String(error);
    if (disable) {
        disableExtension(`${action} 失败：${message}`);
        return;
    }

    console.error(`[${MODULE_NAME}] ${action} 失败：${message}`, error);
}

function runSafely(action, callback, fallbackValue = undefined, { disableOnError = false } = {}) {
    if (state.extensionDisabled) {
        return fallbackValue;
    }

    try {
        return callback();
    } catch (error) {
        reportExtensionError(action, error, { disable: disableOnError });
        return fallbackValue;
    }
}

function safeRenderPage() {
    runSafely("渲染独立页面", () => {
        renderPage();
    });
}

function isColorWheelInputTarget(target) {
    return target instanceof HTMLInputElement
        && target.type === "color"
        && target.classList.contains("stlp-color-wheel-input");
}

function isColorWheelInputActive() {
    return isColorWheelInputTarget(document.activeElement);
}

function deferColorWheelRenderUntilBlur() {
    state.colorWheelRenderPending = true;
}

function flushDeferredColorWheelRender() {
    if (!state.colorWheelRenderPending) {
        return;
    }

    if (isColorWheelInputActive()) {
        return;
    }

    state.colorWheelRenderPending = false;
    safeRenderPage();
}

function setWaitingQueueEditLock(runId, durationMs = WAITING_QUEUE_EDIT_LOCK_MS) {
    if (typeof runId !== "string" || !runId.trim()) {
        return;
    }

    state.waitingQueueEditLockRunId = runId.trim();
    state.waitingQueueEditLockUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
}

function clearWaitingQueueEditLock(runId = "") {
    if (runId && state.waitingQueueEditLockRunId && state.waitingQueueEditLockRunId !== runId) {
        return;
    }

    state.waitingQueueEditLockRunId = "";
    state.waitingQueueEditLockUntil = 0;
}

function getWaitingQueueLockedRunId() {
    if (!isWaitingQueueView()) {
        clearWaitingQueueEditLock();
        return "";
    }

    if (!state.waitingQueueEditLockRunId) {
        return "";
    }

    if (Date.now() > state.waitingQueueEditLockUntil) {
        clearWaitingQueueEditLock();
        return "";
    }

    return state.waitingQueueEditLockRunId;
}

function deferWaitingQueueRenderUntilBlur() {
    if (isWaitingQueueView()) {
        state.waitingQueueRenderPending = true;
    }
}

function flushDeferredWaitingQueueRender() {
    if (!state.waitingQueueRenderPending) {
        return;
    }

    if (isWaitingQueueLabelInputActive()) {
        return;
    }

    state.waitingQueueRenderPending = false;
    safeRenderPage();
}

function captureWaitingQueueInputState() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLInputElement) || !activeElement.dataset.waitingLabelRunId) {
        const lockedRunId = getWaitingQueueLockedRunId();
        if (!lockedRunId) {
            return null;
        }

        return {
            runId: lockedRunId,
            value: typeof state.waitingQueueDrafts?.[lockedRunId] === "string" ? state.waitingQueueDrafts[lockedRunId] : "",
            selectionStart: null,
            selectionEnd: null,
            isFocused: false,
        };
    }

    return {
        runId: activeElement.dataset.waitingLabelRunId,
        value: activeElement.value,
        selectionStart: activeElement.selectionStart,
        selectionEnd: activeElement.selectionEnd,
        isFocused: true,
    };
}

function isWaitingQueueLabelInputActive() {
    if (!isWaitingQueueView()) {
        return false;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLInputElement && activeElement.dataset.waitingLabelRunId) {
        setWaitingQueueEditLock(activeElement.dataset.waitingLabelRunId);
        return true;
    }

    return Boolean(getWaitingQueueLockedRunId());
}

function restoreWaitingQueueInputState(snapshot) {
    if (!snapshot?.runId || !(state.pageRoot instanceof HTMLElement)) {
        return;
    }

    const nextInput = state.pageRoot.querySelector(`input[data-waiting-label-run-id="${snapshot.runId}"]`);
    if (!(nextInput instanceof HTMLInputElement)) {
        return;
    }

    if (typeof snapshot.value === "string" && nextInput.value !== snapshot.value) {
        nextInput.value = snapshot.value;
    }

    const isAlreadyActive = document.activeElement === nextInput;
    if (!isAlreadyActive) {
        try {
            nextInput.focus({ preventScroll: true });
        } catch {
            nextInput.focus();
        }
    }

    if (typeof snapshot.selectionStart === "number" && typeof snapshot.selectionEnd === "number") {
        const selectionAlreadyMatches = nextInput.selectionStart === snapshot.selectionStart
            && nextInput.selectionEnd === snapshot.selectionEnd;
        if (!selectionAlreadyMatches) {
            nextInput.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        }
    }
}

function blurWaitingQueueInput() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLInputElement) || !activeElement.dataset.waitingLabelRunId) {
        return;
    }

    activeElement.blur();
}

function captureWaitingQueueEntrySnapshot(snapshot) {
    if (!snapshot?.runId || !(state.pageRoot instanceof HTMLElement) || !isWaitingQueueView()) {
        return null;
    }

    const waitingQueueInput = state.pageRoot.querySelector(`input[data-waiting-label-run-id="${snapshot.runId}"]`);
    const waitingQueueEntryRoot = waitingQueueInput instanceof HTMLInputElement
        ? waitingQueueInput.closest(`[data-waiting-entry-run-id="${snapshot.runId}"]`)
        : null;
    if (!(waitingQueueEntryRoot instanceof HTMLElement)) {
        return null;
    }

    return {
        runId: snapshot.runId,
        root: waitingQueueEntryRoot,
    };
}

function restoreWaitingQueueEntrySnapshot(entrySnapshot, waitingQueueViewRoot) {
    if (!entrySnapshot?.runId || !(entrySnapshot.root instanceof HTMLElement) || !(waitingQueueViewRoot instanceof HTMLElement)) {
        return waitingQueueViewRoot;
    }

    const nextEntryRoot = waitingQueueViewRoot.querySelector(`[data-waiting-entry-run-id="${entrySnapshot.runId}"]`);
    if (!(nextEntryRoot instanceof HTMLElement)) {
        return waitingQueueViewRoot;
    }

    nextEntryRoot.replaceWith(entrySnapshot.root);
    return waitingQueueViewRoot;
}

function finishOpenMonitorPage() {
    togglePage(true);
    state.pageOpenGuardUntil = isMobileDrawerLayout() ? Date.now() + MOBILE_OPEN_GUARD_MS : 0;
    if (!state.initialDataLoaded) {
        state.initialDataLoaded = true;
        void refreshBackendData();
        return;
    }

    void refreshBackendData({ silent: true });
}

function isIosWebKit() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
    const isiOSDevice = /iPad|iPhone|iPod/.test(ua)
        || (platform === "MacIntel" && maxTouchPoints > 1);
    const isAppleWebKit = /AppleWebKit/i.test(ua)
        && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);

    return isiOSDevice && isAppleWebKit;
}

function openMonitorPage() {
    const now = Date.now();
    if (now - state.pageOpenRequestAt < 400) {
        return;
    }

    state.pageOpenRequestAt = now;
    if (isMobileDrawerLayout()) {
        closeNativeMenu({ forceDirectHide: true });
        window.setTimeout(() => {
            runSafely("打开移动端独立页面", () => {
                finishOpenMonitorPage();
            });
        }, 0);
        return;
    }

    closeNativeMenu();
    window.setTimeout(() => {
        runSafely("打开独立页面", () => {
            finishOpenMonitorPage();
        });
    }, 0);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatSeconds(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }

    const seconds = value / 1000;
    return `${Math.round(seconds * 100) / 100} 秒`;
}

function formatBoolean(value) {
    return value ? "是" : "否";
}

function formatPercent(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }

    return `${Math.round(value * 100) / 100}%`;
}

function formatCount(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }

    return Math.round(value).toLocaleString("zh-CN");
}

function formatDateKeyLabel(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return "-";
    }

    return value.slice(5).replace("-", "/");
}

function formatPlainValue(value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return formatCount(value);
    }

    return String(value);
}

function formatTopValueList(items) {
    if (!Array.isArray(items) || !items.length) {
        return "-";
    }

    return items
        .map((item) => `${item?.label || item?.value || "-"} x${formatCount(Number(item?.count) || 0)}`)
        .join(" / ");
}

function shortenRunId(runId) {
    return typeof runId === "string" ? runId.slice(0, 8) : "-";
}

function getPermissionLabel(value) {
    return PERMISSION_LABELS[value] || value || "-";
}

function getRuntimeModeLabel(value) {
    return RUNTIME_MODE_LABELS[value] || value || "-";
}

function getSuggestionScopeLabel(value) {
    return SUGGESTION_SCOPE_LABELS[value] || value || "-";
}

function getEntryOriginLabel(value) {
    return ENTRY_ORIGIN_LABELS[value] || "主界面生成记录";
}

function getSourceLabel(value) {
    if (typeof value !== "string" || !value.trim()) {
        return "未记录来源";
    }

    return SOURCE_LABELS[value] || value;
}

function normalizePricingCurrency(value) {
    return value === "cny" ? "cny" : "usd";
}

function getPricingCurrencyLabel(value = "usd") {
    return PRICING_CURRENCY_LABELS[value] || PRICING_CURRENCY_LABELS.usd;
}

function normalizeConfiguredPriceValue(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? Math.round(numberValue * 1000000) / 1000000 : null;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePeakValleyTimeValue(value) {
    if (typeof value !== "string") {
        return "";
    }

    const trimmedValue = value.trim();
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmedValue) ? trimmedValue : "";
}

function convertPeakValleyTimeToMinutes(value) {
    const normalizedValue = normalizePeakValleyTimeValue(value);
    if (!normalizedValue) {
        return null;
    }

    const [hours, minutes] = normalizedValue.split(":").map(Number);
    return (hours * 60) + minutes;
}

function normalizePricingConfig(config) {
    const source = isPlainRecord(config) ? config : {};
    return {
        currency: normalizePricingCurrency(source.currency),
        input_price_per_million: normalizeConfiguredPriceValue(source.input_price_per_million),
        cached_input_price_per_million: normalizeConfiguredPriceValue(source.cached_input_price_per_million),
        output_price_per_million: normalizeConfiguredPriceValue(source.output_price_per_million),
        peak_valley_enabled: Boolean(source.peak_valley_enabled),
        peak_start_time: normalizePeakValleyTimeValue(source.peak_start_time),
        peak_end_time: normalizePeakValleyTimeValue(source.peak_end_time),
        peak_input_price_per_million: normalizeConfiguredPriceValue(source.peak_input_price_per_million),
        peak_cached_input_price_per_million: normalizeConfiguredPriceValue(source.peak_cached_input_price_per_million),
        peak_output_price_per_million: normalizeConfiguredPriceValue(source.peak_output_price_per_million),
        valley_input_price_per_million: normalizeConfiguredPriceValue(source.valley_input_price_per_million),
        valley_cached_input_price_per_million: normalizeConfiguredPriceValue(source.valley_cached_input_price_per_million),
        valley_output_price_per_million: normalizeConfiguredPriceValue(source.valley_output_price_per_million),
    };
}

function normalizePricingConfigMap(value) {
    if (!isPlainRecord(value)) {
        return {};
    }

    const nextMap = {};
    for (const [modelName, config] of Object.entries(value)) {
        const normalizedModelName = typeof modelName === "string" ? modelName.trim() : "";
        if (!normalizedModelName) {
            continue;
        }

        nextMap[normalizedModelName] = normalizePricingConfig(config);
    }

    return nextMap;
}

function hasConfiguredPriceValues(config) {
    return PRICING_NUMBER_FIELDS.some((fieldName) => normalizeConfiguredPriceValue(config?.[fieldName]) !== null);
}

function getRunPricingReferenceDate(run) {
    const startedAtMs = Number(run?.started_at_ms);
    if (Number.isFinite(startedAtMs) && startedAtMs > 0) {
        const startedAtDate = new Date(startedAtMs);
        return Number.isNaN(startedAtDate.getTime()) ? null : startedAtDate;
    }

    const startedAtIso = typeof run?.started_at_iso === "string" ? run.started_at_iso : "";
    if (!startedAtIso) {
        return null;
    }

    const startedAtDate = new Date(startedAtIso);
    return Number.isNaN(startedAtDate.getTime()) ? null : startedAtDate;
}

function getRunPeakValleySelection(run, config) {
    const normalizedConfig = normalizePricingConfig(config);
    if (!normalizedConfig.peak_valley_enabled) {
        return null;
    }

    const peakStartMinutes = convertPeakValleyTimeToMinutes(normalizedConfig.peak_start_time);
    const peakEndMinutes = convertPeakValleyTimeToMinutes(normalizedConfig.peak_end_time);
    if (peakStartMinutes === null || peakEndMinutes === null || peakStartMinutes === peakEndMinutes) {
        return {
            enabled: true,
            active: false,
            reason: "invalid_schedule",
        };
    }

    const referenceDate = getRunPricingReferenceDate(run);
    if (!(referenceDate instanceof Date)) {
        return {
            enabled: true,
            active: false,
            reason: "missing_run_time",
        };
    }

    const currentMinutes = (referenceDate.getHours() * 60) + referenceDate.getMinutes();
    const inPeakWindow = peakStartMinutes < peakEndMinutes
        ? currentMinutes >= peakStartMinutes && currentMinutes < peakEndMinutes
        : currentMinutes >= peakStartMinutes || currentMinutes < peakEndMinutes;
    const periodKey = inPeakWindow ? "peak" : "valley";

    return {
        enabled: true,
        active: true,
        periodKey,
        periodLabel: inPeakWindow ? "峰时" : "谷时",
        inputPrice: normalizeConfiguredPriceValue(normalizedConfig[`${periodKey}_input_price_per_million`]),
        cachedInputPrice: normalizeConfiguredPriceValue(normalizedConfig[`${periodKey}_cached_input_price_per_million`]),
        outputPrice: normalizeConfiguredPriceValue(normalizedConfig[`${periodKey}_output_price_per_million`]),
    };
}

function getModelPricingMap() {
    const localPricingMap = state.uiSettings?.pricingConfigByModel && typeof state.uiSettings.pricingConfigByModel === "object"
        ? state.uiSettings.pricingConfigByModel
        : {};
    const backendPricingMap = state.settings?.pricing?.model_prices && typeof state.settings.pricing.model_prices === "object"
        ? state.settings.pricing.model_prices
        : {};

    return {
        ...localPricingMap,
        ...backendPricingMap,
    };
}

function getModelPriceConfig(modelName) {
    const normalizedModelName = typeof modelName === "string" ? modelName.trim() : "";
    if (!normalizedModelName) {
        return null;
    }

    const config = getModelPricingMap()[normalizedModelName];
    return config === undefined ? null : normalizePricingConfig(config);
}

function getModelPriceCurrency(modelName) {
    return normalizePricingCurrency(getModelPriceConfig(modelName)?.currency);
}

function getPricingPanelOpenStates() {
    const value = state.uiSettings?.pricingPanelOpenStates;
    return value && typeof value === "object" ? value : {};
}

function isPricingPanelOpen(modelName) {
    return Boolean(getPricingPanelOpenStates()[modelName]);
}

function getPricingPeakValleyOpenStates() {
    const value = state.uiSettings?.pricingPeakValleyOpenStates;
    return value && typeof value === "object" ? value : {};
}

function isPricingPeakValleyPanelOpen(modelName) {
    return Boolean(getPricingPeakValleyOpenStates()[modelName]);
}

function getOutputCardFields() {
    return normalizeOutputCardFields(state.uiSettings?.outputCardFields);
}

function getRunUsage(run) {
    const usage = run?.response_usage ?? {};
    const promptTokens = normalizeConfiguredPriceValue(usage.prompt_tokens);
    const completionTokens = normalizeConfiguredPriceValue(usage.completion_tokens);
    const totalTokens = normalizeConfiguredPriceValue(usage.total_tokens);
    const cachedTokens = normalizeConfiguredPriceValue(usage.cached_tokens);
    const cacheReadTokens = normalizeConfiguredPriceValue(usage.cache_read_tokens);
    const cacheWriteTokens = normalizeConfiguredPriceValue(usage.cache_write_tokens);
    const cacheHit = typeof usage.cache_hit === "boolean"
        ? usage.cache_hit
        : Boolean(
            (cachedTokens !== null && cachedTokens > 0)
            || (cacheReadTokens !== null && cacheReadTokens > 0)
            || (cacheWriteTokens !== null && cacheWriteTokens > 0),
        );
    return {
        promptTokens,
        completionTokens,
        totalTokens,
        cacheHit,
        cachedTokens,
        cacheReadTokens,
        cacheWriteTokens,
    };
}

function hasRunCacheHit(run) {
    return Boolean(getRunUsage(run).cacheHit);
}

function hasRunUsage(run) {
    const usage = getRunUsage(run);
    return usage.promptTokens !== null
        || usage.completionTokens !== null
        || usage.totalTokens !== null
        || usage.cachedTokens !== null
        || usage.cacheReadTokens !== null
        || usage.cacheWriteTokens !== null
        || typeof run?.response_usage?.cache_hit === "boolean";
}

function getRunCachedInputTokens(usage) {
    if (!usage || typeof usage !== "object") {
        return null;
    }

    if (usage.cachedTokens === null) {
        return usage.cacheReadTokens;
    }
    if (usage.cacheReadTokens === null) {
        return usage.cachedTokens;
    }

    return Math.max(usage.cachedTokens, usage.cacheReadTokens);
}

function formatPriceValue(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }

    if (value === 0) {
        return "0";
    }

    const absValue = Math.abs(value);
    let fractionDigits = 6;
    if (absValue >= 100) {
        fractionDigits = 2;
    } else if (absValue >= 1) {
        fractionDigits = 4;
    }

    return value
        .toFixed(fractionDigits)
        .replace(/\.?0+$/, "");
}

function formatPriceWithCurrency(value, currency = "usd") {
    const formattedValue = formatPriceValue(value);
    if (formattedValue === "-") {
        return "-";
    }

    return `${formattedValue} ${getPricingCurrencyLabel(currency)}`;
}

function collectPricingModels() {
    const pricingMap = getModelPricingMap();
    const modelMap = new Map();
    const allRuns = [
        ...state.runs,
        ...state.historyRuns,
        ...state.historyAllRuns,
        ...state.recentAbnormalRuns,
    ];

    for (const run of allRuns) {
        const modelName = typeof run?.model === "string" ? run.model.trim() : "";
        if (!modelName) {
            continue;
        }

        const current = modelMap.get(modelName) ?? {
            model: modelName,
            run_count: 0,
            supports_usage: false,
            configured: false,
        };
        current.run_count += 1;
        current.supports_usage = current.supports_usage || hasRunUsage(run);
        modelMap.set(modelName, current);
    }

    for (const [modelName, config] of Object.entries(pricingMap)) {
        const normalizedModelName = typeof modelName === "string" ? modelName.trim() : "";
        if (!normalizedModelName) {
            continue;
        }

        const current = modelMap.get(normalizedModelName) ?? {
            model: normalizedModelName,
            run_count: 0,
            supports_usage: false,
            configured: false,
        };
        current.configured = true;
        current.supports_usage = current.supports_usage
            || hasConfiguredPriceValues(config);
        modelMap.set(normalizedModelName, current);
    }

    return Array.from(modelMap.values()).sort((left, right) => right.run_count - left.run_count || left.model.localeCompare(right.model));
}

function getRunEstimatedPrice(run) {
    const usage = getRunUsage(run);
    const config = getModelPriceConfig(run?.model);
    if (!config) {
        return null;
    }

    const currency = getModelPriceCurrency(run?.model);
    const baseInputPrice = normalizeConfiguredPriceValue(config.input_price_per_million);
    const baseCachedInputPrice = normalizeConfiguredPriceValue(config.cached_input_price_per_million);
    const baseOutputPrice = normalizeConfiguredPriceValue(config.output_price_per_million);
    const peakValleySelection = getRunPeakValleySelection(run, config);
    const inputPrice = peakValleySelection?.active
        ? (peakValleySelection.inputPrice ?? baseInputPrice)
        : baseInputPrice;
    const cachedInputPrice = peakValleySelection?.active
        ? (peakValleySelection.cachedInputPrice ?? baseCachedInputPrice)
        : baseCachedInputPrice;
    const outputPrice = peakValleySelection?.active
        ? (peakValleySelection.outputPrice ?? baseOutputPrice)
        : baseOutputPrice;
    const cachedInputTokens = getRunCachedInputTokens(usage);
    const boundedCachedInputTokens = usage.promptTokens !== null && cachedInputTokens !== null
        ? Math.min(usage.promptTokens, cachedInputTokens)
        : cachedInputTokens;
    const discountedCachedInputTokens = cachedInputPrice !== null
        ? (boundedCachedInputTokens ?? 0)
        : 0;
    const regularInputTokens = usage.promptTokens !== null
        ? Math.max(0, usage.promptTokens - discountedCachedInputTokens)
        : null;
    const regularInputCost = inputPrice !== null && usage.promptTokens !== null
        ? (regularInputTokens * inputPrice) / 1000000
        : null;
    const cachedInputCost = cachedInputPrice !== null && boundedCachedInputTokens !== null
        ? (boundedCachedInputTokens * cachedInputPrice) / 1000000
        : null;
    const inputCost = (
        regularInputCost !== null
        || cachedInputCost !== null
        || (usage.promptTokens !== null && inputPrice !== null)
    )
        ? (regularInputCost ?? 0) + (cachedInputCost ?? 0)
        : null;
    const outputCost = outputPrice !== null && usage.completionTokens !== null
        ? (usage.completionTokens * outputPrice) / 1000000
        : null;

    if (inputCost === null && outputCost === null) {
        return null;
    }

    const totalCost = (inputCost ?? 0) + (outputCost ?? 0);
    const noteParts = [];
    const pricingPeriodLabel = peakValleySelection?.active ? `${peakValleySelection.periodLabel}` : "";
    if (inputCost !== null) {
        noteParts.push(cachedInputCost !== null ? `${pricingPeriodLabel}输入价格（缓存部分已折算）` : `${pricingPeriodLabel}输入价格`);
    }
    if (outputCost !== null) {
        noteParts.push(`${pricingPeriodLabel}输出价格`);
    }
    if (boundedCachedInputTokens !== null && boundedCachedInputTokens > 0) {
        if (cachedInputPrice === null && inputPrice !== null) {
            noteParts.push(pricingPeriodLabel ? `${pricingPeriodLabel}缓存输入暂按普通输入价估算` : "缓存输入暂按普通输入价估算");
        }
    }
    if (peakValleySelection?.enabled && !peakValleySelection.active) {
        noteParts.push("峰谷时段未完整配置，暂按普通价格估算");
    } else if (peakValleySelection?.active) {
        const fallbackUsed = (
            (peakValleySelection.inputPrice === null && baseInputPrice !== null)
            || (peakValleySelection.cachedInputPrice === null && baseCachedInputPrice !== null)
            || (peakValleySelection.outputPrice === null && baseOutputPrice !== null)
        );
        if (fallbackUsed) {
            noteParts.push("未填写的峰谷价格已回退普通单价");
        }
    }

    const pricingNote = noteParts.length >= 2
        ? `已按${noteParts.join("、")}估算`
        : (noteParts[0] ? `当前仅按${noteParts[0]}估算` : "当前按已配置价格估算");

    return {
        currency,
        totalCost,
        inputCost,
        regularInputCost,
        cachedInputCost,
        outputCost,
        cachedInputTokens: boundedCachedInputTokens,
        regularInputTokens,
        note: pricingNote,
    };
}

function getRunAbnormalBilling(run) {
    const abnormalDetail = run?.abnormal_detail;
    if (!abnormalDetail || typeof abnormalDetail !== "object") {
        return null;
    }

    const billingStatus = typeof abnormalDetail.billing_status === "string"
        ? abnormalDetail.billing_status
        : "";
    const estimatedPrice = abnormalDetail.estimated_price && typeof abnormalDetail.estimated_price === "object"
        ? abnormalDetail.estimated_price
        : null;
    const estimatedTotalCost = typeof estimatedPrice?.total_cost === "number" && Number.isFinite(estimatedPrice.total_cost)
        ? estimatedPrice.total_cost
        : null;
    const hasUsageEvidence = Boolean(abnormalDetail.has_usage_tokens);
    const hasEstimatedPrice = estimatedTotalCost !== null;
    const isPaidIncomplete = Boolean(abnormalDetail.is_paid_incomplete);
    const billingConfirmed = Boolean(billingStatus) || hasUsageEvidence || hasEstimatedPrice;

    return {
        status: billingStatus,
        label: ABNORMAL_BILLING_STATUS_LABELS[billingStatus]
            || (isPaidIncomplete ? "已付费未完成" : (billingConfirmed ? "已完成" : "费用未确认")),
        paidText: isPaidIncomplete
            ? "未完成"
            : (billingConfirmed ? "已完成" : "未确认"),
        isPaidIncomplete,
        hasUsageTokens: hasUsageEvidence,
        usageTotalTokens: normalizeConfiguredPriceValue(abnormalDetail.usage_total_tokens),
        hasPricingConfig: Boolean(abnormalDetail.has_pricing_config),
        estimatedPriceText: estimatedTotalCost !== null
            ? formatPriceWithCurrency(estimatedTotalCost, estimatedPrice?.currency)
            : "-",
        note: typeof abnormalDetail.billing_note === "string" ? abnormalDetail.billing_note : "",
    };
}

function filterRunsByCacheHit(runs, cacheHitOnly = state.uiSettings.cacheHitOnly) {
    const list = Array.isArray(runs) ? runs : [];
    if (!cacheHitOnly) {
        return list;
    }

    return list.filter(hasRunCacheHit);
}

function normalizePluginKey(value) {
    return typeof value === "string" && value.trim()
        ? value.trim().toLowerCase()
        : "";
}

function getKnownPluginLabel(value) {
    const normalizedKey = normalizePluginKey(value);
    return normalizedKey ? (KNOWN_PLUGIN_LABELS[normalizedKey] || "") : "";
}

function extractPromptTraceKeys(promptTrace) {
    if (!Array.isArray(promptTrace)) {
        return [];
    }

    const keys = [];

    for (const item of promptTrace) {
        if (typeof item === "string" && item.trim()) {
            keys.push(item.trim());
            continue;
        }

        if (!item || typeof item !== "object") {
            continue;
        }

        const candidate = [item.source, item.key, item.type, item.id]
            .find((value) => typeof value === "string" && value.trim());

        if (candidate) {
            keys.push(candidate.trim());
        }
    }

    return [...new Set(keys)];
}

function getPromptTraceSourceLabels(promptTrace) {
    return extractPromptTraceKeys(promptTrace)
        .filter((key) => TRACE_SOURCE_LABELS[key])
        .map((key) => TRACE_SOURCE_LABELS[key]);
}

function getPromptTraceDisplayItems(promptTrace) {
    return extractPromptTraceKeys(promptTrace).map((key) => ({
        key,
        label: TRACE_SOURCE_LABELS[key] || key,
        known: Boolean(TRACE_SOURCE_LABELS[key]),
    }));
}

function getRunPromptTraceItems(run) {
    return getPromptTraceDisplayItems(run?.prompt_trace);
}

function normalizeInjectionSourceKey(value) {
    return typeof value === "string" && value.trim()
        ? value.trim().toLowerCase()
        : "";
}

function getKnownInjectionSourceLabel(sourceId) {
    const normalizedSourceId = normalizeInjectionSourceKey(sourceId);
    return normalizedSourceId ? (KNOWN_INJECTION_SOURCE_LABELS[normalizedSourceId] || "") : "";
}

function getRunInjectionSourceId(run) {
    const sourceId = run?.request_injection_source || run?.injection_source || run?.extension_prompt_source || "";
    return typeof sourceId === "string" ? sourceId.trim() : "";
}

function getRunInjectionSourceLabel(run) {
    if (typeof run?.request_injection_source_label === "string" && run.request_injection_source_label.trim()) {
        return run.request_injection_source_label.trim();
    }

    if (typeof run?.injection_source_label === "string" && run.injection_source_label.trim()) {
        return run.injection_source_label.trim();
    }

    if (typeof run?.extension_prompt_source_label === "string" && run.extension_prompt_source_label.trim()) {
        return run.extension_prompt_source_label.trim();
    }

    return getKnownInjectionSourceLabel(getRunInjectionSourceId(run));
}

function hasRunInjectionTrace(run) {
    const traceKeys = extractPromptTraceKeys(run?.prompt_trace);
    return traceKeys.includes("chat_injects")
        || traceKeys.includes("extension_prompt")
        || Boolean(getRunInjectionSourceId(run))
        || Boolean(getRunInjectionSourceLabel(run));
}

function getFallbackInjectionSourceLabel(run, traceKey) {
    const explicitInjectionSourceLabel = getRunInjectionSourceLabel(run);
    if (explicitInjectionSourceLabel) {
        return explicitInjectionSourceLabel;
    }

    if (traceKey !== "extension_prompt") {
        return null;
    }

    const pluginLabel = getRunPluginLabel(run);
    if (pluginLabel) {
        return pluginLabel;
    }

    return null;
}

function getRunInjectionTraceLabels(run) {
    const labels = getRunPromptTraceItems(run)
        .filter((item) => item.key === "chat_injects" || item.key === "extension_prompt")
        .map((item) => getFallbackInjectionSourceLabel(run, item.key) || item.label);
    if (labels.length) {
        return labels;
    }

    const explicitInjectionSourceLabel = getRunInjectionSourceLabel(run);
    return explicitInjectionSourceLabel ? [explicitInjectionSourceLabel] : [];
}

function getRunSourceLabel(run) {
    const baseLabel = getSourceLabel(run?.source);
    const traceLabels = getPromptTraceSourceLabels(run?.prompt_trace).slice(0, 3);

    if (!traceLabels.length) {
        return baseLabel;
    }

    return `${baseLabel}（${traceLabels.join(" / ")}）`;
}

function getRunPluginLabel(run) {
    if (typeof run?.request_plugin_label === "string" && run.request_plugin_label.trim()) {
        return run.request_plugin_label.trim();
    }

    return getKnownPluginLabel(run?.request_plugin);
}

function isUnknownPluginRun(run) {
    const pluginKey = normalizePluginKey(run?.request_plugin);
    const matchMode = typeof run?.request_plugin_match_mode === "string" ? run.request_plugin_match_mode : "";
    return run?.request_purpose === "non_chat_generation"
        && (!pluginKey || pluginKey === "unknown_plugin" || matchMode === "fallback_unknown" || matchMode === "none");
}

function findRunById(runId) {
    if (typeof runId !== "string" || !runId.trim()) {
        return null;
    }

    const allRuns = [
        ...state.runs,
        ...state.historyRuns,
        ...state.historyAllRuns,
        ...state.recentAbnormalRuns,
        ...state.waitingQueueEntries.map((entry) => entry?.run).filter(Boolean),
    ];

    return allRuns.find((run) => run?.id === runId) ?? null;
}

function getWaitingQueueEntry(runId) {
    return state.waitingQueueEntries.find((entry) => entry?.run_id === runId) ?? null;
}

function getAbnormalTypeLabel(value) {
    return ABNORMAL_TYPE_LABELS[value] || "正常完成";
}

function getFailedStageLabel(value) {
    return FAILED_STAGE_LABELS[value] || "-";
}

function getHttpStatusNumber(run) {
    const value = Number(run?.http_status);
    return Number.isFinite(value) ? value : null;
}

function isFailedHttpStatus(run) {
    const status = getHttpStatusNumber(run);
    return status !== null && status >= 400;
}

function getHttpStatusText(run) {
    const status = getHttpStatusNumber(run);
    return status === null ? "-" : String(status);
}

function getHttpStatusLabel(run) {
    const status = getHttpStatusNumber(run);
    return status === null ? "" : `状态码 ${status}`;
}

function getRunFailedStage(run) {
    return run?.abnormal_detail?.failed_stage || null;
}

function getRunCompletionReason(run) {
    const value = run?.abnormal_detail?.completion_reason ?? run?.response_finish_reason;
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRunCompletionReasonLabel(run) {
    const value = getRunCompletionReason(run);
    if (!value) {
        return "-";
    }

    return COMPLETION_REASON_LABELS[value] || value;
}

function hasRunRecordedOutput(run) {
    const outputBytes = Number(run?.output_bytes);
    const outputChars = Number(run?.output_chars);
    return (Number.isFinite(outputBytes) && outputBytes > 0)
        || (Number.isFinite(outputChars) && outputChars > 0);
}

function hasRunFirstOutputSignal(run) {
    return Boolean(run?.phases?.first_chunk_received)
        || (typeof run?.metrics?.ttft_ms === "number" && Number.isFinite(run.metrics.ttft_ms));
}

function isRunContextLikelyHeavy(run) {
    const promptChars = Number(run?.prompt_chars);
    const messageCount = Number(run?.message_count);
    return (Number.isFinite(promptChars) && promptChars >= 32000)
        || (Number.isFinite(messageCount) && messageCount >= 80);
}

function getRunContextPressureText(run) {
    const promptChars = Number(run?.prompt_chars);
    const messageCount = Number(run?.message_count);
    const charsHeavy = Number.isFinite(promptChars) && promptChars >= 32000;
    const messagesHeavy = Number.isFinite(messageCount) && messageCount >= 80;

    if (charsHeavy && messagesHeavy) {
        return "字符数和消息数都偏高";
    }

    if (charsHeavy) {
        return "提示词字符偏高";
    }

    if (messagesHeavy) {
        return "消息数偏高";
    }

    return "未见明显偏高";
}

function getRunFirstOutputEvidenceText(run) {
    if (run?.stream) {
        return hasRunFirstOutputSignal(run) ? "已拿到首输出" : "未拿到首输出";
    }

    return hasRunRecordedOutput(run) ? "已返回正文" : "未返回正文";
}

function getRunOutputEvidenceText(run) {
    return hasRunRecordedOutput(run) ? "已收到正文内容" : "未收到正文内容";
}

function getRunUsageEvidenceText(run, abnormalBilling, usageAvailable) {
    if (abnormalBilling?.hasUsageTokens || usageAvailable) {
        return "已拿到 usage";
    }

    return isAbnormalRun(run) ? "未拿到 usage" : "-";
}

function getRunFailureEvidenceSummary(run, abnormalType, failedStage, abnormalBilling, usageAvailable) {
    if (!abnormalType) {
        return "未见异常";
    }

    const hasUsageEvidence = Boolean(abnormalBilling?.hasUsageTokens || usageAvailable);
    const contextHeavy = isRunContextLikelyHeavy(run);
    const completionReasonLabel = getRunCompletionReasonLabel(run);
    const hasCompletionReason = completionReasonLabel !== "-";

    if (abnormalType === "request_timeout") {
        return contextHeavy ? "更像请求超时，且上下文偏重" : "更像请求超时";
    }

    if (abnormalType === "stream_interrupted") {
        return hasUsageEvidence ? "更像回传中断，且已发生计费" : "更像回传中断";
    }

    if (abnormalType === "failed_without_output") {
        if (hasCompletionReason) {
            return `更像未出正文即结束（${completionReasonLabel}）`;
        }
        return failedStage === "before_first_output" ? "更像首输出前失败" : "更像未出正文即失败";
    }

    if (abnormalType === "failed_after_partial_output") {
        return hasUsageEvidence ? "更像出正文后中断，且已发生计费" : "更像出正文后中断";
    }

    if (abnormalType === "suspected_incomplete_generation") {
        return hasCompletionReason ? `更像生成提前结束（${completionReasonLabel}）` : "更像生成提前结束";
    }

    if (abnormalType === "failed_generation") {
        return failedStage ? `更像卡在${getFailedStageLabel(failedStage)}` : "更像完整生成失败";
    }

    return "异常原因待确认";
}

function maskOutputCardChatTitle(value) {
    if (typeof value !== "string" || !value.trim()) {
        return "";
    }

    return Array.from(value).map((char) => (/\s/.test(char) ? char : "□")).join("");
}

function buildOutputCardSectionData(snapshot, fields) {
    return {
        coreRows: [
            { label: "开始", value: snapshot.startedAt },
            { label: "聊天窗", value: snapshot.chatName || "-" },
            { label: "楼层", value: snapshot.floorLabel || "-" },
            { label: "来源", value: snapshot.sourceLabel },
            { label: "状态码", value: snapshot.httpStatusText },
            { label: "记录", value: snapshot.shortRunIdText },
        ],
        evidenceRows: [
            { label: "首输出信号", value: snapshot.firstOutputEvidenceText },
            { label: "正文证据", value: snapshot.outputEvidenceText },
            { label: "usage信号", value: snapshot.usageEvidenceText },
            { label: "结束原因", value: snapshot.completionReasonText },
            { label: "上下文压力", value: snapshot.contextPressureText },
            { label: "判断结论", value: snapshot.failureEvidenceSummaryText, full: true },
        ],
        diagnosisRows: [
            { label: "异常", value: snapshot.abnormalTypeLabel },
            { label: "生成完成", value: snapshot.paidText },
            { label: "阶段", value: snapshot.failedStageLabel },
            { label: "流式", value: snapshot.streamText },
            { label: "部分输出", value: snapshot.hasPartialOutputText },
            { label: "总耗时", value: snapshot.totalMsText },
            { label: "预处理", value: snapshot.preprocessMsText },
            { label: "首个输出", value: snapshot.ttftMsText },
            { label: "消息数", value: snapshot.messageCountText },
            { label: "提示词字符", value: snapshot.promptCharsText },
            { label: "Prompt", value: snapshot.promptTokensText },
            { label: "Completion", value: snapshot.completionTokensText },
            { label: "Total", value: snapshot.totalTokensText },
        ],
        injectionRows: [
            { label: "注入痕迹", value: snapshot.injectionTraceText },
            { label: "拓展", value: snapshot.pluginLabel },
        ],
        injectionDetailRows: fields.showInjectionDetails ? [
            { label: "来源名称", value: snapshot.injectionSourceLabel },
            { label: "来源标识", value: snapshot.injectionSourceId },
            { label: "提示词来源", value: snapshot.traceLabelsText, full: true },
        ] : [],
        extensionRows: fields.showExtensionDetails ? [
            { label: "拓展标识", value: snapshot.pluginIdText, full: true },
            { label: "识别方式", value: snapshot.pluginMatchModeLabel },
            { label: "识别分数", value: snapshot.pluginMatchScoreText },
        ] : [],
        pricingRows: fields.showPricingDetails ? [
            { label: "计费状态", value: snapshot.billingStatusText },
            { label: "命中缓存", value: snapshot.cacheHitText },
            { label: "缓存 Tokens", value: snapshot.cachedTokensText },
            { label: "缓存读取", value: snapshot.cacheReadTokensText },
            { label: "预估价格", value: snapshot.estimatedPriceText },
        ] : [],
    };
}

const HISTORY_RUN_DETAIL_FIELDS = Object.freeze({
    showInjectionDetails: true,
    showPricingDetails: true,
    showContextVolume: true,
    showExtensionDetails: true,
    maskChatTitle: false,
});

function getOutputCardRowClass(row) {
    if (!row || typeof row.label !== "string") {
        return "";
    }

    if (row.label === "聊天窗") {
        return " stlp-output-card-row-chat";
    }

    if (row.label === "来源") {
        return " stlp-output-card-row-source";
    }

    return "";
}

function renderOutputCardRows(rows) {
    return (rows || [])
        .filter((row) => row && row.value !== "")
        .map((row) => `
            <div class="stlp-output-card-row${row.full ? " stlp-output-card-row-full" : ""}${getOutputCardRowClass(row)}">
                <div class="stlp-output-card-label">${escapeHtml(row.label)}</div>
                <div class="stlp-output-card-value">${escapeHtml(row.value)}</div>
            </div>
        `)
        .join("");
}

function renderOutputCardSection(title, rows, note = "", rowsClass = "") {
    const rowsHtml = renderOutputCardRows(rows);
    if (!rowsHtml && !note) {
        return "";
    }

    return `
        <section class="stlp-output-card-section">
            ${title ? `<div class="stlp-output-card-section-title">${escapeHtml(title)}</div>` : ""}
            ${rowsHtml ? `<div class="stlp-output-card-rows${rowsClass ? ` ${rowsClass}` : ""}">${rowsHtml}</div>` : ""}
            ${note ? `<div class="stlp-output-card-note">${escapeHtml(note)}</div>` : ""}
        </section>
    `;
}

function renderHistoryDetailRows(rows) {
    return (rows || [])
        .filter((row) => row && row.value !== "")
        .map((row) => `
            <div class="stlp-history-detail-row${row.full ? " stlp-history-detail-row-full" : ""}">
                <div class="stlp-history-detail-label">${escapeHtml(row.label)}</div>
                <div class="stlp-history-detail-value">${escapeHtml(row.value)}</div>
            </div>
        `)
        .join("");
}

function renderHistoryDetailSection(title, rows, note = "", rowsClass = "") {
    const rowsHtml = renderHistoryDetailRows(rows);
    if (!rowsHtml && !note) {
        return "";
    }

    return `
        <section class="stlp-history-detail-section">
            ${title ? `<div class="stlp-history-detail-section-title">${escapeHtml(title)}</div>` : ""}
            ${rowsHtml ? `<div class="stlp-history-detail-rows${rowsClass ? ` ${rowsClass}` : ""}">${rowsHtml}</div>` : ""}
            ${note ? `<div class="stlp-history-detail-note">${escapeHtml(note)}</div>` : ""}
        </section>
    `;
}

function getOutputCardPrimaryTitle(run, chatName = "") {
    return getRunFloorLabel(run)
        || chatName
        || (typeof run?.model === "string" && run.model.trim())
        || "排障输出卡";
}

function getOutputCardSnapshot(run, fieldsOverride = null) {
    if (!run || typeof run !== "object") {
        return null;
    }

    const fields = fieldsOverride || getOutputCardFields();
    const abnormalDetail = run?.abnormal_detail ?? null;
    const abnormalBilling = getRunAbnormalBilling(run);
    const usage = getRunUsage(run);
    const usageAvailable = hasRunUsage(run);
    const estimatedPrice = getRunEstimatedPrice(run);
    const failedStage = getRunFailedStage(run);
    const abnormalType = abnormalDetail?.abnormal_type || null;
    const rawChatName = getRunDisplayChatName(run);
    const chatName = fields.maskChatTitle ? maskOutputCardChatTitle(rawChatName) : rawChatName;
    const traceItems = getRunPromptTraceItems(run);
    const traceLabelsText = traceItems.length ? traceItems.map((item) => item.label).join(" / ") : "-";
    const traceKeysText = traceItems.length ? traceItems.map((item) => item.key).join(" / ") : "-";
    const injectionSourceLabel = getRunInjectionSourceLabel(run);
    const injectionSourceId = getRunInjectionSourceId(run);
    const injectionTraceLabels = getRunInjectionTraceLabels(run);
    const injectionTraceText = injectionTraceLabels.length ? injectionTraceLabels.join(" / ") : "未发现";
    const pluginMatchScore = Number.isFinite(Number(run?.request_plugin_match_score))
        ? String(Number(run.request_plugin_match_score))
        : "-";

    const paymentCompletionText = abnormalBilling
        ? abnormalBilling.paidText
        : (usageAvailable || estimatedPrice ? "已完成" : "未确认");

    return {
        title: getOutputCardPrimaryTitle(run, chatName),
        summaryLabel: isAbnormalRun(run) ? getAbnormalTypeLabel(abnormalType) : "正常完成",
        requestPurposeLabel: getRequestPurposeLabel(run?.request_purpose),
        sourceLabel: getRunSourceLabel(run),
        pluginLabel: getRunPluginLabel(run),
        pluginIdText: run?.request_plugin || "-",
        pluginMatchModeLabel: getRequestPluginMatchModeLabel(run?.request_plugin_match_mode),
        pluginMatchScoreText: pluginMatchScore,
        floorLabel: getRunFloorLabel(run),
        chatName,
        startedAt: formatStartedAtPlain(run?.started_at_iso),
        streamText: formatBoolean(Boolean(run?.stream)),
        httpStatusText: getHttpStatusText(run),
        abnormalTypeLabel: abnormalType ? getAbnormalTypeLabel(abnormalType) : "-",
        failedStageLabel: failedStage ? getFailedStageLabel(failedStage) : "-",
        hasPartialOutputText: abnormalDetail ? formatBoolean(Boolean(abnormalDetail.has_partial_output)) : "-",
        paidText: paymentCompletionText,
        billingStatusText: abnormalBilling?.label || (usageAvailable || estimatedPrice ? "已完成" : "费用未确认"),
        firstOutputEvidenceText: getRunFirstOutputEvidenceText(run),
        outputEvidenceText: getRunOutputEvidenceText(run),
        usageEvidenceText: getRunUsageEvidenceText(run, abnormalBilling, usageAvailable),
        completionReasonText: getRunCompletionReasonLabel(run),
        contextPressureText: getRunContextPressureText(run),
        failureEvidenceSummaryText: getRunFailureEvidenceSummary(run, abnormalType, failedStage, abnormalBilling, usageAvailable),
        totalMsText: formatSeconds(run?.metrics?.total_ms),
        preprocessMsText: formatSeconds(run?.metrics?.preprocess_ms),
        upstreamHeadersMsText: formatSeconds(run?.metrics?.upstream_headers_ms),
        ttftMsText: formatSeconds(run?.metrics?.ttft_ms),
        streamMsText: formatSeconds(run?.metrics?.stream_ms),
        messageCountText: formatPlainValue(run?.message_count),
        promptCharsText: formatPlainValue(run?.prompt_chars),
        promptTokensText: formatPlainValue(usage.promptTokens),
        completionTokensText: formatPlainValue(usage.completionTokens),
        totalTokensText: formatPlainValue(usage.totalTokens),
        cacheHitText: usageAvailable ? formatBoolean(Boolean(usage.cacheHit)) : "-",
        cachedTokensText: formatPlainValue(usage.cachedTokens),
        cacheReadTokensText: formatPlainValue(usage.cacheReadTokens),
        injectionTraceText,
        injectionSourceLabel: injectionSourceLabel || "-",
        injectionSourceId: injectionSourceId || "-",
        traceLabelsText,
        traceKeysText,
        estimatedPriceText: estimatedPrice ? formatPriceWithCurrency(estimatedPrice.totalCost, estimatedPrice.currency) : "-",
        estimatedPriceNote: estimatedPrice
            ? estimatedPrice.note
            : (usageAvailable ? "未配置该模型价格，暂不显示金额估算" : "当前未拿到 usage，暂不显示金额估算"),
        runIdText: run?.id || "-",
        shortRunIdText: shortenRunId(run?.id) || "-",
        modelText: run?.model || "-",
    };
}

function buildOutputCardText(run) {
    const snapshot = getOutputCardSnapshot(run);
    const fields = getOutputCardFields();
    if (!snapshot) {
        return "";
    }

    return [
        `鱼缸后端监控排障卡`,
        `标题：${snapshot.title}`,
        `状态：${snapshot.summaryLabel}`,
        `用途：${snapshot.requestPurposeLabel}`,
        `模型：${snapshot.modelText}`,
        `来源：${snapshot.sourceLabel}`,
        `聊天窗：${snapshot.chatName}`,
        `楼层：${snapshot.floorLabel}`,
        `开始时间：${snapshot.startedAt}`,
        `记录编号：${snapshot.shortRunIdText}`,
        `状态码：${snapshot.httpStatusText}`,
        `流式生成：${snapshot.streamText}`,
        `异常类型：${snapshot.abnormalTypeLabel}`,
        `首输出信号：${snapshot.firstOutputEvidenceText}`,
        `正文证据：${snapshot.outputEvidenceText}`,
        `usage 信号：${snapshot.usageEvidenceText}`,
        `上下文压力：${snapshot.contextPressureText}`,
        `判断结论：${snapshot.failureEvidenceSummaryText}`,
        `生成完成：${snapshot.paidText}`,
        `卡住阶段：${snapshot.failedStageLabel}`,
        `总耗时：${snapshot.totalMsText}`,
        `预处理：${snapshot.preprocessMsText}`,
        `首个输出：${snapshot.ttftMsText}`,
        `Prompt Tokens：${snapshot.promptTokensText}`,
        `Completion Tokens：${snapshot.completionTokensText}`,
        `Total Tokens：${snapshot.totalTokensText}`,
        `注入痕迹：${snapshot.injectionTraceText}`,
        `拓展名称：${snapshot.pluginLabel}`,
        fields.showContextVolume ? `消息数：${snapshot.messageCountText}` : "",
        fields.showContextVolume ? `提示词字符数：${snapshot.promptCharsText}` : "",
        fields.showInjectionDetails ? `注入来源名称：${snapshot.injectionSourceLabel}` : "",
        fields.showInjectionDetails ? `注入来源标识：${snapshot.injectionSourceId}` : "",
        fields.showInjectionDetails ? `提示词来源：${snapshot.traceLabelsText}` : "",
        fields.showExtensionDetails ? `拓展标识：${snapshot.pluginIdText}` : "",
        fields.showExtensionDetails ? `识别方式：${snapshot.pluginMatchModeLabel}` : "",
        fields.showExtensionDetails ? `识别分数：${snapshot.pluginMatchScoreText}` : "",
        fields.showPricingDetails ? `计费状态：${snapshot.billingStatusText}` : "",
        fields.showPricingDetails ? `命中缓存：${snapshot.cacheHitText}` : "",
        fields.showPricingDetails ? `缓存 Tokens：${snapshot.cachedTokensText}` : "",
        fields.showPricingDetails ? `缓存读取 Tokens：${snapshot.cacheReadTokensText}` : "",
        fields.showPricingDetails ? `预估价格：${snapshot.estimatedPriceText}` : "",
        fields.showPricingDetails ? `估算说明：${snapshot.estimatedPriceNote}` : "",
    ].filter(Boolean).join("\n");
}

async function copyTextToClipboard(text) {
    const nextText = typeof text === "string" ? text : "";
    if (!nextText) {
        return false;
    }

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(nextText);
            return true;
        }
    } catch {
        // Fall through to the textarea fallback.
    }

    const textarea = document.createElement("textarea");
    textarea.value = nextText;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        return copied;
    } catch {
        document.body.removeChild(textarea);
        return false;
    }
}

function openOutputCardDialog(runId, host = "page") {
    const run = findRunById(runId);
    if (!run) {
        openMessageDialog("排障输出卡", "没有找到这条记录，可能是当前列表已经刷新。");
        return;
    }

    state.confirmDialog = {
        type: "output-card",
        runId,
        host: host === "history" ? "history" : "page",
    };
    safeRenderPage();
}

function readCurrentChatWindowName() {
    const primarySelectors = [
        "#chat_header_char_name",
        "#rm_button_selected_ch .ch_name",
        "#rm_button_selected_ch .name_text",
        "#rm_button_selected_ch",
        ".chat_header .name_text",
    ];

    for (const selector of primarySelectors) {
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLElement)) {
            continue;
        }

        const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
        if (text) {
            return text;
        }
    }

    const fallbackSelectors = [
        ".character_name_block .ch_name",
        ".group_name",
    ];

    for (const selector of fallbackSelectors) {
        const texts = Array.from(document.querySelectorAll(selector))
            .map((node) => (node instanceof HTMLElement ? node.textContent?.replace(/\s+/g, " ").trim() || "" : ""))
            .filter(Boolean);

        if (texts.length === 1) {
            return texts[0];
        }
    }

    return "";
}

function getSillyTavernContext() {
    const candidates = [
        typeof getContext === "function" ? getContext : null,
        typeof window.getContext === "function" ? window.getContext : null,
        typeof window.SillyTavern?.getContext === "function" ? window.SillyTavern.getContext : null,
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== "function") {
            continue;
        }

        try {
            const context = candidate();
            if (context && typeof context === "object") {
                return context;
            }
        } catch {
            continue;
        }
    }

    return null;
}

function normalizeChatIdentityPart(value) {
    return typeof value === "string" && value.trim()
        ? value.trim()
        : "";
}

function readCurrentChatIdentity() {
    const context = getSillyTavernContext();
    const chatIdHash = normalizeChatIdentityPart(context?.chatMetadata?.chat_id_hash != null ? String(context.chatMetadata.chat_id_hash) : "");
    const chatId = normalizeChatIdentityPart(context?.chatId != null ? String(context.chatId) : "");
    const chatName = readCurrentChatWindowName();
    const chatKey = chatIdHash
        ? `hash:${chatIdHash}`
        : (chatId ? `id:${chatId}` : "");

    return {
        chatKey,
        chatId,
        chatIdHash,
        chatName,
    };
}

function detectChatWindowContext() {
    const identity = readCurrentChatIdentity();
    const chatName = identity.chatName;
    const visibleFloorLabels = chatName ? readVisibleFloorLabels() : [];
    return {
        chatKey: identity.chatKey,
        chatName,
        isHome: !chatName,
        detectedAt: Date.now(),
        visibleFloorLabels,
        latestFloorLabel: visibleFloorLabels[0] || "",
    };
}

function refreshChatWindowContext() {
    const nextContext = detectChatWindowContext();
    state.chatWindowContext = nextContext;
    return nextContext;
}

function getTrackedCurrentChatWindowName() {
    return typeof state.chatWindowContext?.chatName === "string"
        ? state.chatWindowContext.chatName
        : "";
}

function getTrackedCurrentChatKey() {
    return typeof state.chatWindowContext?.chatKey === "string"
        ? state.chatWindowContext.chatKey
        : "";
}

function getTrackedVisibleFloorLabels() {
    return Array.isArray(state.chatWindowContext?.visibleFloorLabels)
        ? state.chatWindowContext.visibleFloorLabels.filter((value) => typeof value === "string" && value)
        : [];
}

function readVisibleFloorLabels() {
    const selector = ".mes .mesIDDisplay, .mes_block .mesIDDisplay, .mesIDDisplay";
    const nodes = Array.from(document.querySelectorAll(selector));
    const parsed = nodes
        .map((node) => {
            if (!(node instanceof HTMLElement)) {
                return null;
            }

            const text = node.textContent?.trim() || "";
            const matched = text.match(/#\d+/);
            if (!matched) {
                return null;
            }

            const messageRoot = node.closest(".mes, .mes_block, .message");
            const isUserMessage = Boolean(messageRoot?.matches?.(".is_user, .user_mes, [is_user='true'], [data-is-user='true']"));

            return {
                floorLabel: matched[0],
                isUserMessage,
            };
        })
        .filter(Boolean);

    const assistantFloors = parsed.filter((item) => !item.isUserMessage).map((item) => item.floorLabel);
    const fallbackFloors = parsed.map((item) => item.floorLabel);
    const floors = assistantFloors.length ? assistantFloors : fallbackFloors;

    return [...floors].reverse();
}

function getMessageAvatarReferenceKeys(root) {
    if (!(root instanceof HTMLElement)) {
        return [];
    }

    const isUser = root.getAttribute("is_user") === "true";
    const chatName = (root.getAttribute("ch_name") || "").trim();
    const roleKey = isUser ? "user" : "char";
    const keys = [`${roleKey}:${chatName}`, roleKey];
    return [...new Set(keys.filter(Boolean))];
}

function normalizeChatMessageUi() {
    const messageRoots = document.querySelectorAll(".mes, .mes_block, .message");
    const avatarReferences = new Map();

    for (const root of messageRoots) {
        if (!(root instanceof HTMLElement)) {
            continue;
        }

        const avatarImage = root.querySelector(".avatar img, .mesAvatar img");
        if (!(avatarImage instanceof HTMLImageElement)) {
            continue;
        }

        const avatarSrc = avatarImage.currentSrc || avatarImage.getAttribute("src") || "";
        if (!avatarSrc) {
            continue;
        }

        for (const key of getMessageAvatarReferenceKeys(root)) {
            if (!avatarReferences.has(key)) {
                avatarReferences.set(key, avatarSrc);
            }
        }
    }

    for (const root of messageRoots) {
        if (!(root instanceof HTMLElement)) {
            continue;
        }

        const floorNode = root.querySelector(".mesIDDisplay");
        if (floorNode instanceof HTMLElement) {
            const floorMatch = (floorNode.textContent || "").match(/#\d+/);
            if (floorMatch && floorNode.textContent !== floorMatch[0]) {
                floorNode.textContent = floorMatch[0];
            }
        }

        const counterNodes = root.querySelectorAll(".tokenCounterDisplay");
        for (const counterNode of counterNodes) {
            if (!(counterNode instanceof HTMLElement)) {
                continue;
            }

            if (counterNode.textContent) {
                counterNode.textContent = "";
            }

            if (counterNode.getAttribute("title")) {
                counterNode.setAttribute("title", "");
            }

            counterNode.setAttribute("aria-hidden", "true");
        }

        const timerNodes = root.querySelectorAll(".mes_timer");
        for (const timerNode of timerNodes) {
            if (!(timerNode instanceof HTMLElement)) {
                continue;
            }

            if (timerNode.textContent) {
                timerNode.textContent = "";
            }

            if (timerNode.getAttribute("title")) {
                timerNode.setAttribute("title", "");
            }

            timerNode.setAttribute("aria-hidden", "true");
        }

        const avatarHost = root.querySelector(".avatar, .mesAvatar");
        const missingAvatar = avatarHost?.querySelector(".missing-avatar");
        if (avatarHost instanceof HTMLElement && missingAvatar instanceof HTMLElement) {
            const avatarSrc = getMessageAvatarReferenceKeys(root)
                .map((key) => avatarReferences.get(key) || "")
                .find(Boolean);

            if (avatarSrc) {
                avatarHost.innerHTML = "";
                const avatarImage = document.createElement("img");
                avatarImage.src = avatarSrc;
                avatarImage.alt = root.getAttribute("ch_name") || "avatar";
                avatarHost.appendChild(avatarImage);
            }
        }

        const avatarImages = root.querySelectorAll(".avatar img, .mesAvatar img");
        for (const avatarImage of avatarImages) {
            if (!(avatarImage instanceof HTMLImageElement)) {
                continue;
            }

            if (avatarImage.naturalWidth > 0) {
                const avatarContainers = [
                    avatarImage.parentElement,
                    avatarImage.closest(".avatar"),
                    avatarImage.closest(".mesAvatar"),
                    avatarImage.closest(".avatar_holder"),
                    avatarImage.closest(".mesAvatarWrapper"),
                ].filter((node) => node instanceof HTMLElement);

                avatarImage.style.removeProperty("display");
                avatarImage.style.removeProperty("visibility");
                avatarImage.style.removeProperty("opacity");
                avatarImage.removeAttribute("hidden");

                for (const container of avatarContainers) {
                    container.style.removeProperty("display");
                    container.style.removeProperty("visibility");
                    container.style.removeProperty("opacity");
                    container.removeAttribute("hidden");
                }

                const placeholder = avatarImage.parentElement?.querySelector(".missing-avatar");
                if (placeholder instanceof HTMLElement) {
                    placeholder.remove();
                }
            }
        }
    }
}

function scheduleChatMessageUiNormalization() {
    if (state.chatUiNormalizeScheduled) {
        return;
    }

    state.chatUiNormalizeScheduled = true;
    window.requestAnimationFrame(() => {
        state.chatUiNormalizeScheduled = false;
        runSafely("同步消息区楼层与头像显示", () => {
            normalizeChatMessageUi();
        });
    });
}

function supportsMutationObserver() {
    return typeof MutationObserver === "function";
}

function isTrackedMutationObserverInstance(value) {
    return supportsMutationObserver() && value instanceof MutationObserver;
}

function startChatUiObserver() {
    if (isTrackedMutationObserverInstance(state.chatUiObserver)) {
        scheduleChatMessageUiNormalization();
        return;
    }

    if (!supportsMutationObserver()) {
        scheduleChatMessageUiNormalization();
        return;
    }

    const chatRoot = document.querySelector("#chat") || document.body;
    if (!(chatRoot instanceof HTMLElement)) {
        return;
    }

    const observer = new MutationObserver(() => {
        scheduleChatMessageUiNormalization();
    });

    observer.observe(chatRoot, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "class", "src", "hidden"],
    });

    state.chatUiObserver = observer;
    scheduleChatMessageUiNormalization();
}

function shouldReusePreviousFloorLabel(previousRun, currentRun) {
    const previousMessageCount = Number(previousRun?.message_count);
    const currentMessageCount = Number(currentRun?.message_count);

    return Number.isFinite(previousMessageCount)
        && Number.isFinite(currentMessageCount)
        && previousMessageCount === currentMessageCount;
}

function syncRunFloorMap() {
    if (!hasLegacyUnkeyedChatRuns(state.runs)) {
        return;
    }

    const visibleFloorLabels = readVisibleFloorLabels();
    if (!visibleFloorLabels.length) {
        return;
    }

    const currentChatName = getTrackedCurrentChatWindowName();
    if (!currentChatName) {
        return;
    }

    const visibleFloorLabelSet = new Set(visibleFloorLabels);
    const nextMap = { ...(state.uiSettings.runFloorMap || {}) };
    const targetRuns = sortRunsByStartedAtDesc(
        state.runs.filter((run) => {
            if (!run?.id) {
                return false;
            }

            if (getRunRequestPurpose(run) !== "chat_main_reply") {
                return false;
            }

            if (getRunChatKey(run)) {
                return false;
            }

            const mappedChatName = getRunChatName(run);
            if (mappedChatName && mappedChatName !== currentChatName) {
                return false;
            }

            const mappedFloorLabel = getRunFloorLabel(run);
            if (mappedFloorLabel && !visibleFloorLabelSet.has(mappedFloorLabel)) {
                return false;
            }

            return true;
        }),
    );

    if (!targetRuns.length) {
        return;
    }

    let changed = false;
    let floorIndex = 0;
    let previousRun = null;

    for (const run of targetRuns) {
        if (previousRun && !shouldReusePreviousFloorLabel(previousRun, run)) {
            floorIndex += 1;
        }

        const floorLabel = visibleFloorLabels[floorIndex];
        if (!floorLabel) {
            break;
        }

        if (nextMap[run.id] !== floorLabel) {
            nextMap[run.id] = floorLabel;
            changed = true;
        }

        previousRun = run;
    }

    if (!changed) {
        return;
    }

    state.uiSettings.runFloorMap = nextMap;
    saveUiSettings();
}

function syncRunChatMap() {
    if (!hasLegacyUnkeyedChatRuns(state.runs)) {
        return;
    }

    const context = refreshChatWindowContext();
    const currentChatName = context.chatName;
    if (!currentChatName) {
        return;
    }

    if (getActiveRequestPurpose() !== "chat_main_reply") {
        return;
    }

    const visibleFloorLabelSet = new Set(context.visibleFloorLabels || []);
    if (!visibleFloorLabelSet.size) {
        return;
    }

    const nextMap = { ...(state.uiSettings.runChatMap || {}) };
    let changed = false;

    for (const run of state.runs) {
        if (!run?.id) {
            continue;
        }

        if (getRunRequestPurpose(run) !== "chat_main_reply") {
            continue;
        }

        if (getRunChatKey(run)) {
            continue;
        }

        const floorLabel = getRunFloorLabel(run);
        if (!floorLabel || !visibleFloorLabelSet.has(floorLabel)) {
            continue;
        }

        if (nextMap[run.id] !== currentChatName) {
            nextMap[run.id] = currentChatName;
            changed = true;
        }
    }

    if (!changed) {
        return;
    }

    state.uiSettings.runChatMap = nextMap;
    saveUiSettings();
}

function getRunFloorLabel(run) {
    if (!run?.id) {
        return "";
    }

    return state.uiSettings.runFloorMap?.[run.id] || "";
}

function getRunChatName(run) {
    if (typeof run?.request_chat_name === "string" && run.request_chat_name.trim()) {
        return run.request_chat_name.trim();
    }

    if (!run?.id) {
        return "";
    }

    return state.uiSettings.runChatMap?.[run.id] || "";
}

function isRunInTrackedCurrentChat(run) {
    const currentChatKey = getTrackedCurrentChatKey();
    if (currentChatKey && getRunChatKey(run) === currentChatKey) {
        return true;
    }

    const currentChatName = getTrackedCurrentChatWindowName();
    return Boolean(currentChatName) && getRunChatName(run) === currentChatName;
}

function getRunChatKey(run) {
    return typeof run?.request_chat_key === "string" && run.request_chat_key.trim()
        ? run.request_chat_key.trim()
        : "";
}

function getRunDisplayChatName(run) {
    const mappedChatName = getRunChatName(run);
    if (mappedChatName) {
        return mappedChatName;
    }

    if (isRunInTrackedCurrentChat(run)) {
        return getTrackedCurrentChatWindowName() || "当前聊天窗";
    }

    return "";
}

function sortRunsByStartedAtDesc(runs) {
    return [...runs].sort((left, right) => {
        const leftValue = Number(left?.started_at_ms) || 0;
        const rightValue = Number(right?.started_at_ms) || 0;
        return rightValue - leftValue;
    });
}

function groupRunsByChatName(runs) {
    const grouped = new Map();

    for (const run of runs) {
        const chatName = getRunDisplayChatName(run) || "未绑定聊天窗";
        if (!grouped.has(chatName)) {
            grouped.set(chatName, []);
        }

        grouped.get(chatName).push(run);
    }

    const currentChatName = getTrackedCurrentChatWindowName();
    return Array.from(grouped.entries())
        .sort(([leftName], [rightName]) => {
            if (currentChatName) {
                if (leftName === currentChatName) return -1;
                if (rightName === currentChatName) return 1;
            }

            return leftName.localeCompare(rightName, "zh-CN");
        })
        .map(([chatName, groupRuns]) => ({
            chatName,
            runs: sortRunsByStartedAtDesc(groupRuns),
        }));
}

function formatDatePart(value) {
    return String(value);
}

function formatStartedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '<span>-</span>';
    }

    const time = [
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
    ].map((item) => String(item).padStart(2, "0")).join(":");

    const day = [
        formatDatePart(date.getFullYear()),
        formatDatePart(date.getMonth() + 1),
        formatDatePart(date.getDate()),
    ].join("/");

    return `
        <span class="stlp-time-value">
            <span>${escapeHtml(time)}</span>
            <span>${escapeHtml(day)}</span>
        </span>
    `;
}

function formatStartedAtCompact(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    const time = [
        date.getHours(),
        date.getMinutes(),
    ].map((item) => String(item).padStart(2, "0")).join(":");

    const day = [
        formatDatePart(date.getMonth() + 1),
        formatDatePart(date.getDate()),
    ].join("/");

    return `${time} ${day}`;
}


function formatStartedAtPlain(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    const time = [
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
    ].map((item) => String(item).padStart(2, "0")).join(":");

    const day = [
        formatDatePart(date.getFullYear()),
        formatDatePart(date.getMonth() + 1),
        formatDatePart(date.getDate()),
    ].join("/");

    return `${day} ${time}`;
}

function buildStartedAtDisplayParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return {
            time: "-",
            day: "",
        };
    }

    return {
        time: [
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
        ].map((item) => String(item).padStart(2, "0")).join(":"),
        day: [
            formatDatePart(date.getFullYear()),
            formatDatePart(date.getMonth() + 1),
            formatDatePart(date.getDate()),
        ].join("/"),
    };
}

function buildWaitingRuleTimeGroupHtml(parts, extraClass = "") {
    const className = ["stlp-waiting-rule-time-group", extraClass].filter(Boolean).join(" ");
    return `
        <div class="${className}">
            <span class="stlp-waiting-rule-time-prefix">更新于</span>
            <span class="stlp-waiting-rule-time-value">${escapeHtml(parts?.time || "-")}</span>
            ${parts?.day ? `<span class="stlp-waiting-rule-date-value">${escapeHtml(parts.day)}</span>` : ""}
        </div>
    `;
}

function isDesktopLayout() {
    return window.matchMedia("(min-width: 901px)").matches;
}

function isMobileDrawerLayout() {
    return isIosWebKit() || window.matchMedia("(max-width: 900px)").matches;
}

function lockBodyScrollForMobileDrawer() {
    if (state.bodyScrollLocked) {
        return;
    }

    const scrollTop = window.scrollY || window.pageYOffset || 0;
    state.bodyScrollLocked = true;
    state.bodyScrollLockTop = scrollTop;

    document.documentElement.classList.add("stlp-page-host-open");
    document.body.classList.add("stlp-page-host-open");
    document.documentElement.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${Math.round(scrollTop)}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
}

function unlockBodyScrollForMobileDrawer() {
    if (!state.bodyScrollLocked) {
        document.documentElement.classList.remove("stlp-page-host-open");
        document.body.classList.remove("stlp-page-host-open");
        return;
    }

    const scrollTop = Math.max(0, Math.round(Number(state.bodyScrollLockTop) || 0));
    state.bodyScrollLocked = false;

    document.documentElement.classList.remove("stlp-page-host-open");
    document.body.classList.remove("stlp-page-host-open");
    document.documentElement.style.removeProperty("overflow");
    document.body.style.removeProperty("position");
    document.body.style.removeProperty("top");
    document.body.style.removeProperty("left");
    document.body.style.removeProperty("right");
    document.body.style.removeProperty("width");
    document.body.style.removeProperty("overflow");
    window.scrollTo(0, scrollTop);
}

function syncBodyScrollLock() {
    if (state.pageOpen && !state.pageMinimized && isMobileDrawerLayout()) {
        lockBodyScrollForMobileDrawer();
        return;
    }

    unlockBodyScrollForMobileDrawer();
}

function shouldIgnoreMobileOpenGuard() {
    return isMobileDrawerLayout() && Date.now() < state.pageOpenGuardUntil;
}

function scheduleViewportSync() {
    if (state.viewportSyncQueued) {
        return;
    }

    state.viewportSyncQueued = true;
    window.requestAnimationFrame(() => {
        state.viewportSyncQueued = false;
        if (!state.pageOpen || !isMobileDrawerLayout()) {
            return;
        }

        syncMobileViewport();
    });
}

function scheduleMobileFieldIntoView(target) {
    if (!state.pageOpen || !isMobileDrawerLayout() || !(target instanceof HTMLElement)) {
        return;
    }

    const scrollTarget = target.closest(".stlp-pricing-field, .stlp-number, .stlp-select, .stlp-pricing-inline-row");
    if (!(scrollTarget instanceof HTMLElement)) {
        return;
    }

    window.setTimeout(() => {
        if (!state.pageOpen || !isMobileDrawerLayout()) {
            return;
        }

        scrollTarget.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "smooth",
        });
    }, 180);
}

function syncMobileViewport() {
    if (!state.pageOpen || !isMobileDrawerLayout() || !(state.pageRoot instanceof HTMLElement)) {
        return;
    }

    const dialogs = state.pageRoot.querySelectorAll(".stlp-page-dialog, .stlp-history-dialog");
    if (!dialogs.length) {
        return;
    }

    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;top:env(safe-area-inset-top,0px);bottom:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(probe);
    const computedProbeStyle = window.getComputedStyle(probe);
    const safeTop = Number.parseFloat(computedProbeStyle.top) || 0;
    const safeBottom = Number.parseFloat(computedProbeStyle.bottom) || 0;
    probe.remove();

    const viewport = window.visualViewport;
    const viewportHeight = Math.max(320, Math.round(viewport?.height || window.innerHeight));
    const offsetTop = viewport ? Math.max(0, Math.round(viewport.offsetTop || 0)) : 0;
    const top = offsetTop + 20 + safeTop;
    const maxHeight = Math.max(260, viewportHeight - 40 - safeTop - safeBottom);

    dialogs.forEach((dialog) => {
        if (!(dialog instanceof HTMLElement)) {
            return;
        }

        dialog.style.top = `${top}px`;
        dialog.style.bottom = "auto";
        dialog.style.height = `${maxHeight}px`;
        dialog.style.maxHeight = `${maxHeight}px`;
    });
}

function clampPagePosition(position, dialogRect = {}) {
    const width = dialogRect.width || 320;
    const visibleHeight = Math.min(Math.max(dialogRect.height || 120, 120), 180);
    const maxLeft = Math.max(16, window.innerWidth - width - 16);
    const maxTop = Math.max(16, window.innerHeight - visibleHeight - 16);

    return {
        left: Math.max(16, Math.min(position.left, maxLeft)),
        top: Math.max(16, Math.min(position.top, maxTop)),
    };
}

function getDesktopDialogMaxHeight(top) {
    const clampedTop = Math.max(16, Math.round(Number(top) || 16));
    return `calc(100vh - ${clampedTop + 16}px)`;
}

function getDesktopDialogHeightBounds(top) {
    const clampedTop = Math.max(16, Math.round(Number(top) || 16));
    const viewportMaxHeight = Math.max(240, window.innerHeight - clampedTop - 16);
    const defaultHeight = Math.min(Math.round(window.innerHeight * 0.56), 620, viewportMaxHeight);
    const minHeight = Math.min(Math.max(300, Math.round(window.innerHeight * 0.38)), viewportMaxHeight);
    const maxHeight = Math.max(minHeight, Math.min(Math.round(defaultHeight * 1.5), viewportMaxHeight));
    return {
        defaultHeight,
        minHeight,
        maxHeight,
    };
}

function getClampedDesktopDialogHeight(height, top) {
    const bounds = getDesktopDialogHeightBounds(top);
    const targetHeight = Number.isFinite(height) ? height : bounds.defaultHeight;
    return Math.max(bounds.minHeight, Math.min(targetHeight, bounds.maxHeight));
}

function buildPageDialogStyle() {
    if (!isDesktopLayout()) {
        return "";
    }

    const basePosition = state.pagePosition ? clampPagePosition(state.pagePosition) : { top: 16, left: null };
    const height = getClampedDesktopDialogHeight(state.pageHeight, basePosition.top);
    state.pageHeight = height;

    if (basePosition.left === null) {
        return ` style="height:${Math.round(height)}px;max-height:${getDesktopDialogMaxHeight(basePosition.top)};"`;
    }

    return ` style="top:${Math.round(basePosition.top)}px;left:${Math.round(basePosition.left)}px;right:auto;bottom:auto;height:${Math.round(height)}px;max-height:${getDesktopDialogMaxHeight(basePosition.top)};"`;
}

function startMinimizedButtonDrag(event) {
    const button = state.pageRoot?.querySelector(".stlp-minimized-button");
    if (!(button instanceof HTMLElement)) {
        return;
    }

    event.preventDefault();
    const rect = button.getBoundingClientRect();
    state.minimizedButtonDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
    };
    state.minimizedButtonLongPressTriggered = false;
    state.uiSettings.minimizedButtonPosition = clampMinimizedButtonPosition({
        left: rect.left,
        top: rect.top,
    }, rect);

    clearMinimizedButtonLongPressTimer();
}

function handleMinimizedButtonDragMove(event) {
    if (!state.minimizedButtonDrag || event.pointerId !== state.minimizedButtonDrag.pointerId) {
        return;
    }

    const button = state.pageRoot?.querySelector(".stlp-minimized-button");
    if (!(button instanceof HTMLElement)) {
        return;
    }

    event.preventDefault();
    if (state.minimizedButtonLongPressTriggered) {
        return;
    }

    const deltaX = event.clientX - state.minimizedButtonDrag.startX;
    const deltaY = event.clientY - state.minimizedButtonDrag.startY;
    if (Math.abs(deltaX) >= MINIMIZED_BUTTON_DRAG_THRESHOLD || Math.abs(deltaY) >= MINIMIZED_BUTTON_DRAG_THRESHOLD) {
        clearMinimizedButtonLongPressTimer();
        state.minimizedButtonDrag.moved = true;
        button.classList.add("is-dragging");
    } else if (!state.minimizedButtonDrag.moved) {
        return;
    }

    const position = clampMinimizedButtonPosition({
        left: event.clientX - state.minimizedButtonDrag.offsetX,
        top: event.clientY - state.minimizedButtonDrag.offsetY,
    }, {
        width: state.minimizedButtonDrag.width,
        height: state.minimizedButtonDrag.height,
    });

    state.uiSettings.minimizedButtonPosition = position;
    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
    button.style.right = "auto";
    button.style.bottom = "auto";
}

function startPageDrag(event) {
    if (!isDesktopLayout()) {
        return;
    }

    const dialog = state.pageRoot?.querySelector(".stlp-page-dialog");
    if (!(dialog instanceof HTMLElement)) {
        return;
    }

    event.preventDefault();
    const rect = dialog.getBoundingClientRect();
    state.pageDrag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
    };
    state.pagePosition = {
        left: rect.left,
        top: rect.top,
    };
    state.pageHeight = getClampedDesktopDialogHeight(rect.height, rect.top);
}

function handlePageDragMove(event) {
    if (!state.pageDrag || event.pointerId !== state.pageDrag.pointerId) {
        return;
    }

    const dialog = state.pageRoot?.querySelector(".stlp-page-dialog");
    if (!(dialog instanceof HTMLElement)) {
        return;
    }

    state.pagePosition = clampPagePosition({
        left: event.clientX - state.pageDrag.offsetX,
        top: event.clientY - state.pageDrag.offsetY,
    }, {
        width: state.pageDrag.width,
        height: state.pageDrag.height,
    });

    dialog.style.top = `${Math.round(state.pagePosition.top)}px`;
    dialog.style.left = `${Math.round(state.pagePosition.left)}px`;
    dialog.style.right = "auto";
    dialog.style.bottom = "auto";
    dialog.style.height = `${Math.round(getClampedDesktopDialogHeight(state.pageHeight || state.pageDrag.height, state.pagePosition.top))}px`;
    dialog.style.maxHeight = getDesktopDialogMaxHeight(state.pagePosition.top);
}

function startPageResize(event) {
    if (!isDesktopLayout()) {
        return;
    }

    const dialog = state.pageRoot?.querySelector(".stlp-page-dialog");
    if (!(dialog instanceof HTMLElement)) {
        return;
    }

    event.preventDefault();
    const rect = dialog.getBoundingClientRect();
    state.pagePosition = {
        left: rect.left,
        top: rect.top,
    };
    state.pageResize = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: rect.height,
        top: rect.top,
    };
    state.pageHeight = getClampedDesktopDialogHeight(rect.height, rect.top);
}

function handlePageResizeMove(event) {
    if (!state.pageResize || event.pointerId !== state.pageResize.pointerId) {
        return;
    }

    const dialog = state.pageRoot?.querySelector(".stlp-page-dialog");
    if (!(dialog instanceof HTMLElement)) {
        return;
    }

    const nextHeight = state.pageResize.startHeight + (event.clientY - state.pageResize.startY);
    const top = state.pagePosition?.top ?? state.pageResize.top;
    state.pageHeight = getClampedDesktopDialogHeight(nextHeight, top);
    dialog.style.height = `${Math.round(state.pageHeight)}px`;
    dialog.style.maxHeight = getDesktopDialogMaxHeight(top);
}

function endPageDrag(event) {
    if (!state.pageDrag || (event && event.pointerId !== state.pageDrag.pointerId)) {
        return;
    }

    state.pageDrag = null;
}

function endPageResize(event) {
    if (!state.pageResize || (event && event.pointerId !== state.pageResize.pointerId)) {
        return;
    }

    state.pageResize = null;
}

function endMinimizedButtonDrag(event) {
    if (!state.minimizedButtonDrag || (event && event.pointerId !== state.minimizedButtonDrag.pointerId)) {
        return;
    }

    clearMinimizedButtonLongPressTimer();
    const button = state.pageRoot?.querySelector(".stlp-minimized-button");
    if (button instanceof HTMLElement) {
        button.classList.remove("is-dragging");
    }

    if (state.minimizedButtonDrag.moved || state.minimizedButtonLongPressTriggered) {
        state.minimizedButtonSuppressClickUntil = Date.now() + 250;
    }
    if (state.minimizedButtonDrag.moved) {
        saveUiSettings();
    }
    state.minimizedButtonDrag = null;
    state.minimizedButtonLongPressTriggered = false;
}

function isAbnormalRun(run) {
    return Boolean(run?.abnormal_detail?.abnormal_type);
}

function buildSectionHtml(sectionKey, title, bodyHtml, { statusIndicatorClass = "", statusIndicatorPosition = "before", sectionClass = "", titleHtml = "" } = {}) {
    const open = Boolean(state.uiSettings.sectionOpenStates?.[sectionKey]);
    const indicatorHtml = statusIndicatorClass
        ? `<span class="stlp-status-indicator ${statusIndicatorClass}" aria-hidden="true"></span>`
        : "";
    const rawTitleContent = titleHtml || escapeHtml(title);
    const titleContent = statusIndicatorPosition === "after"
        ? `${rawTitleContent}${indicatorHtml}`
        : `${indicatorHtml}${rawTitleContent}`;

    return `
        <section class="stlp-section stlp-section-key-${escapeHtml(sectionKey)} ${sectionClass} ${open ? "is-open" : ""}">
            <button class="stlp-section-summary" type="button" data-action="toggle-section" data-section-key="${escapeHtml(sectionKey)}" aria-expanded="${open ? "true" : "false"}">
                <span class="stlp-section-title">${titleContent}</span>
                <span class="stlp-section-chevron" aria-hidden="true">▾</span>
            </button>
            <div class="stlp-section-body ${open ? "" : "stlp-hidden"}">
                ${bodyHtml}
            </div>
        </section>
    `;
}

function collapseRunDetails(runIds) {
    for (const runId of runIds) {
        if (!runId) {
            continue;
        }

        state.expandedRunIds.delete(runId);
        state.expandedSuggestionRunIds.delete(runId);
    }
}

function collapseCurrentRunsDetails() {
    collapseRunDetails(state.runs.map((run) => run?.id || ""));
}

function collapseHistoryRunsDetails() {
    collapseRunDetails(state.historyRuns.map((run) => run?.id || ""));
}

function getSelectedHistoryRunIds() {
    return Array.from(state.selectedHistoryRunIds).filter((runId) => typeof runId === "string" && runId.length);
}

function getSelectedHistoryRunCount() {
    return getSelectedHistoryRunIds().length;
}

function clearHistorySelection() {
    state.selectedHistoryRunIds = new Set();
}

function syncHistorySelectionToLoadedRuns() {
    const sourceRuns = state.historyAbnormalOnly ? state.historyAllRuns : state.historyRuns;
    const visibleRunIds = new Set(sourceRuns.map((run) => run?.id).filter(Boolean));
    if (!visibleRunIds.size) {
        return;
    }

    state.selectedHistoryRunIds = new Set(
        getSelectedHistoryRunIds().filter((runId) => (
            visibleRunIds.has(runId) || !sourceRuns.some((run) => run?.id === runId)
        )),
    );
}

function toggleHistoryRunSelection(runId, checked) {
    if (!runId) {
        return;
    }

    if (checked) {
        state.selectedHistoryRunIds.add(runId);
    } else {
        state.selectedHistoryRunIds.delete(runId);
    }
}

function toggleHistoryPageSelection(checked, runs = state.historyRuns) {
    for (const run of runs) {
        if (!run?.id) {
            continue;
        }

        toggleHistoryRunSelection(run.id, checked);
    }
}

function areAllHistoryRunsSelected(runs = state.historyRuns) {
    const visibleRunIds = runs.map((run) => run?.id).filter(Boolean);
    return visibleRunIds.length > 0 && visibleRunIds.every((runId) => state.selectedHistoryRunIds.has(runId));
}

async function fetchJson(path, options) {
    const stRequestHeadersFactory = await getSillyTavernRequestHeadersFactory();
    const stRequestHeaders = typeof stRequestHeadersFactory === "function"
        ? stRequestHeadersFactory({ omitContentType: !options?.body })
        : {};
    const csrfToken = readCsrfToken() || stRequestHeaders["X-CSRF-Token"] || "";
    const response = await fetch(`${BACKEND_BASE}${path}`, {
        credentials: "same-origin",
        headers: {
            ...stRequestHeaders,
            ...(options?.body ? { "Content-Type": "application/json" } : {}),
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
            ...(options?.headers || {}),
        },
        ...options,
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const message = payload?.error || payload?.message || `${response.status} ${response.statusText}`;
        throw new Error(message);
    }

    return payload;
}

async function loadWaitingQueue({ silent = false } = {}) {
    if (state.waitingQueueLoading) {
        return;
    }

    if (silent && isWaitingQueueLabelInputActive()) {
        return;
    }

    state.waitingQueueLoading = true;
    if (!silent) {
        safeRenderPage();
    }

    try {
        const result = await fetchJson("/waiting-queue");
        state.waitingQueueEntries = Array.isArray(result?.entries) ? result.entries : [];
        state.waitingQueueError = "";
        syncWaitingQueueExpandedState();
    } catch (error) {
        state.waitingQueueError = error instanceof Error ? error.message : String(error);
    } finally {
        state.waitingQueueLoading = false;
        if (silent && isWaitingQueueLabelInputActive()) {
            deferWaitingQueueRenderUntilBlur();
            return;
        }
        safeRenderPage();
    }
}

async function loadPluginRules({ silent = false } = {}) {
    if (state.pluginRulesLoading) {
        return;
    }

    if (silent && isWaitingQueueLabelInputActive()) {
        return;
    }

    state.pluginRulesLoading = true;
    if (!silent) {
        safeRenderPage();
    }

    try {
        const result = await fetchJson("/plugin-rules");
        state.pluginRules = Array.isArray(result?.rules) ? result.rules : [];
        state.pluginRulesError = "";
        syncPluginRuleExpandedState();
    } catch (error) {
        state.pluginRulesError = error instanceof Error ? error.message : String(error);
    } finally {
        state.pluginRulesLoading = false;
        if (silent && isWaitingQueueLabelInputActive()) {
            deferWaitingQueueRenderUntilBlur();
            return;
        }
        safeRenderPage();
    }
}

async function moveRunToWaitingQueue(runId) {
    const run = findRunById(runId);
    if (!run) {
        throw new Error("找不到这条记录。");
    }

    await fetchJson("/waiting-queue", {
        method: "POST",
        body: JSON.stringify({ run_id: runId }),
    });
    await loadWaitingQueue({ silent: true });
    openMessageDialog("已移入等待区", "这条记录已经进入等待区。要不要现在过去继续标注拓展名称？", [
        { action: "go-to-waiting-queue", label: "前往等待区" },
        { action: "dismiss-confirm-dialog", label: "稍后再说" },
    ]);
    safeRenderPage();
}

async function submitWaitingQueueLabel(runId) {
    const rawLabel = state.waitingQueueDrafts?.[runId];
    const pluginLabel = typeof rawLabel === "string" ? rawLabel.trim() : "";
    if (!pluginLabel) {
        openMessageDialog("还没填拓展名称", "请先输入拓展名称，再确认标注。");
        return;
    }

    const result = await fetchJson(`/waiting-queue/${encodeURIComponent(runId)}/label`, {
        method: "POST",
        body: JSON.stringify({
            plugin_label: pluginLabel,
        }),
    });

    const updatedRun = result?.run ?? null;
    if (updatedRun?.id) {
        const replaceRun = (run) => (run?.id === updatedRun.id ? updatedRun : run);
        state.runs = state.runs.map(replaceRun);
        state.historyRuns = state.historyRuns.map(replaceRun);
        state.historyAllRuns = state.historyAllRuns.map(replaceRun);
        state.recentAbnormalRuns = state.recentAbnormalRuns.map(replaceRun);
    }

    const matchedRuns = Number.isFinite(Number(result?.matched_runs))
        ? Math.max(0, Number(result.matched_runs))
        : 0;
    const learnedRuleCreated = Boolean(result?.learned_rule_created);
    delete state.waitingQueueDrafts[runId];
    clearWaitingQueueEditLock(runId);
    await loadWaitingQueue({ silent: true });
    await refreshBackendData({ silent: true });
    openMessageDialog(
        "标注已保存",
        learnedRuleCreated
            ? `已将这条记录标注为“${pluginLabel}”，并自动归类 ${matchedRuns} 条同类记录。`
            : `已将这条记录标注为“${pluginLabel}”。这次还没提炼出可复用规则，所以暂时没有自动归类其他记录。`,
    );
    safeRenderPage();
}

async function removeRunFromWaitingQueue(runId) {
    await fetchJson(`/waiting-queue/${encodeURIComponent(runId)}`, {
        method: "DELETE",
    });
    delete state.waitingQueueDrafts[runId];
    clearWaitingQueueEditLock(runId);
    await loadWaitingQueue({ silent: true });
    safeRenderPage();
}

async function reapplyPluginRule(ruleId) {
    const result = await fetchJson(`/plugin-rules/${encodeURIComponent(ruleId)}/reapply`, {
        method: "POST",
    });
    const matchedRuns = Number.isFinite(Number(result?.matched_runs))
        ? Math.max(0, Number(result.matched_runs))
        : 0;
    await refreshBackendData({ silent: true });
    await loadPluginRules({ silent: true });
    openMessageDialog("规则已重新应用", `这条规则刚刚又回填了一次历史记录，本次自动归类 ${matchedRuns} 条。`);
    safeRenderPage();
}

async function setPluginRuleEnabled(ruleId, enabled) {
    const result = await fetchJson(`/plugin-rules/${encodeURIComponent(ruleId)}`, {
        method: "PATCH",
        body: JSON.stringify({
            enabled,
        }),
    });
    const pluginLabel = result?.rule?.plugin_label || "这条规则";
    await loadPluginRules({ silent: true });
    openMessageDialog(
        enabled ? "规则已启用" : "规则已停用",
        enabled
            ? `已恢复“${pluginLabel}”的自动归类。后续同类记录会继续使用这条规则。`
            : `已暂停“${pluginLabel}”的自动归类。后续同类记录不会再用这条规则自动归类。`,
    );
    safeRenderPage();
}

async function removePluginRule(ruleId) {
    const result = await fetchJson(`/plugin-rules/${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
    });
    const pluginLabel = result?.rule?.plugin_label || "这条规则";
    await loadPluginRules({ silent: true });
    openMessageDialog("规则已删除", `已删除“${pluginLabel}”的规则复用配置。后续新记录将不再使用这条规则自动归类。`);
    safeRenderPage();
}

async function getSillyTavernRequestHeadersFactory() {
    if (stRequestHeadersFactoryPromise) {
        return stRequestHeadersFactoryPromise;
    }

    stRequestHeadersFactoryPromise = import("/script.js")
        .then((module) => (typeof module.getRequestHeaders === "function" ? module.getRequestHeaders : null))
        .catch(() => null);

    return stRequestHeadersFactoryPromise;
}

function normalizeReportedInjectionSource(payload) {
    if (typeof payload === "string" && payload.trim()) {
        return {
            source: payload.trim(),
            label: getKnownInjectionSourceLabel(payload.trim()) || "",
        };
    }

    if (!payload || typeof payload !== "object") {
        return null;
    }

    const source = typeof payload.source === "string" && payload.source.trim()
        ? payload.source.trim()
        : (typeof payload.request_injection_source === "string" && payload.request_injection_source.trim()
            ? payload.request_injection_source.trim()
            : "");
    const label = typeof payload.label === "string" && payload.label.trim()
        ? payload.label.trim()
        : (typeof payload.request_injection_source_label === "string" && payload.request_injection_source_label.trim()
            ? payload.request_injection_source_label.trim()
            : "");
    if (!source && !label) {
        return null;
    }

    return {
        source,
        label: label || getKnownInjectionSourceLabel(source),
    };
}

function reportPendingInjectionSource(payload) {
    const normalized = normalizeReportedInjectionSource(payload);
    if (!normalized) {
        return false;
    }

    state.pendingInjectionSource = {
        ...normalized,
        reportedAt: Date.now(),
    };
    return true;
}

function clearPendingInjectionSource() {
    state.pendingInjectionSource = null;
}

function getActivePendingInjectionSource() {
    const pending = state.pendingInjectionSource;
    const normalized = normalizeReportedInjectionSource(pending);
    if (!normalized) {
        clearPendingInjectionSource();
        return null;
    }

    const reportedAt = Number(pending?.reportedAt);
    if (!Number.isFinite(reportedAt) || reportedAt <= 0) {
        clearPendingInjectionSource();
        return null;
    }

    if (Date.now() - reportedAt > PENDING_INJECTION_SOURCE_TTL_MS) {
        clearPendingInjectionSource();
        return null;
    }

    return normalized;
}

function isChatGenerationRequestTarget(input) {
    const rawUrl = typeof input === "string"
        ? input
        : (input instanceof Request
            ? input.url
            : (typeof input?.url === "string" ? input.url : ""));
    if (!rawUrl) {
        return false;
    }

    try {
        const resolvedUrl = new URL(rawUrl, window.location.origin);
        return resolvedUrl.pathname === "/api/backends/chat-completions/generate";
    } catch {
        return false;
    }
}

function injectTrackedRequestMetadata(requestBody) {
    if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
        return false;
    }

    const pendingInjectionSource = getActivePendingInjectionSource();
    const requestPurpose = typeof requestBody.request_purpose === "string"
        ? requestBody.request_purpose.trim()
        : "";
    const shouldAttachChatIdentity = requestPurpose !== "non_chat_generation" && requestPurpose !== "plugin_internal_request";
    const currentChatIdentity = shouldAttachChatIdentity ? readCurrentChatIdentity() : null;
    let changed = false;

    if (!requestBody.request_injection_source && pendingInjectionSource?.source) {
        requestBody.request_injection_source = pendingInjectionSource.source;
        changed = true;
    }

    if (!requestBody.request_injection_source_label && pendingInjectionSource?.label) {
        requestBody.request_injection_source_label = pendingInjectionSource.label;
        changed = true;
    }

    if (shouldAttachChatIdentity && currentChatIdentity) {
        if (!requestBody.request_chat_key && currentChatIdentity.chatKey) {
            requestBody.request_chat_key = currentChatIdentity.chatKey;
            changed = true;
        }

        if (!requestBody.request_chat_id && currentChatIdentity.chatId) {
            requestBody.request_chat_id = currentChatIdentity.chatId;
            changed = true;
        }

        if (!requestBody.request_chat_id_hash && currentChatIdentity.chatIdHash) {
            requestBody.request_chat_id_hash = currentChatIdentity.chatIdHash;
            changed = true;
        }

        if (!requestBody.request_chat_name && currentChatIdentity.chatName) {
            requestBody.request_chat_name = currentChatIdentity.chatName;
            changed = true;
        }
    }

    if (pendingInjectionSource) {
        clearPendingInjectionSource();
    }

    return changed;
}

function buildPatchedGenerationRequestInit(init) {
    if (!init || typeof init !== "object" || typeof init.body !== "string") {
        return null;
    }

    try {
        const requestBody = JSON.parse(init.body);
        if (!injectTrackedRequestMetadata(requestBody)) {
            return null;
        }

        return {
            ...init,
            body: JSON.stringify(requestBody),
        };
    } catch {
        return null;
    }
}

function parseGenerationRequestBody(init) {
    if (!init || typeof init !== "object" || typeof init.body !== "string") {
        return null;
    }

    try {
        const requestBody = JSON.parse(init.body);
        if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
            return null;
        }

        return requestBody;
    } catch {
        return null;
    }
}

function hasExplicitPluginRequestMetadata(requestBody) {
    return Boolean(
        (typeof requestBody?.request_plugin === "string" && requestBody.request_plugin.trim())
        || (typeof requestBody?.request_plugin_label === "string" && requestBody.request_plugin_label.trim()),
    );
}

function shouldTrackAbortableChatGenerationRequest(input, init, patchedInit) {
    if (!isChatGenerationRequestTarget(input)) {
        return false;
    }

    const requestBody = parseGenerationRequestBody(patchedInit ?? init);
    if (!requestBody) {
        return false;
    }

    const requestPurpose = typeof requestBody.request_purpose === "string"
        ? requestBody.request_purpose.trim()
        : "";
    if (requestPurpose === "non_chat_generation" || requestPurpose === "plugin_internal_request") {
        return false;
    }

    if (hasExplicitPluginRequestMetadata(requestBody)) {
        return false;
    }

    return true;
}

function installOutgoingGenerationHook() {
    if (state.outgoingGenerationHookInstalled || typeof window.fetch !== "function") {
        return;
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init) {
        if (isChatGenerationRequestTarget(input)) {
            const patchedInit = buildPatchedGenerationRequestInit(init);
            const effectiveInit = patchedInit ?? init;
            if (!shouldTrackAbortableChatGenerationRequest(input, effectiveInit, patchedInit)) {
                return originalFetch(input, effectiveInit);
            }
            const requestEntry = registerActiveGenerationRequest();
            const trackedInit = buildTrackedGenerationRequestInit(input, init, effectiveInit, requestEntry);

            try {
                return Promise.resolve(originalFetch(input, trackedInit)).then((response) => {
                    monitorGenerationResponseLifecycle(response, requestEntry.requestId);
                    return response;
                }, (error) => {
                    removeActiveGenerationRequest(requestEntry.requestId);
                    throw error;
                });
            } catch (error) {
                removeActiveGenerationRequest(requestEntry.requestId);
                throw error;
            }
        }

        return originalFetch(input, init);
    };

    window.STLatencyMonitorInjectionSource = {
        reportInjectionSource: reportPendingInjectionSource,
        clearInjectionSource: clearPendingInjectionSource,
        peekInjectionSource: getActivePendingInjectionSource,
    };
    state.outgoingGenerationHookInstalled = true;
}

function installGenerationSettingsHook() {
    if (state.generationSettingsHookInstalled || !eventSource || typeof eventSource.on !== "function") {
        return;
    }

    eventSource.on(event_types.GENERATION_STARTED, () => {
        markSillyTavernGenerationStarted();
    });
    eventSource.on(event_types.GENERATION_STOPPED, () => {
        markSillyTavernGenerationStopped();
    });
    eventSource.on(event_types.GENERATION_ENDED, () => {
        markSillyTavernGenerationEnded();
    });
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, (generateData) => {
        injectTrackedRequestMetadata(generateData);
    });
    state.generationSettingsHookInstalled = true;
}

function readCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"], meta[name="csrf"], meta[name="X-CSRF-Token"]');
    if (meta instanceof HTMLMetaElement && meta.content.trim()) {
        return meta.content.trim();
    }

    const globalCandidates = [
        window.csrfToken,
        window.CSRF_TOKEN,
        window.csrf_token,
    ];

    for (const value of globalCandidates) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }

    const cookieMatch = document.cookie.match(/(?:^|;\s*)(?:csrfToken|csrf_token|X-CSRF-Token)=([^;]+)/i);
    if (cookieMatch?.[1]) {
        return decodeURIComponent(cookieMatch[1]);
    }

    return "";
}

async function refreshBackendData({ silent = false } = {}) {
    if (state.extensionDisabled || state.isRefreshing) {
        return;
    }

    if (silent && (isWaitingQueueLabelInputActive() || isColorWheelInputActive())) {
        return;
    }

    state.isRefreshing = true;
    if (!silent) {
        state.apiStatus = "正在刷新后台监控数据";
        safeRenderPage();
    }

    try {
        refreshChatWindowContext();
        const requestFilterQuery = buildRunFilterQuery();
        const dailySummaryQuery = buildDailySummaryQuery();
        const dailySummaryScope = getDailySummaryScopeInfo();
        const [statusResult, settingsResult, runsResult, summaryResult, dailySummaryResult, waitingQueueResult, pluginRulesResult] = await Promise.all([
            fetchJson("/status"),
            fetchJson("/settings"),
            fetchJson(`/runs?limit=20&${requestFilterQuery}`),
            fetchJson(`/summary?limit=100&${requestFilterQuery}`),
            fetchJson(`/summary?${dailySummaryQuery}`),
            fetchJson("/waiting-queue"),
            fetchJson("/plugin-rules"),
        ]);

        state.status = statusResult;
        state.settings = settingsResult?.settings ?? null;
        state.runs = filterRunsByRequestPurpose(runsResult?.runs);
        updateMinimizedButtonAbnormalAlert(state.runs);
        if (Number.isFinite(Number(runsResult?.total))) {
            state.historyTotal = Math.max(0, Number(runsResult?.total));
        } else {
            state.historyTotal = Math.max(
                Number(statusResult?.stored_runs) || 0,
                state.runs.length,
            );
        }
        state.summary = summaryResult?.summary ?? null;
        state.dailySummary = dailySummaryResult?.daily_summary
            ? {
                ...dailySummaryResult.daily_summary,
                scope_mode: dailySummaryScope.mode,
                scope_label: dailySummaryScope.label,
            }
            : null;
        state.waitingQueueEntries = Array.isArray(waitingQueueResult?.entries) ? waitingQueueResult.entries : [];
        state.waitingQueueError = "";
        state.pluginRules = Array.isArray(pluginRulesResult?.rules) ? pluginRulesResult.rules : [];
        state.pluginRulesError = "";
        syncWaitingQueueExpandedState();
        syncPluginRuleExpandedState();
        if (state.uiSettings.abnormalOnly) {
            const { runs: abnormalRuns, total: abnormalTotal } = await fetchAbnormalStoredRuns();
            state.recentAbnormalRuns = sortRunsByStartedAtDesc(abnormalRuns);
            state.historyTotal = Math.max(state.historyTotal, abnormalTotal);
        }
        state.expandedRunIds = new Set(
            Array.from(state.expandedRunIds).filter((runId) => state.runs.some((run) => run?.id === runId)),
        );
        state.expandedSuggestionRunIds = new Set(
            Array.from(state.expandedSuggestionRunIds).filter((runId) => state.runs.some((run) => run?.id === runId)),
        );
        state.backendReady = true;
        state.apiError = "";
        state.apiStatus = "后端监控接口已连接";
    } catch (error) {
        state.backendReady = false;
        state.apiStatus = "后端监控接口不可用";
        state.apiError = error instanceof Error ? error.message : String(error);
    } finally {
        refreshChatWindowContext();
        state.isRefreshing = false;
        if (silent && isWaitingQueueLabelInputActive()) {
            deferWaitingQueueRenderUntilBlur();
            return;
        }
        if (silent && isColorWheelInputActive()) {
            deferColorWheelRenderUntilBlur();
            return;
        }
        safeRenderPage();
    }
}

async function loadHistoryPage(page) {
    const nextPage = Math.max(1, Number(page) || 1);
    collapseHistoryRunsDetails();
    state.historyLoading = true;
    state.historyError = "";
    state.historyScrollTop = 0;
    safeRenderPage();

    try {
        const offset = (nextPage - 1) * HISTORY_PAGE_SIZE;
        const result = await fetchJson(`/runs?limit=${HISTORY_PAGE_SIZE}&offset=${offset}&${buildRunFilterQuery()}`);
        state.historyPage = nextPage;
        state.historyRuns = filterRunsByRequestPurpose(result?.runs);
        state.historyTotal = Math.max(Number(result?.total) || 0, state.historyRuns.length);
        syncHistorySelectionToLoadedRuns();
        state.expandedRunIds = new Set(
            Array.from(state.expandedRunIds).filter((runId) => (
                state.runs.some((run) => run?.id === runId)
                || state.historyRuns.some((run) => run?.id === runId)
            )),
        );
        state.expandedSuggestionRunIds = new Set(
            Array.from(state.expandedSuggestionRunIds).filter((runId) => (
                state.runs.some((run) => run?.id === runId)
                || state.historyRuns.some((run) => run?.id === runId)
            )),
        );
    } catch (error) {
        state.historyError = error instanceof Error ? error.message : String(error);
        state.historyRuns = [];
    } finally {
        state.historyLoading = false;
        safeRenderPage();
    }
}

async function loadAllHistoryRuns() {
    collapseHistoryRunsDetails();
    state.historyLoading = true;
    state.historyError = "";
    state.historyScrollTop = 0;
    safeRenderPage();

    try {
        const fetchLimit = Math.max(
            Number(state.historyTotal) || 0,
            Number(state.status?.stored_runs) || 0,
            state.historyRuns.length,
            HISTORY_PAGE_SIZE,
        );
        const result = await fetchJson(`/runs?limit=${fetchLimit}&offset=0&${buildRunFilterQuery()}`);
        state.historyAllRuns = filterRunsByRequestPurpose(result?.runs);
        state.historyTotal = Math.max(Number(result?.total) || 0, state.historyAllRuns.length, state.historyTotal);
        syncHistorySelectionToLoadedRuns();
        state.expandedRunIds = new Set(
            Array.from(state.expandedRunIds).filter((runId) => (
                state.runs.some((run) => run?.id === runId)
                || state.historyRuns.some((run) => run?.id === runId)
                || state.historyAllRuns.some((run) => run?.id === runId)
            )),
        );
        state.expandedSuggestionRunIds = new Set(
            Array.from(state.expandedSuggestionRunIds).filter((runId) => (
                state.runs.some((run) => run?.id === runId)
                || state.historyRuns.some((run) => run?.id === runId)
                || state.historyAllRuns.some((run) => run?.id === runId)
            )),
        );
    } catch (error) {
        state.historyError = error instanceof Error ? error.message : String(error);
        state.historyAllRuns = [];
    } finally {
        state.historyLoading = false;
        safeRenderPage();
    }
}

async function fetchAllStoredRuns() {
    const fetchLimit = Math.max(
        Number(state.historyTotal) || 0,
        Number(state.status?.stored_runs) || 0,
        state.historyRuns.length,
        HISTORY_PAGE_SIZE,
    );
    const result = await fetchJson(`/runs?limit=${fetchLimit}&offset=0&${buildRunFilterQuery()}`);
    const runs = filterRunsByRequestPurpose(result?.runs);
    const total = Math.max(Number(result?.total) || 0, runs.length);
    return { runs, total };
}

async function fetchAbnormalStoredRuns() {
    const fetchLimit = Math.max(
        HISTORY_PREVIEW_COUNT,
        state.recentAbnormalRuns.length,
        HISTORY_PAGE_SIZE,
    );
    const result = await fetchJson(`/runs?limit=${fetchLimit}&offset=0&${buildRunFilterQuery({ abnormalOnly: true })}`);
    const runs = filterRunsByRequestPurpose(result?.runs);
    const total = Math.max(Number(result?.total) || 0, runs.length);
    return { runs, total };
}

async function loadRecentAbnormalRuns() {
    if (state.recentAbnormalLoading) {
        return;
    }

    state.recentAbnormalLoading = true;
    safeRenderPage();

    try {
        const { runs, total } = await fetchAbnormalStoredRuns();
        state.recentAbnormalRuns = sortRunsByStartedAtDesc(runs);
        state.historyTotal = Math.max(state.historyTotal, total);
    } catch (error) {
        state.apiError = error instanceof Error ? error.message : String(error);
    } finally {
        state.recentAbnormalLoading = false;
        safeRenderPage();
    }
}

async function refreshHistoryDialogData() {
    if (state.historyLoading) {
        return;
    }

    const currentPage = Math.max(1, state.historyPage || 1);
    await refreshBackendData({ silent: true });
    if (state.historyAbnormalOnly) {
        await loadAllHistoryRuns();
        return;
    }
    await loadHistoryPage(currentPage);
}

function openHistoryDialog() {
    collapseHistoryRunsDetails();
    state.historyDialogOpen = true;
    state.historyDeleteMode = false;
    state.historyAbnormalOnly = false;
    state.historyAllRuns = [];
    state.historyScrollTop = 0;
    clearHistorySelection();
    if (state.historyPage < 1) {
        state.historyPage = 1;
    }
    if (isMobileDrawerLayout()) {
        state.pageOpenGuardUntil = Date.now() + MOBILE_OPEN_GUARD_MS;
    }
    if (!state.historyRuns.length) {
        void loadHistoryPage(state.historyPage);
        return;
    }
    safeRenderPage();
}

function closeHistoryDialog() {
    if (!state.historyDialogOpen) {
        return;
    }

    collapseHistoryRunsDetails();
    clearHistorySelection();
    state.historyDeleteMode = false;
    state.historyAbnormalOnly = false;
    state.historyAllRuns = [];
    state.historyDialogOpen = false;
    state.historyScrollTop = 0;
    safeRenderPage();
}

function mergeMonitorSettingsObjects(baseValue, partialValue) {
    const safeBase = baseValue && typeof baseValue === "object" && !Array.isArray(baseValue) ? baseValue : {};
    const safePartial = partialValue && typeof partialValue === "object" && !Array.isArray(partialValue) ? partialValue : {};
    const nextValue = { ...safeBase };

    for (const [key, value] of Object.entries(safePartial)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            nextValue[key] = mergeMonitorSettingsObjects(safeBase[key], value);
        } else {
            nextValue[key] = value;
        }
    }

    return nextValue;
}

function mergeMonitorSettingsState(partialSettings) {
    const currentSettings = state.settings && typeof state.settings === "object" ? state.settings : {};
    state.settings = mergeMonitorSettingsObjects(currentSettings, partialSettings);
}

function persistPricingModelConfig(modelName, config) {
    const normalizedModelName = typeof modelName === "string" ? modelName.trim() : "";
    if (!normalizedModelName) {
        return;
    }

    const normalizedConfig = normalizePricingConfig(config);
    state.uiSettings.pricingConfigByModel = {
        ...(state.uiSettings?.pricingConfigByModel && typeof state.uiSettings.pricingConfigByModel === "object"
            ? state.uiSettings.pricingConfigByModel
            : {}),
        [normalizedModelName]: normalizedConfig,
    };
    saveUiSettings();
    updateMonitorSettings({
        pricing: {
            model_prices: {
                [normalizedModelName]: normalizedConfig,
            },
        },
    }, { deferBusyRender: true, optimistic: true });
}

async function updateMonitorSettings(partialSettings, { deferBusyRender = false, optimistic = false } = {}) {
    if (state.extensionDisabled) {
        return;
    }

    if (optimistic) {
        mergeMonitorSettingsState(partialSettings);
    }

    state.isSaving = true;
    state.apiStatus = "正在保存设置";
    if (!deferBusyRender) {
        safeRenderPage();
    }

    try {
        const result = await fetchJson("/settings", {
            method: "POST",
            body: JSON.stringify(partialSettings),
        });

        state.settings = result?.settings ?? state.settings;
        state.apiStatus = "设置已更新";
        state.apiError = "";
        await refreshBackendData({ silent: true });
    } catch (error) {
        state.apiStatus = "设置保存失败";
        state.apiError = error instanceof Error ? error.message : String(error);
        safeRenderPage();
    } finally {
        state.isSaving = false;
        if (deferBusyRender && !state.isRefreshing) {
            safeRenderPage();
        }
    }
}

async function clearBackendRuns() {
    if (state.extensionDisabled || state.isRefreshing) {
        return;
    }

    state.confirmDialog = {
        type: "clear-backend",
    };
    safeRenderPage();
}

function getHistoryScopeLabel(scope = "all") {
    return scope === "normal_only" ? "删除正常生成记录" : "删除全部历史记录";
}

function getHistoryScopeConfirmText(scope = "all") {
    const selectedCount = getSelectedHistoryRunCount();
    if (scope === "normal_only") {
        return selectedCount > 0
            ? `确认只删除已勾选的 ${selectedCount} 条历史记录里的正常生成部分吗？未勾选和异常记录都会保留。`
            : "请先勾选要删除的历史记录。";
    }

    return selectedCount > 0
        ? `确认删除已勾选的 ${selectedCount} 条历史记录吗？未勾选部分会保留。`
        : "请先勾选要删除的历史记录。";
}

async function performClearBackendRuns() {
    state.confirmDialog = null;

    state.isRefreshing = true;
    state.apiStatus = "正在清空后台监控记录";
    safeRenderPage();

    try {
        await fetchJson("/runs", {
            method: "DELETE",
        });

        state.runs = [];
        state.summary = null;
        state.apiStatus = "后台监控记录已清空";
        state.apiError = "";
        state.isRefreshing = false;
        await refreshBackendData({ silent: true });
    } catch (error) {
        state.apiStatus = "清空后台监控记录失败";
        state.apiError = error instanceof Error ? error.message : String(error);
        safeRenderPage();
    } finally {
        state.isRefreshing = false;
    }
}

function clearHistoryRuns() {
    if (state.extensionDisabled || state.isRefreshing) {
        return;
    }

    state.confirmDialog = {
        type: "history-delete-menu",
    };
    safeRenderPage();
}

async function performClearHistoryRuns(scope = "all") {
    const scopeLabel = getHistoryScopeLabel(scope);
    const selectedRunIds = getSelectedHistoryRunIds();
    if (!selectedRunIds.length) {
        state.confirmDialog = null;
        state.apiStatus = `历史记录操作失败：${scopeLabel}`;
        state.apiError = "请先勾选要删除的历史记录。";
        safeRenderPage();
        return;
    }

    const currentHistoryPage = state.historyPage;
    state.confirmDialog = null;

    state.isRefreshing = true;
    state.apiStatus = `正在处理历史记录：${scopeLabel}（已勾选 ${selectedRunIds.length} 条）`;
    safeRenderPage();

    try {
        const result = await fetchJson(`/runs?scope=${scope}`, {
            method: "DELETE",
            body: JSON.stringify({
                run_ids: selectedRunIds,
            }),
        });

        collapseCurrentRunsDetails();
        collapseHistoryRunsDetails();
        clearHistorySelection();
        state.historyDeleteMode = false;
        state.isRefreshing = false;
        await refreshBackendData({ silent: true });
        if (state.historyDialogOpen) {
            const remainingCount = Math.max(0, Number(result?.remaining_count) || 0);
            const targetPage = Math.max(1, Math.min(currentHistoryPage, Math.ceil(remainingCount / HISTORY_PAGE_SIZE) || 1));
            await loadHistoryPage(targetPage);
        }
        state.apiStatus = `历史记录操作完成：${scopeLabel}，已删除 ${Number(result?.cleared_count) || 0} 条`;
        state.apiError = "";
    } catch (error) {
        state.apiStatus = `历史记录操作失败：${scopeLabel}`;
        state.apiError = error instanceof Error ? error.message : String(error);
        safeRenderPage();
    } finally {
        state.isRefreshing = false;
        safeRenderPage();
    }
}

function scheduleAutoRefresh() {
    clearRefreshTimer();

    if (state.extensionDisabled || !state.uiReady) {
        return;
    }

    if (!state.pageOpen && state.uiSettings.keepRunningAfterClose === false) {
        return;
    }

    const seconds = Math.max(5, Number(state.uiSettings.autoRefreshSeconds) || DEFAULT_UI_SETTINGS.autoRefreshSeconds);
    state.refreshTimerId = window.setInterval(() => {
        if (state.extensionDisabled || document.hidden) {
            return;
        }

        refreshBackendData({ silent: true });
    }, seconds * 1000);
}

function buildStatusContentHtml() {
    const permissionLevel = state.status?.permission_level || state.status?.effective_runtime_mode;
    const runtimeMode = state.status?.runtime_mode || state.settings?.runtime?.runtime_mode;
    const detectedPermissionLevel = state.status?.detected_permission_level || permissionLevel;
    const waitingQueuePendingCount = state.waitingQueueEntries.length;
    const pluginRuleCount = state.pluginRules.length;
    const generationStopSummary = hasAbortableGenerationRequest()
        ? "已接入，当前可强制终止"
        : "已接入，异常后可弹确认并尝试终止";
    const forceStopEntrySummary = "已启用（监控页按钮）";
    return `
        <div class="stlp-note">当前这里是 ${escapeHtml(getEntryOriginLabel("standalone_page"))}；下面展示的最近记录属于主界面真实生成链路，不是插件自身操作记录。</div>
        <div class="stlp-grid">
            <div><strong>当前区域</strong><span>${escapeHtml(getEntryOriginLabel("standalone_page"))}</span></div>
            <div><strong>接口状态</strong><span>${escapeHtml(state.apiStatus)}</span></div>
            <div><strong>错误信息</strong><span>${escapeHtml(state.apiError || "-")}</span></div>
            <div><strong>权限环境</strong><span>${escapeHtml(getPermissionLabel(permissionLevel))}</span></div>
            <div><strong>运行模式</strong><span>${escapeHtml(getRuntimeModeLabel(runtimeMode))}</span></div>
            <div><strong>自动判定结果</strong><span>${escapeHtml(getPermissionLabel(detectedPermissionLevel))}</span></div>
            <div><strong>当前监视视图</strong><span>${escapeHtml(getActiveRequestPurposeLabel())}</span></div>
            <div><strong>只处理当前楼层</strong><span>${escapeHtml(formatBoolean(Boolean(state.status?.current_floor_only)))}</span></div>
            <div><strong>禁止历史楼层扫描</strong><span>${escapeHtml(formatBoolean(Boolean(state.status?.history_scan_forbidden)))}</span></div>
            <div><strong>已存监控记录</strong><span>${escapeHtml(state.status?.stored_runs ?? "-")}</span></div>
            <div><strong>等待区待标注</strong><span>${escapeHtml(String(waitingQueuePendingCount))} 条</span></div>
            <div><strong>已存规则</strong><span>${escapeHtml(String(pluginRuleCount))} 条</span></div>
            <div><strong>异常终止生成链</strong><span>${escapeHtml(generationStopSummary)}</span></div>
            <div><strong>终止生成入口</strong><span>${escapeHtml(forceStopEntrySummary)}</span></div>
            <div><strong>自动刷新间隔</strong><span>${escapeHtml(`${state.uiSettings.autoRefreshSeconds} 秒`)}</span></div>
        </div>
    `;
}

function buildStatusViewHtml() {
    const statusIndicatorClass = getBackendStatusIndicatorClass();
    return `
        <section class="stlp-status-view">
            <div class="stlp-status-view-header">
                <div class="stlp-status-view-title-row">
                    <div class="stlp-status-view-title">后台监控状态</div>
                    <span class="stlp-status-indicator ${escapeHtml(statusIndicatorClass)}" aria-hidden="true"></span>
                </div>
            </div>
            <div class="stlp-status-view-body">
                ${buildStatusContentHtml()}
            </div>
        </section>
    `;
}

function buildWaitingQueueEntryHtml(entry) {
    const run = entry?.run;
    const runId = entry?.run_id || run?.id || "";
    const draftValue = getWaitingQueueDraftValue(entry);
    const createdAtHtml = formatStartedAt(entry?.created_at) || "<span>-</span>";
    const expanded = isWaitingQueueEntryExpanded(runId);

    if (!run) {
        return `
            <article class="stlp-waiting-card ${expanded ? "is-expanded" : ""}" data-waiting-entry-run-id="${escapeHtml(runId)}">
                <div class="stlp-waiting-card-header">
                    <div class="stlp-waiting-card-summary">
                        <div class="stlp-waiting-card-title">记录已不存在</div>
                        <div class="stlp-waiting-card-summary-meta">
                            <div class="stlp-waiting-card-meta">加入时间 ${createdAtHtml}</div>
                            <span class="stlp-badge stlp-waiting-card-status">记录缺失</span>
                        </div>
                    </div>
                    <button class="menu_button stlp-waiting-card-toggle ${expanded ? "is-expanded" : ""}" type="button" data-action="toggle-waiting-queue-entry" data-run-id="${escapeHtml(runId)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "收起等待区卡片" : "展开等待区卡片"}" title="${expanded ? "收起等待区卡片" : "展开等待区卡片"}">
                        ${getChevronIconSvg()}
                    </button>
                </div>
                ${expanded ? `
                <div class="stlp-waiting-card-body">
                    <div class="stlp-note">这条记录可能已被删除。你可以将它从等待区移除。</div>
                    <div class="stlp-waiting-card-actions">
                        <button class="menu_button stlp-inline-button" type="button" data-action="remove-from-waiting-queue" data-run-id="${escapeHtml(runId)}">移出等待区</button>
                    </div>
                </div>
                ` : ""}
            </article>
        `;
    }

    return `
        <article class="stlp-waiting-card ${expanded ? "is-expanded" : ""}" data-waiting-entry-run-id="${escapeHtml(runId)}">
            <div class="stlp-waiting-card-header">
                <div class="stlp-waiting-card-summary">
                    <div class="stlp-waiting-card-title">${escapeHtml(getRunSourceLabel(run))} · ${escapeHtml(run?.model || "未记录模型")}</div>
                    <div class="stlp-waiting-card-summary-meta">
                        <div class="stlp-waiting-card-meta">加入时间 ${createdAtHtml}</div>
                        <span class="stlp-badge stlp-waiting-card-status">待标注</span>
                    </div>
                </div>
                <button class="menu_button stlp-waiting-card-toggle ${expanded ? "is-expanded" : ""}" type="button" data-action="toggle-waiting-queue-entry" data-run-id="${escapeHtml(runId)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "收起等待区卡片" : "展开等待区卡片"}" title="${expanded ? "收起等待区卡片" : "展开等待区卡片"}">
                    ${getChevronIconSvg()}
                </button>
            </div>
            ${expanded ? `
            <div class="stlp-waiting-card-body">
                ${buildRunHtml(run, { showWaitingQueueAction: false, showOutputCardAction: false })}
                <div class="stlp-waiting-editor">
                    <label class="stlp-number stlp-waiting-label-field">
                        <span>拓展名称</span>
                        <input
                            type="text"
                            value="${escapeHtml(draftValue)}"
                            data-waiting-label-run-id="${escapeHtml(runId)}"
                            placeholder="例如：记忆书"
                        />
                    </label>
                    <div class="stlp-waiting-helper">确认后会修正当前记录；如果已经有同名规则，这条记录还会自动补成它的新样本。</div>
                    <div class="stlp-waiting-card-actions">
                        <button class="menu_button stlp-inline-button" type="button" data-action="submit-waiting-queue-label" data-run-id="${escapeHtml(runId)}">确认标注</button>
                        <button class="menu_button stlp-inline-button" type="button" data-action="remove-from-waiting-queue" data-run-id="${escapeHtml(runId)}">移出等待区</button>
                    </div>
                </div>
            </div>
            ` : ""}
        </article>
    `;
}

function buildPluginRuleCardHtml(rule) {
    const ruleId = rule?.id || "";
    const sourceLabel = getRunSourceLabel({ source: rule?.source }) || "未限定来源";
    const modelLabel = rule?.model || "未限定模型";
    const updatedAtParts = buildStartedAtDisplayParts(rule?.updated_at || rule?.created_at);
    const sampleCount = Number.isFinite(Number(rule?.sample_count)) ? Number(rule.sample_count) : 0;
    const matchedRuns = Number.isFinite(Number(rule?.matched_runs)) ? Number(rule.matched_runs) : 0;
    const activeRuns = Number.isFinite(Number(rule?.active_runs)) ? Number(rule.active_runs) : 0;
    const pendingRuns = Number.isFinite(Number(rule?.pending_runs)) ? Number(rule.pending_runs) : 0;
    const enabled = rule?.enabled !== false;
    const expanded = isPluginRuleCardExpanded(ruleId);

    return `
        <article class="stlp-waiting-card stlp-waiting-rule-card ${expanded ? "is-expanded" : ""}">
            <div class="stlp-waiting-card-header">
                <div class="stlp-waiting-card-summary stlp-waiting-rule-card-summary">
                    <div class="stlp-waiting-rule-card-headline">
                        <div class="stlp-waiting-card-title">${escapeHtml(rule?.plugin_label || "未命名规则")}</div>
                        ${buildWaitingRuleTimeGroupHtml(updatedAtParts, "stlp-waiting-rule-time-group-inline")}
                    </div>
                    <div class="stlp-waiting-rule-card-controls">
                        <div class="stlp-waiting-rule-card-control-group">
                            ${buildWaitingRuleTimeGroupHtml(updatedAtParts, "stlp-waiting-rule-time-group-secondary")}
                            <span class="stlp-badge stlp-waiting-card-status">${enabled ? "启用中" : "已停用"}</span>
                        </div>
                        <div class="stlp-waiting-rule-card-inline-actions">
                            <button class="menu_button stlp-waiting-rule-action-button stlp-waiting-rule-action-button-inline stlp-waiting-rule-action-button-primary ${enabled ? "is-disable-action" : "is-enable-action"}" type="button" data-action="${enabled ? "disable-plugin-rule" : "enable-plugin-rule"}" data-rule-id="${escapeHtml(ruleId)}">${enabled ? "停用规则" : "启用规则"}</button>
                            <button class="menu_button stlp-waiting-card-toggle ${expanded ? "is-expanded" : ""}" type="button" data-action="toggle-plugin-rule-card" data-rule-id="${escapeHtml(ruleId)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "收起规则卡片" : "展开规则卡片"}" title="${expanded ? "收起规则卡片" : "展开规则卡片"}">
                                ${getChevronIconSvg()}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            ${expanded ? `
            <div class="stlp-waiting-card-body">
                <div class="stlp-waiting-rule-meta">${escapeHtml(sourceLabel)} · ${escapeHtml(modelLabel)}</div>
                <div class="stlp-waiting-rule-stats">
                    <span class="stlp-badge">样本 ${escapeHtml(sampleCount)}</span>
                    <span class="stlp-badge">已命中 ${escapeHtml(matchedRuns)}</span>
                    <span class="stlp-badge">已生效 ${escapeHtml(activeRuns)}</span>
                    <span class="stlp-badge">${pendingRuns > 0 ? `待处理 ${escapeHtml(pendingRuns)}` : "已追平"}</span>
                </div>
                <div class="stlp-waiting-helper">继续在等待区把同类记录标成同一个拓展名时，系统会自动把新样本补进这条规则，不需要你手动改规则。</div>
                <div class="stlp-waiting-rule-danger-actions">
                    <button class="menu_button stlp-waiting-rule-action-button stlp-waiting-rule-action-button-secondary" type="button" data-action="request-remove-plugin-rule" data-rule-id="${escapeHtml(ruleId)}">删除规则</button>
                </div>
            </div>
            ` : ""}
        </article>
    `;
}

function buildPluginRuleGuideHtml() {
    return `
        <div class="stlp-waiting-rule-guide">
            <div class="stlp-waiting-rule-guide-row">
                <div class="stlp-waiting-rule-guide-label">规则控制</div>
                <div class="stlp-waiting-rule-guide-text">已经支持启用、停用和删除。</div>
            </div>
            <div class="stlp-waiting-rule-guide-row">
                <div class="stlp-waiting-rule-guide-label">补样本</div>
                <div class="stlp-waiting-rule-guide-text">不需要手改规则。继续在等待区用同一个拓展名标注同类记录时，系统会自动补样本。</div>
            </div>
        </div>
    `;
}

function buildWaitingQueueViewHtml() {
    if (state.waitingQueueLoading && !state.waitingQueueEntries.length && state.pluginRulesLoading && !state.pluginRules.length) {
        return `
            <section class="stlp-waiting-view">
                <div class="stlp-status-view-title">等待区</div>
                <div class="stlp-waiting-copy">正在加载等待区和规则复用数据。</div>
            </section>
        `;
    }

    const hasEntries = state.waitingQueueEntries.length > 0;
    const hasRules = state.pluginRules.length > 0;
    return `
        <section class="stlp-waiting-view">
            <div class="stlp-status-view-header">
                <div class="stlp-status-view-title-row">
                    <div class="stlp-status-view-title">等待区</div>
                </div>
            </div>
            <div class="stlp-waiting-view-body">
                <div class="stlp-waiting-copy">这里会收纳需要人工确认归属的拓展记录。它不是正文/拓展的切换键，而是临时等待区。你可以先从正文或拓展详情页将记录移入等待区，再在这里输入拓展名称完成标注。</div>
                ${state.waitingQueueError ? `<div class="stlp-waiting-copy">等待区加载失败：${escapeHtml(state.waitingQueueError)}</div>` : ""}
                ${hasEntries
                    ? `<div class="stlp-waiting-list">${state.waitingQueueEntries.map((entry) => buildWaitingQueueEntryHtml(entry)).join("")}</div>`
                    : `<div class="stlp-waiting-empty">当前没有需要标注的拓展记录。若发现有记录误入正文或拓展分区，请前往对应记录的详情页，将其移入等待区后再进行标注。</div>`}
                <section class="stlp-waiting-rule-section">
                    <div class="stlp-settings-subtitle">规则复用</div>
                    ${buildPluginRuleGuideHtml()}
                    ${state.pluginRulesError ? `<div class="stlp-waiting-copy">规则加载失败：${escapeHtml(state.pluginRulesError)}</div>` : ""}
                    ${hasRules
                        ? `<div class="stlp-waiting-list">${state.pluginRules.map((rule) => buildPluginRuleCardHtml(rule)).join("")}</div>`
                        : `<div class="stlp-waiting-empty">当前还没有可复用规则。等你在等待区完成一次手动标注后，这里就会出现对应规则。</div>`}
                </section>
            </div>
        </section>
    `;
}

function buildSettingsContentHtml() {
    const displaySettings = state.settings?.display ?? {};
    const permissionLevel = state.status?.permission_level || state.status?.effective_runtime_mode || "no_backend";
    const disableEnhancedToggle = permissionLevel === "no_backend";
    const pricingModels = collectPricingModels();
    const outputCardFields = getOutputCardFields();
    const settingsCategory = normalizeSettingsCategory(state.uiSettings.settingsCategory);
    const minimizedButtonColorMode = normalizeMinimizedButtonColorMode(state.uiSettings.minimizedButtonColorMode);
    const backendRecordActionsContent = `
            <div class="stlp-note">导出记录和清空后台已经从主监控页顶部移到这里，避免顶部操作区过挤。清空会删除当前后台监控记录，导出则保留现有数据。</div>
            <div class="stlp-settings-action-row">
                <button id="stlp_export_runs" class="menu_button stlp-settings-action-button" type="button">导出记录</button>
                <button id="stlp_clear_runs" class="menu_button stlp-settings-action-button stlp-settings-action-button-danger" type="button">清空后台</button>
            </div>
    `;
    const runtimeContent = `
            <div class="stlp-controls">
                <label class="checkbox_label stlp-settings-toggle">
                    <input id="stlp_show_abnormal_optimization_suggestions" type="checkbox" ${displaySettings.show_abnormal_optimization_suggestions ? "checked" : ""} ${state.isSaving ? "disabled" : ""} />
                    <span>显示异常优化建议</span>
                </label>
                <label class="checkbox_label stlp-settings-toggle">
                    <input id="stlp_show_permission_enhanced_suggestions" type="checkbox" ${displaySettings.show_permission_enhanced_suggestions ? "checked" : ""} ${(state.isSaving || disableEnhancedToggle) ? "disabled" : ""} />
                    <span>显示权限增强建议</span>
                </label>
                <label class="stlp-number">
                    <span>建议条数上限</span>
                    <input id="stlp_abnormal_optimization_suggestion_limit" type="number" min="2" max="4" step="1" value="${escapeHtml(displaySettings.abnormal_optimization_suggestion_limit ?? 3)}" ${state.isSaving ? "disabled" : ""} />
                </label>
                <label class="stlp-select">
                    <span>建议触发范围</span>
                    <select id="stlp_abnormal_optimization_suggestion_scope" ${state.isSaving ? "disabled" : ""}>
                        <option value="failed_generation_only" ${displaySettings.abnormal_optimization_suggestion_scope === "failed_generation_only" ? "selected" : ""}>仅生成失败/中断相关异常时显示</option>
                        <option value="all_abnormal" ${displaySettings.abnormal_optimization_suggestion_scope === "all_abnormal" ? "selected" : ""}>所有异常时显示</option>
                    </select>
                </label>
                <label class="stlp-number">
                    <span>自动刷新秒数</span>
                    <input id="stlp_auto_refresh_seconds" type="number" min="5" max="120" step="1" value="${escapeHtml(state.uiSettings.autoRefreshSeconds)}" />
                </label>
            </div>
            <div class="stlp-note">
                正常轮次保持安静，只有异常轮次才会显示“查看优化建议”。当前环境为 ${escapeHtml(getPermissionLabel(permissionLevel))}，建议触发范围为 ${escapeHtml(getSuggestionScopeLabel(displaySettings.abnormal_optimization_suggestion_scope))}。
            </div>
            ${buildSettingsSubsectionHtml("runtime_backend_actions", "后台记录", "导出记录 / 清空后台", backendRecordActionsContent)}
    `;

    const outputCardContent = `
            <div class="stlp-settings-subtitle">排障卡</div>
            <div class="stlp-note">默认排障卡只保留核心排障信息和注入概况，目标是尽量缩短卡片长度、让手机端更容易一屏看完。下面这些开关控制是否把次要信息一起塞进去。</div>
            <div class="stlp-controls">
                <label class="checkbox_label stlp-settings-toggle">
                    <input id="stlp_output_card_show_injection_details" type="checkbox" ${outputCardFields.showInjectionDetails ? "checked" : ""} />
                    <span>显示注入细项（来源标识 / 提示词来源）</span>
                </label>
                <label class="checkbox_label stlp-settings-toggle">
                    <input id="stlp_output_card_show_pricing_details" type="checkbox" ${outputCardFields.showPricingDetails ? "checked" : ""} />
                    <span>显示费用细项（价格估算 / 缓存相关）</span>
                </label>
                <label class="checkbox_label stlp-settings-toggle">
                    <input id="stlp_output_card_show_context_volume" type="checkbox" ${outputCardFields.showContextVolume ? "checked" : ""} />
                    <span>显示上下文体量（消息数 / 字符数）</span>
                </label>
                <label class="checkbox_label stlp-settings-toggle">
                    <input id="stlp_output_card_show_extension_details" type="checkbox" ${outputCardFields.showExtensionDetails ? "checked" : ""} />
                    <span>显示扩展识别细节（标识 / 方式 / 分数）</span>
                </label>
            </div>
    `;

    const pricingContent = `
            <div class="stlp-settings-subtitle">模型价格估算</div>
            <div class="stlp-note">这里会列出后台已经抓到的模型。每个模型都可以单独选择美元或人民币，填写输入 / 缓存输入 / 输出每 100 万 Token 的价格；详情里的估算金额会跟着这个模型自己的单位显示。峰谷计费按本机时间判断，只需要配置峰时段，其余时间会自动按谷时段计算。</div>
            ${!pricingModels.length ? `
                <div class="stlp-note">当前还没抓到任何模型。等后台先记录几次生成后，这里会自动列出模型。</div>
            ` : `
                <div class="stlp-pricing-model-list">
                    ${pricingModels.map((modelInfo) => {
                        const modelName = modelInfo.model;
                        const config = getModelPriceConfig(modelName) ?? {};
                        const currency = normalizePricingCurrency(config.currency);
                        const currencyLabel = getPricingCurrencyLabel(currency);
                        const inputPrice = normalizeConfiguredPriceValue(config.input_price_per_million);
                        const cachedInputPrice = normalizeConfiguredPriceValue(config.cached_input_price_per_million);
                        const outputPrice = normalizeConfiguredPriceValue(config.output_price_per_million);
                        const peakValleyEnabled = Boolean(config.peak_valley_enabled);
                        const peakValleyPanelOpen = isPricingPeakValleyPanelOpen(modelName);
                        const peakStartTime = normalizePeakValleyTimeValue(config.peak_start_time);
                        const peakEndTime = normalizePeakValleyTimeValue(config.peak_end_time);
                        const peakInputPrice = normalizeConfiguredPriceValue(config.peak_input_price_per_million);
                        const peakCachedInputPrice = normalizeConfiguredPriceValue(config.peak_cached_input_price_per_million);
                        const peakOutputPrice = normalizeConfiguredPriceValue(config.peak_output_price_per_million);
                        const valleyInputPrice = normalizeConfiguredPriceValue(config.valley_input_price_per_million);
                        const valleyCachedInputPrice = normalizeConfiguredPriceValue(config.valley_cached_input_price_per_million);
                        const valleyOutputPrice = normalizeConfiguredPriceValue(config.valley_output_price_per_million);
                        const inputPriceValue = inputPrice === null || inputPrice === 0 ? "" : escapeHtml(inputPrice);
                        const cachedInputPriceValue = cachedInputPrice === null || cachedInputPrice === 0 ? "" : escapeHtml(cachedInputPrice);
                        const outputPriceValue = outputPrice === null || outputPrice === 0 ? "" : escapeHtml(outputPrice);
                        const peakInputPriceValue = peakInputPrice === null || peakInputPrice === 0 ? "" : escapeHtml(peakInputPrice);
                        const peakCachedInputPriceValue = peakCachedInputPrice === null || peakCachedInputPrice === 0 ? "" : escapeHtml(peakCachedInputPrice);
                        const peakOutputPriceValue = peakOutputPrice === null || peakOutputPrice === 0 ? "" : escapeHtml(peakOutputPrice);
                        const valleyInputPriceValue = valleyInputPrice === null || valleyInputPrice === 0 ? "" : escapeHtml(valleyInputPrice);
                        const valleyCachedInputPriceValue = valleyCachedInputPrice === null || valleyCachedInputPrice === 0 ? "" : escapeHtml(valleyCachedInputPrice);
                        const valleyOutputPriceValue = valleyOutputPrice === null || valleyOutputPrice === 0 ? "" : escapeHtml(valleyOutputPrice);
                        const allowPricingEdit = true;
                        const panelOpen = isPricingPanelOpen(modelName);
                        const usageStatusSummary = modelInfo.supports_usage
                            ? "已记录 usage"
                            : (modelInfo.configured ? "已保存价格" : "暂未记录 usage");
                        const runCountSummary = modelInfo.run_count ? `已抓取 ${modelInfo.run_count} 次` : "暂未抓到记录";
                        const configuredSummary = [
                            inputPrice !== null ? `输入 ${formatPriceValue(inputPrice)}` : "",
                            cachedInputPrice !== null ? `缓存输入 ${formatPriceValue(cachedInputPrice)}` : "",
                            outputPrice !== null ? `输出 ${formatPriceValue(outputPrice)}` : "",
                        ].filter(Boolean).join(" · ");
                        const peakValleySummary = peakValleyEnabled
                            ? `峰时 ${peakStartTime && peakEndTime ? `${peakStartTime} - ${peakEndTime}` : "待补时段"}`
                            : "峰谷未启用";
                        const compactSummary = configuredSummary
                            ? `${currencyLabel} · ${configuredSummary}`
                            : `${currencyLabel} · 价格待填`;

                        return `
                            <div class="stlp-pricing-model-card ${panelOpen ? "is-open" : ""}">
                                <button class="stlp-pricing-model-summary" type="button" data-action="toggle-pricing-panel" data-pricing-model="${escapeHtml(modelName)}" aria-expanded="${panelOpen ? "true" : "false"}">
                                    <span class="stlp-pricing-model-summary-main">
                                        <span class="stlp-pricing-model-name">${escapeHtml(modelName)}</span>
                                        <span class="stlp-pricing-model-note">${escapeHtml(compactSummary)}</span>
                                    </span>
                                    <span class="stlp-pricing-model-chevron" aria-hidden="true">▾</span>
                                </button>
                                <div class="stlp-pricing-model-body ${panelOpen ? "" : "stlp-hidden"}">
                                    <div class="stlp-pricing-model-meta">
                                        <div class="stlp-pricing-model-note">价格状态：${escapeHtml(usageStatusSummary)}</div>
                                        <div class="stlp-pricing-model-note">抓取记录：${escapeHtml(runCountSummary)}</div>
                                        <div class="stlp-pricing-model-note">峰谷计费：${escapeHtml(peakValleySummary)}</div>
                                    </div>
                                    <div class="stlp-pricing-fields-stack">
                                        <div class="stlp-pricing-inline-row">
                                            <span class="stlp-pricing-inline-label">价格单位</span>
                                            <button class="menu_button stlp-pricing-currency-button" type="button" data-action="pricing-cycle-currency" data-pricing-model="${escapeHtml(modelName)}" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""}>${escapeHtml(currencyLabel)}</button>
                                        </div>
                                        <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                            <span>输入单价（${escapeHtml(currencyLabel)}）</span>
                                            <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${inputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="input_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                        </label>
                                        <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                            <span>缓存输入单价（${escapeHtml(currencyLabel)}）</span>
                                            <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${cachedInputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="cached_input_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                        </label>
                                        <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                            <span>输出单价（${escapeHtml(currencyLabel)}）</span>
                                            <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${outputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="output_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                        </label>
                                    </div>
                                    <div class="stlp-pricing-actions">
                                        <div class="stlp-pricing-model-note">如果这个模型存在缓存输入折扣，可以单独填写“缓存输入单价”；没填时，命中缓存的输入部分会继续按普通输入单价估算。</div>
                                    </div>
                                    <div class="stlp-pricing-peak-valley-card ${peakValleyPanelOpen ? "is-open" : ""}">
                                        <button class="stlp-pricing-peak-valley-summary" type="button" data-action="toggle-pricing-peak-valley-panel" data-pricing-model="${escapeHtml(modelName)}" aria-expanded="${peakValleyPanelOpen ? "true" : "false"}">
                                            <span class="stlp-pricing-peak-valley-summary-main">
                                                <span class="stlp-pricing-inline-label">峰谷计费</span>
                                                <span class="stlp-pricing-model-note">只配置峰时段，其余时间自动按谷时段。所有判断都按本机时间走。</span>
                                            </span>
                                            <span class="stlp-pricing-peak-valley-status ${peakValleyEnabled ? "is-enabled" : ""}">${peakValleyEnabled ? "已启用" : "未启用"}</span>
                                            <span class="stlp-pricing-model-chevron" aria-hidden="true">▾</span>
                                        </button>
                                        <div class="stlp-pricing-peak-valley-body ${peakValleyPanelOpen ? "" : "stlp-hidden"}">
                                            <label class="checkbox_label stlp-settings-toggle stlp-pricing-peak-valley-toggle">
                                                <input type="checkbox" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="peak_valley_enabled" ${peakValleyEnabled ? "checked" : ""} ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                <span>启用峰谷计费</span>
                                            </label>
                                            <div class="stlp-pricing-model-note">只需要填写峰时段起止，未落在这个时间段的请求会自动按谷时段价格估算。峰谷价格如果有空项，会回退到上面的普通单价。</div>
                                            <div class="stlp-pricing-time-grid">
                                                <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                                    <span>峰时开始</span>
                                                    <input type="time" value="${escapeHtml(peakStartTime)}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="peak_start_time" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                </label>
                                                <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                                    <span>峰时结束</span>
                                                    <input type="time" value="${escapeHtml(peakEndTime)}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="peak_end_time" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                </label>
                                            </div>
                                            <div class="stlp-pricing-band-grid">
                                                <div class="stlp-pricing-band-column">
                                                    <div class="stlp-pricing-inline-label">峰时价格</div>
                                                    <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                                        <span>输入单价（${escapeHtml(currencyLabel)}）</span>
                                                        <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${peakInputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="peak_input_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                    </label>
                                                    <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                                        <span>缓存输入单价（${escapeHtml(currencyLabel)}）</span>
                                                        <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${peakCachedInputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="peak_cached_input_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                    </label>
                                                    <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                                        <span>输出单价（${escapeHtml(currencyLabel)}）</span>
                                                        <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${peakOutputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="peak_output_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                    </label>
                                                </div>
                                                <div class="stlp-pricing-band-column">
                                                    <div class="stlp-pricing-inline-label">谷时价格</div>
                                                    <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                                        <span>输入单价（${escapeHtml(currencyLabel)}）</span>
                                                        <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${valleyInputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="valley_input_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                    </label>
                                                    <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                                        <span>缓存输入单价（${escapeHtml(currencyLabel)}）</span>
                                                        <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${valleyCachedInputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="valley_cached_input_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                    </label>
                                                    <label class="stlp-number stlp-pricing-field stlp-pricing-field-vertical">
                                                        <span>输出单价（${escapeHtml(currencyLabel)}）</span>
                                                        <input type="number" min="0" step="0.000001" inputmode="decimal" placeholder="${currencyLabel}，可选" value="${valleyOutputPriceValue}" data-pricing-model="${escapeHtml(modelName)}" data-pricing-field="valley_output_price_per_million" ${(state.isSaving || !allowPricingEdit) ? "disabled" : ""} />
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join("")}
                </div>
            `}
    `;

    const minimizedButtonCustomColor = normalizeMinimizedButtonCustomColor(state.uiSettings.minimizedButtonCustomColor);
    const minimizedButtonStrokeColor = normalizeMinimizedButtonStrokeColor(state.uiSettings.minimizedButtonStrokeColor);
    const isMinimizedButtonFollowingTheme = minimizedButtonColorMode === "follow_theme";
    const themeSummary = getThemeModeLabel(state.uiSettings.themeMode).replace("主题：", "");
    const minimizedIconSummary = `${isMinimizedButtonFollowingTheme ? "主色跟随酒馆" : `主色 ${minimizedButtonCustomColor.toUpperCase()}`} · 描边 ${minimizedButtonStrokeColor.toUpperCase()}`;
    const themeSubsectionBody = `
            <div class="stlp-segmented-control" role="group" aria-label="面板主题">
                ${THEME_MODE_SEQUENCE.map((mode) => `
                    <button class="menu_button stlp-segmented-option ${normalizeThemeMode(state.uiSettings.themeMode) === mode ? "is-selected" : ""}" type="button" data-action="set-theme-mode" data-theme-mode="${escapeHtml(mode)}" aria-pressed="${normalizeThemeMode(state.uiSettings.themeMode) === mode ? "true" : "false"}">${escapeHtml(mode === "follow_tavern" ? "跟随酒馆" : getThemeModeLabel(mode).replace("主题：", ""))}</button>
                `).join("")}
            </div>
    `;
    const minimizedIconSubsectionBody = `
            <label class="checkbox_label stlp-settings-toggle">
                <input id="stlp_minimized_button_follow_theme_color" type="checkbox" ${isMinimizedButtonFollowingTheme ? "checked" : ""} />
                <span>最小化图标配色跟随酒馆主题</span>
            </label>
            <label class="stlp-color-wheel-field ${isMinimizedButtonFollowingTheme ? "is-disabled" : ""}">
                <span>星星主色</span>
                <div class="stlp-color-wheel-row">
                    <input id="stlp_minimized_button_custom_color" class="stlp-color-wheel-input" type="color" value="${escapeHtml(minimizedButtonCustomColor)}" ${isMinimizedButtonFollowingTheme ? "disabled" : ""} />
                    <span class="stlp-color-wheel-hint">点击打开色轮选择</span>
                    <span class="stlp-color-wheel-value">${escapeHtml(minimizedButtonCustomColor.toUpperCase())}</span>
                </div>
            </label>
            <label class="stlp-color-wheel-field">
                <span>星星描边</span>
                <div class="stlp-color-wheel-row">
                    <input id="stlp_minimized_button_stroke_color" class="stlp-color-wheel-input" type="color" value="${escapeHtml(minimizedButtonStrokeColor)}" />
                    <span class="stlp-color-wheel-hint">点击打开色轮选择描边颜色</span>
                    <span class="stlp-color-wheel-value">${escapeHtml(minimizedButtonStrokeColor.toUpperCase())}</span>
                </div>
            </label>
            <div class="stlp-note">当前最小化图标颜色：${escapeHtml(isMinimizedButtonFollowingTheme ? "主色跟随酒馆主题配色" : minimizedButtonCustomColor.toUpperCase())}；描边 ${escapeHtml(minimizedButtonStrokeColor.toUpperCase())}。按钮背景固定透明，常态不再额外带绿色外发光。</div>
    `;
    const appearanceContent = `
            <div class="stlp-settings-subtitle">外观与主题</div>
            <div class="stlp-note">这里收口主题和最小化悬浮图标的显示风格。最小化图标在后台正常时使用下面配置的颜色，后台未连接时固定显示红色；闪烁提醒继续走纯 CSS 动画，不额外增加后台请求。</div>
            ${buildSettingsSubsectionHtml("appearance_theme", "面板主题", themeSummary, themeSubsectionBody)}
            ${buildSettingsSubsectionHtml("appearance_minimized_color", "最小图标选色", minimizedIconSummary, minimizedIconSubsectionBody)}
    `;

    const categoryCards = [
        { key: "runtime", label: "运行与建议", body: runtimeContent },
        { key: "output_card", label: "排障卡", body: outputCardContent },
        { key: "pricing", label: "价格估算", body: pricingContent },
        { key: "appearance", label: "外观与主题", body: appearanceContent },
    ];

    return `
            <div class="stlp-settings-view-note">设置项已经按功能归类，点开对应分区就能直接调整。</div>
            <div class="stlp-settings-category-list">
                ${categoryCards.map((item) => {
                    const active = settingsCategory === item.key;
                    return `
                        <section class="stlp-settings-category-card ${active ? "is-open" : ""}">
                            <button class="stlp-settings-category-button" type="button" data-action="set-settings-category" data-settings-category="${escapeHtml(item.key)}" aria-expanded="${active ? "true" : "false"}">
                                <span>${escapeHtml(item.label)}</span>
                                <span class="stlp-settings-category-chevron" aria-hidden="true">▾</span>
                            </button>
                            <div class="stlp-settings-category-body ${active ? "" : "stlp-hidden"}">
                                ${item.body}
                            </div>
                        </section>
                    `;
                }).join("")}
            </div>
    `;
}

function buildSettingsViewHtml() {
    return `
        <section class="stlp-section is-open stlp-settings-view">
            <div class="stlp-section-body">
                <div class="stlp-settings-view-title">设置</div>
                ${buildSettingsContentHtml()}
            </div>
        </section>
    `;
}

function buildDailyAbnormalListText(items) {
    if (!Array.isArray(items) || !items.length) {
        return "-";
    }

    return items
        .map((item) => `${getAbnormalTypeLabel(item?.value)} x${formatCount(Number(item?.count) || 0)}`)
        .join(" / ");
}

function isDailySummaryRowExpanded(dateKey) {
    return typeof dateKey === "string" && dateKey
        ? state.expandedDailySummaryDateKeys.has(dateKey)
        : false;
}

function buildDailySummaryViewHtml() {
    const dailySummary = state.dailySummary;
    const rows = Array.isArray(dailySummary?.rows) ? dailySummary.rows : [];
    const summary = dailySummary?.summary ?? null;
    const activeDays = normalizeDailySummaryDays(state.uiSettings.dailySummaryDays);
    const scopeMode = normalizeSummaryText(dailySummary?.scope_mode) || "global";
    const scopeLabel = normalizeSummaryText(dailySummary?.scope_label) || "全部用途";
    const scopeTagLabel = scopeMode === "chat_view" ? "聊天聚合" : "总聚合";
    const aggregatePromptTokens = rows.reduce((total, row) => total + (Number(row?.prompt_tokens) || 0), 0);
    const aggregateCompletionTokens = rows.reduce((total, row) => total + (Number(row?.completion_tokens) || 0), 0);
    const aggregateTotalTokens = rows.reduce((total, row) => total + (Number(row?.total_tokens) || 0), 0);
    const aggregateAbnormalRuns = rows.reduce((total, row) => total + (Number(row?.abnormal_runs) || 0), 0);
    const aggregateTotalRuns = rows.reduce((total, row) => total + (Number(row?.total_runs) || 0), 0);
    const aggregateAbnormalRate = aggregateTotalRuns ? (aggregateAbnormalRuns / aggregateTotalRuns) * 100 : 0;

    return `
        <section class="stlp-section is-open stlp-daily-summary-view">
            <div class="stlp-section-body">
                <div class="stlp-settings-view-title">日聚合</div>
                <div class="stlp-daily-summary-scope">
                    <span class="stlp-daily-summary-scope-badge">${escapeHtml(scopeTagLabel)}</span>
                    <span class="stlp-daily-summary-scope-text">${escapeHtml(scopeLabel)}</span>
                </div>
                <div class="stlp-note">这里只看最近 ${escapeHtml(activeDays)} 天的${escapeHtml(scopeLabel)} Tokens、异常率和耗时走势，不做金额汇总。若某些流式记录 Usage 曾经落成 0，历史统计可能偏低。</div>
                <div class="stlp-daily-summary-filters">
                    ${DAILY_SUMMARY_DAY_OPTIONS.map((days) => `
                        <button class="menu_button stlp-daily-summary-filter ${days === activeDays ? "is-active" : ""}" type="button" data-action="set-daily-summary-days" data-days="${days}" aria-pressed="${days === activeDays ? "true" : "false"}">${days} 天</button>
                    `).join("")}
                </div>
                ${summary ? `
                    <div class="stlp-grid">
                        <div><strong>总记录数</strong><span>${escapeHtml(formatCount(aggregateTotalRuns))}</span></div>
                        <div><strong>异常率</strong><span>${escapeHtml(formatPercent(aggregateAbnormalRate))}</span></div>
                        <div><strong>Total Tokens</strong><span>${escapeHtml(formatCount(aggregateTotalTokens))}</span></div>
                        <div><strong>Prompt / Completion</strong><span>${escapeHtml(`${formatCount(aggregatePromptTokens)} / ${formatCount(aggregateCompletionTokens)}`)}</span></div>
                        <div><strong>缓存命中率</strong><span>${escapeHtml(formatPercent(summary.cache_hit_rate))}</span></div>
                        <div><strong>平均总耗时</strong><span>${escapeHtml(formatSeconds(summary.avg_total_ms))}</span></div>
                        <div><strong>平均首个输出</strong><span>${escapeHtml(formatSeconds(summary.avg_ttft_ms))}</span></div>
                    </div>
                ` : ""}
                ${rows.length ? `
                    <div class="stlp-daily-summary-list">
                        ${rows.slice().reverse().map((row) => {
                            const dateKey = typeof row?.date_key === "string" ? row.date_key : "";
                            const expanded = isDailySummaryRowExpanded(dateKey);
                            return `
                            <article class="stlp-daily-summary-card ${expanded ? "is-expanded" : ""}">
                                <div class="stlp-daily-summary-card-header">
                                    <div class="stlp-daily-summary-card-summary">
                                        <div class="stlp-daily-summary-card-title">${escapeHtml(formatDateKeyLabel(row.date_key))}</div>
                                        <div class="stlp-daily-summary-card-meta">
                                            <span>${escapeHtml(formatCount(row.total_runs))} 条</span>
                                            <span>异常 ${escapeHtml(formatPercent(row.abnormal_rate))}</span>
                                        </div>
                                    </div>
                                    <button class="menu_button stlp-daily-summary-toggle ${expanded ? "is-expanded" : ""}" type="button" data-action="toggle-daily-summary-row" data-date-key="${escapeHtml(dateKey)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "收起当日详情" : "展开当日详情"}" title="${expanded ? "收起当日详情" : "展开当日详情"}">
                                        ${getChevronIconSvg()}
                                    </button>
                                </div>
                                ${expanded ? `
                                <div class="stlp-grid">
                                    <div><strong>P95 总耗时</strong><span>${escapeHtml(formatSeconds(row.p95_total_ms))}</span></div>
                                    <div><strong>Prompt</strong><span>${escapeHtml(formatCount(row.prompt_tokens))}</span></div>
                                    <div><strong>Completion</strong><span>${escapeHtml(formatCount(row.completion_tokens))}</span></div>
                                    <div><strong>Total</strong><span>${escapeHtml(formatCount(row.total_tokens))}</span></div>
                                    <div><strong>缓存命中率</strong><span>${escapeHtml(formatPercent(row.cache_hit_rate))}</span></div>
                                    <div><strong>平均总耗时</strong><span>${escapeHtml(formatSeconds(row.avg_total_ms))}</span></div>
                                    <div><strong>平均预处理</strong><span>${escapeHtml(formatSeconds(row.avg_preprocess_ms))}</span></div>
                                    <div><strong>平均上游响应头</strong><span>${escapeHtml(formatSeconds(row.avg_upstream_headers_ms))}</span></div>
                                    <div><strong>平均首个输出</strong><span>${escapeHtml(formatSeconds(row.avg_ttft_ms))}</span></div>
                                    <div><strong>平均流式输出</strong><span>${escapeHtml(formatSeconds(row.avg_stream_ms))}</span></div>
                                </div>
                                <div class="stlp-note">Top 模型：${escapeHtml(formatTopValueList(row.top_models))}</div>
                                <div class="stlp-note">Top 异常：${escapeHtml(buildDailyAbnormalListText(row.top_abnormal_types))}</div>
                                ` : ""}
                            </article>
                        `;
                        }).join("")}
                    </div>
                ` : `<div class="stlp-empty">当前筛选下，最近 ${escapeHtml(activeDays)} 天还没有可汇总的后台监控记录。</div>`}
            </div>
        </section>
    `;
}

function buildSummaryHtml() {
    const summaryBody = !state.summary
        ? '<div class="stlp-empty">当前还没有可汇总的后台监控记录。</div>'
        : (() => {
            const abnormalCount = filterRunsByCacheHit(filterRunsByRequestPurpose(state.runs)).filter(isAbnormalRun).length;
            return `
            <div class="stlp-grid">
                <div><strong>记录数</strong><span>${escapeHtml(state.summary.total_runs ?? "-")}</span></div>
                <div><strong>异常记录</strong><span>${escapeHtml(abnormalCount)}</span></div>
                <div><strong>缓存命中记录</strong><span>${escapeHtml(state.summary.cache_hit_runs ?? "-")}</span></div>
                <div><strong>缓存命中率</strong><span>${escapeHtml(formatPercent(state.summary.cache_hit_rate))}</span></div>
                <div><strong>缓存 Tokens</strong><span>${escapeHtml(state.summary.cached_tokens ?? "-")}</span></div>
                <div><strong>缓存读取 Tokens</strong><span>${escapeHtml(state.summary.cache_read_tokens ?? "-")}</span></div>
                <div><strong>缓存写入 Tokens</strong><span>${escapeHtml(state.summary.cache_write_tokens ?? "-")}</span></div>
                <div><strong>平均总耗时</strong><span>${escapeHtml(formatSeconds(state.summary.avg_total_ms))}</span></div>
                <div><strong>平均预处理</strong><span>${escapeHtml(formatSeconds(state.summary.avg_preprocess_ms))}</span></div>
                <div><strong>平均上游响应头</strong><span>${escapeHtml(formatSeconds(state.summary.avg_upstream_headers_ms))}</span></div>
                <div><strong>平均首个输出返回</strong><span>${escapeHtml(formatSeconds(state.summary.avg_ttft_ms))}</span></div>
                <div><strong>平均流式输出</strong><span>${escapeHtml(formatSeconds(state.summary.avg_stream_ms))}</span></div>
            </div>
            `;
        })();

    return buildSectionHtml("summary", "最近汇总", summaryBody, {
        titleHtml: buildSectionTitleHtml("最近汇总"),
    });
}

function getHistoryPreviewRuns() {
    return sortRunsByStartedAtDesc(filterRunsByCacheHit(filterRunsByRequestPurpose(state.runs))).slice(0, HISTORY_PREVIEW_COUNT);
}

function getRunDateKey(run) {
    const timestamp = Number(run?.started_at_ms);
    const date = Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp)
        : new Date(run?.started_at_iso || "");
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
}

function getLatestDateRuns(runs) {
    const sortedRuns = sortRunsByStartedAtDesc(runs);
    const latestDateKey = getRunDateKey(sortedRuns[0]);
    if (!latestDateKey) {
        return sortedRuns.slice(0, HISTORY_PREVIEW_COUNT);
    }

    return sortedRuns
        .filter((run) => getRunDateKey(run) === latestDateKey)
        .slice(0, HISTORY_PREVIEW_COUNT);
}

function normalizeSummaryText(value) {
    return typeof value === "string" && value.trim()
        ? value.trim()
        : "";
}

function getVisibleHistoryRuns() {
    const sourceRuns = sortRunsByStartedAtDesc(filterRunsByCacheHit(filterRunsByRequestPurpose(state.historyAbnormalOnly ? state.historyAllRuns : state.historyRuns)));
    return state.historyAbnormalOnly ? sourceRuns.filter(isAbnormalRun) : sourceRuns;
}

function getHistoryTotalPages() {
    const total = Math.max(0, Number(state.historyTotal) || 0);
    return Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
}

function buildHistoryPreviewItem(run) {
    const floorLabel = getRunFloorLabel(run);
    const sourceLabel = getRunSourceLabel(run);
    const summaryLabel = isAbnormalRun(run)
        ? getAbnormalTypeLabel(run?.abnormal_detail?.abnormal_type)
        : "正常完成";
    const httpStatusFailed = isFailedHttpStatus(run);

    return `
        <article class="stlp-history-preview-item">
            <div class="stlp-history-preview-main">
                <span class="stlp-badge">${escapeHtml(floorLabel || "未标楼层")}</span>
                <span>${escapeHtml(run?.model || "未记录模型")}</span>
                <span>${escapeHtml(summaryLabel)}</span>
                ${httpStatusFailed ? `<span class="stlp-badge stlp-badge-http-failed">${escapeHtml(getHttpStatusLabel(run))}</span>` : ""}
            </div>
            <div class="stlp-history-preview-meta">
                <span>来源 ${escapeHtml(sourceLabel)}</span>
                <span>总耗时 ${escapeHtml(formatSeconds(run?.metrics?.total_ms))}</span>
                <span>${escapeHtml((getRunDisplayChatName(run) || "未绑定聊天窗"))}</span>
            </div>
        </article>
    `;
}

function renderHistoryPreview() {
    const previewRuns = getHistoryPreviewRuns();
    if (!previewRuns.length) {
        return '<div class="stlp-empty">当前还没有可查看的历史记录。发送几轮消息后，这里会先显示简短版历史。</div>';
    }

    return `
        <div class="stlp-history-preview-list">
            ${previewRuns.map((run) => buildHistoryPreviewItem(run)).join("")}
        </div>
        <div class="stlp-history-preview-footer">
            <button class="menu_button stlp-history-preview-button" type="button" data-action="open-history-dialog">全部历史详情</button>
        </div>
    `;
}

function buildHistorySectionHtml() {
    return buildSectionHtml("history", "历史记录", renderHistoryPreview(), {
        titleHtml: buildSectionTitleHtml("历史记录"),
    });
}

function renderHistoryDialogRuns() {
    const visibleHistoryRuns = getVisibleHistoryRuns();
    const baseRuns = filterRunsByCacheHit(filterRunsByRequestPurpose(state.historyAbnormalOnly ? state.historyAllRuns : state.historyRuns));
    if (state.historyLoading && !baseRuns.length) {
        return '<div class="stlp-empty">正在加载历史记录...</div>';
    }

    if (state.historyError) {
        return `<div class="stlp-empty">${escapeHtml(state.historyError)}</div>`;
    }

    if (!baseRuns.length) {
        return `<div class="stlp-empty">${state.historyAbnormalOnly ? "当前还没有可查看的异常历史记录。" : "当前页没有历史记录。"}</div>`;
    }

    if (!visibleHistoryRuns.length) {
        return `<div class="stlp-empty">${state.uiSettings.cacheHitOnly ? "当前还没有命中的缓存历史记录。" : "当前还没有命中的异常历史记录。"}</div>`;
    }

    return `
        <div class="stlp-history-run-list">
            ${visibleHistoryRuns.map((run) => buildRunHtml(run, { compactSummary: true })).join("")}
        </div>
    `;
}

function buildHistoryDialogHtml() {
    if (!state.historyDialogOpen) {
        return "";
    }

    const mobileDrawer = isMobileDrawerLayout();
    const totalPages = getHistoryTotalPages();
    const currentPage = Math.max(1, Math.min(state.historyPage, totalPages));
    const previousDisabled = currentPage <= 1 || state.historyLoading;
    const nextDisabled = currentPage >= totalPages || state.historyLoading;
    const selectedCount = getSelectedHistoryRunCount();
    const visibleHistoryRuns = getVisibleHistoryRuns();
    const allSelected = areAllHistoryRunsSelected(visibleHistoryRuns);
    const deleteMode = state.historyDeleteMode;
    const footerMeta = state.historyAbnormalOnly
        ? `异常记录 ${visibleHistoryRuns.length} 条`
        : `第 ${escapeHtml(currentPage)} 页 / 共 ${escapeHtml(totalPages)} 页 · ${HISTORY_PAGE_SIZE} 条/页`;
    const historyCloseAction = "close-history-dialog";
    const historyCloseLabel = mobileDrawer ? "关闭历史页" : "收起历史页";
    const historyDialogClass = mobileDrawer ? "stlp-history-dialog stlp-mobile-sheet" : "stlp-history-dialog";

    return `
        <div class="stlp-history-layer">
            ${mobileDrawer ? "" : '<div class="stlp-history-backdrop" data-action="close-history-dialog"></div>'}
            <div class="${historyDialogClass}" role="dialog" aria-modal="true" aria-label="历史记录大页面">
                <div class="stlp-history-header">
                    <div class="stlp-history-header-start">
                        ${mobileDrawer ? `
                            <button class="menu_button stlp-header-icon-button stlp-history-back-button" type="button" data-action="close-history-dialog" title="返回主监控页" aria-label="返回主监控页">
                                ${getHeaderIconSvg("back")}
                            </button>
                        ` : ""}
                        <div class="stlp-history-header-copy">
                    <div class="stlp-history-title">
                        <span class="stlp-history-title-text">全部历史详情</span>
                        ${buildRequestPurposeBadgeHtml()}
                    </div>
                        </div>
                    </div>
                    <button class="menu_button stlp-close-button" type="button" data-action="${historyCloseAction}" title="${historyCloseLabel}" aria-label="${historyCloseLabel}">
                        ${getHeaderIconSvg("close")}
                    </button>
                </div>
                <div class="stlp-history-actions">
                    <button class="menu_button" type="button" data-action="refresh-history-dialog" ${state.historyLoading || state.isRefreshing ? "disabled" : ""}>刷新后台数据</button>
                    <button class="menu_button" type="button" data-action="toggle-history-abnormal-only" aria-pressed="${state.historyAbnormalOnly ? "true" : "false"}" ${state.historyLoading || !state.historyRuns.length ? "disabled" : ""}>${state.historyAbnormalOnly ? "显示全部记录" : "只看异常记录"}</button>
                    ${deleteMode
                        ? `
                            <div class="stlp-history-selection-meta">已勾选 ${escapeHtml(selectedCount)} 条</div>
                            <button class="menu_button" type="button" data-action="toggle-history-page-selection" data-select-mode="${allSelected ? "clear" : "all"}" ${state.historyLoading || !visibleHistoryRuns.length ? "disabled" : ""}>${allSelected ? "取消本页全选" : "本页全选"}</button>
                            <button class="menu_button" type="button" data-action="clear-history-selection" ${selectedCount <= 0 ? "disabled" : ""}>清空勾选</button>
                            <button class="menu_button" type="button" data-action="open-history-delete-dialog" ${(state.isRefreshing || selectedCount <= 0) ? "disabled" : ""}>删除已勾选记录</button>
                            <button class="menu_button" type="button" data-action="exit-history-delete-mode">取消删除</button>
                        `
                        : `
                            <button class="menu_button" type="button" data-action="enter-history-delete-mode" ${state.historyLoading || !state.historyRuns.length ? "disabled" : ""}>删除历史记录</button>
                        `}
                </div>
                <div class="stlp-history-scroll">
                    ${renderHistoryDialogRuns()}
                </div>
                <div class="stlp-history-footer">
                    <span class="stlp-history-meta">${footerMeta}</span>
                    <div class="stlp-history-footer-nav">
                        <button class="stlp-history-page-link" type="button" data-action="history-prev-page" ${(state.historyAbnormalOnly || previousDisabled) ? "disabled" : ""}>上一页</button>
                        <button class="stlp-history-page-link" type="button" data-action="history-next-page" ${(state.historyAbnormalOnly || nextDisabled) ? "disabled" : ""}>下一页</button>
                    </div>
                </div>
                ${state.confirmDialog?.type === "output-card" && state.confirmDialog.host === "history"
                    ? buildOutputCardDialogHtml({ withinHistory: true })
                    : ""}
            </div>
        </div>
    `;
}

function buildRunHtml(run, { compactSummary = false, showWaitingQueueAction = true, showOutputCardAction = true } = {}) {
    const abnormalDetail = run?.abnormal_detail;
    const abnormalBilling = getRunAbnormalBilling(run);
    const suggestions = abnormalDetail?.optimization_suggestions?.suggestions ?? [];
    const summaryLabel = isAbnormalRun(run) ? getAbnormalTypeLabel(abnormalDetail.abnormal_type) : "正常完成";
    const statusBadgeClass = isAbnormalRun(run) ? "stlp-badge stlp-badge-abnormal" : "stlp-badge";
    const sourceLabel = getRunSourceLabel(run);
    const pluginLabel = getRunPluginLabel(run);
    const entryOriginLabel = getEntryOriginLabel(run?.entry_origin);
    const failedStage = getRunFailedStage(run);
    const failedStageLabel = getFailedStageLabel(failedStage);
    const floorLabel = getRunFloorLabel(run);
    const chatName = getRunDisplayChatName(run);
    const waitingQueueEntry = getWaitingQueueEntry(run?.id);
    const runOpen = state.expandedRunIds.has(run?.id);
    const suggestionOpen = state.expandedSuggestionRunIds.has(run?.id);
    const httpStatusFailed = isFailedHttpStatus(run);
    const startedAtCompact = formatStartedAtCompact(run?.started_at_iso);
    const showDeleteToggle = compactSummary && state.historyDeleteMode;
    const selectedForDelete = showDeleteToggle && state.selectedHistoryRunIds.has(run?.id);
    const usage = getRunUsage(run);
    const usageAvailable = hasRunUsage(run);
    const injectionTraceLabels = getRunInjectionTraceLabels(run);
    const injectionTraceText = injectionTraceLabels.length ? injectionTraceLabels.join(" / ") : "聊天注入";
    const detailSnapshot = getOutputCardSnapshot(run, HISTORY_RUN_DETAIL_FIELDS);
    const detailSections = detailSnapshot ? (() => {
        const sections = buildOutputCardSectionData(detailSnapshot, HISTORY_RUN_DETAIL_FIELDS);
        sections.coreRows = [
            { label: "模型", value: detailSnapshot.modelText },
            { label: "开始", value: detailSnapshot.startedAt },
            { label: "聊天窗", value: detailSnapshot.chatName || "-" },
            { label: "楼层", value: detailSnapshot.floorLabel || "-" },
            { label: "用途", value: detailSnapshot.requestPurposeLabel },
            { label: "来源", value: detailSnapshot.sourceLabel, full: true },
            { label: "状态码", value: detailSnapshot.httpStatusText },
            { label: "记录", value: detailSnapshot.shortRunIdText, full: true },
        ];
        sections.diagnosisRows = [
            { label: "异常", value: detailSnapshot.abnormalTypeLabel },
            { label: "生成完成", value: detailSnapshot.paidText },
            { label: "阶段", value: detailSnapshot.failedStageLabel },
            { label: "流式", value: detailSnapshot.streamText },
            { label: "部分输出", value: detailSnapshot.hasPartialOutputText },
            { label: "总耗时", value: detailSnapshot.totalMsText },
            { label: "预处理", value: detailSnapshot.preprocessMsText },
            { label: "响应头", value: detailSnapshot.upstreamHeadersMsText },
            { label: "首个输出", value: detailSnapshot.ttftMsText },
            { label: "流式输出", value: detailSnapshot.streamMsText },
            { label: "消息数", value: detailSnapshot.messageCountText },
            { label: "提示词字符", value: detailSnapshot.promptCharsText },
            { label: "Prompt", value: detailSnapshot.promptTokensText },
            { label: "Completion", value: detailSnapshot.completionTokensText },
            { label: "Total", value: detailSnapshot.totalTokensText },
        ];
        sections.rawRows = [
            { label: "来源名称", value: detailSnapshot.injectionSourceLabel },
            { label: "来源标识", value: detailSnapshot.injectionSourceId },
            { label: "提示词来源", value: detailSnapshot.traceLabelsText, full: true },
            { label: "来源键", value: detailSnapshot.traceKeysText, full: true },
            { label: "拓展标识", value: detailSnapshot.pluginIdText, full: true },
            { label: "识别方式", value: detailSnapshot.pluginMatchModeLabel },
            { label: "识别分数", value: detailSnapshot.pluginMatchScoreText },
        ];
        return sections;
    })() : null;
    const estimatedPrice = getRunEstimatedPrice(run);
    const estimatedInputPriceText = estimatedPrice?.inputCost !== null && estimatedPrice?.inputCost !== undefined
        ? formatPriceWithCurrency(estimatedPrice.inputCost, estimatedPrice.currency)
        : "-";
    const estimatedRegularInputPriceText = estimatedPrice?.regularInputCost !== null && estimatedPrice?.regularInputCost !== undefined
        ? formatPriceWithCurrency(estimatedPrice.regularInputCost, estimatedPrice.currency)
        : "-";
    const estimatedCachedInputPriceText = estimatedPrice?.cachedInputCost !== null && estimatedPrice?.cachedInputCost !== undefined
        ? formatPriceWithCurrency(estimatedPrice.cachedInputCost, estimatedPrice.currency)
        : "-";
    const estimatedOutputPriceText = estimatedPrice?.outputCost !== null && estimatedPrice?.outputCost !== undefined
        ? formatPriceWithCurrency(estimatedPrice.outputCost, estimatedPrice.currency)
        : "-";
    const estimatedPriceNote = estimatedPrice
        ? `已估算：${estimatedPrice.note}。输入部分 ${estimatedInputPriceText}${estimatedPrice?.cachedInputCost !== null && estimatedPrice?.cachedInputCost !== undefined ? `（普通输入 ${estimatedRegularInputPriceText}，缓存输入 ${estimatedCachedInputPriceText}）` : ""}，输出部分 ${estimatedOutputPriceText}。`
        : "当前模型已经返回 usage，但你还没在设置里填这个模型的价格，所以暂时不计算金额。";
    const abnormalRows = abnormalDetail ? [
        { label: "已有部分输出", value: formatBoolean(Boolean(abnormalDetail.has_partial_output)) },
        { label: "计费状态", value: abnormalBilling?.label || "费用未确认" },
        { label: "已拿到 Usage", value: formatBoolean(Boolean(abnormalBilling?.hasUsageTokens)) },
        { label: "Usage Tokens", value: abnormalBilling?.usageTotalTokens ?? "-" },
        { label: "已配置价格", value: formatBoolean(Boolean(abnormalBilling?.hasPricingConfig)) },
        { label: "异常费用估算", value: abnormalBilling?.estimatedPriceText || "-" },
    ] : [];

    const compactSummaryText = [
        floorLabel || "未标楼层",
        startedAtCompact,
        run?.model || "未记录模型",
        summaryLabel,
        `总耗时 ${formatSeconds(run?.metrics?.total_ms)}`,
    ].filter(Boolean).join(" · ");
    const toggleRunButtonHtml = `
        <button class="menu_button stlp-inline-button" type="button" data-action="toggle-run" data-run-id="${escapeHtml(run?.id || "")}">
            ${runOpen ? "收起详情" : "展开详情"}
        </button>
    `;
    const compactOutputCardButtonHtml = showOutputCardAction ? `
        <button class="menu_button stlp-inline-button stlp-run-compact-output-button" type="button" data-action="open-output-card" data-run-id="${escapeHtml(run?.id || "")}">
            生成排障卡
        </button>
    ` : "";
    const runActionButtonsHtml = `
        <div class="stlp-run-compact-actions ${compactSummary ? "" : "stlp-run-summary-actions"}">
            ${compactOutputCardButtonHtml}
            ${toggleRunButtonHtml}
        </div>
    `;

    return `
        <article class="stlp-run ${isAbnormalRun(run) ? "stlp-run-abnormal" : ""} ${compactSummary ? "stlp-run-compact" : ""}" data-run-id="${escapeHtml(run?.id || "")}">
            <div class="stlp-run-summary ${compactSummary ? `stlp-run-summary-compact ${showDeleteToggle ? "stlp-run-summary-with-select" : "stlp-run-summary-no-select"}` : ""}">
                ${compactSummary
                    ? `
                        ${showDeleteToggle
                            ? `
                                <label class="stlp-history-select-toggle" aria-label="选中这条历史记录">
                                    <input type="checkbox" data-history-select-run-id="${escapeHtml(run?.id || "")}" ${selectedForDelete ? "checked" : ""} />
                                </label>
                            `
                            : ""}
                        <div class="stlp-run-summary-text">${escapeHtml(compactSummaryText)}</div>
                    `
                    : `
                        <span class="stlp-badge">${escapeHtml(entryOriginLabel)}</span>
                        ${floorLabel ? `<span class="stlp-badge">${escapeHtml(floorLabel)}</span>` : ""}
                        <span class="stlp-badge">${escapeHtml(startedAtCompact)}</span>
                        <span>${escapeHtml(run?.model || "未记录模型")}</span>
                        <span class="${statusBadgeClass}">${escapeHtml(summaryLabel)}</span>
                        ${failedStage ? `<span class="stlp-badge stlp-badge-stage">卡在 ${escapeHtml(failedStageLabel)}</span>` : ""}
                        <span>来源 ${escapeHtml(sourceLabel)}</span>
                        <span>总耗时 ${escapeHtml(formatSeconds(run?.metrics?.total_ms))}</span>
                    `}
            </div>
            ${runActionButtonsHtml}
            <div class="stlp-run-body ${runOpen ? "" : "stlp-hidden"}">
                <div class="stlp-run-detail-sections">
                    ${detailSections ? renderHistoryDetailSection("核心信息", detailSections.coreRows) : ""}
                    ${detailSections ? renderHistoryDetailSection("失败证据", detailSections.evidenceRows) : ""}
                    ${detailSections ? renderHistoryDetailSection("诊断与耗时", detailSections.diagnosisRows) : ""}
                    ${detailSections ? renderHistoryDetailSection("注入概况", detailSections.injectionRows) : ""}
                    ${detailSections ? renderHistoryDetailSection("费用细项", detailSections.pricingRows, usageAvailable ? estimatedPriceNote : "") : ""}
                    ${detailSections ? renderHistoryDetailSection("原始识别细节", detailSections.rawRows) : ""}
                    ${abnormalDetail ? renderHistoryDetailSection("异常详情", abnormalRows, abnormalBilling?.note || "") : ""}
                </div>
            ${showOutputCardAction && !compactSummary ? `
                <div class="stlp-suggestions">
                    <div class="stlp-note">整理这条记录的关键字段，方便直接截图发论坛咨询，或者复制成文本版发给 AI 提问。</div>
                </div>
            ` : ""}
            ${showWaitingQueueAction ? `
                <div class="stlp-suggestions">
                    <button class="menu_button stlp-inline-button" type="button" data-action="move-to-waiting-queue" data-run-id="${escapeHtml(run?.id || "")}" ${waitingQueueEntry ? "disabled" : ""}>
                        ${waitingQueueEntry ? "已在等待区" : "移入等待区"}
                    </button>
                    <div class="stlp-note">如果这条记录误入正文或拓展分区，可以先移入等待区，再由你手动补上拓展名称。</div>
                </div>
            ` : ""}
            ${abnormalDetail ? `
                <div class="stlp-abnormal">
                    <div class="stlp-stage-highlight">未成功生成卡在：${escapeHtml(failedStageLabel)}</div>
                    ${abnormalDetail.show_optimization_suggestions && suggestions.length ? `
                        <div class="stlp-suggestions">
                            <button class="menu_button stlp-inline-button" type="button" data-action="toggle-suggestions" data-run-id="${escapeHtml(run?.id || "")}">
                                ${suggestionOpen ? "收起优化建议" : escapeHtml(abnormalDetail.optimization_suggestions.button_label || "查看优化建议")}
                            </button>
                            <div class="stlp-suggestions-panel ${suggestionOpen ? "" : "stlp-hidden"}">
                            <div class="stlp-note">${escapeHtml(abnormalDetail.optimization_suggestions.section_title || "建议操作方向")}</div>
                            <ul class="stlp-suggestion-list">
                                ${suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                            </ul>
                            </div>
                        </div>
                    ` : '<div class="stlp-muted">当前异常未生成可显示的优化建议。</div>'}
                </div>
            ` : ''}
            </div>
        </article>
    `;
}

function renderRuns() {
    const currentChatName = getTrackedCurrentChatWindowName();
    const scopedRuns = filterRunsByCacheHit(filterRunsByRequestPurpose(state.runs));
    const scopedAbnormalRuns = filterRunsByCacheHit(filterRunsByRequestPurpose(state.recentAbnormalRuns));

    if (!scopedRuns.length && !state.uiSettings.abnormalOnly) {
        return '<div class="stlp-empty">当前还没有后台监控记录。发送一轮消息后，这里会显示最近 20 条生成详情。</div>';
    }

    let visibleRuns = state.uiSettings.abnormalOnly
        ? scopedAbnormalRuns
        : sortRunsByStartedAtDesc(scopedRuns);

    if (state.uiSettings.currentChatOnly && currentChatName) {
        visibleRuns = visibleRuns.filter((run) => isRunInTrackedCurrentChat(run));
    }

    visibleRuns = visibleRuns.slice(0, HISTORY_PREVIEW_COUNT);

    if (state.uiSettings.abnormalOnly && state.recentAbnormalLoading && !scopedAbnormalRuns.length) {
        return '<div class="stlp-empty">正在加载全部历史里的异常记录...</div>';
    }

    if (!visibleRuns.length) {
        if (state.uiSettings.abnormalOnly) {
            return '<div class="stlp-empty">全部历史里暂时没有可显示的异常记录。</div>';
        }

        const fallbackRuns = getLatestDateRuns(scopedRuns);
        return `
            <div class="stlp-note">当前筛选没有命中，已保留最近日期的历史记录。</div>
            ${groupRunsByChatName(fallbackRuns)
                .map((group) => `
                    <section class="stlp-run-group">
                        <div class="stlp-run-group-title">
                            <span>${escapeHtml(group.chatName)}</span>
                            <span>${escapeHtml(`${group.runs.length} 条`)}</span>
                        </div>
                        <div class="stlp-run-group-list">
                            ${group.runs.map((run) => buildRunHtml(run)).join("")}
                        </div>
                    </section>
                `)
                .join("")}
        `;
    }

    return groupRunsByChatName(visibleRuns)
        .map((group) => `
            <section class="stlp-run-group">
                <div class="stlp-run-group-title">
                    <span>${escapeHtml(group.chatName)}</span>
                    <span>${escapeHtml(`${group.runs.length} 条`)}</span>
                </div>
                <div class="stlp-run-group-list">
                    ${group.runs.map((run) => buildRunHtml(run)).join("")}
                </div>
            </section>
        `)
        .join("");
}

function buildRunsSectionHtml() {
    return buildSectionHtml("runs", "最近记录", renderRuns(), {
        titleHtml: buildSectionTitleHtml("最近记录"),
    });
}

function buildOutputCardDialogHtml({ withinHistory = false } = {}) {
    if (state.confirmDialog?.type !== "output-card") {
        return "";
    }

    const run = findRunById(state.confirmDialog.runId);
    const snapshot = getOutputCardSnapshot(run);
    if (!snapshot) {
        return "";
    }

    const mobileDrawer = isMobileDrawerLayout();
    const fields = getOutputCardFields();
    const sections = buildOutputCardSectionData(snapshot, fields);
    const badgeHtml = [
        snapshot.cacheHitText === "是" ? '<span class="stlp-badge">命中缓存</span>' : "",
    ].filter(Boolean).join("");
    const maskChatTitleButtonLabel = fields.maskChatTitle ? "显示标题" : "隐藏标题";
    const layerClass = withinHistory
        ? "stlp-confirm-layer stlp-confirm-layer-output-card stlp-history-output-card-layer"
        : "stlp-confirm-layer stlp-confirm-layer-output-card";
    return `
        <div class="${layerClass}">
            <div class="stlp-confirm-backdrop" data-action="dismiss-confirm-dialog"></div>
            <div class="stlp-output-card-dialog ${mobileDrawer ? "stlp-output-card-sheet" : ""}" role="dialog" aria-modal="true" aria-label="排障输出卡">
                ${mobileDrawer ? '<div class="stlp-confirm-sheet-grab" aria-hidden="true"></div>' : ""}
                <div class="stlp-output-card-actions">
                    <div class="stlp-output-card-dialog-title">鱼缸后端监控排障卡 · ${escapeHtml(snapshot.requestPurposeLabel)}</div>
                    <button class="menu_button stlp-inline-button stlp-output-card-action-button" type="button" data-action="copy-output-card-text" data-run-id="${escapeHtml(run?.id || "")}">复制文本</button>
                    <button class="menu_button stlp-inline-button stlp-output-card-action-button" type="button" data-action="toggle-output-card-mask-chat-title" aria-pressed="${escapeHtml(String(fields.maskChatTitle))}">${escapeHtml(maskChatTitleButtonLabel)}</button>
                    <button class="menu_button stlp-inline-button stlp-output-card-action-button stlp-output-card-close-button" type="button" data-action="dismiss-confirm-dialog" aria-label="关闭排障卡">×</button>
                </div>
                <article class="stlp-output-card stlp-output-card-compact">
                    <div class="stlp-output-card-header">
                        <div class="stlp-output-card-title">${escapeHtml(snapshot.modelText)}</div>
                        ${badgeHtml ? `<div class="stlp-output-card-badges">${badgeHtml}</div>` : ""}
                        <div class="stlp-output-card-meta${isAbnormalRun(run) ? " is-abnormal" : ""}">${isAbnormalRun(run)
                            ? `<span class="stlp-badge stlp-badge-stage">${escapeHtml(snapshot.summaryLabel)}</span>`
                            : escapeHtml(snapshot.summaryLabel)}</div>
                    </div>
                    ${renderOutputCardSection("核心信息", sections.coreRows, "", "stlp-output-card-rows-two-column")}
                    ${renderOutputCardSection("失败证据", sections.evidenceRows, "", "stlp-output-card-rows-two-column")}
                    ${renderOutputCardSection("诊断与耗时", sections.diagnosisRows, "", "stlp-output-card-rows-two-column")}
                    ${renderOutputCardSection("注入概况", sections.injectionRows, "", "stlp-output-card-rows-two-column")}
                    ${renderOutputCardSection("注入细项", sections.injectionDetailRows, "", "stlp-output-card-rows-two-column")}
                    ${renderOutputCardSection("扩展识别", sections.extensionRows, "", "stlp-output-card-rows-two-column")}
                    ${renderOutputCardSection("费用细项", sections.pricingRows, fields.showPricingDetails ? snapshot.estimatedPriceNote : "", "stlp-output-card-rows-two-column")}
                </article>
            </div>
        </div>
    `;
}

function buildCloseConfirmHtml() {
    if (!state.confirmDialog) {
        return "";
    }

    if (state.confirmDialog.type === "output-card") {
        return "";
    }

    const mobileDrawer = isMobileDrawerLayout();
    let title = "";
    let text = "";
    let actions = [];

    if (state.confirmDialog.type === "close-page") {
        title = "关闭页面后是否继续在后台运行？";
        text = "选择“运行”为继续在后台运行，选择“不运行”为关闭页面并停止后台自动刷新。";
        actions = [
            { action: "confirm-close-keep-running", label: "运行" },
            { action: "confirm-close-stop", label: "不运行" },
        ];
    } else if (state.confirmDialog.type === "generation-intervention") {
        title = state.confirmDialog.title || "这次生成等得太久了";
        text = state.confirmDialog.text || "这次生成已经明显超出正常时长，基本不用继续等了。要现在尝试中止这次生成吗？";
        actions = [
            { action: "confirm-generation-intervention-yes", label: "是" },
            { action: "confirm-generation-intervention-no", label: "否" },
        ];
    } else if (state.confirmDialog.type === "manual-force-stop-generation") {
        title = "强行终止当前生成？";
        text = state.confirmDialog.mode === "rescue"
            ? "现在没有检测到明确的活跃生成信号，但你遇到的那种“酒馆停止键消失、发送键也没回来”的死锁，确实可能把检测链路一起骗过去。继续后会补做一次酒馆原生终止探测；如果还卡住，再补发中止指令，尽量把前端锁松开。"
            : "会先尝试酒馆原生停止；如果还卡住，会继续强制切断监控接管的请求，并再补一次 Escape，尽量把前端锁一起松开。";
        actions = [
            { action: "confirm-manual-force-stop-yes", label: "是" },
            { action: "confirm-manual-force-stop-no", label: "否" },
        ];
    } else if (state.confirmDialog.type === "clear-backend") {
        title = "清空后台记录";
        text = "确认清空后台监控记录吗？这个操作会删除当前已保存的最近记录。";
        actions = [
            { action: "confirm-clear-backend-yes", label: "是" },
            { action: "confirm-clear-backend-no", label: "否" },
        ];
    } else if (state.confirmDialog.type === "history-delete-menu") {
        title = "删除历史记录";
        text = `当前已勾选 ${getSelectedHistoryRunCount()} 条，请选择要删除的范围。`;
        actions = [
            { action: "choose-clear-history-all", label: "删除勾选项里的全部记录" },
            { action: "choose-clear-history-normal", label: "删除勾选项里的正常记录" },
            { action: "cancel-history-delete", label: "取消" },
        ];
    } else if (state.confirmDialog.type === "history-delete-confirm") {
        const scope = state.confirmDialog.scope === "normal_only" ? "normal_only" : "all";
        title = getHistoryScopeLabel(scope);
        text = getHistoryScopeConfirmText(scope);
        actions = [
            { action: "confirm-clear-history-yes", label: "是", scope },
            { action: "confirm-clear-history-no", label: "否", scope },
        ];
    } else if (state.confirmDialog.type === "message") {
        title = state.confirmDialog.title || "";
        text = state.confirmDialog.text || "";
        actions = Array.isArray(state.confirmDialog.actions) && state.confirmDialog.actions.length
            ? state.confirmDialog.actions
            : [{ action: "dismiss-confirm-dialog", label: "知道了" }];
    }

    return `
        <div class="stlp-confirm-layer">
            <div class="stlp-confirm-backdrop" data-action="dismiss-confirm-dialog"></div>
            <div class="stlp-confirm-dialog ${mobileDrawer ? "stlp-confirm-sheet" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
                ${mobileDrawer ? '<div class="stlp-confirm-sheet-grab" aria-hidden="true"></div>' : ""}
                <div class="stlp-confirm-title">${escapeHtml(title)}</div>
                <div class="stlp-confirm-text">${escapeHtml(text)}</div>
                <div class="stlp-confirm-actions">
                    ${actions.map((item) => `
                        <button
                            class="menu_button"
                            type="button"
                            data-action="${escapeHtml(item.action)}"
                            ${item.scope ? `data-scope="${escapeHtml(item.scope)}"` : ""}
                        >${escapeHtml(item.label)}</button>
                    `).join("")}
                </div>
            </div>
        </div>
    `;
}

function buildPageHtml() {
    const currentThemeMode = normalizeThemeMode(state.uiSettings.themeMode);
    const mobileDrawer = isMobileDrawerLayout();
    const compactTouchLayout = mobileDrawer;
    const pageHeaderTitle = compactTouchLayout ? "" : ' title="按住移动页面"';
    const pageHeaderDragAction = compactTouchLayout ? "" : ' data-action="drag-page"';
    const pageBackdropAction = mobileDrawer ? "" : ' data-action="close-page"';
    const pageDialogClass = mobileDrawer
        ? "stlp-page-dialog stlp-mobile-sheet"
        : "stlp-page-dialog";
    if (!state.pageOpen) {
        return "";
    }

    if (state.pageMinimized) {
        return `
            <button
                class="menu_button stlp-minimized-button ${escapeHtml(getBackendStatusIndicatorClass())} ${state.minimizedButtonFlashActive ? "is-alert-flashing" : ""}"
                type="button"
                data-action="restore-page"
                title="${escapeHtml(MODULE_DISPLAY_NAME)}"
                aria-label="恢复悬浮隐藏"
                data-action-drag="drag-minimized-page"
                ${buildMinimizedButtonStyle()}
            >
                ${getMinimizedMonitorIconSvg()}
            </button>
            ${buildCloseConfirmHtml()}
        `;
    }

    const statusViewActive = isStatusView();
    const settingsViewActive = isSettingsView();
    const waitingQueueViewActive = isWaitingQueueView();
    const dailySummaryViewActive = isDailySummaryView();
    const monitorViewActive = !statusViewActive && !settingsViewActive && !waitingQueueViewActive && !dailySummaryViewActive;
    const pageSubtitle = statusViewActive
        ? "监控状态"
        : (settingsViewActive ? "设置" : (waitingQueueViewActive ? "等待区" : (dailySummaryViewActive ? "日聚合" : "主监控页")));

    return `
        <div class="stlp-page-backdrop"${pageBackdropAction}></div>
        <div class="${pageDialogClass}" role="dialog" aria-modal="true" aria-label="${escapeHtml(MODULE_DISPLAY_NAME)}"${buildPageDialogStyle()}>
            <div class="stlp-page-header"${pageHeaderDragAction}${pageHeaderTitle}>
                <div class="stlp-page-header-start">
                    <div class="stlp-page-header-copy">
                        <div class="stlp-page-title-row">
                            <div class="stlp-page-title">${escapeHtml(MODULE_DISPLAY_NAME)}</div>
                            <span class="stlp-status-indicator ${escapeHtml(getBackendStatusIndicatorClass())} stlp-page-title-status" aria-hidden="true"></span>
                        </div>
                        ${compactTouchLayout ? `<div class="stlp-page-subtitle">${escapeHtml(pageSubtitle)}</div>` : ""}
                    </div>
                </div>
                <div class="stlp-page-header-actions">
                    <button class="menu_button stlp-header-icon-button" type="button" data-action="cycle-theme-mode" title="${escapeHtml(getThemeModeLabel(currentThemeMode))}" aria-label="切换主题">
                        ${getHeaderIconSvg("theme", currentThemeMode)}
                    </button>
                    <button class="menu_button stlp-header-icon-button stlp-minimize-button" type="button" data-action="minimize-page" title="悬浮隐藏" aria-label="悬浮隐藏">
                        ${getHeaderIconSvg("minimize")}
                    </button>
                    <button class="menu_button stlp-close-button" type="button" data-action="close-page" title="关闭" aria-label="关闭">
                        ${getHeaderIconSvg("close")}
                    </button>
                </div>
            </div>
            <div class="stlp-page-body">
                <nav class="stlp-side-nav" aria-label="监控入口">
                    <button class="stlp-side-nav-item ${monitorViewActive && !isExtensionRequestView() ? "is-active" : ""}" type="button" data-nav-purpose="chat_main_reply" aria-pressed="${escapeHtml(String(monitorViewActive && !isExtensionRequestView()))}" title="正文回复" aria-label="正文回复">
                        <span class="stlp-side-nav-icon" aria-hidden="true">
                            <svg class="stlp-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M8 12h8M8 16h6"/></svg>
                        </span>
                    </button>
                    <button class="stlp-side-nav-item ${monitorViewActive && isExtensionRequestView() ? "is-active" : ""}" type="button" data-nav-purpose="non_chat_generation" aria-pressed="${escapeHtml(String(monitorViewActive && isExtensionRequestView()))}" title="拓展调用" aria-label="拓展调用">
                        <span class="stlp-side-nav-icon" aria-hidden="true">
                            <svg class="stlp-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M14 16.5h6M17 13.5v6"/></svg>
                        </span>
                    </button>
                    <button class="stlp-side-nav-item ${statusViewActive ? "is-active" : ""}" type="button" data-nav-action="open-status" aria-pressed="${escapeHtml(String(statusViewActive))}" title="监控状态" aria-label="监控状态">
                        <span class="stlp-side-nav-icon" aria-hidden="true">
                            <svg class="stlp-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16"/><path d="M7 15l3-3 2 2 5-6"/><circle cx="17" cy="8" r="1.5"/></svg>
                        </span>
                    </button>
                    <button class="stlp-side-nav-item ${waitingQueueViewActive ? "is-active" : ""}" type="button" data-nav-action="open-waiting-queue" aria-pressed="${escapeHtml(String(waitingQueueViewActive))}" title="等待区" aria-label="等待区">
                        <span class="stlp-side-nav-icon" aria-hidden="true">
                            <svg class="stlp-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12"/><path d="M6 12h12"/><path d="M6 17h7"/><path d="M18 17h.01"/></svg>
                        </span>
                    </button>
                    <button class="stlp-side-nav-item ${dailySummaryViewActive ? "is-active" : ""}" type="button" data-nav-action="open-daily-summary" aria-pressed="${escapeHtml(String(dailySummaryViewActive))}" title="日聚合" aria-label="日聚合">
                        <span class="stlp-side-nav-icon" aria-hidden="true">
                            <svg class="stlp-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19h16"/><path d="M7 15v-4"/><path d="M12 15V8"/><path d="M17 15v-6"/></svg>
                        </span>
                    </button>
                    <button class="stlp-side-nav-item ${settingsViewActive ? "is-active" : ""}" type="button" data-nav-action="open-settings" aria-pressed="${escapeHtml(String(settingsViewActive))}" title="设置" aria-label="设置">
                        <span class="stlp-side-nav-icon" aria-hidden="true">
                            <svg class="stlp-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
                        </span>
                    </button>
                </nav>
                <div class="stlp-page-main">
                    ${monitorViewActive ? `<div class="stlp-page-toolbar">
                        <div class="stlp-toolbar-row stlp-toolbar-actions">
                            <button id="stlp_refresh_runs" class="menu_button stlp-toolbar-button" type="button">刷新后台</button>
                            <button id="stlp_request_force_stop_generation" class="menu_button stlp-toolbar-button stlp-toolbar-button-danger" type="button" data-action="request-force-stop-generation">终止生成</button>
                        </div>
                        <div class="stlp-toolbar-row stlp-toolbar-filters">
                            <label class="stlp-inline-checkbox stlp-toolbar-toggle" aria-pressed="${escapeHtml(String(state.uiSettings.abnormalOnly))}">
                                <input id="stlp_abnormal_only" type="checkbox" ${state.uiSettings.abnormalOnly ? "checked" : ""} />
                                <span>只看异常</span>
                            </label>
                            <label class="stlp-inline-checkbox stlp-toolbar-toggle" aria-pressed="${escapeHtml(String(state.uiSettings.cacheHitOnly))}">
                                <input id="stlp_cache_hit_only" type="checkbox" ${state.uiSettings.cacheHitOnly ? "checked" : ""} />
                                <span>只看缓存命中</span>
                            </label>
                            <label class="stlp-inline-checkbox stlp-toolbar-toggle" aria-pressed="${escapeHtml(String(state.uiSettings.currentChatOnly))}">
                                <input id="stlp_current_chat_only" type="checkbox" ${state.uiSettings.currentChatOnly ? "checked" : ""} />
                                <span>此聊天条目</span>
                            </label>
                        </div>
                    </div>` : ""}
                    <div class="stlp-page-scroll">
                        ${settingsViewActive
                            ? `<div id="stlp_settings_view"></div>`
                            : (statusViewActive
                                ? `<div id="stlp_status_view"></div>`
                                : (waitingQueueViewActive
                                    ? `<div id="stlp_waiting_queue_view"></div>`
                                    : (dailySummaryViewActive
                                        ? `<div id="stlp_daily_summary_view"></div>`
                                        : `<div id="stlp_monitor_sections" class="stlp-section-stack"></div>`)))}
                    </div>
                </div>
            </div>
            <div class="stlp-page-resizer" data-action="resize-page" aria-hidden="true"></div>
        </div>
        ${buildHistoryDialogHtml()}
        ${state.confirmDialog?.type === "output-card" && state.confirmDialog.host === "history" ? "" : buildOutputCardDialogHtml()}
        ${buildCloseConfirmHtml()}
    `;
}

function updateWaitingRuleCardLayouts(root) {
    if (!(root instanceof HTMLElement)) {
        return;
    }

    const cards = root.querySelectorAll(".stlp-waiting-rule-card");
    cards.forEach((card) => {
        if (!(card instanceof HTMLElement)) {
            return;
        }

        const headline = card.querySelector(".stlp-waiting-rule-card-headline");
        const title = card.querySelector(".stlp-waiting-rule-card-headline .stlp-waiting-card-title");
        const inlineTimeGroup = card.querySelector(".stlp-waiting-rule-time-group-inline");
        if (!(headline instanceof HTMLElement) || !(title instanceof HTMLElement) || !(inlineTimeGroup instanceof HTMLElement)) {
            card.classList.remove("is-time-secondary");
            return;
        }

        const headlineStyle = window.getComputedStyle(headline);
        const gapValue = headlineStyle.columnGap || headlineStyle.gap || "0";
        const gap = Number.parseFloat(gapValue) || 0;
        const requiredWidth = title.scrollWidth + inlineTimeGroup.offsetWidth + gap;
        const availableWidth = headline.clientWidth;
        card.classList.toggle("is-time-secondary", requiredWidth > (availableWidth + 1));
    });
}

function renderPage() {
    if (!(state.pageRoot instanceof HTMLElement)) {
        return;
    }

    const waitingQueueInputSnapshot = captureWaitingQueueInputState();
    const waitingQueueEntrySnapshot = captureWaitingQueueEntrySnapshot(waitingQueueInputSnapshot);
    if (waitingQueueInputSnapshot?.runId && typeof waitingQueueInputSnapshot.value === "string") {
        state.waitingQueueDrafts = {
            ...state.waitingQueueDrafts,
            [waitingQueueInputSnapshot.runId]: waitingQueueInputSnapshot.value,
        };
    }
    const existingScrollRoot = state.pageRoot.querySelector(".stlp-page-scroll");
    if (existingScrollRoot instanceof HTMLElement) {
        state.pageScrollTop = existingScrollRoot.scrollTop;
    }

    const existingHistoryScrollRoot = state.pageRoot.querySelector(".stlp-history-scroll");
    if (existingHistoryScrollRoot instanceof HTMLElement) {
        state.historyScrollTop = existingHistoryScrollRoot.scrollTop;
    }

    state.pageRoot.classList.toggle("stlp-page-open", state.pageOpen);
    state.pageRoot.classList.toggle("stlp-page-minimized", state.pageMinimized);
    state.pageRoot.classList.toggle("stlp-layout-mobile", isMobileDrawerLayout());
    state.pageRoot.classList.toggle("stlp-platform-ios", isIosWebKit());
    state.pageRoot.classList.remove(
        "stlp-theme-dawn",
        "stlp-theme-rose",
        "stlp-theme-night",
        "stlp-theme-follow-tavern",
    );
    state.pageRoot.classList.add(`stlp-theme-${normalizeThemeMode(state.uiSettings.themeMode).replace(/_/g, "-")}`);
    syncBodyScrollLock();
    state.pageRoot.innerHTML = buildPageHtml();

    const settingsViewRoot = state.pageRoot.querySelector("#stlp_settings_view");
    const statusViewRoot = state.pageRoot.querySelector("#stlp_status_view");
    let waitingQueueViewRoot = state.pageRoot.querySelector("#stlp_waiting_queue_view");
    const dailySummaryViewRoot = state.pageRoot.querySelector("#stlp_daily_summary_view");
    const monitorSectionsRoot = state.pageRoot.querySelector("#stlp_monitor_sections");
    const refreshButton = state.pageRoot.querySelector("#stlp_refresh_runs");
    const exportButton = state.pageRoot.querySelector("#stlp_export_runs");
    const clearButton = state.pageRoot.querySelector("#stlp_clear_runs");

    if (settingsViewRoot) {
        settingsViewRoot.innerHTML = buildSettingsViewHtml();
    }

    if (statusViewRoot) {
        statusViewRoot.innerHTML = buildStatusViewHtml();
    }

    if (waitingQueueViewRoot) {
        waitingQueueViewRoot.innerHTML = buildWaitingQueueViewHtml();
        if (waitingQueueEntrySnapshot?.runId) {
            waitingQueueViewRoot = restoreWaitingQueueEntrySnapshot(waitingQueueEntrySnapshot, waitingQueueViewRoot);
        }
    }

    if (dailySummaryViewRoot) {
        dailySummaryViewRoot.innerHTML = buildDailySummaryViewHtml();
    }

    if (monitorSectionsRoot) {
        syncRunFloorMap();
        syncRunChatMap();
        monitorSectionsRoot.innerHTML = [
            buildSummaryHtml(),
            buildRunsSectionHtml(),
            buildHistorySectionHtml(),
        ].join("");
    }

    if (refreshButton) {
        refreshButton.disabled = state.isRefreshing;
    }

    if (exportButton) {
        exportButton.disabled = !state.runs.length;
    }

    if (clearButton) {
        clearButton.disabled = !state.runs.length || state.isRefreshing;
    }

    bindRenderedPageActions();

    const nextScrollRoot = state.pageRoot.querySelector(".stlp-page-scroll");
    if (nextScrollRoot instanceof HTMLElement) {
        nextScrollRoot.scrollTop = state.pageScrollTop;
    }

    const nextHistoryScrollRoot = state.pageRoot.querySelector(".stlp-history-scroll");
    if (nextHistoryScrollRoot instanceof HTMLElement) {
        nextHistoryScrollRoot.scrollTop = state.historyScrollTop;
    }

    if (waitingQueueInputSnapshot && state.confirmDialog?.type !== "close-page") {
        restoreWaitingQueueInputState(waitingQueueInputSnapshot);
    }

    window.requestAnimationFrame(() => {
        updateWaitingRuleCardLayouts(state.pageRoot);
    });

    if (state.pageOpen && !state.pageMinimized) {
        window.requestAnimationFrame(() => {
            closeNativeMenu({ forceDirectHide: isIosWebKit() });
        });
    }

    if (state.pageOpen && isMobileDrawerLayout()) {
        scheduleViewportSync();
    }
}

function handlePanelChangeTarget(target) {
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
        return false;
    }

    if (target.dataset.waitingLabelRunId) {
        const runId = typeof target.dataset.waitingLabelRunId === "string" ? target.dataset.waitingLabelRunId.trim() : "";
        if (!runId) {
            return false;
        }

        state.waitingQueueDrafts = {
            ...state.waitingQueueDrafts,
            [runId]: target.value,
        };
        return true;
    }

    if (target.dataset.pricingModel && target.dataset.pricingField) {
        const modelName = typeof target.dataset.pricingModel === "string" ? target.dataset.pricingModel.trim() : "";
        const fieldName = target.dataset.pricingField;
        const supportedFields = new Set(["currency", ...PRICING_NUMBER_FIELDS, ...PRICING_TIME_FIELDS, ...PRICING_BOOLEAN_FIELDS]);
        if (!modelName || !supportedFields.has(fieldName)) {
            return false;
        }

        const currentMap = getModelPricingMap();
        const currentConfig = normalizePricingConfig(currentMap[modelName]);

        if (fieldName === "currency") {
            persistPricingModelConfig(modelName, {
                ...currentConfig,
                currency: normalizePricingCurrency(target.value),
            });
            return true;
        }

        if (PRICING_BOOLEAN_FIELDS.includes(fieldName)) {
            persistPricingModelConfig(modelName, {
                ...currentConfig,
                [fieldName]: Boolean(target.checked),
            });
            state.apiStatus = "价格设置已更新";
            state.apiError = "";
            return true;
        }

        if (PRICING_TIME_FIELDS.includes(fieldName)) {
            const rawTimeValue = target.value.trim();
            const nextTimeValue = rawTimeValue ? normalizePeakValleyTimeValue(rawTimeValue) : "";
            if (rawTimeValue && !nextTimeValue) {
                target.value = currentConfig[fieldName] || "";
                state.apiStatus = "价格保存失败";
                state.apiError = "峰时段时间必须是有效的 24 小时制时间。";
                safeRenderPage();
                return true;
            }

            const otherFieldName = fieldName === "peak_start_time" ? "peak_end_time" : "peak_start_time";
            const otherTimeValue = fieldName === "peak_start_time"
                ? normalizePeakValleyTimeValue(currentConfig.peak_end_time)
                : normalizePeakValleyTimeValue(currentConfig.peak_start_time);
            if (nextTimeValue && otherTimeValue && nextTimeValue === otherTimeValue) {
                target.value = currentConfig[fieldName] || "";
                state.apiStatus = "价格保存失败";
                state.apiError = "峰时开始和结束时间不能相同。";
                safeRenderPage();
                return true;
            }

            persistPricingModelConfig(modelName, {
                ...currentConfig,
                [fieldName]: nextTimeValue,
                [otherFieldName]: otherTimeValue,
            });
            state.apiStatus = "价格设置已更新";
            state.apiError = "";
            return true;
        }

        const rawValue = target.value.trim();
        const nextValue = rawValue ? normalizeConfiguredPriceValue(Number(rawValue)) : null;
        if (rawValue && nextValue === null) {
            const fallbackValue = normalizeConfiguredPriceValue(currentConfig[fieldName]);
            target.value = fallbackValue === null ? "" : String(fallbackValue);
            state.apiStatus = "价格保存失败";
            state.apiError = "价格必须是大于等于 0 的数字。";
            safeRenderPage();
            return true;
        }

        persistPricingModelConfig(modelName, {
            ...currentConfig,
            [fieldName]: nextValue,
        });
        target.value = nextValue === null ? "" : String(nextValue);
        state.apiStatus = "价格设置已更新";
        state.apiError = "";
        return true;
    }

    if (target.id === "stlp_show_abnormal_optimization_suggestions") {
        updateMonitorSettings({
            display: {
                show_abnormal_optimization_suggestions: Boolean(target.checked),
            },
        }, { deferBusyRender: true, optimistic: true });
        return true;
    }

    if (target.id === "stlp_show_permission_enhanced_suggestions") {
        updateMonitorSettings({
            display: {
                show_permission_enhanced_suggestions: Boolean(target.checked),
            },
        }, { deferBusyRender: true, optimistic: true });
        return true;
    }

    if (target.id === "stlp_abnormal_optimization_suggestion_scope") {
        updateMonitorSettings({
            display: {
                abnormal_optimization_suggestion_scope: target.value,
            },
        }, { deferBusyRender: true, optimistic: true });
        return true;
    }

    if (target.id === "stlp_abnormal_optimization_suggestion_limit") {
        const parsed = Number(target.value);
        const nextValue = Number.isInteger(parsed) ? Math.max(2, Math.min(4, parsed)) : 3;
        target.value = String(nextValue);
        updateMonitorSettings({
            display: {
                abnormal_optimization_suggestion_limit: nextValue,
            },
        }, { deferBusyRender: true, optimistic: true });
        return true;
    }

    if (target.id === "stlp_auto_refresh_seconds") {
        const parsed = Number(target.value);
        state.uiSettings.autoRefreshSeconds = Number.isFinite(parsed)
            ? Math.max(5, Math.min(120, parsed))
            : DEFAULT_UI_SETTINGS.autoRefreshSeconds;
        target.value = String(state.uiSettings.autoRefreshSeconds);
        saveUiSettings();
        scheduleAutoRefresh();
        safeRenderPage();
        return true;
    }

    if (target.id === "stlp_theme_mode") {
        state.uiSettings.themeMode = normalizeThemeMode(target.value);
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (target.id === "stlp_minimized_button_follow_theme_color") {
        state.uiSettings.minimizedButtonColorMode = target.checked ? "follow_theme" : "custom";
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (target.id === "stlp_minimized_button_custom_color") {
        state.uiSettings.minimizedButtonColorMode = "custom";
        state.uiSettings.minimizedButtonCustomColor = normalizeMinimizedButtonCustomColor(target.value);
        saveUiSettings();
        if (isColorWheelInputTarget(target)) {
            deferColorWheelRenderUntilBlur();
        } else {
            safeRenderPage();
        }
        return true;
    }

    if (target.id === "stlp_minimized_button_stroke_color") {
        state.uiSettings.minimizedButtonStrokeColor = normalizeMinimizedButtonStrokeColor(target.value);
        saveUiSettings();
        if (isColorWheelInputTarget(target)) {
            deferColorWheelRenderUntilBlur();
        } else {
            safeRenderPage();
        }
        return true;
    }

    if (target.id === "stlp_abnormal_only") {
        state.uiSettings.abnormalOnly = Boolean(target.checked);
        saveUiSettings();
        if (state.uiSettings.abnormalOnly) {
            void loadRecentAbnormalRuns();
        } else {
            safeRenderPage();
        }
        return true;
    }

    if (target.id === "stlp_cache_hit_only") {
        state.uiSettings.cacheHitOnly = Boolean(target.checked);
        saveUiSettings();
        void (async () => {
            if (state.historyDialogOpen) {
                await refreshHistoryDialogData();
                return;
            }
            await refreshBackendData({ silent: true });
        })();
        return true;
    }

    if (target.id === "stlp_current_chat_only") {
        state.uiSettings.currentChatOnly = Boolean(target.checked);
        saveUiSettings();
        safeRenderPage();
        void refreshBackendData({ silent: true });
        return true;
    }

    if (
        target.id === "stlp_output_card_show_injection_details"
        || target.id === "stlp_output_card_show_pricing_details"
        || target.id === "stlp_output_card_show_context_volume"
        || target.id === "stlp_output_card_show_extension_details"
        || target.id === "stlp_output_card_mask_chat_title"
    ) {
        const currentFields = getOutputCardFields();
        state.uiSettings.outputCardFields = {
            ...currentFields,
            showInjectionDetails: target.id === "stlp_output_card_show_injection_details" ? Boolean(target.checked) : currentFields.showInjectionDetails,
            showPricingDetails: target.id === "stlp_output_card_show_pricing_details" ? Boolean(target.checked) : currentFields.showPricingDetails,
            showContextVolume: target.id === "stlp_output_card_show_context_volume" ? Boolean(target.checked) : currentFields.showContextVolume,
            showExtensionDetails: target.id === "stlp_output_card_show_extension_details" ? Boolean(target.checked) : currentFields.showExtensionDetails,
            maskChatTitle: target.id === "stlp_output_card_mask_chat_title" ? Boolean(target.checked) : currentFields.maskChatTitle,
        };
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (target.dataset.historySelectRunId) {
        toggleHistoryRunSelection(target.dataset.historySelectRunId, Boolean(target.checked));
        safeRenderPage();
        return true;
    }

    return false;
}

function handlePanelAction(actionTarget, event) {
    if (!(actionTarget instanceof HTMLElement)) {
        return false;
    }

    const action = actionTarget.dataset.action;
    const runId = actionTarget.dataset.runId || "";
    const sectionKey = actionTarget.dataset.sectionKey || "";
    const insidePage = Boolean(actionTarget.closest("#stlp_page"));
    const insideHistoryDialog = Boolean(actionTarget.closest(".stlp-history-dialog"));

    if (action === "pricing-cycle-currency") {
        const modelName = typeof actionTarget?.dataset.pricingModel === "string"
            ? actionTarget.dataset.pricingModel.trim()
            : "";
        if (!modelName) {
            return true;
        }

        const currentConfig = getModelPriceConfig(modelName) ?? {};
        const nextCurrency = normalizePricingCurrency(currentConfig.currency) === "usd" ? "cny" : "usd";
        persistPricingModelConfig(modelName, {
            ...currentConfig,
            currency: nextCurrency,
        });
        return true;
    }

    if (action === "toggle-pricing-panel") {
        const modelName = typeof actionTarget?.dataset.pricingModel === "string"
            ? actionTarget.dataset.pricingModel.trim()
            : "";
        if (!modelName) {
            return true;
        }

        state.uiSettings.pricingPanelOpenStates = {
            ...getPricingPanelOpenStates(),
            [modelName]: !isPricingPanelOpen(modelName),
        };
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (action === "toggle-pricing-peak-valley-panel") {
        const modelName = typeof actionTarget?.dataset.pricingModel === "string"
            ? actionTarget.dataset.pricingModel.trim()
            : "";
        if (!modelName) {
            return true;
        }

        state.uiSettings.pricingPeakValleyOpenStates = {
            ...getPricingPeakValleyOpenStates(),
            [modelName]: !isPricingPeakValleyPanelOpen(modelName),
        };
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (action === "open-page") {
        openMonitorPage();
        return true;
    }

    if (action === "close-page") {
        if (shouldIgnoreMobileOpenGuard()) {
            return true;
        }
        requestClosePage();
        return true;
    }

    if (action === "minimize-page") {
        minimizePage();
        return true;
    }

    if (action === "restore-page") {
        if (Date.now() < state.minimizedButtonSuppressClickUntil) {
            return true;
        }
        restoreMinimizedPage();
        return true;
    }

    if (action === "confirm-close-keep-running") {
        confirmClosePage(true);
        return true;
    }

    if (action === "confirm-close-stop") {
        confirmClosePage(false);
        return true;
    }

    if (action === "confirm-generation-intervention-yes") {
        executeGenerationStopAction();
        return true;
    }

    if (action === "confirm-generation-intervention-no") {
        clearPendingGenerationIntervention({ rememberDismissed: true });
        state.confirmDialog = null;
        safeRenderPage();
        return true;
    }

    if (action === "request-force-stop-generation") {
        openManualForceStopGenerationDialog();
        return true;
    }

    if (action === "confirm-manual-force-stop-yes") {
        executeGenerationStopAction();
        return true;
    }

    if (action === "confirm-manual-force-stop-no") {
        closeCloseConfirm();
        return true;
    }

    if (action === "cycle-theme-mode") {
        cycleThemeMode();
        return true;
    }

    if (action === "confirm-clear-backend-yes") {
        void performClearBackendRuns();
        return true;
    }

    if (action === "confirm-clear-backend-no") {
        closeCloseConfirm();
        return true;
    }

    if (action === "dismiss-confirm-dialog") {
        if (shouldIgnoreMobileOpenGuard()) {
            return true;
        }
        if (state.confirmDialog?.type === "generation-intervention") {
            clearPendingGenerationIntervention({ rememberDismissed: true });
        }
        closeCloseConfirm();
        return true;
    }

    if (action === "cancel-confirm-dialog") {
        cancelConfirmDialog();
        return true;
    }

    if (action === "open-history-dialog") {
        openHistoryDialog();
        return true;
    }

    if (action === "open-settings") {
        openSettingsSection();
        return true;
    }

    if (action === "open-output-card" && runId) {
        openOutputCardDialog(runId, insideHistoryDialog ? "history" : "page");
        return true;
    }

    if (action === "copy-output-card-text" && runId) {
        void (async () => {
            const run = findRunById(runId);
            const copied = await copyTextToClipboard(buildOutputCardText(run));
            if (!copied) {
                openMessageDialog("排障输出卡", "复制失败了，这次没拿到剪贴板权限。");
                return;
            }
            state.apiStatus = "排障输出卡文本已复制";
            state.apiError = "";
            safeRenderPage();
        })();
        return true;
    }

    if (action === "toggle-output-card-mask-chat-title") {
        const currentFields = getOutputCardFields();
        state.uiSettings.outputCardFields = {
            ...currentFields,
            maskChatTitle: !currentFields.maskChatTitle,
        };
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (action === "set-daily-summary-days") {
        const nextDays = normalizeDailySummaryDays(actionTarget?.dataset.days);
        if (nextDays === state.uiSettings.dailySummaryDays) {
            return true;
        }
        state.uiSettings.dailySummaryDays = nextDays;
        saveUiSettings();
        void refreshBackendData({ silent: true });
        return true;
    }

    if (action === "set-settings-category") {
        const nextCategory = normalizeSettingsCategory(actionTarget?.dataset.settingsCategory);
        const willOpen = nextCategory !== state.uiSettings.settingsCategory;
        state.uiSettings.settingsCategory = willOpen ? nextCategory : "none";
        if (willOpen && nextCategory === "appearance") {
            state.settingsSubsectionOpenStates = { ...DEFAULT_SETTINGS_SUBSECTION_OPEN_STATES };
        }
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (action === "toggle-settings-subsection") {
        const subsectionKey = typeof actionTarget?.dataset.settingsSubsection === "string"
            ? actionTarget.dataset.settingsSubsection.trim()
            : "";
        if (!subsectionKey) {
            return true;
        }

        state.settingsSubsectionOpenStates = {
            ...state.settingsSubsectionOpenStates,
            [subsectionKey]: !isSettingsSubsectionOpen(subsectionKey),
        };
        safeRenderPage();
        return true;
    }

    if (action === "set-theme-mode") {
        state.uiSettings.themeMode = normalizeThemeMode(actionTarget?.dataset.themeMode);
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (action === "toggle-daily-summary-row") {
        const dateKey = typeof actionTarget?.dataset.dateKey === "string" ? actionTarget.dataset.dateKey.trim() : "";
        if (!dateKey) {
            return true;
        }

        if (state.expandedDailySummaryDateKeys.has(dateKey)) {
            state.expandedDailySummaryDateKeys.delete(dateKey);
        } else {
            state.expandedDailySummaryDateKeys.add(dateKey);
        }
        safeRenderPage();
        return true;
    }

    if (action === "toggle-waiting-queue-entry") {
        const waitingRunId = typeof actionTarget?.dataset.runId === "string" ? actionTarget.dataset.runId.trim() : "";
        if (!waitingRunId) {
            return true;
        }

        if (state.expandedWaitingQueueRunIds.has(waitingRunId)) {
            state.expandedWaitingQueueRunIds.delete(waitingRunId);
        } else {
            state.expandedWaitingQueueRunIds.add(waitingRunId);
        }
        safeRenderPage();
        return true;
    }

    if (action === "toggle-plugin-rule-card") {
        const ruleId = typeof actionTarget?.dataset.ruleId === "string" ? actionTarget.dataset.ruleId.trim() : "";
        if (!ruleId) {
            return true;
        }

        if (state.expandedPluginRuleIds.has(ruleId)) {
            state.expandedPluginRuleIds.delete(ruleId);
        } else {
            state.expandedPluginRuleIds.add(ruleId);
        }
        safeRenderPage();
        return true;
    }

    if (action === "move-to-waiting-queue" && runId) {
        void moveRunToWaitingQueue(runId).catch((error) => {
            openMessageDialog("等待区操作失败", error instanceof Error ? error.message : String(error));
        });
        return true;
    }

    if (action === "submit-waiting-queue-label" && runId) {
        void submitWaitingQueueLabel(runId).catch((error) => {
            openMessageDialog("等待区操作失败", error instanceof Error ? error.message : String(error));
        });
        return true;
    }

    if (action === "remove-from-waiting-queue" && runId) {
        void removeRunFromWaitingQueue(runId).catch((error) => {
            openMessageDialog("等待区操作失败", error instanceof Error ? error.message : String(error));
        });
        return true;
    }

    if (action === "enable-plugin-rule" || action === "disable-plugin-rule") {
        const ruleId = typeof actionTarget?.dataset.ruleId === "string" ? actionTarget.dataset.ruleId.trim() : "";
        if (!ruleId) {
            return true;
        }

        void setPluginRuleEnabled(ruleId, action === "enable-plugin-rule").catch((error) => {
            openMessageDialog("规则操作失败", error instanceof Error ? error.message : String(error));
        });
        return true;
    }

    if (action === "request-remove-plugin-rule") {
        const ruleId = typeof actionTarget?.dataset.ruleId === "string" ? actionTarget.dataset.ruleId.trim() : "";
        const rule = getPluginRuleById(ruleId);
        if (!ruleId || !rule) {
            return true;
        }

        state.confirmDialog = {
            type: "message",
            title: "删除规则复用",
            text: `确认删除“${rule.plugin_label}”这条规则吗？删除后，新记录将不再使用它自动归类。`,
            actions: [
                { action: "confirm-remove-plugin-rule", label: "删除" },
                { action: "dismiss-confirm-dialog", label: "取消" },
            ],
            ruleId,
        };
        safeRenderPage();
        return true;
    }

    if (action === "confirm-remove-plugin-rule") {
        const ruleId = typeof state.confirmDialog?.ruleId === "string" ? state.confirmDialog.ruleId.trim() : "";
        closeCloseConfirm();
        if (!ruleId) {
            return true;
        }

        void removePluginRule(ruleId).catch((error) => {
            openMessageDialog("规则删除失败", error instanceof Error ? error.message : String(error));
        });
        return true;
    }

    if (action === "go-to-waiting-queue") {
        closeCloseConfirm();
        openWaitingQueueSection();
        return true;
    }

    if (action === "close-history-dialog") {
        if (shouldIgnoreMobileOpenGuard()) {
            return true;
        }
        closeHistoryDialog();
        return true;
    }

    if (action === "enter-history-delete-mode") {
        state.historyDeleteMode = true;
        clearHistorySelection();
        safeRenderPage();
        return true;
    }

    if (action === "refresh-history-dialog") {
        void refreshHistoryDialogData();
        return true;
    }

    if (action === "toggle-history-abnormal-only") {
        state.historyAbnormalOnly = !state.historyAbnormalOnly;
        clearHistorySelection();
        if (state.historyAbnormalOnly) {
            void loadAllHistoryRuns();
            return true;
        }
        state.historyAllRuns = [];
        safeRenderPage();
        return true;
    }

    if (action === "exit-history-delete-mode") {
        state.historyDeleteMode = false;
        clearHistorySelection();
        safeRenderPage();
        return true;
    }

    if (action === "history-prev-page") {
        if (!state.historyLoading && state.historyPage > 1) {
            void loadHistoryPage(state.historyPage - 1);
        }
        return true;
    }

    if (action === "history-next-page") {
        if (!state.historyLoading && state.historyPage < getHistoryTotalPages()) {
            void loadHistoryPage(state.historyPage + 1);
        }
        return true;
    }

    if (action === "open-history-delete-dialog") {
        if (getSelectedHistoryRunCount() <= 0) {
            return true;
        }
        clearHistoryRuns();
        return true;
    }

    if (action === "choose-clear-history-all") {
        state.confirmDialog = {
            type: "history-delete-confirm",
            scope: "all",
        };
        safeRenderPage();
        return true;
    }

    if (action === "choose-clear-history-normal") {
        state.confirmDialog = {
            type: "history-delete-confirm",
            scope: "normal_only",
        };
        safeRenderPage();
        return true;
    }

    if (action === "cancel-history-delete") {
        closeCloseConfirm();
        return true;
    }

    if (action === "toggle-history-page-selection") {
        toggleHistoryPageSelection(actionTarget.dataset.selectMode !== "clear", getVisibleHistoryRuns());
        safeRenderPage();
        return true;
    }

    if (action === "clear-history-selection") {
        clearHistorySelection();
        safeRenderPage();
        return true;
    }

    if (action === "confirm-clear-history-yes") {
        void performClearHistoryRuns(actionTarget.dataset.scope || "all");
        return true;
    }

    if (action === "confirm-clear-history-no") {
        closeCloseConfirm();
        return true;
    }

    if (action === "toggle-section" && sectionKey) {
        state.uiSettings.sectionOpenStates = normalizeSectionOpenStates(state.uiSettings.sectionOpenStates);
        const nextOpen = !state.uiSettings.sectionOpenStates[sectionKey];
        state.uiSettings.sectionOpenStates[sectionKey] = nextOpen;
        if (!nextOpen) {
            if (sectionKey === "runs") {
                collapseCurrentRunsDetails();
            }
            if (sectionKey === "history") {
                collapseHistoryRunsDetails();
            }
        }
        saveUiSettings();
        safeRenderPage();
        return true;
    }

    if (action === "toggle-run" && runId) {
        if (state.expandedRunIds.has(runId)) {
            state.expandedRunIds.delete(runId);
            state.expandedSuggestionRunIds.delete(runId);
        } else {
            state.expandedRunIds.add(runId);
        }
        safeRenderPage();
        return true;
    }

    if (action === "toggle-suggestions" && runId) {
        if (state.expandedSuggestionRunIds.has(runId)) {
            state.expandedSuggestionRunIds.delete(runId);
        } else {
            state.expandedSuggestionRunIds.add(runId);
            state.expandedRunIds.add(runId);
        }
        safeRenderPage();
        return true;
    }

    return false;
}

function handlePanelClickTarget(target, event) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    const actionTarget = target.closest("[data-action]");
    if (handlePanelAction(actionTarget, event)) {
        return true;
    }

    const purposeTarget = target.closest("[data-nav-purpose]");
    if (purposeTarget instanceof HTMLElement) {
        void setActiveRequestPurpose(purposeTarget.dataset.navPurpose);
        return true;
    }

    const navActionTarget = target.closest("[data-nav-action]");
    if (navActionTarget instanceof HTMLElement) {
        if (navActionTarget.dataset.navAction === "open-status") {
            openStatusSection();
            return true;
        }
        if (navActionTarget.dataset.navAction === "open-waiting-queue") {
            openWaitingQueueSection();
            return true;
        }
        if (navActionTarget.dataset.navAction === "open-daily-summary") {
            openDailySummarySection();
            return true;
        }
        if (navActionTarget.dataset.navAction === "open-settings") {
            openSettingsSection();
            return true;
        }
    }

    if (target.id === "stlp_refresh_runs") {
        void (async () => {
            await refreshBackendData();
            if (state.uiSettings.abnormalOnly) {
                await loadRecentAbnormalRuns();
            }
        })();
        return true;
    }

    if (target.id === "stlp_export_runs") {
        const payload = JSON.stringify(state.runs, null, 2);
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `st-latency-monitor-runs-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        return true;
    }

    if (target.id === "stlp_clear_runs") {
        clearBackendRuns();
        return true;
    }

    return false;
}

function bindRenderedPageActions() {
    if (!(state.pageRoot instanceof HTMLElement)) {
        return;
    }

    state.pageRoot.querySelectorAll("[data-action]").forEach((element) => {
        if (!(element instanceof HTMLElement)) {
            return;
        }

        element.addEventListener("click", (event) => {
            runSafely("处理面板直接点击绑定", () => {
                event.preventDefault();
                event.stopPropagation();
                handlePanelAction(element, event);
            });
        });
    });

    state.pageRoot.querySelectorAll("[data-nav-purpose]").forEach((element) => {
        if (!(element instanceof HTMLElement)) {
            return;
        }

        element.addEventListener("click", (event) => {
            runSafely("处理侧栏用途切换点击", () => {
                event.preventDefault();
                event.stopPropagation();
                void setActiveRequestPurpose(element.dataset.navPurpose);
            });
        });
    });

    state.pageRoot.querySelectorAll("[data-nav-action]").forEach((element) => {
        if (!(element instanceof HTMLElement)) {
            return;
        }

        element.addEventListener("click", (event) => {
            runSafely("处理侧栏动作点击", () => {
                event.preventDefault();
                event.stopPropagation();
                if (element.dataset.navAction === "open-status") {
                    openStatusSection();
                    return;
                }
                if (element.dataset.navAction === "open-waiting-queue") {
                    openWaitingQueueSection();
                    return;
                }
                if (element.dataset.navAction === "open-daily-summary") {
                    openDailySummarySection();
                    return;
                }
                if (element.dataset.navAction === "open-settings") {
                    openSettingsSection();
                }
            });
        });
    });

    ["stlp_refresh_runs", "stlp_export_runs", "stlp_clear_runs"].forEach((id) => {
        const element = state.pageRoot?.querySelector(`#${id}`);
        if (!(element instanceof HTMLElement)) {
            return;
        }

        element.addEventListener("click", (event) => {
            runSafely("处理面板直接按钮绑定", () => {
                event.preventDefault();
                event.stopPropagation();
                handlePanelClickTarget(element, event);
            });
        });
    });
}

function bindPageRootEvents() {
    if (!(state.pageRoot instanceof HTMLElement) || state.pageRoot.dataset.stlpBound === "true") {
        return;
    }

    state.pageRoot.dataset.stlpBound = "true";

    state.pageRoot.addEventListener("change", (event) => {
        runSafely("处理面板根节点变更", () => {
            if (isMobileDrawerLayout()) {
                event.stopPropagation();
            }
            handlePanelChangeTarget(event.target);
        });
    });

    state.pageRoot.addEventListener("focusin", (event) => {
        runSafely("处理面板焦点进入", () => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLSelectElement)) {
                return;
            }

            if (target instanceof HTMLInputElement && target.dataset.waitingLabelRunId) {
                setWaitingQueueEditLock(target.dataset.waitingLabelRunId);
            }

            if (!isMobileDrawerLayout()) {
                return;
            }

            scheduleViewportSync();
            if (isColorWheelInputTarget(target)) {
                return;
            }
            if (target instanceof HTMLInputElement && target.dataset.waitingLabelRunId) {
                return;
            }
            scheduleMobileFieldIntoView(target);
        });
    });

    state.pageRoot.addEventListener("focusout", (event) => {
        runSafely("处理等待区焦点离开", () => {
            const target = event.target;
            if (isColorWheelInputTarget(target)) {
                window.setTimeout(() => {
                    runSafely("处理色轮延后刷新", () => {
                        flushDeferredColorWheelRender();
                    });
                }, 0);
                return;
            }

            if (!(target instanceof HTMLInputElement) || !target.dataset.waitingLabelRunId) {
                return;
            }

            const runId = target.dataset.waitingLabelRunId;
            setWaitingQueueEditLock(runId);
            window.setTimeout(() => {
                runSafely("处理等待区延后刷新", () => {
                    const activeElement = document.activeElement;
                    if (activeElement instanceof HTMLInputElement && activeElement.dataset.waitingLabelRunId) {
                        return;
                    }

                    clearWaitingQueueEditLock(runId);
                    flushDeferredWaitingQueueRender();
                });
            }, 0);
        });
    });

    state.pageRoot.addEventListener("pointerdown", (event) => {
        if (!isMobileDrawerLayout()) {
            return;
        }

        const target = event.target;
        if (target instanceof Element && target.closest('[data-action-drag="drag-minimized-page"]')) {
            return;
        }

        event.stopPropagation();
    });

    state.pageRoot.addEventListener("click", (event) => {
        runSafely("处理面板根节点点击", () => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

             const clickedInsideDialog = target.closest(".stlp-confirm-dialog, .stlp-output-card-dialog");
             const clickedFunctionalTarget = target.closest('[data-action], button, input, select, textarea, a[href], label');
             if (state.confirmDialog && !clickedInsideDialog && !clickedFunctionalTarget) {
                 if (state.confirmDialog.type === "generation-intervention") {
                     clearPendingGenerationIntervention({ rememberDismissed: true });
                 }
                 closeCloseConfirm();
                 event.preventDefault();
                 event.stopPropagation();
                 return;
             }

            if (isMobileDrawerLayout()) {
                event.stopPropagation();
            }

            if (handlePanelClickTarget(target, event)) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
    });
}

function bindUiEvents() {
    if (state.eventsBound) {
        return;
    }

    document.addEventListener("input", (event) => {
        runSafely("处理等待区输入", () => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }

            if (!target.closest("#stlp_page")) {
                return;
            }

            if (target.dataset.waitingLabelRunId) {
                setWaitingQueueEditLock(target.dataset.waitingLabelRunId);
                handlePanelChangeTarget(target);
            }
        });
    });

    document.addEventListener("change", (event) => {
        runSafely("处理面板变更", () => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
                return;
            }

            if (target.closest("#stlp_page")) {
                if (isMobileDrawerLayout()) {
                    return;
                }
                handlePanelChangeTarget(target);
                return;
            }
        });
    });

    document.addEventListener("load", (event) => {
        runSafely("处理头像图片加载", () => {
            const target = event.target;
            if (!(target instanceof HTMLImageElement)) {
                return;
            }

            if (!target.closest(".avatar, .mesAvatar")) {
                return;
            }

            scheduleChatMessageUiNormalization();
        });
    }, true);

    document.addEventListener("pointerdown", (event) => {
        runSafely("记录调试交互命中", () => {
            if (!state.pageOpen) {
                return;
            }

            const target = event.target;
            if (!(target instanceof Element) || !target.closest("#stlp_page")) {
                return;
            }

        });
    }, true);

    document.addEventListener("click", (event) => {
        runSafely("处理面板点击", () => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (state.confirmDialog && target.closest("#stlp_page")) {
                const clickedInsideDialog = target.closest(".stlp-confirm-dialog, .stlp-output-card-dialog");
                const clickedFunctionalTarget = target.closest('[data-action], button, input, select, textarea, a[href], label');
                if (!clickedInsideDialog && !clickedFunctionalTarget) {
                    if (state.confirmDialog.type === "generation-intervention") {
                        clearPendingGenerationIntervention({ rememberDismissed: true });
                    }
                    closeCloseConfirm();
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }

            if (state.pageOpen && target.closest("#stlp_page")) {
                if (isMobileDrawerLayout()) {
                    return;
                }
                handlePanelClickTarget(target, event);
                return;
            }

            handlePanelClickTarget(target, event);
        });
    });

    document.addEventListener("keydown", (event) => {
        runSafely("处理快捷键", () => {
            if (!state.pageOpen || event.key !== "Escape" || shouldIgnoreSyntheticEscapeForMonitor(event)) {
                return;
            }

            if (state.pageMinimized) {
                return;
            }

            if (state.confirmDialog) {
                cancelConfirmDialog();
                return;
            }

            if (state.historyDialogOpen) {
                closeHistoryDialog();
                return;
            }

            requestClosePage();
        });
    });

    document.addEventListener("pointerdown", (event) => {
        runSafely("处理拖动起点", () => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const minimizedDragHandle = target.closest('[data-action-drag="drag-minimized-page"]');
            if (minimizedDragHandle instanceof HTMLElement) {
                startMinimizedButtonDrag(event);
                if (typeof minimizedDragHandle.setPointerCapture === "function") {
                    try {
                        minimizedDragHandle.setPointerCapture(event.pointerId);
                    } catch {
                        // Ignore pointer capture failures so the page stays usable.
                    }
                }
                return;
            }

            if (target.closest(".stlp-confirm-dialog")) {
                return;
            }

            if (target.closest(".stlp-history-dialog")) {
                return;
            }

            if (target.closest('[data-action="close-page"]')) {
                return;
            }

            if (target.closest(".stlp-page-header-actions")) {
                return;
            }

            const resizeHandle = target.closest('[data-action="resize-page"]');
            if (resizeHandle instanceof HTMLElement) {
                startPageResize(event);
                if (typeof resizeHandle.setPointerCapture === "function") {
                    try {
                        resizeHandle.setPointerCapture(event.pointerId);
                    } catch {
                        // Ignore pointer capture failures so the page stays usable.
                    }
                }
                return;
            }

            const dragHandle = target.closest('[data-action="drag-page"]');
            if (!(dragHandle instanceof HTMLElement)) {
                return;
            }

            startPageDrag(event);
            if (typeof dragHandle.setPointerCapture === "function") {
                try {
                    dragHandle.setPointerCapture(event.pointerId);
                } catch {
                    // Ignore pointer capture failures so the page stays usable.
                }
            }
        });
    });

    document.addEventListener("pointermove", (event) => {
        runSafely("处理拖动过程", () => {
            handleMinimizedButtonDragMove(event);
            handlePageDragMove(event);
            handlePageResizeMove(event);
        });
    });

    document.addEventListener("pointerup", (event) => {
        runSafely("处理拖动结束", () => {
            endMinimizedButtonDrag(event);
            endPageDrag(event);
            endPageResize(event);
        });
    });

    document.addEventListener("pointercancel", (event) => {
        runSafely("处理拖动取消", () => {
            endMinimizedButtonDrag(event);
            endPageDrag(event);
            endPageResize(event);
        });
    });

    window.addEventListener("resize", () => {
        runSafely("处理页面尺寸变化", () => {
            if (!state.pageOpen) {
                return;
            }

            if (isMobileDrawerLayout()) {
                scheduleViewportSync();
                return;
            }

            const dialog = state.pageRoot?.querySelector(".stlp-page-dialog");
            const rect = dialog instanceof HTMLElement ? dialog.getBoundingClientRect() : {};
            if (state.pagePosition) {
                state.pagePosition = clampPagePosition(state.pagePosition, rect);
                state.pageHeight = getClampedDesktopDialogHeight(state.pageHeight, state.pagePosition.top);
            } else {
                state.pageHeight = getClampedDesktopDialogHeight(state.pageHeight, 16);
            }
            safeRenderPage();
        });
    });

    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", () => {
            runSafely("处理可视视口变化", () => {
                scheduleViewportSync();
            });
        });

        window.visualViewport.addEventListener("scroll", () => {
            runSafely("处理可视视口滚动", () => {
                scheduleViewportSync();
            });
        });
    }

    window.addEventListener("pagehide", () => {
        unlockBodyScrollForMobileDrawer();
    });

    state.eventsBound = true;
}

function togglePage(nextOpen) {
    state.pageOpen = Boolean(nextOpen);
    if (state.pageOpen) {
        state.pageMinimized = false;
        state.confirmDialog = null;
    } else {
        state.pageMinimized = false;
        state.confirmDialog = null;
        state.historyDialogOpen = false;
        if (!isIosWebKit()) {
            restoreNativeMenuState();
        }
    }
    syncBodyScrollLock();
    scheduleAutoRefresh();
    safeRenderPage();
}

function requestClosePage() {
    blurWaitingQueueInput();
    state.confirmDialog = {
        type: "close-page",
    };
    safeRenderPage();
}

function closeCloseConfirm() {
    if (!state.confirmDialog) {
        return;
    }

    state.confirmDialog = null;
    safeRenderPage();
}

function cancelConfirmDialog() {
    if (!state.confirmDialog) {
        return;
    }

    if (state.confirmDialog.type === "close-page") {
        confirmClosePage(false);
        return;
    }

    closeCloseConfirm();
}

function confirmClosePage(keepRunning) {
    state.uiSettings.keepRunningAfterClose = keepRunning;
    saveUiSettings();
    state.confirmDialog = null;
    togglePage(false);
}

function removeLegacyLauncher() {
    const existingLauncher = document.querySelector("#stlp_launcher_wrap");
    if (existingLauncher instanceof HTMLElement) {
        existingLauncher.remove();
    }

    state.launcherRoot = null;
}

function scheduleNativeMenuEntryRepair() {
    if (state.nativeMenuRepairScheduled) {
        return;
    }

    state.nativeMenuRepairScheduled = true;
    window.requestAnimationFrame(() => {
        state.nativeMenuRepairScheduled = false;
        runSafely("同步魔棒入口", () => {
            ensureLauncher();
        });
    });
}

function runWithNativeMenuObserverSilenced(callback) {
    state.nativeMenuObserverSilenced = true;
    try {
        return callback();
    } finally {
        window.setTimeout(() => {
            state.nativeMenuObserverSilenced = false;
        }, 0);
    }
}

function startNativeMenuObserver() {
    const menuRoot = document.querySelector("#extensionsMenu");
    if (!(menuRoot instanceof HTMLElement)) {
        if (isTrackedMutationObserverInstance(state.nativeMenuObserver)) {
            state.nativeMenuObserver.disconnect();
        }
        state.nativeMenuObserver = null;
        state.nativeMenuObserverRoot = null;
        return;
    }

    if (!supportsMutationObserver()) {
        state.nativeMenuObserver = null;
        state.nativeMenuObserverRoot = menuRoot;
        return;
    }

    if (state.nativeMenuObserverRoot === menuRoot && isTrackedMutationObserverInstance(state.nativeMenuObserver)) {
        return;
    }

    if (isTrackedMutationObserverInstance(state.nativeMenuObserver)) {
        state.nativeMenuObserver.disconnect();
    }

    const observer = new MutationObserver(() => {
        if (state.nativeMenuObserverSilenced) {
            return;
        }
        scheduleNativeMenuEntryRepair();
    });

    observer.observe(menuRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });

    state.nativeMenuObserver = observer;
    state.nativeMenuObserverRoot = menuRoot;
}

function restoreNativeMenuState() {
    const menuRoot = document.querySelector("#extensionsMenu");
    const button = document.querySelector("#extensionsMenuButton");

    if (!(menuRoot instanceof HTMLElement)) {
        return;
    }

    if (menuRoot.dataset.stlpForceHidden !== "true") {
        return;
    }

    menuRoot.style.removeProperty("display");
    menuRoot.style.removeProperty("visibility");
    menuRoot.style.removeProperty("opacity");
    menuRoot.style.removeProperty("pointer-events");
    menuRoot.hidden = true;
    menuRoot.setAttribute("aria-hidden", "true");
    delete menuRoot.dataset.stlpForceHidden;

    if (button instanceof HTMLElement && button.dataset.stlpForceCollapsed === "true") {
        button.setAttribute("aria-expanded", "false");
        delete button.dataset.stlpForceCollapsed;
    }
}

function bindNativeMenuButtonGuard() {
    const button = document.querySelector("#extensionsMenuButton");
    if (!(button instanceof HTMLElement) || button.dataset.stlpRestoreBound === "true") {
        return;
    }

    button.dataset.stlpRestoreBound = "true";

    const restoreBeforeNativeOpen = () => {
        if (state.pageOpen && !state.pageMinimized) {
            return;
        }

        const menuRoot = document.querySelector("#extensionsMenu");
        if (!(menuRoot instanceof HTMLElement)) {
            return;
        }

        if (menuRoot.dataset.stlpForceHidden === "true" || button.dataset.stlpForceCollapsed === "true") {
            restoreNativeMenuState();
        }
    };

    button.addEventListener("pointerdown", restoreBeforeNativeOpen, true);
    button.addEventListener("click", restoreBeforeNativeOpen, true);
}

function closeNativeMenu({ forceDirectHide = false } = {}) {
    const menuRoot = document.querySelector("#extensionsMenu");
    const button = document.querySelector("#extensionsMenuButton");
    const menuVisible = menuRoot instanceof HTMLElement && (() => {
        const style = window.getComputedStyle(menuRoot);
        return style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0";
    })();
    const buttonExpanded = button instanceof HTMLElement && button.getAttribute("aria-expanded") === "true";
    if (!menuVisible && !buttonExpanded) {
        return;
    }

    if (!forceDirectHide && button instanceof HTMLElement) {
        button.click();
        return;
    }

    if (forceDirectHide && menuRoot instanceof HTMLElement) {
        menuRoot.style.display = "none";
        menuRoot.style.visibility = "hidden";
        menuRoot.style.opacity = "0";
        menuRoot.style.pointerEvents = "none";
        menuRoot.hidden = true;
        menuRoot.setAttribute("aria-hidden", "true");
        menuRoot.dataset.stlpForceHidden = "true";
    }

    if (button instanceof HTMLElement) {
        button.setAttribute("aria-expanded", "false");
        button.dataset.stlpForceCollapsed = "true";
    }
}

function bindNativeMenuEntry(entry) {
    if (!(entry instanceof HTMLElement)) {
        return;
    }

    const activateEntry = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openMonitorPage();
    };

    if (entry.dataset.stlpBound !== "true") {
        entry.dataset.stlpBound = "true";
        entry.addEventListener("click", activateEntry);
        entry.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                activateEntry(event);
            }
        });
    }

    const innerEntry = entry.querySelector(".stlp-wand-entry-item");
    if (innerEntry instanceof HTMLElement && innerEntry.dataset.stlpBound !== "true") {
        innerEntry.dataset.stlpBound = "true";
        innerEntry.addEventListener("click", activateEntry);
        innerEntry.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                activateEntry(event);
            }
        });
    }
}

function getNativeMenuTemplateEntry(menuRoot) {
    if (!(menuRoot instanceof HTMLElement)) {
        return null;
    }

    const children = Array.from(menuRoot.children).filter((child) => (
        child instanceof HTMLElement && child.id !== "stlp_wand_entry"
    ));

    return children.find((child) => (
        !child.classList.contains("mc3-hidden")
        && getComputedStyle(child).display !== "none"
    )) ?? children[0] ?? null;
}

function buildMenuTemplateClasses(source, fallback) {
    if (!(source instanceof HTMLElement) || !source.className) {
        return fallback;
    }

    const sanitized = source.className
        .split(/\s+/)
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => (
            name !== "mc3-hidden"
            && name !== "stlp-wand-entry"
            && name !== "stlp-wand-entry-item"
        ));

    return sanitized.length ? sanitized.join(" ") : fallback;
}

function buildMenuTemplateIconClasses(source) {
    const fallback = "fa-solid fa-chart-column extensionsMenuExtensionButton";
    if (!(source instanceof HTMLElement) || !source.className) {
        return fallback;
    }

    const preserved = source.className
        .split(/\s+/)
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => !/^fa[srlbdk]?-/.test(name));

    return Array.from(new Set(["fa-solid", "fa-chart-column", ...preserved])).join(" ");
}

function buildMenuTemplateLabelClasses(source) {
    if (!(source instanceof HTMLElement) || !source.className) {
        return "stlp-wand-entry-label";
    }

    const sanitized = source.className
        .split(/\s+/)
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => name !== "stlp-wand-entry-label");

    return sanitized.length
        ? `${sanitized.join(" ")} stlp-wand-entry-label`
        : "stlp-wand-entry-label";
}

function createNativeMenuItemFromTemplate(templateItem) {
    const item = document.createElement("div");
    item.className = `${buildMenuTemplateClasses(templateItem, "list-group-item flex-container flexGap5 interactable")} stlp-wand-entry-item`;
    item.setAttribute("tabindex", "0");
    item.setAttribute("role", "listitem");
    item.hidden = false;
    item.removeAttribute("aria-hidden");

    const iconElement = document.createElement("div");
    iconElement.className = buildMenuTemplateIconClasses(
        templateItem instanceof HTMLElement ? templateItem.querySelector(".extensionsMenuExtensionButton") : null,
    );
    iconElement.setAttribute("aria-hidden", "true");

    const templateLabelElement = templateItem instanceof HTMLElement
        ? Array.from(templateItem.children).find((child) => (
            child instanceof HTMLElement && !child.classList.contains("extensionsMenuExtensionButton")
        )) || templateItem.querySelector("span")
        : null;
    const labelElement = document.createElement("span");
    labelElement.textContent = MODULE_DISPLAY_NAME;
    labelElement.className = buildMenuTemplateLabelClasses(
        templateLabelElement instanceof HTMLElement ? templateLabelElement : null,
    );

    item.replaceChildren(iconElement, labelElement);

    return item;
}

function resolveNativeMenuTemplateItem(templateEntry) {
    if (!(templateEntry instanceof HTMLElement)) {
        return null;
    }

    const nestedItem = templateEntry.querySelector(":scope > .list-group-item");
    if (nestedItem instanceof HTMLElement) {
        return nestedItem;
    }

    return templateEntry.classList.contains("list-group-item") ? templateEntry : null;
}

function buildNativeMenuEntryContent(templateItem) {
    const iconElement = document.createElement("div");
    iconElement.className = buildMenuTemplateIconClasses(
        templateItem instanceof HTMLElement ? templateItem.querySelector(".extensionsMenuExtensionButton") : null,
    );
    iconElement.setAttribute("aria-hidden", "true");

    const templateLabelElement = templateItem instanceof HTMLElement
        ? Array.from(templateItem.children).find((child) => (
            child instanceof HTMLElement && !child.classList.contains("extensionsMenuExtensionButton")
        )) || templateItem.querySelector("span")
        : null;
    const labelElement = document.createElement("span");
    labelElement.textContent = MODULE_DISPLAY_NAME;
    labelElement.className = buildMenuTemplateLabelClasses(
        templateLabelElement instanceof HTMLElement ? templateLabelElement : null,
    );

    return [iconElement, labelElement];
}

function syncNativeMenuEntryPresentation(entry, templateEntry) {
    if (!(entry instanceof HTMLElement)) {
        return;
    }

    const templateItem = resolveNativeMenuTemplateItem(templateEntry);
    const usesNestedMenuItem = templateItem instanceof HTMLElement && templateItem !== templateEntry;
    entry.className = `${buildMenuTemplateClasses(
        usesNestedMenuItem ? templateEntry : templateItem,
        usesNestedMenuItem ? "extension_container interactable" : "list-group-item flex-container flexGap5 interactable",
    )} stlp-wand-entry`;
    const order = entry.style.order || (templateEntry instanceof HTMLElement ? String(Array.from(templateEntry.parentElement?.children || []).length + 1) : "99");
    entry.setAttribute("tabindex", usesNestedMenuItem ? String(templateEntry?.tabIndex || 0) : String(templateItem?.tabIndex || templateEntry?.tabIndex || 0));
    entry.style.order = order;
    entry.style.removeProperty("display");
    entry.style.removeProperty("visibility");
    entry.style.removeProperty("opacity");
    entry.style.removeProperty("pointer-events");
    entry.hidden = false;
    entry.removeAttribute("aria-hidden");
    entry.title = MODULE_DISPLAY_NAME;
    entry.setAttribute("role", usesNestedMenuItem ? "none" : (templateItem?.getAttribute("role") || "listitem"));

    const contentNodes = buildNativeMenuEntryContent(templateItem);
    if (usesNestedMenuItem) {
        const nextItem = createNativeMenuItemFromTemplate(templateItem);
        if (nextItem instanceof HTMLElement) {
            entry.replaceChildren(nextItem);
        }
        return;
    }

    entry.replaceChildren(...contentNodes);
}

function ensureNativeMenuItem() {
    const menuRoot = document.querySelector("#extensionsMenu");
    if (!(menuRoot instanceof HTMLElement)) {
        state.nativeMenuItemRegistered = false;
        return false;
    }

    if (!isIosWebKit() && !state.pageOpen && !state.pageMinimized && menuRoot.dataset.stlpForceHidden === "true") {
        restoreNativeMenuState();
    }

    return runWithNativeMenuObserverSilenced(() => {
        const templateEntry = getNativeMenuTemplateEntry(menuRoot);
        const duplicatedEntries = Array.from(document.querySelectorAll("#stlp_wand_entry"));
        const menuEntries = duplicatedEntries.filter((entry) => entry instanceof HTMLElement && entry.parentElement === menuRoot);
        const existingEntry = menuEntries[0] instanceof HTMLElement ? menuEntries[0] : null;

        duplicatedEntries.forEach((entry) => {
            if (!(entry instanceof HTMLElement)) {
                return;
            }

            if (entry !== existingEntry) {
                entry.remove();
            }
        });

        if (existingEntry instanceof HTMLElement) {
            syncNativeMenuEntryPresentation(existingEntry, templateEntry);
            bindNativeMenuEntry(existingEntry);
            state.launcherRoot = existingEntry;
            state.nativeMenuItemRegistered = true;
            return true;
        }

        const entry = document.createElement(
            templateEntry instanceof HTMLElement ? templateEntry.tagName.toLowerCase() : "button",
        );
        entry.id = "stlp_wand_entry";
        if (entry instanceof HTMLButtonElement) {
            entry.type = "button";
        }
        entry.dataset.action = "open-page";
        syncNativeMenuEntryPresentation(entry, templateEntry);
        bindNativeMenuEntry(entry);
        menuRoot.appendChild(entry);
        state.nativeMenuItemRegistered = true;

        const button = document.querySelector("#extensionsMenuButton");
        if (button instanceof HTMLElement) {
            button.style.display = "flex";
        }

        bindNativeMenuButtonGuard();

        removeLegacyLauncher();
        state.launcherRoot = entry;
        return true;
    });
}

function ensureLauncher() {
    if (state.extensionDisabled) {
        return false;
    }

    return ensureNativeMenuItem();
}

function ensurePage() {
    if (state.extensionDisabled) {
        return false;
    }

    const legacyPanel = document.querySelector("#stlp_panel");
    if (legacyPanel instanceof HTMLElement) {
        legacyPanel.remove();
    }

    const existingPage = document.querySelector("#stlp_page");
    if (existingPage instanceof HTMLElement) {
        const shouldRenderExistingPage = state.pageRoot !== existingPage || !existingPage.hasChildNodes();
        if (existingPage.parentElement !== document.documentElement) {
            document.documentElement.appendChild(existingPage);
        }
        state.pageRoot = existingPage;
        bindPageRootEvents();
        if (shouldRenderExistingPage) {
            safeRenderPage();
        }
        return true;
    }

    const pageRoot = document.createElement("div");
    pageRoot.id = "stlp_page";
    pageRoot.className = "stlp-page-host";
    document.documentElement.appendChild(pageRoot);
    state.pageRoot = pageRoot;
    bindPageRootEvents();
    safeRenderPage();
    return true;
}

function ensureUi() {
    const launcherReady = ensureLauncher();
    const pageReady = ensurePage();
    startNativeMenuObserver();
    state.uiReady = Boolean(launcherReady && pageReady);
    scheduleAutoRefresh();
    return state.uiReady;
}

function startUiRetryLoop() {
    clearUiRetryTimer();

    if (state.extensionDisabled) {
        return;
    }

    state.uiRetryTimerId = window.setInterval(() => {
        runSafely("查找独立页面入口", () => {
            ensureUi();
        });
    }, UI_RETRY_MS);
}

function init() {
    runSafely("初始化扩展", () => {
        if (pendingUiSettingsMigrationSave) {
            saveUiSettings();
            pendingUiSettingsMigrationSave = false;
        }
        installGenerationSettingsHook();
        installOutgoingGenerationHook();
        bindUiEvents();
        ensureUi();
        startChatUiObserver();
        startUiRetryLoop();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        init();
    });
} else {
    init();
}
