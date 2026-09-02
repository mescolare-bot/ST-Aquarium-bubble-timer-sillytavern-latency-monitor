import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

import { getMonitorRuntimeStatus } from '../settings-ui/service/monitor-runtime-status.js';
import {
    chatCompletionsPatchTarget,
    inspectChatCompletionsPatches,
} from '../shared/chat-completions-patch.js';
import {
    getMonitorSettingsFilePath,
    readMonitorSettings,
    updateMonitorSettings,
} from '../settings-ui/service/monitor-settings-store.js';
import {
    createLearnedPluginRuleFromRun,
    matchLearnedPluginRuleAgainstRun,
    readPluginRuleByIdSync,
    readPluginRulesSync,
    removeLearnedPluginRule,
    setLearnedPluginRuleEnabled,
    upsertLearnedPluginRule,
} from '../shared/plugin-rule-service.js';
import {
    buildDailySummary,
    buildSummary,
    filterRunsByAbnormal,
    filterRunsByCacheHit,
    filterRunsByChatKey,
    filterRunsByPurpose,
    normalizeOptionalText,
    normalizeRequestPurpose,
    normalizeUsageValue,
    readRequestedFlag,
    toClientRun,
    toClientRuns,
} from '../shared/run-query.js';

const LOG_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const LOG_FILE = path.join(LOG_DIR, 'runs.jsonl');
const WAITING_QUEUE_FILE = path.join(LOG_DIR, 'waiting-queue.json');
const PLUGIN_RULE_CANDIDATES_FILE = path.join(LOG_DIR, 'plugin-rule-candidates.jsonl');
const FORCE_STOP_DIAGNOSTICS_FILE = path.join(LOG_DIR, 'force-stop-diagnostics.jsonl');
// 前端在真正中止之前先把生成 id 写进来，latency-monitor 落盘时据此区分
// "用户自己停的" 和 "连接意外断了"——两者的错误文本完全一样，服务端只能靠这个分辨。
const CLIENT_STOP_SIGNALS_FILE = path.join(LOG_DIR, 'client-stop-signals.json');
const CLIENT_STOP_SIGNAL_TTL_MS = 5 * 60 * 1000;

// 诊断记录只在用户手动点"终止生成"时写入，正常一次就几 KB。
// 上限用来挡住前端意外把大对象塞进来，避免重演 frontend-debug.jsonl 涨到 64MB 的旧事。
const MAX_FORCE_STOP_DIAGNOSTICS_BYTES = 32 * 1024;

// 剥掉 prompt_breakdown 之后单条 run 约 1.5KB，这里仍然保留上限：
// 全量 5000+ 条一次返回依然是好几 MB，没有任何视图需要这么多。
// 筛选已经下沉到服务端，命中筛选后的结果集远小于这个上限。
const MAX_RUNS_PAGE_LIMIT = 2000;

// 本体源码有一百多 KB，而 /status 是前端轮询的接口，不能每次都整个读一遍。
// 按 mtime 缓存：文件没动就直接用上次的结论，动过了才重新读。
let patchInspectionCache = { mtimeMs: -1, result: null };

// 只装了前端、没打本体补丁时，面板一切正常但记录永远是空的，而且不报任何错。
// 这是这个项目最容易踩的坑，所以让服务端自己把它检出来，别再靠文档提醒。
async function inspectInstalledPatches() {
    const target = path.join(process.cwd(), ...chatCompletionsPatchTarget.split('/'));

    try {
        const { mtimeMs } = await fs.stat(target);
        if (mtimeMs !== patchInspectionCache.mtimeMs) {
            patchInspectionCache = {
                mtimeMs,
                result: inspectChatCompletionsPatches(await fs.readFile(target, 'utf8')),
            };
        }
        return patchInspectionCache.result;
    } catch {
        // 读不到本体源码（权限或路径不对）时不猜，让前端按"未知"处理。
        return null;
    }
}


function slugifyPluginId(value) {
    const normalized = normalizeOptionalText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || '';
}


function readRequestedPurpose(value) {
    if (value === 'chat_main_reply' || value === 'non_chat_generation' || value === 'plugin_internal_request') {
        return value;
    }

    return '';
}

function readRequestedChatKey(value) {
    return normalizeOptionalText(value, 200) || '';
}


