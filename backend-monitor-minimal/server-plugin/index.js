import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

import { getMonitorRuntimeStatus } from '../settings-ui/service/monitor-runtime-status.js';
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

const LOG_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const LOG_FILE = path.join(LOG_DIR, 'runs.jsonl');
const WAITING_QUEUE_FILE = path.join(LOG_DIR, 'waiting-queue.json');
const PLUGIN_RULE_CANDIDATES_FILE = path.join(LOG_DIR, 'plugin-rule-candidates.jsonl');

// 剥掉 prompt_breakdown 之后单条 run 约 1.5KB，这里仍然保留上限：
// 全量 5000+ 条一次返回依然是好几 MB，没有任何视图需要这么多。
// 筛选已经下沉到服务端，命中筛选后的结果集远小于这个上限。
const MAX_RUNS_PAGE_LIMIT = 2000;

function normalizeOptionalText(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : '';
}

function slugifyPluginId(value) {
    const normalized = normalizeOptionalText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || '';
}

function normalizeRequestPurpose(value) {
    return value === 'non_chat_generation' || value === 'plugin_internal_request'
        ? value
        : 'chat_main_reply';
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

function filterRunsByPurpose(runs, requestPurpose = '') {
    if (!requestPurpose) {
        return runs;
    }

    return runs.filter((run) => normalizeRequestPurpose(run?.request_purpose) === requestPurpose);
}

function filterRunsByChatKey(runs, chatKey = '') {
    if (!chatKey) {
        return runs;
    }

    return runs.filter((run) => normalizeOptionalText(run?.request_chat_key, 200) === chatKey);
}

function readRequestedFlag(value) {
    const text = String(value ?? '').trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'yes';
}

function filterRunsByAbnormal(runs, abnormalOnly = false) {
    if (!abnormalOnly) {
        return runs;
    }

    return runs.filter((run) => isAbnormalRun(run));
}

function filterRunsByCacheHit(runs, cacheHitOnly = false) {
    if (!cacheHitOnly) {
        return runs;
    }

    return runs.filter((run) => getRunUsage(run).cacheHit);
}

// prompt_breakdown 平均 4.6KB，占单条 run 体积的 74.8%，而前端目前不读它。
// 默认不下发可以把列表响应缩小到约四分之一；需要时用 include_prompt_breakdown=1 显式取回。
function toClientRun(run, includePromptBreakdown = false) {
    if (!run || typeof run !== 'object' || includePromptBreakdown) {
        return run;
    }

    if (run.prompt_breakdown === undefined) {
        return run;
    }

    const { prompt_breakdown: _promptBreakdown, ...rest } = run;
    return rest;
}

function toClientRuns(runs, includePromptBreakdown = false) {
    if (includePromptBreakdown) {
        return runs;
    }

    return runs.map((run) => toClientRun(run, false));
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

function average(numbers) {
    const valid = numbers.filter((n) => typeof n === 'number' && Number.isFinite(n));
    if (!valid.length) {
        return null;
    }

    return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100;
}

function sumNumbers(numbers) {
    return numbers
        .filter((n) => typeof n === 'number' && Number.isFinite(n))
        .reduce((sum, value) => sum + value, 0);
}

function percentile(numbers, ratio = 0.95) {
    const valid = numbers
        .filter((n) => typeof n === 'number' && Number.isFinite(n))
        .sort((left, right) => left - right);
    if (!valid.length) {
        return null;
    }

    const safeRatio = Math.min(1, Math.max(0, Number(ratio) || 0));
    const index = Math.min(valid.length - 1, Math.max(0, Math.ceil(valid.length * safeRatio) - 1));
    return Math.round(valid[index] * 100) / 100;
}

function getRunDate(run) {
    const startedAtMs = Number(run?.started_at_ms);
    const date = Number.isFinite(startedAtMs) && startedAtMs > 0
        ? new Date(startedAtMs)
        : new Date(run?.started_at_iso || '');
    return Number.isNaN(date.getTime()) ? null : date;
}

function getRunDateKey(run) {
    const date = getRunDate(run);
    if (!date) {
        return '';
    }

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}

function getRunUsage(run) {
    const usage = run?.response_usage ?? {};
    const promptTokens = normalizeUsageValue(usage.prompt_tokens);
    const completionTokens = normalizeUsageValue(usage.completion_tokens);
    const totalTokens = normalizeUsageValue(usage.total_tokens);
    const cachedTokens = normalizeUsageValue(usage.cached_tokens);
    const cacheReadTokens = normalizeUsageValue(usage.cache_read_tokens);
    const cacheWriteTokens = normalizeUsageValue(usage.cache_write_tokens);
    const cacheHit = typeof usage.cache_hit === 'boolean'
        ? usage.cache_hit
        : Boolean(
            (cachedTokens !== null && cachedTokens > 0)
            || (cacheReadTokens !== null && cacheReadTokens > 0)
            || (cacheWriteTokens !== null && cacheWriteTokens > 0)
        );

    return {
        promptTokens,
        completionTokens,
        totalTokens: totalTokens ?? ((promptTokens !== null || completionTokens !== null)
            ? (promptTokens ?? 0) + (completionTokens ?? 0)
            : null),
        cachedTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheHit,
    };
}

function isAbnormalRun(run) {
    return Boolean(run?.abnormal_detail?.abnormal_type);
}

function countByValue(items) {
    const counts = new Map();
    for (const item of items) {
        const key = normalizeOptionalText(item);
        if (!key) {
            continue;
        }
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, 'zh-CN'));
}

function normalizeModelName(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : '';
}

function normalizeUsageValue(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
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

function buildSummary(runs) {
    const usageSnapshots = runs.map((run) => getRunUsage(run));
    const cacheHitRuns = usageSnapshots.filter((usage) => usage.cacheHit).length;
    return {
        total_runs: runs.length,
        cache_hit_runs: cacheHitRuns,
        cache_hit_rate: runs.length ? (cacheHitRuns / runs.length) * 100 : 0,
        prompt_tokens: sumNumbers(usageSnapshots.map((usage) => usage.promptTokens)),
        completion_tokens: sumNumbers(usageSnapshots.map((usage) => usage.completionTokens)),
        total_tokens: sumNumbers(usageSnapshots.map((usage) => usage.totalTokens)),
        cached_tokens: sumNumbers(usageSnapshots.map((usage) => usage.cachedTokens)),
        cache_read_tokens: sumNumbers(usageSnapshots.map((usage) => usage.cacheReadTokens)),
        cache_write_tokens: sumNumbers(usageSnapshots.map((usage) => usage.cacheWriteTokens)),
        avg_total_ms: average(runs.map((run) => run.metrics?.total_ms)),
        avg_preprocess_ms: average(runs.map((run) => run.metrics?.preprocess_ms)),
        avg_upstream_headers_ms: average(runs.map((run) => run.metrics?.upstream_headers_ms)),
        avg_ttft_ms: average(runs.map((run) => run.metrics?.ttft_ms)),
        avg_stream_ms: average(runs.map((run) => run.metrics?.stream_ms)),
    };
}

function buildDailySummary(runs, days = 14) {
    const normalizedDays = Math.max(1, Math.min(365, Number(days) || 14));
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (normalizedDays - 1));

    const dayBuckets = new Map();
    const filteredRuns = [];
    // 当前口径（已按用途/聊天筛过，但未按天数截断）的真实数据范围。
    // 聊天口径下 request_chat_key 是后加的字段，老记录没有，所以可选天数经常远超实际能覆盖的范围，
    // 前端需要这两个值才能说清楚"再往前没有记录"，而不是让人以为切换天数坏了。
    const scopeDateKeys = new Set();
    let scopeEarliestDateKey = '';

    for (const run of runs) {
        const runDate = getRunDate(run);
        const dateKey = getRunDateKey(run);

        if (runDate && dateKey) {
            scopeDateKeys.add(dateKey);
            if (!scopeEarliestDateKey || dateKey < scopeEarliestDateKey) {
                scopeEarliestDateKey = dateKey;
            }
        }

        if (!runDate || runDate < cutoff || !dateKey) {
            continue;
        }

        filteredRuns.push(run);
        const usage = getRunUsage(run);
        const bucket = dayBuckets.get(dateKey) ?? {
            date_key: dateKey,
            runs: [],
            totalMsValues: [],
            preprocessMsValues: [],
            upstreamHeadersMsValues: [],
            ttftMsValues: [],
            streamMsValues: [],
            topModelsSource: [],
            topAbnormalTypesSource: [],
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cached_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cache_hit_runs: 0,
            abnormal_runs: 0,
        };

        bucket.runs.push(run);
        if (typeof run?.metrics?.total_ms === 'number' && Number.isFinite(run.metrics.total_ms)) {
            bucket.totalMsValues.push(run.metrics.total_ms);
        }
        if (typeof run?.metrics?.preprocess_ms === 'number' && Number.isFinite(run.metrics.preprocess_ms)) {
            bucket.preprocessMsValues.push(run.metrics.preprocess_ms);
        }
        if (typeof run?.metrics?.upstream_headers_ms === 'number' && Number.isFinite(run.metrics.upstream_headers_ms)) {
            bucket.upstreamHeadersMsValues.push(run.metrics.upstream_headers_ms);
        }
        if (typeof run?.metrics?.ttft_ms === 'number' && Number.isFinite(run.metrics.ttft_ms)) {
            bucket.ttftMsValues.push(run.metrics.ttft_ms);
        }
        if (typeof run?.metrics?.stream_ms === 'number' && Number.isFinite(run.metrics.stream_ms)) {
            bucket.streamMsValues.push(run.metrics.stream_ms);
        }

        bucket.prompt_tokens += usage.promptTokens ?? 0;
        bucket.completion_tokens += usage.completionTokens ?? 0;
        bucket.total_tokens += usage.totalTokens ?? 0;
        bucket.cached_tokens += usage.cachedTokens ?? 0;
        bucket.cache_read_tokens += usage.cacheReadTokens ?? 0;
        bucket.cache_write_tokens += usage.cacheWriteTokens ?? 0;
        if (usage.cacheHit) {
            bucket.cache_hit_runs += 1;
        }
        if (isAbnormalRun(run)) {
            bucket.abnormal_runs += 1;
        }

        const modelName = normalizeModelName(run?.model);
        if (modelName) {
            bucket.topModelsSource.push(modelName);
        }
        const abnormalType = normalizeOptionalText(run?.abnormal_detail?.abnormal_type);
        if (abnormalType) {
            bucket.topAbnormalTypesSource.push(abnormalType);
        }

        dayBuckets.set(dateKey, bucket);
    }

    const rows = Array.from(dayBuckets.values())
        .sort((left, right) => left.date_key.localeCompare(right.date_key))
        .map((bucket) => ({
            date_key: bucket.date_key,
            total_runs: bucket.runs.length,
            abnormal_runs: bucket.abnormal_runs,
            abnormal_rate: bucket.runs.length ? (bucket.abnormal_runs / bucket.runs.length) * 100 : 0,
            prompt_tokens: bucket.prompt_tokens,
            completion_tokens: bucket.completion_tokens,
            total_tokens: bucket.total_tokens,
            cached_tokens: bucket.cached_tokens,
            cache_read_tokens: bucket.cache_read_tokens,
            cache_write_tokens: bucket.cache_write_tokens,
            cache_hit_rate: bucket.runs.length ? (bucket.cache_hit_runs / bucket.runs.length) * 100 : 0,
            avg_total_ms: average(bucket.totalMsValues),
            p95_total_ms: percentile(bucket.totalMsValues, 0.95),
            avg_preprocess_ms: average(bucket.preprocessMsValues),
            avg_upstream_headers_ms: average(bucket.upstreamHeadersMsValues),
            avg_ttft_ms: average(bucket.ttftMsValues),
            avg_stream_ms: average(bucket.streamMsValues),
            top_models: countByValue(bucket.topModelsSource).slice(0, 3),
            top_abnormal_types: countByValue(bucket.topAbnormalTypesSource).slice(0, 3),
        }));

    return {
        days: normalizedDays,
        summary: buildSummary(filteredRuns),
        rows,
        scope_earliest_date_key: scopeEarliestDateKey || null,
        scope_total_days: scopeDateKeys.size,
    };
}

export async function init(router) {
    router.use(express.json({ limit: '256kb' }));

    router.get('/status', async (req, res) => {
        const storedRuns = await countRuns();
        const runtimeStatus = await getMonitorRuntimeStatus(req);
        res.json({
            ok: true,
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
