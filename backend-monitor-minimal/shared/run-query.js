// 记录的查询、筛选与聚合。和 run-analysis.js 一样不含任何 Node 依赖，
// 因为纯前端形态要用同一份筛选和统计逻辑——两种形态的"只看异常""只看缓存命中"
// 和日聚合必须给出完全一致的结果，各写一份迟早会分叉。

import { normalizeModelName } from './run-analysis.js';

export { normalizeModelName };

// 这里曾经悄悄吞掉第二个参数，导致 `normalizeOptionalText(value, 200)` 这类
// 写明了上限的调用其实完全没有上限。plugin-rule-service.js 里另有一份带截断的
// 同名实现，两份行为不一致正是那个 bug 的来源，现在以这份为准，那边直接引用。
export function normalizeOptionalText(value, maxLength = 120) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    return trimmed.slice(0, maxLength);
}
export function normalizeRequestPurpose(value) {
    return value === 'non_chat_generation' || value === 'plugin_internal_request'
        ? value
        : 'chat_main_reply';
}
export function filterRunsByPurpose(runs, requestPurpose = '') {
    if (!requestPurpose) {
        return runs;
    }

    return runs.filter((run) => normalizeRequestPurpose(run?.request_purpose) === requestPurpose);
}

export function filterRunsByChatKey(runs, chatKey = '') {
    if (!chatKey) {
        return runs;
    }

    return runs.filter((run) => normalizeOptionalText(run?.request_chat_key, 200) === chatKey);
}

export function readRequestedFlag(value) {
    const text = String(value ?? '').trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'yes';
}

export function filterRunsByAbnormal(runs, abnormalOnly = false) {
    if (!abnormalOnly) {
        return runs;
    }

    return runs.filter((run) => isAbnormalRun(run));
}

export function filterRunsByCacheHit(runs, cacheHitOnly = false) {
    if (!cacheHitOnly) {
        return runs;
    }

    return runs.filter((run) => getRunUsage(run).cacheHit);
}

// prompt_breakdown 平均 4.6KB，占单条 run 体积的 74.8%，而前端目前不读它。
// 默认不下发可以把列表响应缩小到约四分之一；需要时用 include_prompt_breakdown=1 显式取回。
export function toClientRun(run, includePromptBreakdown = false) {
    if (!run || typeof run !== 'object' || includePromptBreakdown) {
        return run;
    }

    if (run.prompt_breakdown === undefined) {
        return run;
    }

    const { prompt_breakdown: _promptBreakdown, ...rest } = run;
    return rest;
}

export function toClientRuns(runs, includePromptBreakdown = false) {
    if (includePromptBreakdown) {
        return runs;
    }

    return runs.map((run) => toClientRun(run, false));
}
export function average(numbers) {
    const valid = numbers.filter((n) => typeof n === 'number' && Number.isFinite(n));
    if (!valid.length) {
        return null;
    }

    return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100;
}

export function sumNumbers(numbers) {
    return numbers
        .filter((n) => typeof n === 'number' && Number.isFinite(n))
        .reduce((sum, value) => sum + value, 0);
}

export function percentile(numbers, ratio = 0.95) {
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

export function getRunDate(run) {
    const startedAtMs = Number(run?.started_at_ms);
    const date = Number.isFinite(startedAtMs) && startedAtMs > 0
        ? new Date(startedAtMs)
        : new Date(run?.started_at_iso || '');
    return Number.isNaN(date.getTime()) ? null : date;
}

export function getRunDateKey(run) {
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

export function getRunUsage(run) {
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

export function isAbnormalRun(run) {
    return Boolean(run?.abnormal_detail?.abnormal_type);
}

// 明细轮转出去之后，日聚合仍然要能算。这里把一条完整记录投影成"统计够用的最小存根"：
// 实测平均 288 字节，只有完整记录的 4.5%，两个月的历史压完不到 2 MB。
//
// 字段清单不是随便挑的，是 getRunDate、filterRunsByPurpose、filterRunsByChatKey、
// buildSummary、buildDailySummary、isAbnormalRun 这六处实际访问到的全部字段。
// 往那几个函数里加新的读取时，必须同步加到这里，否则存档期的统计会静默缺项。
//
// 存的是记录而不是算好的日行，所以按聊天/用途筛选、p95、摘要全都保持精确，
// 合并时把存根数组和现存记录接起来交给 buildDailySummary 即可，不需要另一套聚合。
export function toArchivedRunStub(run) {
    if (!run || typeof run !== 'object') {
        return null;
    }

    const stub = {
        started_at_ms: run.started_at_ms,
        started_at_iso: run.started_at_ms ? undefined : run.started_at_iso,
        request_purpose: run.request_purpose,
        request_chat_key: run.request_chat_key,
        model: run.model,
        archived: true,
    };

    const metrics = run.metrics;
    if (metrics && typeof metrics === 'object') {
        stub.metrics = {
            total_ms: metrics.total_ms,
            preprocess_ms: metrics.preprocess_ms,
            upstream_headers_ms: metrics.upstream_headers_ms,
            ttft_ms: metrics.ttft_ms,
            stream_ms: metrics.stream_ms,
        };
    }

    const usage = run.response_usage;
    if (usage && typeof usage === 'object') {
        stub.response_usage = {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            cached_tokens: usage.cached_tokens,
            cache_read_tokens: usage.cache_read_tokens,
            cache_write_tokens: usage.cache_write_tokens,
            cache_hit: usage.cache_hit,
        };
    }

    const abnormalType = run.abnormal_detail?.abnormal_type;
    if (abnormalType) {
        stub.abnormal_detail = { abnormal_type: abnormalType };
    }

    return stub;
}

export function countByValue(items) {
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

export function normalizeUsageValue(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}
export function buildSummary(runs) {
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

export function buildDailySummary(runs, days = 14) {
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