async function readRunEntries() {
    try {
        const content = await fs.readFile(LOG_FILE, 'utf8');
        return content
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
                try {
                    return {
                        line,
                        run: JSON.parse(line),
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

async function rewriteRunEntries(entries) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const nextContent = entries.map((entry) => entry.line).join('\n');
    await fs.writeFile(LOG_FILE, nextContent ? `${nextContent}\n` : '', 'utf8');
}

async function readRuns(limit = 50, offset = 0) {
    try {
        const entries = await readRunEntries();
        const lines = entries.map((entry) => entry.line);
        const safeOffset = Math.max(0, Number(offset) || 0);
        const endIndex = Math.max(0, lines.length - safeOffset);
        const startIndex = Math.max(0, endIndex - limit);

        return entries
            .slice(startIndex, endIndex)
            .reverse()
            .map((entry) => entry.run);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

async function readAllRuns() {
    const entries = await readRunEntries();
    return entries
        .map((entry) => entry?.run)
        .filter(Boolean)
        .reverse();
}

async function readRunById(runId) {
    if (typeof runId !== 'string' || !runId.length) {
        return null;
    }

    const runs = await readRuns(500);
    return runs.find((run) => run?.id === runId) ?? null;
}

async function updateRunById(runId, updater) {
    if (typeof runId !== 'string' || !runId.trim() || typeof updater !== 'function') {
        return null;
    }

    const entries = await readRunEntries();
    let updatedRun = null;
    const nextEntries = entries.map((entry) => {
        if (entry?.run?.id !== runId) {
            return entry;
        }

        const nextRun = updater({ ...entry.run });
        if (!nextRun || typeof nextRun !== 'object') {
            return entry;
        }

        updatedRun = nextRun;
        return {
            line: JSON.stringify(nextRun),
            run: nextRun,
        };
    });

    if (!updatedRun) {
        return null;
    }

    await rewriteRunEntries(nextEntries);
    return updatedRun;
}

async function countRuns() {
    const entries = await readRunEntries();
    return entries.length;
}

function normalizeRunIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(new Set(
        value
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
    ));
}

function shouldDeleteRun(entry, scope, selectedRunIds) {
    const runId = entry.run?.id;
    const selectedOnly = selectedRunIds.length > 0;
    if (selectedOnly && (!runId || !selectedRunIds.includes(runId))) {
        return false;
    }

    if (scope === 'normal_only') {
        return !entry.run?.abnormal_detail?.abnormal_type;
    }

    return true;
}

async function clearRuns(scope = 'all', selectedRunIds = []) {
    const entries = await readRunEntries();
    const existingRuns = entries.length;
    const normalizedRunIds = normalizeRunIds(selectedRunIds);

    try {
        await fs.mkdir(LOG_DIR, { recursive: true });
        const keptEntries = entries.filter((entry) => !shouldDeleteRun(entry, scope, normalizedRunIds));
        const nextContent = keptEntries.map((entry) => entry.line).join('\n');
        await fs.writeFile(LOG_FILE, nextContent ? `${nextContent}\n` : '', 'utf8');
        return {
            deletedCount: existingRuns - keptEntries.length,
            remainingCount: keptEntries.length,
            selectedCount: normalizedRunIds.length,
        };
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return {
                deletedCount: 0,
                remainingCount: 0,
                selectedCount: normalizedRunIds.length,
            };
        }

        throw error;
    }
}

async function readWaitingQueueEntries() {
    try {
        const raw = await fs.readFile(WAITING_QUEUE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter((item) => typeof item?.run_id === 'string' && item.run_id.trim()).map((item) => ({
            run_id: item.run_id.trim(),
            created_at: normalizeOptionalText(item.created_at) || new Date().toISOString(),
            status: normalizeOptionalText(item.status) || 'pending',
            plugin_label: normalizeOptionalText(item.plugin_label),
            plugin_id: normalizeOptionalText(item.plugin_id),
        }));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

async function writeWaitingQueueEntries(entries) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.writeFile(WAITING_QUEUE_FILE, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

async function addWaitingQueueEntry(runId) {
    const run = await readRunById(runId);
    if (!run) {
        throw new Error('Run not found.');
    }

    const entries = await readWaitingQueueEntries();
    const existingEntry = entries.find((entry) => entry.run_id === runId);
    if (existingEntry) {
        return existingEntry;
    }

    const nextEntry = {
        run_id: runId,
        created_at: new Date().toISOString(),
        status: 'pending',
        plugin_label: '',
        plugin_id: '',
    };
    entries.unshift(nextEntry);
    await writeWaitingQueueEntries(entries);
    return nextEntry;
}

async function removeWaitingQueueEntry(runId) {
    const entries = await readWaitingQueueEntries();
    const nextEntries = entries.filter((entry) => entry.run_id !== runId);
    const changed = nextEntries.length !== entries.length;
    if (changed) {
        await writeWaitingQueueEntries(nextEntries);
    }
    return changed;
}

async function appendPluginRuleCandidate(candidate) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(PLUGIN_RULE_CANDIDATES_FILE, `${JSON.stringify(candidate)}\n`, 'utf8');
}

async function appendForceStopDiagnostics(record) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(FORCE_STOP_DIAGNOSTICS_FILE, `${JSON.stringify(record)}\n`, 'utf8');
}

// 这里是唯一的写者，latency-monitor 那侧只读，所以不需要额外的并发保护。
// 每次写入顺带丢掉过期项，文件长期只有个位数条目。
async function recordClientStopSignal(clientGenerationId) {
    await fs.mkdir(LOG_DIR, { recursive: true });

    let current = {};
    try {
        const parsed = JSON.parse(await fs.readFile(CLIENT_STOP_SIGNALS_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            current = parsed;
        }
    } catch {
        // 文件不存在或内容损坏都当作空表重建。
    }

    const nowMs = Date.now();
    const next = {};
    for (const [id, at] of Object.entries(current)) {
        if (Number.isFinite(at) && nowMs - at < CLIENT_STOP_SIGNAL_TTL_MS) {
            next[id] = at;
        }
    }
    next[clientGenerationId] = nowMs;

    await fs.writeFile(CLIENT_STOP_SIGNALS_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function readWaitingQueueRuns() {
    const queueEntries = await readWaitingQueueEntries();
    if (!queueEntries.length) {
        return [];
    }

    const runs = await readRuns(1000000, 0);
    const runMap = new Map(runs.map((run) => [run?.id, run]));

    return queueEntries.map((entry) => ({
        ...entry,
        run: toClientRun(runMap.get(entry.run_id) ?? null),
    }));
}

function shouldApplyLearnedRuleToRun(run, match) {
    if (!run || !match?.pluginLabel) {
        return false;
    }

    const normalizedPurpose = normalizeRequestPurpose(run.request_purpose);
    const currentMatchMode = normalizeOptionalText(run.request_plugin_match_mode);
    const currentPlugin = normalizeOptionalText(run.request_plugin);
    const currentPluginLabel = normalizeOptionalText(run.request_plugin_label);

    if (currentMatchMode === 'explicit' || currentMatchMode === 'fingerprint' || currentMatchMode === 'manual_waiting_queue') {
        return false;
    }

    if (normalizedPurpose === 'non_chat_generation'
        && currentPlugin
        && currentPlugin !== 'unknown_plugin'
        && currentPluginLabel
        && currentPluginLabel !== match.pluginLabel) {
        return false;
    }

    return true;
}

async function backfillRunsWithLearnedRule(rule, excludedRunId = '') {
    if (!rule) {
        return {
            updatedCount: 0,
            updatedRuns: [],
        };
    }

    const entries = await readRunEntries();
    const updatedRuns = [];
    const nextEntries = entries.map((entry) => {
        const run = entry?.run;
        if (!run || run.id === excludedRunId) {
            return entry;
        }

        const match = matchLearnedPluginRuleAgainstRun(rule, run);
        if (!match || match.ruleId !== rule.id || !shouldApplyLearnedRuleToRun(run, match)) {
            return entry;
        }

        const updatedRun = {
            ...run,
            request_purpose: 'non_chat_generation',
            request_plugin: match.pluginId || 'unknown_plugin',
            request_plugin_label: match.pluginLabel,
            request_plugin_match_mode: match.matchMode,
            request_plugin_match_score: match.matchScore,
        };
        updatedRuns.push(updatedRun);
        return {
            line: JSON.stringify(updatedRun),
            run: updatedRun,
        };
    });

    if (!updatedRuns.length) {
        return {
            updatedCount: 0,
            updatedRuns: [],
        };
    }

    await rewriteRunEntries(nextEntries);
    return {
        updatedCount: updatedRuns.length,
        updatedRuns,
    };
}

async function buildPluginRuleSummaries() {
    const rules = readPluginRulesSync();
    const entries = await readRunEntries();
    const runs = entries.map((entry) => entry?.run).filter(Boolean);

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

function normalizeModelName(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : '';
}


function normalizeOptionalPricingValue(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function hasConfiguredPricingValue(config) {
    return [
        'input_price_per_million',
        'cached_input_price_per_million',
        'output_price_per_million',
        'peak_input_price_per_million',
        'peak_cached_input_price_per_million',
        'peak_output_price_per_million',
        'valley_input_price_per_million',
        'valley_cached_input_price_per_million',
        'valley_output_price_per_million',
    ].some((fieldName) => normalizeOptionalPricingValue(config?.[fieldName]) !== null);
}

function hasUsageData(run) {
    return normalizeUsageValue(run?.response_usage?.prompt_tokens) !== null
        || normalizeUsageValue(run?.response_usage?.completion_tokens) !== null
        || normalizeUsageValue(run?.response_usage?.total_tokens) !== null;
}

async function readPricingModelCatalog() {
    const settings = await readMonitorSettings();
    const configuredModelPrices = settings?.pricing?.model_prices && typeof settings.pricing.model_prices === 'object'
        ? settings.pricing.model_prices
        : {};
    const entries = await readRunEntries();
    const modelMap = new Map();

    for (const entry of entries) {
        const run = entry?.run;
        const modelName = normalizeModelName(run?.model);
        if (!modelName) {
            continue;
        }

        const current = modelMap.get(modelName) ?? {
            model: modelName,
            run_count: 0,
            supports_usage: false,
            last_seen_at: run?.started_at_iso || null,
        };

        current.run_count += 1;
        current.supports_usage = current.supports_usage || hasUsageData(run);

        if (!current.last_seen_at && run?.started_at_iso) {
            current.last_seen_at = run.started_at_iso;
        }

        modelMap.set(modelName, current);
    }

    for (const [modelName, config] of Object.entries(configuredModelPrices)) {
        const normalizedModelName = normalizeModelName(modelName);
        if (!normalizedModelName) {
            continue;
        }

        const current = modelMap.get(normalizedModelName) ?? {
            model: normalizedModelName,
            run_count: 0,
            supports_usage: false,
            last_seen_at: null,
        };

        current.configured = true;
        current.supports_usage = current.supports_usage
            || hasConfiguredPricingValue(config);

        modelMap.set(normalizedModelName, current);
    }

    return Array.from(modelMap.values()).sort((left, right) => {
        const leftSeen = left.last_seen_at ? Date.parse(left.last_seen_at) : 0;
        const rightSeen = right.last_seen_at ? Date.parse(right.last_seen_at) : 0;
        return rightSeen - leftSeen || left.model.localeCompare(right.model);
    });
}


export async function init(router) {
    router.use(express.json({ limit: '256kb' }));

    router.get('/status', async (req, res) => {
        const storedRuns = await countRuns();
        const runtimeStatus = await getMonitorRuntimeStatus(req);
        const patchStatus = await inspectInstalledPatches();
        res.json({
            ok: true,
            patch_state: patchStatus?.state ?? 'unknown',
            patch_present_count: patchStatus?.present_count ?? null,
            patch_total: patchStatus?.total ?? null,
            patch_missing: patchStatus?.missing ?? [],
            plugin: info.id,
            version: info.version,
            stored_runs: storedRuns,
            log_file: 'data/default-user/latency-monitor/runs.jsonl',
            settings_file: path.relative(process.cwd(), getMonitorSettingsFilePath()).replace(/\\/g, '/'),
            runtime_mode: runtimeStatus.runtime_mode,
            effective_runtime_mode: runtimeStatus.effective_runtime_mode,
            detected_permission_level: runtimeStatus.detected_permission_level,
            permission_level: runtimeStatus.permission_level,
            current_floor_only: runtimeStatus.current_floor_only,
            history_scan_forbidden: runtimeStatus.history_scan_forbidden,
        });
    });

    router.get('/settings', async (_req, res) => {
        const settings = await readMonitorSettings();
        res.json({
            ok: true,
            settings,
        });
    });

    router.get('/pricing-models', async (_req, res) => {
        const models = await readPricingModelCatalog();
        res.json({
            ok: true,
            models,
        });
    });

    router.post('/settings', async (req, res) => {
        try {
            const settings = await updateMonitorSettings(req.body ?? {});
            res.json({
                ok: true,
                settings,
            });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.get('/runs', async (req, res) => {
        const limit = Math.max(1, Math.min(MAX_RUNS_PAGE_LIMIT, Number(req.query.limit) || 50));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const requestedPurpose = readRequestedPurpose(req.query.request_purpose);
        const requestedChatKey = readRequestedChatKey(req.query.request_chat_key);
        const abnormalOnly = readRequestedFlag(req.query.abnormal_only);
        const cacheHitOnly = readRequestedFlag(req.query.cache_hit);
        const includePromptBreakdown = readRequestedFlag(req.query.include_prompt_breakdown);
        const allRuns = await readRuns(1000000, 0);
        const filteredRuns = filterRunsByCacheHit(
            filterRunsByAbnormal(
                filterRunsByChatKey(filterRunsByPurpose(allRuns, requestedPurpose), requestedChatKey),
                abnormalOnly,
            ),
            cacheHitOnly,
        );
        const total = filteredRuns.length;
        const runs = toClientRuns(filteredRuns.slice(offset, offset + limit), includePromptBreakdown);
        res.json({
            ok: true,
            total,
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
        });
    });

    router.delete('/runs', async (req, res) => {
        try {
            const scope = req.query.scope === 'normal_only' ? 'normal_only' : 'all';
            const runIds = normalizeRunIds(req.body?.run_ids);
            const result = await clearRuns(scope, runIds);
            res.json({
                ok: true,
                scope,
                cleared_count: result.deletedCount,
                remaining_count: result.remainingCount,
                selected_count: result.selectedCount,
            });
        } catch (error) {
            res.status(500).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    // 单条详情按需返回完整 run，包含列表接口已经剥掉的 prompt_breakdown。
    router.get('/runs/:id', async (req, res) => {
        const run = await readRunById(req.params.id);
        if (!run) {
            return res.status(404).json({
                ok: false,
                error: 'Run not found.',
            });
        }

        return res.json({
            ok: true,
            run,
        });
    });

    router.get('/summary', async (req, res) => {
        const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
        const requestedPurpose = readRequestedPurpose(req.query.request_purpose);
        const requestedChatKey = readRequestedChatKey(req.query.request_chat_key);
        const groupBy = normalizeOptionalText(req.query.group_by);
        const days = Math.max(1, Math.min(365, Number(req.query.days) || 14));
        const runs = filterRunsByChatKey(
            filterRunsByPurpose(
                groupBy === 'day' ? await readAllRuns() : await readRuns(limit),
                requestedPurpose,
            ),
            requestedChatKey,
        );
        const runtimeStatus = await getMonitorRuntimeStatus(req);
        res.json({
            ok: true,
            summary: buildSummary(runs),
            daily_summary: groupBy === 'day' ? buildDailySummary(runs, days) : null,
            permission_level: runtimeStatus.permission_level,
            request_purpose: requestedPurpose || null,
            request_chat_key: requestedChatKey || null,
        });
    });

    router.get('/plugin-rules', async (_req, res) => {
        const rules = await buildPluginRuleSummaries();
        res.json({
            ok: true,
            count: rules.length,
            rules,
        });
    });

    router.post('/plugin-rules/:id/reapply', async (req, res) => {
        try {
            const ruleId = normalizeOptionalText(req.params.id);
            if (!ruleId) {
                throw new Error('rule id is required.');
            }

            const rule = readPluginRuleByIdSync(ruleId);
            if (!rule) {
                return res.status(404).json({
                    ok: false,
                    error: 'Rule not found.',
                });
            }

            const backfillResult = await backfillRunsWithLearnedRule(rule);
            res.json({
                ok: true,
                rule,
                matched_runs: backfillResult.updatedCount,
                matched_run_ids: backfillResult.updatedRuns.map((run) => run.id),
            });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.patch('/plugin-rules/:id', async (req, res) => {
        try {
            const ruleId = normalizeOptionalText(req.params.id);
            if (!ruleId) {
                throw new Error('rule id is required.');
            }

            const enabled = req.body?.enabled !== false;
            const updatedRule = await setLearnedPluginRuleEnabled(ruleId, enabled);
            if (!updatedRule) {
                return res.status(404).json({
                    ok: false,
                    error: 'Rule not found.',
                });
            }

            return res.json({
                ok: true,
                rule: updatedRule,
            });
        } catch (error) {
            return res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.delete('/plugin-rules/:id', async (req, res) => {
        try {
            const result = await removeLearnedPluginRule(req.params.id);
            if (!result.removed) {
                return res.status(404).json({
                    ok: false,
                    error: 'Rule not found.',
                });
            }

            return res.json({
                ok: true,
                removed: true,
                rule: result.rule,
            });
        } catch (error) {
            return res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.get('/waiting-queue', async (_req, res) => {
        const entries = await readWaitingQueueRuns();
        res.json({
            ok: true,
            count: entries.length,
            entries,
        });
    });

    router.post('/waiting-queue', async (req, res) => {
        try {
            const runId = normalizeOptionalText(req.body?.run_id);
            if (!runId) {
                throw new Error('run_id is required.');
            }

            const entry = await addWaitingQueueEntry(runId);
            res.json({
                ok: true,
                entry,
            });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.delete('/waiting-queue/:id', async (req, res) => {
        const removed = await removeWaitingQueueEntry(req.params.id);
        res.json({
            ok: true,
            removed,
            run_id: req.params.id,
        });
    });

    router.post('/waiting-queue/:id/label', async (req, res) => {
        try {
            const runId = normalizeOptionalText(req.params.id);
            const pluginLabel = normalizeOptionalText(req.body?.plugin_label);
            const pluginId = slugifyPluginId(req.body?.plugin_id || pluginLabel);
            if (!runId) {
                throw new Error('run id is required.');
            }
            if (!pluginLabel) {
                throw new Error('plugin_label is required.');
            }

            const updatedRun = await updateRunById(runId, (run) => ({
                ...run,
                request_purpose: 'non_chat_generation',
                request_plugin: pluginId || 'unknown_plugin',
                request_plugin_label: pluginLabel,
                request_plugin_match_mode: 'manual_waiting_queue',
                request_plugin_match_score: 1,
            }));

            if (!updatedRun) {
                throw new Error('Run not found.');
            }

            const queueEntries = await readWaitingQueueEntries();
            const nextEntries = queueEntries.filter((entry) => entry.run_id !== runId);
            await writeWaitingQueueEntries(nextEntries);

            await appendPluginRuleCandidate({
                run_id: runId,
                plugin_label: pluginLabel,
                plugin_id: pluginId,
                created_at: new Date().toISOString(),
                source: updatedRun.source ?? null,
                model: updatedRun.model ?? null,
                note: 'created_from_waiting_queue',
            });

            const learnedRule = createLearnedPluginRuleFromRun(updatedRun, pluginLabel, pluginId, runId);
            const savedLearnedRule = learnedRule ? await upsertLearnedPluginRule(learnedRule) : null;
            const backfillResult = savedLearnedRule
                ? await backfillRunsWithLearnedRule(savedLearnedRule, runId)
                : { updatedCount: 0, updatedRuns: [] };

            res.json({
                ok: true,
                run: toClientRun(updatedRun),
                queue_entry: null,
                removed_from_waiting_queue: true,
                learned_rule_created: Boolean(savedLearnedRule),
                learned_rule: savedLearnedRule,
                matched_runs: backfillResult.updatedCount,
                matched_run_ids: backfillResult.updatedRuns.map((run) => run.id),
            });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.post('/force-stop-diagnostics', async (req, res) => {
        try {
            const payload = req.body;
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                throw new Error('diagnostics payload must be an object.');
            }

            const serialized = JSON.stringify(payload);
            if (Buffer.byteLength(serialized, 'utf8') > MAX_FORCE_STOP_DIAGNOSTICS_BYTES) {
                throw new Error('diagnostics payload is too large.');
            }

            // 前端时间可能因为设备时钟漂移不可信，落盘时间以服务端为准。
            await appendForceStopDiagnostics({
                ...payload,
                received_at: new Date().toISOString(),
            });

            res.json({ ok: true });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.post('/client-stop-signal', async (req, res) => {
        try {
            const clientGenerationId = normalizeOptionalText(req.body?.client_generation_id);
            if (!clientGenerationId) {
                throw new Error('client_generation_id is required.');
            }

            await recordClientStopSignal(clientGenerationId);
            res.json({ ok: true });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}

export async function exit() {
    return Promise.resolve();
}

export const info = {
    id: 'st-latency-monitor',
    name: 'ST Latency Monitor',
    description: 'Reads generation latency monitoring logs and exposes them through API routes.',
    version: '0.1.0',
};
