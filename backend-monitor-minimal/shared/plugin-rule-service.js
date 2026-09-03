import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { normalizeOptionalText } from './run-query.js';

const LOG_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const PLUGIN_RULES_FILE = path.join(LOG_DIR, 'plugin-rules.json');

const GENERIC_PROMPT_MARKERS = new Set([
    'content',
    'message',
    'messages',
    'name',
    'role',
    'system',
    'text',
    'user',
]);

const MATCH_MODE = 'learned_rule';
let cachedRulesMtimeMs = -1;
let cachedRules = [];

// 实现统一放在 run-query.js（那份不含任何 Node 依赖，纯前端形态也要用）。
// 这里保留同名导出，是因为已经有调用方从本模块取它。
export { normalizeOptionalText };

export function slugifyPluginId(value) {
    const normalized = normalizeOptionalText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || '';
}

function normalizeStringArray(value, maxItems = 12) {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(new Set(
        value
            .map((item) => normalizeOptionalText(item, 80))
            .filter(Boolean),
    )).slice(0, maxItems);
}

function normalizeRunIdArray(value, maxItems = 200) {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(new Set(
        value
            .map((item) => normalizeOptionalText(item, 120))
            .filter(Boolean),
    )).slice(0, maxItems);
}

function collectTextChunks(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }

    const chunks = [];

    function visit(value) {
        if (typeof value === 'string') {
            const normalized = value.trim();
            if (normalized) {
                chunks.push(normalized);
            }
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item);
            }
            return;
        }

        if (!value || typeof value !== 'object') {
            return;
        }

        if (typeof value.text === 'string') {
            visit(value.text);
        }

        if (typeof value.content === 'string' || Array.isArray(value.content)) {
            visit(value.content);
        }
    }

    for (const message of messages) {
        visit(message?.content);
    }

    return chunks;
}

function pushMarker(markers, value) {
    const normalized = normalizeOptionalText(value, 60);
    if (!normalized) {
        return;
    }

    if (GENERIC_PROMPT_MARKERS.has(normalized.toLowerCase())) {
        return;
    }

    markers.push(normalized);
}

export function collectPromptTraceKeys(promptTrace) {
    if (Array.isArray(promptTrace)) {
        return Array.from(new Set(
            promptTrace
                .flatMap((item) => [
                    normalizeOptionalText(item?.key, 60),
                    item?.group && item?.key ? normalizeOptionalText(`${item.group}:${item.key}`, 80) : '',
                ])
                .filter(Boolean),
        )).slice(0, 12);
    }

    return normalizeStringArray(promptTrace, 12);
}

export function collectPromptMarkersFromMessages(messages) {
    const text = collectTextChunks(messages).join('\n');
    if (!text) {
        return [];
    }

    const markers = [];
    for (const match of text.matchAll(/<([a-z][a-z0-9_:-]{2,40})\b/gi)) {
        pushMarker(markers, `<${match[1].toLowerCase()}>`);
    }
    for (const match of text.matchAll(/【([^【】\n]{2,40})】/g)) {
        pushMarker(markers, `【${match[1].replace(/\s+/g, ' ').trim()}】`);
    }
    for (const match of text.matchAll(/(?:^|\n)\s*([A-Za-z][A-Za-z _-]{1,30}):/g)) {
        pushMarker(markers, `${match[1].replace(/\s+/g, ' ').trim()}:`);
    }
    for (const match of text.matchAll(/\b([a-z]+_[a-z0-9_]{2,30})\b/g)) {
        pushMarker(markers, match[1].toLowerCase());
    }

    return Array.from(new Set(markers)).slice(0, 12);
}

export function buildPromptMarkerSnapshot({ messages, promptTrace, promptMarkers, promptTraceKeys } = {}) {
    return {
        promptMarkers: normalizeStringArray(
            Array.isArray(promptMarkers) && promptMarkers.length
                ? promptMarkers
                : collectPromptMarkersFromMessages(messages),
            12,
        ),
        promptTraceKeys: normalizeStringArray(
            Array.isArray(promptTraceKeys) && promptTraceKeys.length
                ? promptTraceKeys
                : collectPromptTraceKeys(promptTrace),
            12,
        ),
    };
}

