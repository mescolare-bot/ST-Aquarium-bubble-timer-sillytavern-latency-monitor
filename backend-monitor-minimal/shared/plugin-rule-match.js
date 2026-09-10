// 插件规则的纯逻辑：特征提取、规则归一化、合并、匹配。
//
// 这份文件不含任何 Node 依赖，两种形态共用：
// - 完整版由 plugin-rule-service.js 包一层文件读写后使用
// - 精简版由 lite/ 直接 import，规则存 IndexedDB
//
// 拆出来的原因是 plugin-rule-service.js 顶部硬绑了 node:crypto / node:fs / node:path，
// 浏览器里根本 import 不进来，于是精简版一直没有规则学习、打标只能一条算一条。
// 真正需要 Node 的只有"生成 id"和"读写 plugin-rules.json"两件事，匹配算法本身是纯的。
//
// 改这里要当心：完整版和精简版跑的是同一份实现，任何行为变化都会同时作用到两边。

import { normalizeOptionalText, normalizeRequestPurpose } from './run-query.js';

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

// crypto.randomUUID 只在安全上下文可用，而酒馆常常是 http 直连，
// 精简版直接调会抛异常。Node 侧 globalThis.crypto 一定在，所以统一走这个兜底。
function createRuleId() {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) {
        return uuid;
    }

    return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// 认不出是哪个拓展时用的占位 id。必须选一个"再 slugify 一次还是自己"的写法：
// 归一化会反复跑在同一条规则上，用下划线版的话第二次就被改写成连字符，
// 于是和这里的比较、KNOWN_PLUGIN_LABELS 的查表全部失配。
export const UNKNOWN_PLUGIN_ID = 'unknown-plugin';

// 这个改动之前落盘的记录里存的是下划线写法，判断占位 id 时两种都得认，
// 否则老记录会被当成"已经认出某个拓展"，反而挡住后续改判。
export function isUnknownPluginId(value) {
    const normalized = normalizeOptionalText(value).toLowerCase();
    return normalized === UNKNOWN_PLUGIN_ID || normalized === 'unknown_plugin';
}

// 白名单必须包含非 ASCII 字母：只留 a-z0-9 的话，纯中文的拓展名会整个被剥成空串，
// 于是所有中文名拓展共用一个占位 id，彼此再也分不开。
// 对纯 ASCII 输入，这个正则和原来的 /[^a-z0-9]+/g 结果逐字节相同，内置 id 不受影响。
export function slugifyPluginId(value) {
    const normalized = normalizeOptionalText(value)
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
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

export function normalizeRule(rule) {
    const pluginLabel = normalizeOptionalText(rule?.plugin_label);
    const pluginId = slugifyPluginId(rule?.plugin_id || pluginLabel) || UNKNOWN_PLUGIN_ID;
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
        id: normalizeOptionalText(rule?.id, 80) || createRuleId(),
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

export function normalizeRuleList(value) {
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

/**
 * 把一条新规则并进已有规则列表，返回新列表和落地后的那条规则。
 *
 * 只做内存里的合并，不碰任何存储：完整版拿它夹在"读磁盘"和"写磁盘"之间，
 * 精简版拿它夹在"读 IndexedDB"和"写 IndexedDB"之间，两边共用同一份合并语义。
 */
export function mergeLearnedPluginRule(existingRules, ruleInput) {
    const normalized = normalizeRule(ruleInput);
    if (!normalized) {
        return { rules: Array.isArray(existingRules) ? existingRules : [], rule: null };
    }

    const rules = Array.isArray(existingRules) ? existingRules : [];
    const mergeKey = getRuleMergeKey(normalized);
    const index = rules.findIndex((rule) => getRuleMergeKey(rule) === mergeKey);

    const nextRules = [...rules];
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

        return { rules: nextRules, rule: nextRules[index] };
    }

    nextRules.unshift(normalized);
    return { rules: nextRules, rule: normalized };
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

export function matchRuleAgainstSnapshot(rule, snapshot, source, model) {
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

/**
 * 规则来源由调用方给：完整版传磁盘上读到的，精简版传 IndexedDB 里读到的。
 * 分数最高的那条胜出。
 */
export function findMatchingPluginRuleForRequest(rules, requestBody) {
    const snapshot = buildPromptMarkerSnapshot({
        messages: requestBody?.messages,
        promptTrace: requestBody?.prompt_trace,
    });
    const source = requestBody?.chat_completion_source ?? null;
    const model = requestBody?.model ?? null;

    let bestMatch = null;
    for (const rule of Array.isArray(rules) ? rules : []) {
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

/**
 * 这条规则该不该改写这条记录。
 *
 * 比规则本身更可信的来源（自报、指纹、人工打标）一律不覆盖；
 * 已经归给另一个拓展的记录也不抢。
 *
 * 完整版的回填和精简版的回填共用这一份，两边的改判口径必须一致。
 */
export function shouldApplyLearnedRuleToRun(run, match) {
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
        && !isUnknownPluginId(currentPlugin)
        && currentPluginLabel
        && currentPluginLabel !== match.pluginLabel) {
        return false;
    }

    return true;
}

export function findMatchingPluginRuleForRun(rules, run) {
    let bestMatch = null;
    for (const rule of Array.isArray(rules) ? rules : []) {
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
