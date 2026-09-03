// 从 latency-monitor.js 抽出来的纯分析逻辑：prompt 体积汇总、异常判定、计价、
// usage 与 SSE 解析。这里刻意不含任何 Node 依赖（fs / path / process），
// 因为纯前端形态要在浏览器里跑同一份逻辑——两边给出的异常分类和建议必须完全一致。
//
// 落盘、读设置、读停止信号这些带 I/O 的部分仍留在 latency-monitor.js。

import { generateAbnormalOptimizationSuggestions } from '../settings-ui/service/abnormal-optimization-suggestion-service.js';

export function safeStringifyLength(value) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return null;
    }
}

export function createRoleSummary() {
    return {
        count: 0,
        chars: 0,
    };
}

export function collectContentStats(content) {
    const stats = {
        chars: 0,
        part_count: 0,
        text_parts: 0,
        image_parts: 0,
        audio_parts: 0,
        tool_parts: 0,
        other_parts: 0,
    };

    function visit(value) {
        if (typeof value === 'string') {
            stats.chars += value.length;
            stats.part_count += 1;
            stats.text_parts += 1;
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

        stats.part_count += 1;

        const type = typeof value.type === 'string' ? value.type : 'object';
        if (typeof value.text === 'string') {
            stats.chars += value.text.length;
        }

        if (typeof value.content === 'string') {
            stats.chars += value.content.length;
        }

        if (Array.isArray(value.content)) {
            visit(value.content);
        }

        if (type.includes('text')) {
            stats.text_parts += 1;
        } else if (type.includes('image')) {
            stats.image_parts += 1;
        } else if (type.includes('audio')) {
            stats.audio_parts += 1;
        } else if (type.includes('tool')) {
            stats.tool_parts += 1;
        } else {
            stats.other_parts += 1;
        }
    }

    visit(content);
    return stats;
}

export function summarizeMessages(messages) {
    if (!Array.isArray(messages)) {
        return null;
    }

    const roleTotals = {};
    const messageSizes = messages.map((message, index) => {
        const role = typeof message?.role === 'string' ? message.role : 'unknown';
        const name = typeof message?.name === 'string' ? message.name : null;
        const contentStats = collectContentStats(message?.content);
        const toolCallCount = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0;

        if (!roleTotals[role]) {
            roleTotals[role] = createRoleSummary();
        }

        roleTotals[role].count += 1;
        roleTotals[role].chars += contentStats.chars;

        return {
            index,
            role,
            name,
            chars: contentStats.chars,
            part_count: contentStats.part_count,
            text_parts: contentStats.text_parts,
            image_parts: contentStats.image_parts,
            audio_parts: contentStats.audio_parts,
            tool_parts: contentStats.tool_parts,
            other_parts: contentStats.other_parts,
            tool_call_count: toolCallCount,
        };
    });

    // 这里刻意不再落盘 top_messages / recent_messages。
    // 它们只是 message_sizes 的排序切片，重复存储会让每条记录多出约 1.7KB，
    // 而消费方从 message_sizes 现算即可，信息没有任何损失。
    return {
        mode: 'messages',
        total_messages: messages.length,
        total_chars: messageSizes.reduce((sum, item) => sum + item.chars, 0),
        role_totals: roleTotals,
        message_sizes: messageSizes,
    };
}

export function summarizePrompt(messages) {
    if (Array.isArray(messages)) {
        return summarizeMessages(messages);
    }

    if (typeof messages === 'string') {
        return {
            mode: 'text',
            total_messages: null,
            total_chars: messages.length,
        };
    }

    return null;
}

export function hasRecordedOutput(run) {
    return run.output_bytes > 0 || (typeof run.output_chars === 'number' && run.output_chars > 0);
}

export function detectFailedStage(run) {
    const phases = run.phases ?? {};

    if (!phases.upstream_request_started) {
        return 'preprocess';
    }

    if (!phases.upstream_headers_received) {
        return 'request_model';
    }

    if (!phases.first_chunk_received) {
        return 'before_first_output';
    }

    if (run.stream && !phases.stream_completed) {
        return 'full_return';
    }

    if (phases.stream_error) {
        return 'full_return';
    }

    return null;
}

// 酒馆六处转发函数都是同一套接线（src/endpoints/backends/chat-completions.js:225 起）：
//   request.socket.on('close', () => controller.abort())
// 上游请求带着这个 signal 发出，所以 "The operation was aborted." 有且只有一个成因——
// 浏览器到酒馆的连接断了，酒馆随即掐掉上游请求。跟模型、跟上游接口都没有关系。
export function isClientAbortError(errorText) {
    return /operation was aborted|aborterror|user aborted a request/.test(errorText);
}

export function detectAbnormalType(run) {
    const phases = run.phases ?? {};
    const errorText = String(run.error ?? '').toLowerCase();
    const hasOutput = hasRecordedOutput(run);
    const hasError = Boolean(run.error) || (typeof run.http_status === 'number' && run.http_status >= 400);
    const isTimeout = /timeout|timed out|time out/.test(errorText);
    const isStreamInterrupted = Boolean(run.stream && phases.first_chunk_received && !phases.stream_completed);
    const isSuspectedIncompleteGeneration = Boolean(run.stream && hasOutput && !phases.stream_completed && !hasError);

    if (!hasError && !isSuspectedIncompleteGeneration && !isStreamInterrupted) {
        return null;
    }

    // 断连要排在流式中断和"未输出即失败"之前：这两类描述的是现象，而断连是确定的成因，
    // 归错了会把用户引去换模型、关流式，而真正该看的是自己这一侧的连接。
    if (isClientAbortError(errorText)) {
        return run.client_stopped ? 'client_stopped' : 'client_disconnected';
    }

    if (isTimeout) {
        return 'request_timeout';
    }

    if (isStreamInterrupted) {
        return 'stream_interrupted';
    }

    if (isSuspectedIncompleteGeneration) {
        return 'suspected_incomplete_generation';
    }

    if (hasError && !hasOutput) {
        return 'failed_without_output';
    }

    if (hasError && hasOutput) {
        return 'failed_after_partial_output';
    }

    if (hasError) {
        return 'failed_generation';
    }

    return null;
}

export function isPromptLikelyOverweight(run) {
    const totalChars = run.prompt_breakdown?.total_chars ?? run.prompt_chars ?? 0;
    const totalMessages = run.prompt_breakdown?.total_messages ?? run.message_count ?? 0;
    return totalChars >= 32000 || totalMessages >= 80;
}

export function normalizePricingCurrency(value) {
    return value === 'cny' ? 'cny' : 'usd';
}

export function normalizeModelName(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : '';
}

// 中转层会在模型名前面加路由前缀（例如 假流式/gemini-3.1-pro-preview），底下往往是同一个模型。
// 精确匹配不上时就从左往右逐段剥掉前缀再找。显式配置的名字永远先命中，所以要给某个前缀
// 单独定价，照原样配一条就能盖住回退——硅基流动的 Pro/ 付费档就得这么配，否则会套用非
// Pro 的便宜价。回退时把命中的名字一起返回，好让界面写明钱是按谁算的。
export function resolvePricingModelEntry(modelName, modelPrices) {
    const normalizedModelName = normalizeModelName(modelName);
    if (!normalizedModelName || !modelPrices || typeof modelPrices !== 'object') {
        return null;
    }

    const candidates = [normalizedModelName];
    let rest = normalizedModelName;
    let separatorIndex = rest.indexOf('/');
    while (separatorIndex >= 0) {
        rest = rest.slice(separatorIndex + 1);
        if (rest) {
            candidates.push(rest);
        }
        separatorIndex = rest.indexOf('/');
    }

    for (const candidate of candidates) {
        const config = normalizePricingConfig(modelPrices[candidate]);
        if (config && hasConfiguredPricingValue(config)) {
            return {
                model_name: candidate,
                config,
                is_fallback: candidate !== normalizedModelName,
            };
        }
    }

    return null;
}

export function normalizeOptionalPricingNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

export function normalizePricingConfig(config) {
    if (!config || typeof config !== 'object') {
        return null;
    }

    return {
        currency: normalizePricingCurrency(config.currency),
        input_price_per_million: normalizeOptionalPricingNumber(config.input_price_per_million),
        cached_input_price_per_million: normalizeOptionalPricingNumber(config.cached_input_price_per_million),
        output_price_per_million: normalizeOptionalPricingNumber(config.output_price_per_million),
        peak_valley_enabled: Boolean(config.peak_valley_enabled),
        peak_start_time: typeof config.peak_start_time === 'string' ? config.peak_start_time.trim() : '',
        peak_end_time: typeof config.peak_end_time === 'string' ? config.peak_end_time.trim() : '',
        peak_input_price_per_million: normalizeOptionalPricingNumber(config.peak_input_price_per_million),
        peak_cached_input_price_per_million: normalizeOptionalPricingNumber(config.peak_cached_input_price_per_million),
        peak_output_price_per_million: normalizeOptionalPricingNumber(config.peak_output_price_per_million),
        valley_input_price_per_million: normalizeOptionalPricingNumber(config.valley_input_price_per_million),
        valley_cached_input_price_per_million: normalizeOptionalPricingNumber(config.valley_cached_input_price_per_million),
        valley_output_price_per_million: normalizeOptionalPricingNumber(config.valley_output_price_per_million),
    };
}

export function hasConfiguredPricingValue(config) {
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
    ].some((fieldName) => normalizeOptionalPricingNumber(config?.[fieldName]) !== null);
}

