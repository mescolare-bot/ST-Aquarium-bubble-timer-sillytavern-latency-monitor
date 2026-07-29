const MODULE_NAME = "st-latency-profiler";
const BACKEND_BASE = "/api/plugins/st-latency-monitor";
const UI_STORAGE_KEY = `${MODULE_NAME}:ui`;

const DEFAULT_UI_SETTINGS = {
    autoRefreshSeconds: 15,
    abnormalOnly: false,
};

const PERMISSION_LABELS = {
    no_backend: "无后台权限版",
    local_full: "本地部署完整权限版",
    cloud_full: "云端部署完整权限版",
};

const RUNTIME_MODE_LABELS = {
    auto: "自动选择",
    no_backend: "无后台权限版",
    local_full: "本地部署完整权限版",
    cloud_full: "云端部署完整权限版",
};

const ABNORMAL_TYPE_LABELS = {
    failed_without_output: "未输出即失败",
    failed_after_partial_output: "部分输出后失败",
    failed_generation: "完整生成失败",
    request_timeout: "请求超时",
    stream_interrupted: "流式中断",
    suspected_incomplete_generation: "疑似未完整生成",
};

const FAILED_STAGE_LABELS = {
    preprocess: "预处理阶段",
    retrieval: "检索阶段",
    prompt_assembly: "提示词组装阶段",
    request_model: "请求模型阶段",
    before_first_output: "首个输出返回前",
    full_return: "完整返回阶段",
};

const SUGGESTION_SCOPE_LABELS = {
    failed_generation_only: "仅完整生成失败相关异常时显示",
    all_abnormal: "所有异常时显示",
};

const state = {
    panelReady: false,
    uiSettings: loadUiSettings(),
    settings: null,
    status: null,
    runs: [],
    summary: null,
    isRefreshing: false,
    isSaving: false,
    backendReady: false,
    apiStatus: "正在连接后台监控接口",
    apiError: "",
    refreshTimerId: null,
};

function loadUiSettings() {
    try {
        const raw = localStorage.getItem(UI_STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_UI_SETTINGS };
        }

        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_UI_SETTINGS,
            ...parsed,
        };
    } catch {
        return { ...DEFAULT_UI_SETTINGS };
    }
}

