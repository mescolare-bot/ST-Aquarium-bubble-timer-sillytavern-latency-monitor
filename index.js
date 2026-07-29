const MODULE_NAME = "st-latency-profiler";
const STORAGE_KEY = `${MODULE_NAME}:settings`;

const DEFAULT_SETTINGS = {
    enabled: true,
    maxRuns: 20,
    onlyApiFetches: true,
};

const state = {
    fetchInstalled: false,
    panelReady: false,
    seq: 0,
    activeRun: null,
    runs: [],
    apiStatus: "未连接到 SillyTavern 事件接口",
    apiError: "",
};

function now() {
    return performance.now();
}

function roundMs(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return null;
    }

    return Math.round(value * 100) / 100;
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_SETTINGS };
        }

        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_SETTINGS,
            ...parsed,
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

let settings = loadSettings();

function getCurrentChatKey() {
    try {
        if (window.SillyTavern?.getContext) {
            const context = window.SillyTavern.getContext();
            return context.groupId || context.chatId || context.characterId || "unknown";
        }
    } catch {
        // ignore
    }

    return "unknown";
}

function limitRuns() {
    const maxRuns = Math.max(1, Number(settings.maxRuns) || DEFAULT_SETTINGS.maxRuns);
    state.runs = state.runs.slice(0, maxRuns);
}

function createRun(trigger) {
    const run = {
        id: ++state.seq,
        chatKey: getCurrentChatKey(),
        createdAtIso: new Date().toISOString(),
        trigger,
        marks: {},
        fetches: [],
        tokenCount: 0,
    };

    state.activeRun = run;
    state.runs.unshift(run);
    limitRuns();
    renderPanel();
    return run;
}

function getActiveRun(trigger) {
    if (!state.activeRun) {
        return createRun(trigger);
    }

    return state.activeRun;
}

function mark(run, key, value = now()) {
    if (!run || run.marks[key] !== undefined) {
        return;
    }

    run.marks[key] = value;
}

function shortenUrl(url) {
    if (!url) {
        return "";
    }

    try {
        const parsed = new URL(url, window.location.href);
        return `${parsed.pathname}${parsed.search}`.slice(0, 120);
    } catch {
        return String(url).slice(0, 120);
    }
}

function isRelevantFetch(url) {
    if (!url) {
        return false;
    }

    if (!settings.onlyApiFetches) {
        return true;
    }

    return /\/api\/|\/v1\/|\/chat\/completions|\/completions|\/generate|\/backends\//i.test(url);
}

function installFetchProbe() {
    if (state.fetchInstalled || typeof window.fetch !== "function") {
        return;
    }

    const originalFetch = window.fetch.bind(window);

    window.fetch = async function latencyProfilerFetch(input, init) {
        const requestUrl =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input?.url || "";

        const trackedRun = state.activeRun && isRelevantFetch(requestUrl) ? state.activeRun : null;
        const startedAt = now();
        let fetchRecord = null;

        if (trackedRun) {
            fetchRecord = {
                shortUrl: shortenUrl(requestUrl),
                method: init?.method || input?.method || "GET",
                startedAt,
            };

            trackedRun.fetches.push(fetchRecord);
            renderPanel();
        }

        try {
            const response = await originalFetch(input, init);

            if (fetchRecord) {
                fetchRecord.status = response.status;
                fetchRecord.headerMs = roundMs(now() - startedAt);
                renderPanel();
            }

            return response;
        } catch (error) {
            if (fetchRecord) {
                fetchRecord.error = String(error);
                fetchRecord.headerMs = roundMs(now() - startedAt);
                renderPanel();
            }

            throw error;
        }
    };

    state.fetchInstalled = true;
}

function calculateMetrics(run) {
    const marks = run?.marks || {};
    const sent = marks.messageSent ?? marks.generationStarted;
    const afterCommands = marks.generationAfterCommands;
    const generationStarted = marks.generationStarted ?? afterCommands ?? sent;
    const firstToken = marks.firstToken;
    const generationEnded = marks.generationEnded ?? marks.messageReceived;
    const rendered = marks.characterMessageRendered ?? generationEnded;

    return {
        totalMs: sent !== undefined && rendered !== undefined ? roundMs(rendered - sent) : null,
        preProcessMs: sent !== undefined && afterCommands !== undefined ? roundMs(afterCommands - sent) : null,
        queueMs: afterCommands !== undefined && generationStarted !== undefined ? roundMs(generationStarted - afterCommands) : null,
        ttftMs: generationStarted !== undefined && firstToken !== undefined ? roundMs(firstToken - generationStarted) : null,
        streamMs: firstToken !== undefined && generationEnded !== undefined ? roundMs(generationEnded - firstToken) : null,
        renderMs: generationEnded !== undefined && rendered !== undefined ? roundMs(rendered - generationEnded) : null,
    };
}