export function convertPricingTimeToMinutes(value) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
        return null;
    }

    const [hours, minutes] = value.split(':').map(Number);
    return (hours * 60) + minutes;
}

export function getRunPricingReferenceDate(run) {
    const startedAtMs = Number(run?.started_at_ms);
    if (Number.isFinite(startedAtMs) && startedAtMs > 0) {
        const startedAtDate = new Date(startedAtMs);
        return Number.isNaN(startedAtDate.getTime()) ? null : startedAtDate;
    }

    const startedAtIso = typeof run?.started_at_iso === 'string' ? run.started_at_iso : '';
    if (!startedAtIso) {
        return null;
    }

    const startedAtDate = new Date(startedAtIso);
    return Number.isNaN(startedAtDate.getTime()) ? null : startedAtDate;
}

export function getRunPeakValleySelection(run, config) {
    if (!config?.peak_valley_enabled) {
        return null;
    }

    const peakStartMinutes = convertPricingTimeToMinutes(config.peak_start_time);
    const peakEndMinutes = convertPricingTimeToMinutes(config.peak_end_time);
    if (peakStartMinutes === null || peakEndMinutes === null || peakStartMinutes === peakEndMinutes) {
        return {
            enabled: true,
            active: false,
            reason: 'invalid_schedule',
        };
    }

    const referenceDate = getRunPricingReferenceDate(run);
    if (!(referenceDate instanceof Date)) {
        return {
            enabled: true,
            active: false,
            reason: 'missing_run_time',
        };
    }

    const currentMinutes = (referenceDate.getHours() * 60) + referenceDate.getMinutes();
    const inPeakWindow = peakStartMinutes < peakEndMinutes
        ? currentMinutes >= peakStartMinutes && currentMinutes < peakEndMinutes
        : currentMinutes >= peakStartMinutes || currentMinutes < peakEndMinutes;
    const periodKey = inPeakWindow ? 'peak' : 'valley';

    return {
        enabled: true,
        active: true,
        periodKey,
        periodLabel: inPeakWindow ? '峰时' : '谷时',
        inputPrice: normalizeOptionalPricingNumber(config[`${periodKey}_input_price_per_million`]),
        cachedInputPrice: normalizeOptionalPricingNumber(config[`${periodKey}_cached_input_price_per_million`]),
        outputPrice: normalizeOptionalPricingNumber(config[`${periodKey}_output_price_per_million`]),
    };
}