function saveUiSettings() {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state.uiSettings));
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatMs(value) {
    return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100) / 100} ms` : "-";
}

function formatBoolean(value) {
    return value ? "是" : "否";
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

function getAbnormalTypeLabel(value) {
    return ABNORMAL_TYPE_LABELS[value] || "正常完成";
}

function getFailedStageLabel(value) {
    return FAILED_STAGE_LABELS[value] || "-";
}

function isAbnormalRun(run) {
    return Boolean(run?.abnormal_detail?.abnormal_type);
}

async function fetchJson(path, options) {
    const response = await fetch(`${BACKEND_BASE}${path}`, {
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
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

async function refreshBackendData({ silent = false } = {}) {
    if (state.isRefreshing) {
        return;
    }

    state.isRefreshing = true;
    if (!silent) {
        state.apiStatus = "正在刷新后台监控数据";
        renderPanel();
    }

    try {
        const [statusResult, settingsResult, runsResult, summaryResult] = await Promise.all([
            fetchJson("/status"),
            fetchJson("/settings"),
            fetchJson("/runs?limit=20"),
            fetchJson("/summary?limit=100"),
        ]);

        state.status = statusResult;
        state.settings = settingsResult?.settings ?? null;
        state.runs = Array.isArray(runsResult?.runs) ? runsResult.runs : [];
        state.summary = summaryResult?.summary ?? null;
        state.backendReady = true;
        state.apiError = "";
        state.apiStatus = "后端监控接口已连接";
    } catch (error) {
        state.backendReady = false;
        state.apiStatus = "后端监控接口不可用";
        state.apiError = error instanceof Error ? error.message : String(error);
    } finally {
        state.isRefreshing = false;
        renderPanel();
    }
}

async function updateMonitorSettings(partialSettings) {
    state.isSaving = true;
    state.apiStatus = "正在保存设置";
    renderPanel();

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
        renderPanel();
    } finally {
        state.isSaving = false;
    }
}

async function clearBackendRuns() {
    const shouldClear = window.confirm("确认清空后台监控记录吗？这个操作会删除当前已保存的最近记录。");
    if (!shouldClear) {
        return;
    }

    state.isRefreshing = true;
    state.apiStatus = "正在清空后台监控记录";
    renderPanel();

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
        renderPanel();
    } finally {
        state.isRefreshing = false;
    }
}

function scheduleAutoRefresh() {
    if (state.refreshTimerId) {
        clearInterval(state.refreshTimerId);
        state.refreshTimerId = null;
    }

    const seconds = Math.max(5, Number(state.uiSettings.autoRefreshSeconds) || DEFAULT_UI_SETTINGS.autoRefreshSeconds);
    state.refreshTimerId = window.setInterval(() => {
        if (document.hidden) {
            return;
        }

        refreshBackendData({ silent: true });
    }, seconds * 1000);
}

function buildStatusHtml() {
    const permissionLevel = state.status?.permission_level || state.status?.effective_runtime_mode;
    const runtimeMode = state.settings?.runtime?.runtime_mode || state.status?.runtime_mode;

    return `
        <div class="stlp-mode-card">
            <div class="stlp-mode-title">后台监控状态</div>
            <div class="stlp-grid">
                <div><strong>接口状态</strong><span>${escapeHtml(state.apiStatus)}</span></div>
                <div><strong>错误信息</strong><span>${escapeHtml(state.apiError || "-")}</span></div>
                <div><strong>权限环境</strong><span>${escapeHtml(getPermissionLabel(permissionLevel))}</span></div>
                <div><strong>运行模式</strong><span>${escapeHtml(getRuntimeModeLabel(runtimeMode))}</span></div>
                <div><strong>只处理当前楼层</strong><span>${escapeHtml(formatBoolean(Boolean(state.status?.current_floor_only)))}</span></div>
                <div><strong>禁止历史楼层扫描</strong><span>${escapeHtml(formatBoolean(Boolean(state.status?.history_scan_forbidden)))}</span></div>
                <div><strong>已存监控记录</strong><span>${escapeHtml(state.status?.stored_runs ?? "-")}</span></div>
                <div><strong>自动刷新间隔</strong><span>${escapeHtml(`${state.uiSettings.autoRefreshSeconds} 秒`)}</span></div>
            </div>
        </div>
    `;
}

function buildSettingsHtml() {
    const displaySettings = state.settings?.display ?? {};
    const permissionLevel = state.status?.permission_level || state.status?.effective_runtime_mode || "no_backend";
    const disableEnhancedToggle = permissionLevel === "no_backend";

    return `
        <div class="stlp-settings-block">
            <div class="stlp-subtitle">异常显示</div>
            <div class="stlp-controls">
                <label class="checkbox_label">
                    <input id="stlp_show_abnormal_optimization_suggestions" type="checkbox" ${displaySettings.show_abnormal_optimization_suggestions ? "checked" : ""} ${state.isSaving ? "disabled" : ""} />
                    <span>显示异常优化建议</span>
                </label>
                <label class="checkbox_label">
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
                        <option value="failed_generation_only" ${displaySettings.abnormal_optimization_suggestion_scope === "failed_generation_only" ? "selected" : ""}>仅完整生成失败相关异常时显示</option>
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
        </div>
    `;
}

function buildSummaryHtml() {
    if (!state.summary) {
        return '<div class="stlp-empty">当前还没有可汇总的后台监控记录。</div>';
    }

    const abnormalCount = state.runs.filter(isAbnormalRun).length;

    return `
        <div class="stlp-mode-card">
            <div class="stlp-mode-title">最近汇总</div>
            <div class="stlp-grid">
                <div><strong>记录数</strong><span>${escapeHtml(state.summary.total_runs ?? "-")}</span></div>
                <div><strong>异常记录</strong><span>${escapeHtml(abnormalCount)}</span></div>
                <div><strong>平均总耗时</strong><span>${escapeHtml(formatMs(state.summary.avg_total_ms))}</span></div>
                <div><strong>平均预处理</strong><span>${escapeHtml(formatMs(state.summary.avg_preprocess_ms))}</span></div>
                <div><strong>平均上游响应头</strong><span>${escapeHtml(formatMs(state.summary.avg_upstream_headers_ms))}</span></div>
                <div><strong>平均首个输出返回</strong><span>${escapeHtml(formatMs(state.summary.avg_ttft_ms))}</span></div>
                <div><strong>平均流式输出</strong><span>${escapeHtml(formatMs(state.summary.avg_stream_ms))}</span></div>
            </div>
        </div>
    `;
}

function buildRunHtml(run, index) {
    const abnormalDetail = run?.abnormal_detail;
    const suggestions = abnormalDetail?.optimization_suggestions?.suggestions ?? [];
    const summaryLabel = isAbnormalRun(run) ? getAbnormalTypeLabel(abnormalDetail.abnormal_type) : "正常完成";
    const openAttr = index === 0 ? "open" : "";
    const statusBadgeClass = isAbnormalRun(run) ? "stlp-badge stlp-badge-abnormal" : "stlp-badge";
    const sourceLabel = run?.source ? `来源 ${run.source}` : "未记录来源";

    return `
        <details class="stlp-run ${isAbnormalRun(run) ? "stlp-run-abnormal" : ""}" ${openAttr}>
            <summary>
                <span>#${escapeHtml(shortenRunId(run?.id))}</span>
                <span>${escapeHtml(run?.model || "未记录模型")}</span>
                <span class="${statusBadgeClass}">${escapeHtml(summaryLabel)}</span>
                <span>总耗时 ${escapeHtml(formatMs(run?.metrics?.total_ms))}</span>
                <span>首个输出 ${escapeHtml(formatMs(run?.metrics?.ttft_ms))}</span>
                <span>${escapeHtml(sourceLabel)}</span>
            </summary>
            <div class="stlp-grid">
                <div><strong>模型</strong><span>${escapeHtml(run?.model || "-")}</span></div>
                <div><strong>来源</strong><span>${escapeHtml(run?.source || "-")}</span></div>
                <div><strong>开始时间</strong><span>${escapeHtml(run?.started_at_iso || "-")}</span></div>
                <div><strong>状态码</strong><span>${escapeHtml(run?.http_status ?? "-")}</span></div>
                <div><strong>总耗时</strong><span>${escapeHtml(formatMs(run?.metrics?.total_ms))}</span></div>
                <div><strong>预处理</strong><span>${escapeHtml(formatMs(run?.metrics?.preprocess_ms))}</span></div>
                <div><strong>上游响应头</strong><span>${escapeHtml(formatMs(run?.metrics?.upstream_headers_ms))}</span></div>
                <div><strong>首个输出返回</strong><span>${escapeHtml(formatMs(run?.metrics?.ttft_ms))}</span></div>
                <div><strong>流式输出</strong><span>${escapeHtml(formatMs(run?.metrics?.stream_ms))}</span></div>
                <div><strong>流式生成</strong><span>${escapeHtml(formatBoolean(Boolean(run?.stream)))}</span></div>
                <div><strong>提示词字符数</strong><span>${escapeHtml(run?.prompt_chars ?? "-")}</span></div>
                <div><strong>消息数</strong><span>${escapeHtml(run?.message_count ?? "-")}</span></div>
            </div>
            ${abnormalDetail ? `
                <div class="stlp-abnormal">
                    <div class="stlp-subtitle">异常详情</div>
                    <div class="stlp-grid">
                        <div><strong>失败原因</strong><span>${escapeHtml(getAbnormalTypeLabel(abnormalDetail.abnormal_type))}</span></div>
                        <div><strong>失败阶段</strong><span>${escapeHtml(getFailedStageLabel(abnormalDetail.failed_stage))}</span></div>
                        <div><strong>已有部分输出</strong><span>${escapeHtml(formatBoolean(Boolean(abnormalDetail.has_partial_output)))}</span></div>
                        <div><strong>建议权限环境</strong><span>${escapeHtml(getPermissionLabel(abnormalDetail.permission_level))}</span></div>
                    </div>
                    ${abnormalDetail.show_optimization_suggestions && suggestions.length ? `
                        <details class="stlp-suggestions">
                            <summary>${escapeHtml(abnormalDetail.optimization_suggestions.button_label || "查看优化建议")}</summary>
                            <div class="stlp-note">${escapeHtml(abnormalDetail.optimization_suggestions.section_title || "建议操作方向")}，当前按 ${getPermissionLabel(abnormalDetail.permission_level)} 裁剪显示。</div>
                            <ul class="stlp-suggestion-list">
                                ${suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                            </ul>
                        </details>
                    ` : '<div class="stlp-muted">当前异常未生成可显示的优化建议。</div>'}
                </div>
            ` : ''}
        </details>
    `;
}

function renderRuns() {
    const visibleRuns = state.uiSettings.abnormalOnly ? state.runs.filter(isAbnormalRun) : state.runs;

    if (!state.runs.length) {
        return '<div class="stlp-empty">当前还没有后台监控记录。发送一轮消息后，这里会显示最近 20 条生成详情。</div>';
    }

    if (!visibleRuns.length) {
        return '<div class="stlp-empty">当前筛选为“只看异常”，最近记录里没有命中的异常轮次。</div>';
    }

    const firstAbnormalIndex = visibleRuns.findIndex(isAbnormalRun);
    const defaultOpenIndex = firstAbnormalIndex >= 0 ? firstAbnormalIndex : 0;

    return visibleRuns.map((run, index) => buildRunHtml(run, index === defaultOpenIndex ? 0 : index + 1)).join("");
}

function renderPanel() {
    if (!state.panelReady) {
        return;
    }

    const statusRoot = document.querySelector("#stlp_status");
    const settingsRoot = document.querySelector("#stlp_settings");
    const summaryRoot = document.querySelector("#stlp_summary");
    const runsRoot = document.querySelector("#stlp_runs");
    const refreshButton = document.querySelector("#stlp_refresh_runs");
    const exportButton = document.querySelector("#stlp_export_runs");
    const clearButton = document.querySelector("#stlp_clear_runs");

    if (statusRoot) {
        statusRoot.innerHTML = buildStatusHtml();
    }

    if (settingsRoot) {
        settingsRoot.innerHTML = buildSettingsHtml();
    }

    if (summaryRoot) {
        summaryRoot.innerHTML = buildSummaryHtml();
    }

    if (runsRoot) {
        runsRoot.innerHTML = renderRuns();
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
}

function bindPanelEvents() {
    document.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.id === "stlp_show_abnormal_optimization_suggestions") {
            updateMonitorSettings({
                display: {
                    show_abnormal_optimization_suggestions: Boolean(target.checked),
                },
            });
        }

        if (target.id === "stlp_show_permission_enhanced_suggestions") {
            updateMonitorSettings({
                display: {
                    show_permission_enhanced_suggestions: Boolean(target.checked),
                },
            });
        }

        if (target.id === "stlp_abnormal_optimization_suggestion_scope") {
            updateMonitorSettings({
                display: {
                    abnormal_optimization_suggestion_scope: target.value,
                },
            });
        }

        if (target.id === "stlp_abnormal_optimization_suggestion_limit") {
            const parsed = Number(target.value);
            const nextValue = Number.isInteger(parsed) ? Math.max(2, Math.min(4, parsed)) : 3;
            target.value = String(nextValue);
            updateMonitorSettings({
                display: {
                    abnormal_optimization_suggestion_limit: nextValue,
                },
            });
        }

        if (target.id === "stlp_auto_refresh_seconds") {
            const parsed = Number(target.value);
            state.uiSettings.autoRefreshSeconds = Number.isFinite(parsed)
                ? Math.max(5, Math.min(120, parsed))
                : DEFAULT_UI_SETTINGS.autoRefreshSeconds;
            target.value = String(state.uiSettings.autoRefreshSeconds);
            saveUiSettings();
            scheduleAutoRefresh();
            renderPanel();
        }

        if (target.id === "stlp_abnormal_only") {
            state.uiSettings.abnormalOnly = Boolean(target.checked);
            saveUiSettings();
            renderPanel();
        }
    });

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (target.id === "stlp_refresh_runs") {
            refreshBackendData();
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
        }

        if (target.id === "stlp_clear_runs") {
            clearBackendRuns();
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
                    <div class="stlp-note">
                        当前面板优先读取后台监控接口，只处理当前楼层，不扫描任何历史楼层。异常轮次会在详情里显示“查看优化建议”。
                    </div>
                    <div class="stlp-actions">
                        <button id="stlp_refresh_runs" class="menu_button">刷新后台数据</button>
                        <button id="stlp_export_runs" class="menu_button">导出最近记录</button>
                        <button id="stlp_clear_runs" class="menu_button">清空后台记录</button>
                        <label class="checkbox_label stlp-inline-checkbox">
                            <input id="stlp_abnormal_only" type="checkbox" ${state.uiSettings.abnormalOnly ? "checked" : ""} />
                            <span>只看异常</span>
                        </label>
                    </div>
                    <div id="stlp_status"></div>
                    <div id="stlp_settings"></div>
                    <div id="stlp_summary"></div>
                    <div class="stlp-subtitle">最近记录</div>
                    <div id="stlp_runs" class="stlp-runs"></div>
                </div>
            </div>
        </div>
        `,
    );

    state.panelReady = true;
    renderPanel();
}

async function init() {
    try {
        bindPanelEvents();
        ensurePanel();
        scheduleAutoRefresh();
        await refreshBackendData();

        const observer = new MutationObserver(() => {
            ensurePanel();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    } catch (error) {
        state.apiStatus = "扩展初始化失败";
        state.apiError = error instanceof Error ? error.message : String(error);
        renderPanel();
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