function normalizeRule(rule) {
    const pluginLabel = normalizeOptionalText(rule?.plugin_label);
    const pluginId = slugifyPluginId(rule?.plugin_id || pluginLabel) || 'unknown_plugin';
    const promptMarkers = normalizeStringArray(rule?.prompt_markers, 12);
    const promptTraceKeys = normalizeStringArray(rule?.prompt_trace_keys, 12);
    const sampleRunIds = normalizeRunIdArray(rule?.sample_run_ids);
    const source = normalizeOptionalText(rule?.source, 80);
    const model = normalizeOptionalText(rule?.model, 160);
    const requiredMarkerCount = promptMarkers.length >= 2 ? 2 : promptMarkers.length;

    if (!pluginLabel) {
        return null;
    }

    if (!promptMarkers.length && !promptTraceKeys.length) {
        return null;
    }

    return {
        id: normalizeOptionalText(rule?.id, 80) || crypto.randomUUID(),
        plugin_id: pluginId,
        plugin_label: pluginLabel,
        enabled: rule?.enabled !== false,
        source,
        model,
        prompt_markers: promptMarkers,
        prompt_trace_keys: promptTraceKeys,
        sample_run_ids: sampleRunIds,
        sample_count: sampleRunIds.length,
        required_marker_count: requiredMarkerCount,
        created_at: normalizeOptionalText(rule?.created_at, 80) || new Date().toISOString(),
        updated_at: normalizeOptionalText(rule?.updated_at, 80) || new Date().toISOString(),
    };
}

function getRuleMergeKey(rule) {
    return [
        rule?.plugin_id || '',
        rule?.plugin_label || '',
        rule?.source || '',
        rule?.model || '',
    ].join('::');
}

function normalizeRuleList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    const rules = [];
    const seen = new Set();
    for (const item of value) {
        const normalized = normalizeRule(item);
        if (!normalized) {
            continue;
        }

        const signature = [
            normalized.plugin_id,
            normalized.plugin_label,
            normalized.source,
            normalized.model,
            ...normalized.prompt_markers,
            '|',
            ...normalized.prompt_trace_keys,
        ].join('::');
        if (seen.has(signature)) {
            continue;
        }

        seen.add(signature);
        rules.push(normalized);
    }

    return rules;
}

function loadRulesFromDiskSync() {
    try {
        const stat = fs.statSync(PLUGIN_RULES_FILE);
        if (stat.mtimeMs === cachedRulesMtimeMs) {
            return cachedRules;
        }

        const parsed = JSON.parse(fs.readFileSync(PLUGIN_RULES_FILE, 'utf8'));
        cachedRules = normalizeRuleList(parsed);
        cachedRulesMtimeMs = stat.mtimeMs;
        return cachedRules;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            cachedRules = [];
            cachedRulesMtimeMs = -1;
            return cachedRules;
        }

        return cachedRules;
    }
}

export function readPluginRulesSync() {
    return loadRulesFromDiskSync();
}

export function readPluginRuleByIdSync(ruleId) {
    const normalizedRuleId = normalizeOptionalText(ruleId, 80);
    if (!normalizedRuleId) {
        return null;
    }

    return readPluginRulesSync().find((rule) => rule.id === normalizedRuleId) ?? null;
}

async function writePluginRules(rules) {
    await fsp.mkdir(LOG_DIR, { recursive: true });
    await fsp.writeFile(PLUGIN_RULES_FILE, `${JSON.stringify(normalizeRuleList(rules), null, 2)}\n`, 'utf8');
    cachedRulesMtimeMs = -1;
}

export async function upsertLearnedPluginRule(ruleInput) {
    const normalized = normalizeRule(ruleInput);
    if (!normalized) {
        return null;
    }

    const existingRules = readPluginRulesSync();
    const mergeKey = getRuleMergeKey(normalized);
    const index = existingRules.findIndex((rule) => getRuleMergeKey(rule) === mergeKey);

    const nextRules = [...existingRules];
    if (index >= 0) {
        const mergedPromptMarkers = normalizeStringArray([
            ...nextRules[index].prompt_markers,
            ...normalized.prompt_markers,
        ], 20);
        const mergedPromptTraceKeys = normalizeStringArray([
            ...nextRules[index].prompt_trace_keys,
            ...normalized.prompt_trace_keys,
        ], 20);
        const mergedSampleRunIds = normalizeRunIdArray([
            ...nextRules[index].sample_run_ids,
            ...normalized.sample_run_ids,
        ], 200);
        nextRules[index] = {
            ...nextRules[index],
            ...normalized,
            id: nextRules[index].id,
            created_at: nextRules[index].created_at,
            enabled: nextRules[index].enabled !== false,
            prompt_markers: mergedPromptMarkers,
            prompt_trace_keys: mergedPromptTraceKeys,
            sample_run_ids: mergedSampleRunIds,
            sample_count: mergedSampleRunIds.length,
            required_marker_count: mergedPromptMarkers.length >= 2 ? 2 : mergedPromptMarkers.length,
            updated_at: new Date().toISOString(),
        };
    } else {
        nextRules.unshift(normalized);
    }

    await writePluginRules(nextRules);
    return index >= 0 ? nextRules[index] : normalized;
}