export function getRunCachedInputTokens(usage) {
    if (!usage || typeof usage !== 'object') {
        return null;
    }

    if (usage.cached_tokens === null || usage.cached_tokens === undefined) {
        return normalizeUsageNumber(usage.cache_read_tokens);
    }

    if (usage.cache_read_tokens === null || usage.cache_read_tokens === undefined) {
        return normalizeUsageNumber(usage.cached_tokens);
    }

    return Math.max(
        normalizeUsageNumber(usage.cached_tokens) ?? 0,
        normalizeUsageNumber(usage.cache_read_tokens) ?? 0,
    );
}

export function buildEstimatedPrice(run, settings) {
    const modelName = normalizeModelName(run?.model);
    const modelPrices = settings?.pricing?.model_prices && typeof settings.pricing.model_prices === 'object'
        ? settings.pricing.model_prices
        : {};
    const pricingEntry = resolvePricingModelEntry(modelName, modelPrices);
    if (!pricingEntry) {
        return null;
    }

    const config = pricingEntry.config;

    const usage = run?.response_usage;
    if (!usage || typeof usage !== 'object') {
        return null;
    }

    const promptTokens = normalizeUsageNumber(usage.prompt_tokens);
    const completionTokens = normalizeUsageNumber(usage.completion_tokens);
    const baseInputPrice = normalizeOptionalPricingNumber(config.input_price_per_million);
    const baseCachedInputPrice = normalizeOptionalPricingNumber(config.cached_input_price_per_million);
    const baseOutputPrice = normalizeOptionalPricingNumber(config.output_price_per_million);
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
    const boundedCachedInputTokens = promptTokens !== null && cachedInputTokens !== null
        ? Math.min(promptTokens, cachedInputTokens)
        : cachedInputTokens;
    const discountedCachedInputTokens = cachedInputPrice !== null
        ? (boundedCachedInputTokens ?? 0)
        : 0;
    const regularInputTokens = promptTokens !== null
        ? Math.max(0, promptTokens - discountedCachedInputTokens)
        : null;
    const regularInputCost = inputPrice !== null && promptTokens !== null
        ? (regularInputTokens * inputPrice) / 1000000
        : null;
    const cachedInputCost = cachedInputPrice !== null && boundedCachedInputTokens !== null
        ? (boundedCachedInputTokens * cachedInputPrice) / 1000000
        : null;
    const inputCost = (
        regularInputCost !== null
        || cachedInputCost !== null
        || (promptTokens !== null && inputPrice !== null)
    )
        ? (regularInputCost ?? 0) + (cachedInputCost ?? 0)
        : null;
    const outputCost = outputPrice !== null && completionTokens !== null
        ? (completionTokens * outputPrice) / 1000000
        : null;

    if (inputCost === null && outputCost === null) {
        return null;
    }

    const noteParts = [];
    const pricingPeriodLabel = peakValleySelection?.active ? `${peakValleySelection.periodLabel}` : '';
    if (inputCost !== null) {
        noteParts.push(cachedInputCost !== null ? `${pricingPeriodLabel}输入价格（缓存部分已折算）` : `${pricingPeriodLabel}输入价格`);
    }
    if (outputCost !== null) {
        noteParts.push(`${pricingPeriodLabel}输出价格`);
    }
    if (boundedCachedInputTokens !== null && boundedCachedInputTokens > 0) {
        if (cachedInputPrice === null && inputPrice !== null) {
            noteParts.push(pricingPeriodLabel ? `${pricingPeriodLabel}缓存输入暂按普通输入价估算` : '缓存输入暂按普通输入价估算');
        }
    }
    if (peakValleySelection?.enabled && !peakValleySelection.active) {
        noteParts.push('峰谷时段未完整配置，暂按普通价格估算');
    } else if (peakValleySelection?.active) {
        const fallbackUsed = (
            (peakValleySelection.inputPrice === null && baseInputPrice !== null)
            || (peakValleySelection.cachedInputPrice === null && baseCachedInputPrice !== null)
            || (peakValleySelection.outputPrice === null && baseOutputPrice !== null)
        );
        if (fallbackUsed) {
            noteParts.push('未填写的峰谷价格已回退普通单价');
        }
    }

    const pricingNote = noteParts.length >= 2
        ? `已按${noteParts.join('、')}估算`
        : (noteParts[0] ? `当前仅按${noteParts[0]}估算` : '当前按已配置价格估算');
    // 沿用别的名字算钱时必须说出来。悄悄回退算出的金额可能偏低（例如付费档套用了普通档单价），
    // 不写明就看不出来。
    const pricingSourceNote = pricingEntry.is_fallback
        ? `${pricingNote}。这个模型没有单独配价，沿用了 ${pricingEntry.model_name} 的价格`
        : pricingNote;

    return {
        currency: config.currency,
        total_cost: (inputCost ?? 0) + (outputCost ?? 0),
        input_cost: inputCost,
        regular_input_cost: regularInputCost,
        cached_input_cost: cachedInputCost,
        output_cost: outputCost,
        cached_input_tokens: boundedCachedInputTokens,
        regular_input_tokens: regularInputTokens,
        note: pricingSourceNote,
        pricing_model_name: pricingEntry.model_name,
        pricing_is_fallback: pricingEntry.is_fallback,
    };
}

