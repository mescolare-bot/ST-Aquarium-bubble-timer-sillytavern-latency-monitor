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
import {
    UNKNOWN_PLUGIN_ID,
    createLearnedPluginRuleFromRun,
    matchLearnedPluginRuleAgainstRun,
    mergeLearnedPluginRule,
    normalizeRuleList,
    shouldApplyLearnedRuleToRun,
    slugifyPluginId,
} from '../backend-monitor-minimal/shared/plugin-rule-match.js';
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
const PLUGIN_RULES_META_KEY = 'plugin-rules';

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

// slugifyPluginId 从 plugin-rule-match.js 引入，和后端同一份实现。

export async function readLitePluginRules() {
    return normalizeRuleList(await readMeta(PLUGIN_RULES_META_KEY, []));
}

async function writeLitePluginRules(rules) {
    const normalized = normalizeRuleList(rules);
    await writeMeta(PLUGIN_RULES_META_KEY, normalized);
    return normalized;
}

/**
 * 把一条规则套到已有记录上，命中的就地改判。
 * 和后端 backfillRunsWithLearnedRule 同义：打标之后，之前那些没认出来的同类记录也一起改。
 */
async function backfillLiteRunsWithRule(rule, excludedRunId = '') {
    if (!rule) {
        return { updatedCount: 0, updatedRunIds: [] };
    }

    const runs = await readAllRuns();
    const updatedRunIds = [];

    for (const run of runs) {
        if (!run || run.id === excludedRunId) {
            continue;
        }

        const match = matchLearnedPluginRuleAgainstRun(rule, run);
        if (!match || match.ruleId !== rule.id || !shouldApplyLearnedRuleToRun(run, match)) {
            continue;
        }

        await updateRunById(run.id, (existing) => ({
            ...existing,
            request_purpose: 'non_chat_generation',
            request_plugin: match.pluginId || UNKNOWN_PLUGIN_ID,
            request_plugin_label: match.pluginLabel,
            request_plugin_match_mode: match.matchMode,
            request_plugin_match_score: match.matchScore,
        }));
        updatedRunIds.push(run.id);
    }

    return { updatedCount: updatedRunIds.length, updatedRunIds };
}

/**
 * 给每条规则补上"命中多少条、已生效多少条、还能改判多少条"，字段名和后端
 * buildPluginRuleSummaries 对齐，面板的渲染代码两种形态共用。
 */
async function buildLitePluginRuleSummaries() {
    const rules = await readLitePluginRules();
    const runs = await readAllRuns();

    return rules.map((rule) => {
        let matchedRuns = 0;
        let activeRuns = 0;
        let pendingRuns = 0;

        for (const run of runs) {
            const match = matchLearnedPluginRuleAgainstRun(rule, run);
            if (!match || match.ruleId !== rule.id) {
                continue;
            }

            matchedRuns += 1;
            if (run.request_plugin_match_mode === 'learned_rule'
                && normalizeOptionalText(run.request_plugin_label) === rule.plugin_label
                && normalizeOptionalText(run.request_plugin) === rule.plugin_id) {
                activeRuns += 1;
            }
            if (shouldApplyLearnedRuleToRun(run, match)) {
                pendingRuns += 1;
            }
        }

        return {
            ...rule,
            matched_runs: matchedRuns,
            active_runs: activeRuns,
            pending_runs: pendingRuns,
            sample_count: Number(rule.sample_count) || (Array.isArray(rule.sample_run_ids) ? rule.sample_run_ids.length : 0),
        };
    }).sort((left, right) => {
        const leftUpdated = left.updated_at ? Date.parse(left.updated_at) : 0;
        const rightUpdated = right.updated_at ? Date.parse(right.updated_at) : 0;
        return rightUpdated - leftUpdated;
    });
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

// 条目结构和完整版的 waiting-queue.json 保持一致，面板读的是 entry.run_id / entry.created_at。
async function readWaitingQueueEntries() {
    const stored = await readMeta(WAITING_QUEUE_META_KEY, []);
    if (!Array.isArray(stored)) {
        return [];
    }

    const entries = [];
    for (const item of stored) {
        // 早期版本这里只存了一个 id 数组，加入时间当时就没记，补不出来，留空。
        const source = typeof item === 'string' ? { run_id: item } : item;
        const runId = normalizeOptionalText(source?.run_id);
        if (!runId) {
            continue;
        }
        entries.push({
            run_id: runId,
            created_at: normalizeOptionalText(source?.created_at) || '',
            status: normalizeOptionalText(source?.status) || 'pending',
            plugin_label: normalizeOptionalText(source?.plugin_label) || '',
            plugin_id: normalizeOptionalText(source?.plugin_id) || '',
        });
    }
    return entries;
}

async function writeWaitingQueueEntries(entries) {
    await writeMeta(WAITING_QUEUE_META_KEY, entries);
    return entries;
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
        // 这两条是对行为的声明，和完整版报一样的值：读楼层的代码在 index.js 里，两种装法共用同一份。
        // readCurrentGenerationFloor 只取 chat.length 和最后一个元素，是 O(1)；
        // readVisibleFloorLabels 只读已渲染消息上的 #N 标签，不碰消息内容。lite/ 自己完全接触不到 chat。
        // 早先这里写的是 false，而 current_floor_only 读的还是一个设置里根本不存在的键（恒为 false），
        // 于是精简版面板上这两行一直显示「否」，看起来像是保证被撤了，其实行为从来没变过。
        current_floor_only: true,
        history_scan_forbidden: true,
    };
}