export async function removeLearnedPluginRule(ruleId) {
    const normalizedRuleId = normalizeOptionalText(ruleId, 80);
    if (!normalizedRuleId) {
        return {
            removed: false,
            rule: null,
        };
    }

    const existingRules = readPluginRulesSync();
    const matchedRule = existingRules.find((rule) => rule.id === normalizedRuleId) ?? null;
    if (!matchedRule) {
        return {
            removed: false,
            rule: null,
        };
    }

    await writePluginRules(existingRules.filter((rule) => rule.id !== normalizedRuleId));
    return {
        removed: true,
        rule: matchedRule,
    };
}

export async function setLearnedPluginRuleEnabled(ruleId, enabled) {
    const normalizedRuleId = normalizeOptionalText(ruleId, 80);
    if (!normalizedRuleId) {
        return null;
    }

    const existingRules = readPluginRulesSync();
    const index = existingRules.findIndex((rule) => rule.id === normalizedRuleId);
    if (index < 0) {
        return null;
    }

    const nextRules = [...existingRules];
    nextRules[index] = {
        ...nextRules[index],
        enabled: enabled !== false,
        updated_at: new Date().toISOString(),
    };
    await writePluginRules(nextRules);
    return nextRules[index];
}

export function createLearnedPluginRuleFromRun(run, pluginLabel, pluginId = '', sampleRunId = '') {
    const snapshot = buildPromptMarkerSnapshot({
        promptMarkers: run?.prompt_markers,
        promptTraceKeys: run?.prompt_trace_keys,
        promptTrace: run?.prompt_trace,
    });

    return normalizeRule({
        plugin_label: pluginLabel,
        plugin_id: pluginId,
        source: run?.source,
        model: run?.model,
        prompt_markers: snapshot.promptMarkers,
        prompt_trace_keys: snapshot.promptTraceKeys,
        sample_run_ids: sampleRunId ? [sampleRunId] : (run?.id ? [run.id] : []),
    });
}

function countOverlaps(left, right) {
    const rightSet = new Set(right);
    return left.filter((item) => rightSet.has(item));
}

function matchRuleAgainstSnapshot(rule, snapshot, source, model) {
    if (!rule || !snapshot) {
        return null;
    }

    if (rule.enabled === false) {
        return null;
    }

    const normalizedSource = normalizeOptionalText(source, 80);
    const normalizedModel = normalizeOptionalText(model, 160);
    if (rule.source && rule.source !== normalizedSource) {
        return null;
    }
    if (rule.model && rule.model !== normalizedModel) {
        return null;
    }

    const matchedMarkers = countOverlaps(rule.prompt_markers, snapshot.promptMarkers);
    const matchedTraceKeys = countOverlaps(rule.prompt_trace_keys, snapshot.promptTraceKeys);
    if (rule.prompt_markers.length) {
        const requiredMarkerCount = Math.max(1, Number(rule.required_marker_count) || 1);
        if (matchedMarkers.length < Math.min(requiredMarkerCount, rule.prompt_markers.length)) {
            return null;
        }
    } else if (rule.prompt_trace_keys.length) {
        const requiredTraceCount = Math.min(2, rule.prompt_trace_keys.length);
        if (matchedTraceKeys.length < requiredTraceCount) {
            return null;
        }
    } else {
        return null;
    }

    return {
        pluginId: rule.plugin_id,
        pluginLabel: rule.plugin_label,
        matchMode: MATCH_MODE,
        matchScore: matchedMarkers.length * 100 + matchedTraceKeys.length * 10 + (rule.source ? 1 : 0) + (rule.model ? 1 : 0),
        ruleId: rule.id,
        matchedMarkers,
        matchedTraceKeys,
    };
}

export function matchLearnedPluginRuleAgainstRun(rule, run) {
    const snapshot = buildPromptMarkerSnapshot({
        promptMarkers: run?.prompt_markers,
        promptTraceKeys: run?.prompt_trace_keys,
        promptTrace: run?.prompt_trace,
    });

    return matchRuleAgainstSnapshot(rule, snapshot, run?.source, run?.model);
}

export function findMatchingLearnedPluginRuleForRequest(requestBody) {
    const snapshot = buildPromptMarkerSnapshot({
        messages: requestBody?.messages,
        promptTrace: requestBody?.prompt_trace,
    });
    const source = requestBody?.chat_completion_source ?? null;
    const model = requestBody?.model ?? null;

    let bestMatch = null;
    for (const rule of readPluginRulesSync()) {
        const match = matchRuleAgainstSnapshot(rule, snapshot, source, model);
        if (!match) {
            continue;
        }

        if (!bestMatch || match.matchScore > bestMatch.matchScore) {
            bestMatch = match;
        }
    }

    return bestMatch;
}

export function findMatchingLearnedPluginRuleForRun(run) {
    let bestMatch = null;
    for (const rule of readPluginRulesSync()) {
        const match = matchLearnedPluginRuleAgainstRun(rule, run);
        if (!match) {
            continue;
        }

        if (!bestMatch || match.matchScore > bestMatch.matchScore) {
            bestMatch = match;
        }
    }

    return bestMatch;
}