export function buildAbnormalBillingDetail(run, settings) {
    const usage = run?.response_usage;
    const usageTotalTokens = getUsageTokenTotal(usage);
    const hasUsageTokens = usageTotalTokens > 0;
    const modelName = normalizeModelName(run?.model);
    const modelPrices = settings?.pricing?.model_prices && typeof settings.pricing.model_prices === 'object'
        ? settings.pricing.model_prices
        : {};
    const hasPricingConfig = Boolean(resolvePricingModelEntry(modelName, modelPrices));
    const estimatedPrice = buildEstimatedPrice(run, settings);
    const isPaidIncomplete = hasUsageTokens;

    let billingStatus = '';
    let billingNote = '';

    if (isPaidIncomplete) {
        billingStatus = 'paid_incomplete';
        billingNote = estimatedPrice?.note
            ?? (hasPricingConfig ? '已拿到 usage，但当前价格配置还不足以完成估算。' : '已拿到 usage，但当前模型还没有配置价格。');
    } else {
        billingStatus = 'usage_unconfirmed';
        billingNote = '当前没有拿到 usage，暂时无法确认这次异常是否已经计费。';
    }

    return {
        has_usage_tokens: hasUsageTokens,
        usage_total_tokens: hasUsageTokens ? usageTotalTokens : 0,
        has_pricing_config: hasPricingConfig,
        estimated_price: estimatedPrice,
        is_paid_incomplete: isPaidIncomplete,
        billing_status: billingStatus,
        billing_note: billingNote,
    };
}