async function handleWaitingQueue() {
    const entries = [];
    for (const entry of await readWaitingQueueEntries()) {
        entries.push({ ...entry, run: (await readRunById(entry.run_id)) ?? null });
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
        request_plugin: pluginId || UNKNOWN_PLUGIN_ID,
        request_plugin_label: pluginLabel,
        request_plugin_match_mode: 'manual_waiting_queue',
        request_plugin_match_score: 1,
    }));

    if (!updated) {
        throw new Error('Run not found.');
    }

    const queued = await readWaitingQueueEntries();
    await writeWaitingQueueEntries(queued.filter((entry) => entry.run_id !== runId));

    // 和后端同一套动作：把这次标注学成规则，再拿它去改判已有的同类记录。
    // 规则存 IndexedDB 的 meta，匹配逻辑和后端共用 plugin-rule-match.js。
    const learnedRule = createLearnedPluginRuleFromRun(updated, pluginLabel, pluginId, runId);
    let savedRule = null;
    let backfill = { updatedCount: 0, updatedRunIds: [] };

    if (learnedRule) {
        const merged = mergeLearnedPluginRule(await readLitePluginRules(), learnedRule);
        if (merged.rule) {
            await writeLitePluginRules(merged.rules);
            savedRule = merged.rule;
            backfill = await backfillLiteRunsWithRule(savedRule, runId);
        }
    }

    return {
        ok: true,
        run: updated,
        // 老记录没有 prompt 特征（那是这个版本才开始存的），学不出规则，
        // 这里就会是 null。如实返回，不要让面板以为规则已经建好了。
        rule: savedRule,
        backfilled_runs: backfill.updatedCount,
        backfilled_run_ids: backfill.updatedRunIds,
    };
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
            // 和完整版一致：记录不存在就拒绝，别往队列里塞一个指不到记录的条目。
            if (!(await readRunById(runId))) {
                throw new Error('Run not found.');
            }

            const entries = await readWaitingQueueEntries();
            const existing = entries.find((entry) => entry.run_id === runId);
            if (existing) {
                return { ok: true, entry: existing };
            }

            const nextEntry = {
                run_id: runId,
                created_at: new Date().toISOString(),
                status: 'pending',
                plugin_label: '',
                plugin_id: '',
            };
            await writeWaitingQueueEntries([nextEntry, ...entries]);
            return { ok: true, entry: nextEntry };
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
        const entries = await readWaitingQueueEntries();
        const nextEntries = entries.filter((entry) => entry.run_id !== runId);
        const removed = nextEntries.length !== entries.length;
        if (removed) {
            await writeWaitingQueueEntries(nextEntries);
        }
        return { ok: true, removed, run_id: runId };
    }

    // 规则的匹配算法是纯逻辑，和后端共用 plugin-rule-match.js；
    // 差别只在存哪儿——后端是 plugin-rules.json，这里是 IndexedDB 的 meta。
    if (pathname === '/plugin-rules') {
        const rules = await buildLitePluginRuleSummaries();
        return { ok: true, count: rules.length, rules };
    }

    if (pathname.startsWith('/plugin-rules/')) {
        const rest = pathname.slice('/plugin-rules/'.length);

        if (rest.endsWith('/reapply')) {
            const ruleId = decodeURIComponent(rest.slice(0, -'/reapply'.length));
            const rule = (await readLitePluginRules()).find((item) => item.id === ruleId) ?? null;
            if (!rule) {
                throw new Error('Rule not found.');
            }

            const backfill = await backfillLiteRunsWithRule(rule);
            return {
                ok: true,
                rule,
                matched_runs: backfill.updatedCount,
                matched_run_ids: backfill.updatedRunIds,
            };
        }

        const ruleId = decodeURIComponent(rest);
        const rules = await readLitePluginRules();
        const index = rules.findIndex((item) => item.id === ruleId);
        if (index < 0) {
            throw new Error('Rule not found.');
        }

        if (method === 'DELETE') {
            const removed = rules[index];
            await writeLitePluginRules(rules.filter((item) => item.id !== ruleId));
            return { ok: true, removed: true, rule: removed };
        }

        if (method === 'PATCH') {
            const nextRules = [...rules];
            nextRules[index] = {
                ...nextRules[index],
                enabled: body?.enabled !== false,
                updated_at: new Date().toISOString(),
            };
            const saved = await writeLitePluginRules(nextRules);
            return { ok: true, rule: saved.find((item) => item.id === ruleId) ?? nextRules[index] };
        }

        return { ok: true, rule: rules[index] };
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