function formatMetric(value) {
    return value === null ? "-" : `${value} ms`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildRunHtml(run) {
    const metrics = calculateMetrics(run);
    const fetchHtml = run.fetches.length
        ? run.fetches
              .map((item) => {
                  const status = item.status ? ` ${item.status}` : "";
                  const ms = item.headerMs !== undefined && item.headerMs !== null ? ` ${item.headerMs} ms` : "";
                  const error = item.error ? ` error=${escapeHtml(item.error)}` : "";
                  return `<div class="stlp-fetch-row"><code>${escapeHtml(item.method)}</code><span>${escapeHtml(item.shortUrl)}</span><span>${status}${ms}${error}</span></div>`;
              })
              .join("")
        : `<div class="stlp-fetch-row stlp-muted">当前这次没有采集到 fetch 记录</div>`;

    return `
        <details class="stlp-run" ${run === state.runs[0] ? "open" : ""}>
            <summary>
                <span>#${run.id}</span>
                <span>总耗时 ${formatMetric(metrics.totalMs)}</span>
                <span>首 token ${formatMetric(metrics.ttftMs)}</span>
                <span>流式输出 ${formatMetric(metrics.streamMs)}</span>
                <span>token 事件 ${run.tokenCount}</span>
            </summary>
            <div class="stlp-grid">
                <div><strong>触发</strong><span>${escapeHtml(run.trigger)}</span></div>
                <div><strong>创建时间</strong><span>${escapeHtml(run.createdAtIso)}</span></div>
                <div><strong>消息发出 -> 命令后</strong><span>${formatMetric(metrics.preProcessMs)}</span></div>
                <div><strong>命令后 -> 开始生成</strong><span>${formatMetric(metrics.queueMs)}</span></div>
                <div><strong>开始生成 -> 首 token</strong><span>${formatMetric(metrics.ttftMs)}</span></div>
                <div><strong>首 token -> 生成结束</strong><span>${formatMetric(metrics.streamMs)}</span></div>
                <div><strong>生成结束 -> 渲染完成</strong><span>${formatMetric(metrics.renderMs)}</span></div>
                <div><strong>关联会话</strong><span>${escapeHtml(run.chatKey)}</span></div>
            </div>
            <div class="stlp-fetches">
                <div class="stlp-subtitle">关联 fetch</div>
                ${fetchHtml}
            </div>
        </details>
    `;
}

function renderPanel() {
    if (!state.panelReady) {
        return;
    }

    const enabled = document.querySelector("#stlp_enabled");
    const onlyApiFetches = document.querySelector("#stlp_only_api_fetches");
    const maxRuns = document.querySelector("#stlp_max_runs");
    const mode = document.querySelector("#stlp_mode");
    const root = document.querySelector("#stlp_runs");

    if (enabled) {
        enabled.checked = Boolean(settings.enabled);
    }

    if (onlyApiFetches) {
        onlyApiFetches.checked = Boolean(settings.onlyApiFetches);
    }

    if (maxRuns) {
        maxRuns.value = String(settings.maxRuns);
    }

    if (mode) {
        mode.innerHTML = `
            <div class="stlp-mode-card">
                <div class="stlp-mode-title">兼容模式</div>
                <div class="stlp-grid">
                    <div><strong>状态</strong><span>${escapeHtml(state.apiStatus)}</span></div>
                    <div><strong>错误</strong><span>${escapeHtml(state.apiError || "-")}</span></div>
                </div>
            </div>
        `;
    }

    if (!root) {
        return;
    }

    if (!state.runs.length) {
        root.innerHTML = '<div class="stlp-empty">发送一条消息后，这里会出现每次生成的分阶段计时。</div>';
        return;
    }

    root.innerHTML = state.runs.map(buildRunHtml).join("");
}

function bindPanelEvents() {
    document.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.id === "stlp_enabled") {
            settings.enabled = Boolean(target.checked);
            saveSettings(settings);
            renderPanel();
        }

        if (target.id === "stlp_only_api_fetches") {
            settings.onlyApiFetches = Boolean(target.checked);
            saveSettings(settings);
            renderPanel();
        }
    });

    document.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.id === "stlp_max_runs") {
            const parsed = Number(target.value);
            settings.maxRuns = Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : DEFAULT_SETTINGS.maxRuns;
            limitRuns();
            saveSettings(settings);
            renderPanel();
        }
    });

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.id === "stlp_clear_runs") {
            state.activeRun = null;
            state.runs = [];
            renderPanel();
        }

        if (target.id === "stlp_export_runs") {
            const payload = JSON.stringify(
                state.runs.map((run) => ({
                    ...run,
                    metrics: calculateMetrics(run),
                })),
                null,
                2,
            );

            const blob = new Blob([payload], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `st-latency-profiler-${Date.now()}.json`;
            link.click();
            URL.revokeObjectURL(url);
        }
    });
}