// settings 由调用方传入：后端从文件读，前端从 IndexedDB 读，这里只管算。
export function buildAbnormalDetail(run, settings) {
    const abnormalType = detectAbnormalType(run);
    if (!abnormalType) {
        return null;
    }

    const failedStage = detectFailedStage(run);
    const suggestionResult = generateAbnormalOptimizationSuggestions({
        settings: settings ?? undefined,
        abnormalType,
        failedStage,
        isStreaming: run.stream,
        suspectedContextOverweight: isPromptLikelyOverweight(run),
        permissionLevel: run.permission_level,
        httpStatus: run.http_status,
        errorText: run.error,
        completionReason: run.response_finish_reason,
    });
    const billingDetail = buildAbnormalBillingDetail(run, settings ?? undefined);

    return {
        abnormal_type: abnormalType,
        failed_stage: failedStage,
        completion_reason: run.response_finish_reason ?? null,
        has_partial_output: hasRecordedOutput(run),
        is_streaming: run.stream,
        is_timeout: abnormalType === 'request_timeout',
        show_optimization_suggestions: suggestionResult.show_optimization_suggestions,
        optimization_suggestions: suggestionResult.optimization_suggestions,
        permission_level: suggestionResult.permission_level,
        ...billingDetail,
    };
}

export function normalizeUsageNumber(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

export function getNestedValue(source, path) {
    return path.reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), source);
}

export function readFirstUsageNumber(source, paths = []) {
    for (const path of paths) {
        const value = normalizeUsageNumber(getNestedValue(source, path));
        if (value !== null) {
            return value;
        }
    }

    return null;
}

