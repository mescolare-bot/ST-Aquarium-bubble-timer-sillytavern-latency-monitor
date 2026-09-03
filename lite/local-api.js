// 精简模式下顶替后端插件的本地路由。
//
// 返回结构和后端逐字段对齐，这样面板的渲染代码一行都不用改；
// 筛选和聚合直接复用 shared/run-query.js，和后端跑的是同一份实现。
//
// 没有实现的两个接口（插件规则、强制停止诊断）都显式返回 supported: false，
// 而不是假装成功——静默的空数据比一个明确的"不支持"难查得多。

import {
    buildDailySummary,
    buildSummary,
    filterRunsByAbnormal,
    filterRunsByCacheHit,
    filterRunsByChatKey,
    filterRunsByPurpose,
    normalizeOptionalText,
    readRequestedFlag,
    toClientRuns,
} from '../backend-monitor-minimal/shared/run-query.js';
import { cloneMonitorSettingsDefaults } from '../backend-monitor-minimal/settings-ui/config/monitor-settings-default.js';
import {
    inferPermissionLevelFromHost,
    normalizeMonitorSettings,
    resolvePermissionLevel,
} from '../backend-monitor-minimal/settings-ui/service/monitor-settings-validator.js';
import {
    clearRuns,
    countRuns,
    readAllRuns,
    readArchivedRunStubs,
    readMeta,
    readRunById,
    updateRunById,
    writeMeta,
} from './run-store.js';

const MAX_RUNS_PAGE_LIMIT = 2000;
const SETTINGS_META_KEY = 'settings';
const WAITING_QUEUE_META_KEY = 'waiting-queue';

// 和后端 readRequestedPurpose 保持一致：只认这三个值，其余按"不筛选"处理。
function readRequestedPurpose(value) {
    if (value === 'chat_main_reply' || value === 'non_chat_generation' || value === 'plugin_internal_request') {
        return value;
    }
    return '';
}

function readRequestedChatKey(value) {
    return normalizeOptionalText(value, 200) || '';
}