function ensurePanel() {
    if (document.querySelector("#stlp_panel")) {
        state.panelReady = true;
        renderPanel();
        return;
    }

    const target = document.querySelector("#extensions_settings2") || document.querySelector("#extensions_settings");
    if (!target) {
        return;
    }

    target.insertAdjacentHTML(
        "beforeend",
        `
        <div id="stlp_panel" class="stlp-panel">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Latency Profiler</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="stlp-controls">
                        <label class="checkbox_label">
                            <input id="stlp_enabled" type="checkbox" />
                            <span>启用监控</span>
                        </label>
                        <label class="checkbox_label">
                            <input id="stlp_only_api_fetches" type="checkbox" />
                            <span>只显示 API fetch</span>
                        </label>
                        <label class="stlp-number">
                            <span>保留记录数</span>
                            <input id="stlp_max_runs" type="number" min="1" max="100" step="1" />
                        </label>
                    </div>
                    <div class="stlp-actions">
                        <button id="stlp_export_runs" class="menu_button">导出 JSON</button>
                        <button id="stlp_clear_runs" class="menu_button">清空记录</button>
                    </div>
                    <div class="stlp-note">
                        这是兼容优先版本：优先保证酒馆能正常打开，再记录每轮消息的大致耗时。它不会拆记忆检索和模型内部思维链。
                    </div>
                    <div id="stlp_mode"></div>
                    <div id="stlp_runs" class="stlp-runs"></div>
                </div>
            </div>
        </div>
        `,
    );

    state.panelReady = true;
    renderPanel();
}

async function installSillyTavernHooks() {
    try {
        const [extensionsModule, scriptModule] = await Promise.all([
            import("/scripts/extensions.js"),
            import("/script.js"),
        ]);

        const getContext = extensionsModule.getContext;
        if (typeof getContext !== "function") {
            state.apiStatus = "SillyTavern getContext 不可用";
            renderPanel();
            return;
        }

        const context = getContext();
        const eventSource = context?.eventSource || scriptModule.eventSource;
        const event_types = context?.event_types || scriptModule.event_types;

        if (!eventSource || !event_types) {
            state.apiStatus = "未找到事件系统";
            renderPanel();
            return;
        }

        state.apiStatus = "已连接到 SillyTavern 事件接口";
        state.apiError = "";
        renderPanel();

        eventSource.on(event_types.MESSAGE_SENT, () => {
            if (!settings.enabled) {
                return;
            }

            const run = createRun("MESSAGE_SENT");
            mark(run, "messageSent");
            renderPanel();
        });

        if (event_types.GENERATION_AFTER_COMMANDS) {
            eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => {
                if (!settings.enabled) {
                    return;
                }

                const run = getActiveRun("GENERATION_AFTER_COMMANDS");
                mark(run, "generationAfterCommands");
                renderPanel();
            });
        }

        if (event_types.GENERATION_STARTED) {
            eventSource.on(event_types.GENERATION_STARTED, () => {
                if (!settings.enabled) {
                    return;
                }

                const run = getActiveRun("GENERATION_STARTED");
                mark(run, "generationStarted");
                renderPanel();
            });
        }

        if (event_types.STREAM_TOKEN_RECEIVED) {
            eventSource.on(event_types.STREAM_TOKEN_RECEIVED, () => {
                if (!settings.enabled || !state.activeRun) {
                    return;
                }

                mark(state.activeRun, "firstToken");
                state.activeRun.tokenCount += 1;
                renderPanel();
            });
        }

        if (event_types.MESSAGE_RECEIVED) {
            eventSource.on(event_types.MESSAGE_RECEIVED, () => {
                if (!settings.enabled) {
                    return;
                }

                const run = getActiveRun("MESSAGE_RECEIVED");
                mark(run, "messageReceived");
                renderPanel();
            });
        }

        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, () => {
                if (!settings.enabled || !state.activeRun) {
                    return;
                }

                mark(state.activeRun, "generationEnded");
                renderPanel();
            });
        }

        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
                if (!settings.enabled || !state.activeRun) {
                    return;
                }

                mark(state.activeRun, "characterMessageRendered");
                state.activeRun = null;
                renderPanel();
            });
        }
    } catch (error) {
        state.apiStatus = "加载兼容接口失败";
        state.apiError = error instanceof Error ? error.message : String(error);
        renderPanel();
        console.warn(`[${MODULE_NAME}] failed to connect SillyTavern APIs`, error);
    }
}

async function init() {
    try {
        bindPanelEvents();
        installFetchProbe();
        ensurePanel();
        await installSillyTavernHooks();

        const observer = new MutationObserver(() => {
            ensurePanel();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    } catch (error) {
        console.warn(`[${MODULE_NAME}] init failed`, error);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        init();
    });
} else {
    init();
}