export function buildResponseUsage(usage) {
    if (!usage || typeof usage !== 'object') {
        return null;
    }

    const promptTokens = normalizeUsageNumber(usage.prompt_tokens);
    const completionTokens = normalizeUsageNumber(usage.completion_tokens);
    const totalTokens = normalizeUsageNumber(usage.total_tokens);
    const reasoningTokens = readFirstUsageNumber(usage, [
        ['reasoning_tokens'],
        ['completion_tokens_details', 'reasoning_tokens'],
        ['output_tokens_details', 'reasoning_tokens'],
    ]);
    const cachedTokens = readFirstUsageNumber(usage, [
        ['cached_tokens'],
        ['prompt_tokens_details', 'cached_tokens'],
        ['input_tokens_details', 'cached_tokens'],
        ['input_tokens_details', 'cache_read_input_tokens'],
        ['cache_read_input_tokens'],
    ]);
    const cacheReadTokens = readFirstUsageNumber(usage, [
        ['cache_read_tokens'],
        ['cache_read_input_tokens'],
        ['input_tokens_details', 'cache_read_input_tokens'],
        ['prompt_tokens_details', 'cached_tokens'],
    ]);
    const cacheWriteTokens = readFirstUsageNumber(usage, [
        ['cache_write_tokens'],
        ['cache_creation_input_tokens'],
        ['input_tokens_details', 'cache_creation_input_tokens'],
        ['input_tokens_details', 'cache_write_tokens'],
    ]);
    const rawCacheHit = usage.cache_hit;
    const hasExplicitCacheHit = typeof rawCacheHit === 'boolean';
    const cacheHit = hasExplicitCacheHit
        ? rawCacheHit
        : Boolean(
            (cachedTokens !== null && cachedTokens > 0)
            || (cacheReadTokens !== null && cacheReadTokens > 0)
            || (cacheWriteTokens !== null && cacheWriteTokens > 0),
        );

    if (
        promptTokens === null
        && completionTokens === null
        && totalTokens === null
        && reasoningTokens === null
        && cachedTokens === null
        && cacheReadTokens === null
        && cacheWriteTokens === null
        && !hasExplicitCacheHit
    ) {
        return null;
    }

    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        reasoning_tokens: reasoningTokens,
        cache_hit: cacheHit,
        cached_tokens: cachedTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
    };
}

export function buildGeminiResponseUsage(usageMetadata) {
    if (!usageMetadata || typeof usageMetadata !== 'object') {
        return null;
    }

    return buildResponseUsage({
        prompt_tokens: readFirstUsageNumber(usageMetadata, [
            ['promptTokenCount'],
            ['inputTokenCount'],
        ]),
        completion_tokens: readFirstUsageNumber(usageMetadata, [
            ['candidatesTokenCount'],
            ['outputTokenCount'],
        ]),
        total_tokens: readFirstUsageNumber(usageMetadata, [
            ['totalTokenCount'],
        ]),
        cached_tokens: readFirstUsageNumber(usageMetadata, [
            ['cachedContentTokenCount'],
            ['cachedTokenCount'],
        ]),
        cache_hit: Boolean(readFirstUsageNumber(usageMetadata, [
            ['cachedContentTokenCount'],
            ['cachedTokenCount'],
        ])),
    });
}

export function buildAnthropicResponseUsage(usage) {
    if (!usage || typeof usage !== 'object') {
        return null;
    }

    const promptTokens = readFirstUsageNumber(usage, [
        ['input_tokens'],
    ]);
    const completionTokens = readFirstUsageNumber(usage, [
        ['output_tokens'],
    ]);
    const totalTokens = (
        promptTokens !== null || completionTokens !== null
    )
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : null;

    return buildResponseUsage({
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cache_read_tokens: readFirstUsageNumber(usage, [
            ['cache_read_input_tokens'],
        ]),
        cache_write_tokens: readFirstUsageNumber(usage, [
            ['cache_creation_input_tokens'],
        ]),
    });
}

export function normalizeCompletionReason(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!normalized) {
        return null;
    }

    if (normalized === 'length') {
        return 'max_tokens';
    }

    if (normalized === 'tool_use') {
        return 'tool_calls';
    }

    return normalized;
}

export function buildResponseCompletionReasonFromPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const choiceFinishReason = normalizeCompletionReason(payload?.choices?.[0]?.finish_reason);
    if (choiceFinishReason) {
        return choiceFinishReason;
    }

    const messageStopReason = normalizeCompletionReason(payload?.message?.stop_reason);
    if (messageStopReason) {
        return messageStopReason;
    }

    const payloadStopReason = normalizeCompletionReason(payload?.stop_reason);
    if (payloadStopReason) {
        return payloadStopReason;
    }

    const candidateFinishReason = normalizeCompletionReason(payload?.candidates?.[0]?.finishReason);
    if (candidateFinishReason) {
        return candidateFinishReason;
    }

    const promptBlockReason = normalizeCompletionReason(payload?.promptFeedback?.blockReason);
    if (promptBlockReason) {
        return promptBlockReason;
    }

    return null;
}

export function buildResponseUsageFromPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    if (payload.usage && typeof payload.usage === 'object') {
        return buildResponseUsage(payload.usage);
    }

    if (payload.usageMetadata && typeof payload.usageMetadata === 'object') {
        return buildGeminiResponseUsage(payload.usageMetadata);
    }

    if (payload.usage_metadata && typeof payload.usage_metadata === 'object') {
        return buildGeminiResponseUsage(payload.usage_metadata);
    }

    if (payload.usage && typeof payload.usage === 'object') {
        const anthropicUsage = buildAnthropicResponseUsage(payload.usage);
        if (anthropicUsage) {
            return anthropicUsage;
        }
    }

    if (payload.message?.usage && typeof payload.message.usage === 'object') {
        return buildAnthropicResponseUsage(payload.message.usage);
    }

    return null;
}

export function getUsageTokenTotal(usage) {
    if (!usage || typeof usage !== 'object') {
        return 0;
    }

    const totalTokens = normalizeUsageNumber(usage.total_tokens);
    if (totalTokens !== null) {
        return totalTokens;
    }

    const promptTokens = normalizeUsageNumber(usage.prompt_tokens) ?? 0;
    const completionTokens = normalizeUsageNumber(usage.completion_tokens) ?? 0;
    return promptTokens + completionTokens;
}

export function shouldReplaceCapturedUsage(currentUsage, nextUsage) {
    if (!nextUsage) {
        return false;
    }

    if (!currentUsage) {
        return true;
    }

    const currentUsageTotal = getUsageTokenTotal(currentUsage);
    const nextUsageTotal = getUsageTokenTotal(nextUsage);

    if (currentUsageTotal <= 0 && nextUsageTotal > 0) {
        return true;
    }

    if (currentUsageTotal > 0 && nextUsageTotal <= 0) {
        return false;
    }

    return nextUsageTotal >= currentUsageTotal;
}

export function processSseUsageEvent(run, eventBlock) {
    if (!eventBlock) {
        return;
    }

    const payloadText = eventBlock
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .filter(Boolean)
        .join('\n')
        .trim();

    if (!payloadText || payloadText === '[DONE]') {
        return;
    }

    try {
        const payload = JSON.parse(payloadText);
        const usage = buildResponseUsageFromPayload(payload);
        const completionReason = buildResponseCompletionReasonFromPayload(payload);
        if (shouldReplaceCapturedUsage(run.response_usage, usage)) {
            run.response_usage = usage;
        }
        if (completionReason) {
            run.response_finish_reason = completionReason;
        }
    } catch {
        // Ignore non-JSON SSE frames.
    }
}

export function findSseEventBoundary(buffer) {
    const lfIndex = buffer.indexOf('\n\n');
    const crlfIndex = buffer.indexOf('\r\n\r\n');

    if (lfIndex === -1) {
        return crlfIndex === -1 ? null : { index: crlfIndex, length: 4 };
    }

    if (crlfIndex === -1 || lfIndex < crlfIndex) {
        return { index: lfIndex, length: 2 };
    }

    return { index: crlfIndex, length: 4 };
}