function slugifyPluginId(value) {
    return normalizeOptionalText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export async function readLiteSettings() {
    const stored = await readMeta(SETTINGS_META_KEY, null);
    return stored ? normalizeMonitorSettings(stored) : cloneMonitorSettingsDefaults();
}

async function writeLiteSettings(patch) {
    const current = await readLiteSettings();
    const merged = normalizeMonitorSettings({ ...current, ...(patch ?? {}) });
    await writeMeta(SETTINGS_META_KEY, merged);
    return merged;
}

function resolveLitePermissionLevel(settings) {
    // 拿不到 host 时按云端处理：local_full 会多给一批"去改服务端配置"的建议，
    // 对着一个其实没有服务器权限的用户说这些是帮倒忙。
    let inferred = 'cloud_full';
    try {
        const host = typeof location === 'object' ? location.hostname : '';
        inferred = inferPermissionLevelFromHost(host, 'cloud_full');
    } catch {
        // 保持 cloud_full。
    }
    return resolvePermissionLevel(settings, inferred);
}

async function readWaitingQueueIds() {
    const stored = await readMeta(WAITING_QUEUE_META_KEY, []);
    return Array.isArray(stored) ? stored : [];
}

async function writeWaitingQueueIds(ids) {
    await writeMeta(WAITING_QUEUE_META_KEY, ids);
    return ids;
}

function parseTarget(rawPath) {
    const [pathname, search = ''] = String(rawPath).split('?');
    const query = {};
    for (const [key, value] of new URLSearchParams(search).entries()) {
        query[key] = value;
    }
    return { pathname, query };
}

function parseBody(options) {
    if (typeof options?.body !== 'string') {
        return {};
    }
    try {
        return JSON.parse(options.body) ?? {};
    } catch {
        return {};
    }
}

async function handleRuns(query) {
    const limit = Math.max(1, Math.min(MAX_RUNS_PAGE_LIMIT, Number(query.limit) || 50));
    const offset = Math.max(0, Number(query.offset) || 0);
    const requestedPurpose = readRequestedPurpose(query.request_purpose);
    const requestedChatKey = readRequestedChatKey(query.request_chat_key);
    const abnormalOnly = readRequestedFlag(query.abnormal_only);
    const cacheHitOnly = readRequestedFlag(query.cache_hit);
    const includePromptBreakdown = readRequestedFlag(query.include_prompt_breakdown);

    const allRuns = await readAllRuns();
    const filteredRuns = filterRunsByCacheHit(
        filterRunsByAbnormal(
            filterRunsByChatKey(filterRunsByPurpose(allRuns, requestedPurpose), requestedChatKey),
            abnormalOnly,
        ),
        cacheHitOnly,
    );
    const runs = toClientRuns(filteredRuns.slice(offset, offset + limit), includePromptBreakdown);

    return {
        ok: true,
        total: filteredRuns.length,
        count: runs.length,
        limit,
        max_limit: MAX_RUNS_PAGE_LIMIT,
        offset,
        request_purpose: requestedPurpose || null,
        request_chat_key: requestedChatKey || null,
        abnormal_only: abnormalOnly,
        cache_hit: cacheHitOnly,
        include_prompt_breakdown: includePromptBreakdown,
        runs,
    };
}

async function handleSummary(query) {
    const limit = Math.max(1, Math.min(500, Number(query.limit) || 200));
    const requestedPurpose = readRequestedPurpose(query.request_purpose);
    const requestedChatKey = readRequestedChatKey(query.request_chat_key);
    const groupBy = normalizeOptionalText(query.group_by);
    const days = Math.max(1, Math.min(365, Number(query.days) || 14));

    const allRuns = await readAllRuns();
    // 日聚合要覆盖超额后被归档的日子，所以额外把存根接上；
    // 明细列表不接，存根里没有列表要显示的东西。
    const dailySource = groupBy === 'day'
        ? (await readArchivedRunStubs()).concat(allRuns)
        : allRuns.slice(0, limit);
    const runs = filterRunsByChatKey(
        filterRunsByPurpose(dailySource, requestedPurpose),
        requestedChatKey,
    );
    const settings = await readLiteSettings();

    return {
        ok: true,
        summary: buildSummary(runs),
        daily_summary: groupBy === 'day' ? buildDailySummary(runs, days) : null,
        permission_level: resolveLitePermissionLevel(settings),
        request_purpose: requestedPurpose || null,
        request_chat_key: requestedChatKey || null,
    };
}

async function handleStatus() {
    const settings = await readLiteSettings();
    const permissionLevel = resolveLitePermissionLevel(settings);

    return {
        ok: true,
        // 精简模式压根不需要本体补丁，用 not_required 让面板不要弹"补丁没装"的警告。
        patch_state: 'not_required',
        patch_present_count: null,
        patch_total: null,
        patch_missing: [],
        plugin: 'st-latency-monitor-lite',
        version: 'lite',
        record_source: 'frontend',
        stored_runs: await countRuns(),
        log_file: 'IndexedDB: st-latency-monitor',
        settings_file: 'IndexedDB: st-latency-monitor / meta',
        runtime_mode: settings?.runtime?.runtime_mode ?? 'auto',
        effective_runtime_mode: permissionLevel,
        detected_permission_level: permissionLevel,
        permission_level: permissionLevel,
        current_floor_only: Boolean(settings?.runtime?.current_floor_only),
        history_scan_forbidden: false,
    };
}

async function handleWaitingQueue() {
    const ids = await readWaitingQueueIds();
    const entries = [];
    for (const id of ids) {
        const run = await readRunById(id);
        if (run) {
            entries.push(run);
        }
    }
    return { ok: true, count: entries.length, entries };
}

async function handleWaitingQueueLabel(runId, body) {
    const pluginLabel = normalizeOptionalText(body?.plugin_label);
    if (!pluginLabel) {
        throw new Error('plugin_label is required.');
    }
    const pluginId = slugifyPluginId(body?.plugin_id || pluginLabel);

    const updated = await updateRunById(runId, (run) => ({
        ...run,
        request_purpose: 'non_chat_generation',
        request_plugin: pluginId || 'unknown_plugin',
        request_plugin_label: pluginLabel,
        request_plugin_match_mode: 'manual_waiting_queue',
        request_plugin_match_score: 1,
    }));

    if (!updated) {
        throw new Error('Run not found.');
    }

    const ids = await readWaitingQueueIds();
    await writeWaitingQueueIds(ids.filter((id) => id !== runId));

    // 后端在这里还会把标注学成一条插件规则，用来给之后没标注的请求兜底。
    // 精简模式没有规则库，所以只改这一条记录，rule 显式给 null。
    return { ok: true, run: updated, rule: null };
}

/**
 * 返回 null 表示这个路径本地不接管，调用方应该照常走网络。
 */
export async function handleLocalRequest(rawPath, options = {}) {
    const method = String(options.method ?? 'GET').toUpperCase();
    const { pathname, query } = parseTarget(rawPath);
    const body = parseBody(options);

    if (pathname === '/status') {
        return handleStatus();
    }

    if (pathname === '/settings') {
        if (method === 'POST') {
            return { ok: true, settings: await writeLiteSettings(body) };
        }
        return { ok: true, settings: await readLiteSettings() };
    }

    if (pathname === '/runs') {
        if (method === 'DELETE') {
            const scope = query.scope === 'normal_only' ? 'normal_only' : 'all';
            const runIds = Array.isArray(body?.run_ids)
                ? Array.from(new Set(body.run_ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())))
                : [];
            const result = await clearRuns(scope, runIds);
            return {
                ok: true,
                scope,
                cleared_count: result.deletedCount,
                remaining_count: result.remainingCount,
                selected_count: result.selectedCount,
            };
        }
        return handleRuns(query);
    }

    if (pathname.startsWith('/runs/')) {
        const id = decodeURIComponent(pathname.slice('/runs/'.length));
        const run = await readRunById(id);
        if (!run) {
            throw new Error('Run not found.');
        }
        return { ok: true, run };
    }

    if (pathname === '/summary') {
        return handleSummary(query);
    }

    if (pathname === '/waiting-queue') {
        if (method === 'POST') {
            const runId = normalizeOptionalText(body?.run_id);
            if (!runId) {
                throw new Error('run_id is required.');
            }
            const ids = await readWaitingQueueIds();
            if (!ids.includes(runId)) {
                await writeWaitingQueueIds([...ids, runId]);
            }
            return { ok: true, entry: await readRunById(runId) };
        }
        return handleWaitingQueue();
    }

    if (pathname.startsWith('/waiting-queue/')) {
        const rest = pathname.slice('/waiting-queue/'.length);
        if (rest.endsWith('/label')) {
            const runId = decodeURIComponent(rest.slice(0, -'/label'.length));
            return handleWaitingQueueLabel(runId, body);
        }
        const runId = decodeURIComponent(rest);
        const ids = await readWaitingQueueIds();
        const removed = ids.includes(runId);
        await writeWaitingQueueIds(ids.filter((id) => id !== runId));
        return { ok: true, removed, run_id: runId };
    }

    // 插件规则依赖服务端的哈希与规则学习，精简模式没有。显式说明而不是返回空数组，
    // 否则面板会表现得像"一条规则都没学到"，让人以为是功能坏了。
    if (pathname.startsWith('/plugin-rules')) {
        return { ok: true, supported: false, rules: [], reason: 'lite_mode_backend_required' };
    }

    // 精简模式下前端自己就知道是不是用户按的停止，不需要给后端发信号。
    if (pathname === '/client-stop-signal') {
        return { ok: true, supported: false, reason: 'lite_mode_not_needed' };
    }

    if (pathname === '/force-stop-diagnostics') {
        return { ok: true, supported: false, reason: 'lite_mode_not_implemented' };
    }

    return null;
}
