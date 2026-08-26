import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

import { generateAbnormalOptimizationSuggestions } from './settings-ui/service/abnormal-optimization-suggestion-service.js';
import { readMonitorSettings } from './settings-ui/service/monitor-settings-store.js';
import { inferPermissionLevelFromHost } from './settings-ui/service/monitor-settings-validator.js';
import {
    buildPromptMarkerSnapshot,
    findMatchingLearnedPluginRuleForRequest,
} from './shared/plugin-rule-service.js';

const LOG_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const LOG_FILE = path.join(LOG_DIR, 'runs.jsonl');
const REQUEST_PURPOSE_VALUES = new Set(['chat_main_reply', 'non_chat_generation', 'plugin_internal_request']);
const KNOWN_PLUGIN_LABELS = new Map([
    ['st-baibai-inkwell', '柏宝砚'],
    ['st-baibai-book', '柏宝书'],
    ['baibai_book', '柏宝书'],
    ['schedule-planner', '构画'],
    ['st-sevendayscal', '构画'],
    ['st-seven-days-cal', '构画'],
]);
const KNOWN_INJECTION_SOURCE_LABELS = new Map([
    ...KNOWN_PLUGIN_LABELS.entries(),
    ['abstract-external-phone', 'Abstract外置手机'],
    ['abstract_external_phone', 'Abstract外置手机'],
    ['abstract-phone', 'Abstract外置手机'],
    ['abstract_phone', 'Abstract外置手机'],
]);
const PLUGIN_FINGERPRINT_RULES = [
    {
        pluginId: 'st-baibai-book',
        pluginLabel: '柏宝书',
        markerPatterns: [
            /<bbs_start\b/i,
            /<\/bbs_end>/i,
            /【完整时间锚点格式(?:\(系统强制\)|（系统强制）)】/,
            /【时间锚点要求(?:\(系统强制\)|（系统强制）)】/,
            /本段开始时的故事内时间/,
            /本段结束时的故事内时间/,
            /YYYY\/M\/D HH:mm/i,
            /baibai_book/i,
        ],
        minHits: 2,
    },
    {
        pluginId: 'st-baibai-inkwell',
        pluginLabel: '柏宝砚',
        markerPatterns: [
            /<horae[\s\S]*?>/i,
            /\[柏宝砚\]/,
            /世界书激活失败，继续执行不带世界书的改写/,
            /世界书 EJS 渲染失败，使用宏展开后的文本/,
        ],
        minHits: 1,
    },
    {
        pluginId: 'schedule-planner',
        pluginLabel: '构画',
        markerPatterns: [
            /<outline_widget>/i,
            /<line_widget(?:\s|>)/i,
            /<schedule_widget(?:\s|>)/i,
            /<almanac_widget>/i,
            /【当前的点·按序号】/,
            /【当前的线·按序号】/,
            /【本世界观·重要日期（历）】/,
            /Beat:\s*[^|\n]+\|[^|\n]+\|[^|\n]+\|[^|\n]+\|[^\n]+/,
            /Subtext:\s*/,
            /Think:\s*/,
            /Item:\s*[^|\n]+\|(?:festival|birthday|anniversary|custom)\|/,
            /Line:\s*[^|\n]+\|[^|\n]+\|[^|\n]+\|[^|\n]+\|[^|\n]+\|(?:player|world)\|(?:true|false)/i,
        ],
        minHits: 2,
    },
];

function normalizeOptionalText(value, maxLength = 120) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    return trimmed.slice(0, maxLength);
}

function getKnownPluginLabel(pluginId) {
    const normalizedPluginId = normalizeOptionalText(pluginId);
    if (!normalizedPluginId) {
        return null;
    }

    return KNOWN_PLUGIN_LABELS.get(normalizedPluginId.toLowerCase()) ?? null;
}

function normalizeRequestPlugin(value) {
    return normalizeOptionalText(value);
}

function normalizeRequestPluginLabel(pluginId, value) {
    return normalizeOptionalText(value) ?? getKnownPluginLabel(pluginId);
}

function getKnownInjectionSourceLabel(sourceId) {
    const normalizedSourceId = normalizeOptionalText(sourceId);
    if (!normalizedSourceId) {
        return null;
    }

    return KNOWN_INJECTION_SOURCE_LABELS.get(normalizedSourceId.toLowerCase()) ?? null;
}

function normalizeRequestInjectionSource(value) {
    return normalizeOptionalText(value);
}

function normalizeRequestInjectionSourceLabel(sourceId, value) {
    return normalizeOptionalText(value) ?? getKnownInjectionSourceLabel(sourceId);
}

function normalizeRequestChatKey(value) {
    return normalizeOptionalText(value, 200);
}

function normalizeRequestChatId(value) {
    return normalizeOptionalText(value, 200);
}

function normalizeRequestChatIdHash(value) {
    return normalizeOptionalText(value, 200);
}

function normalizeRequestChatName(value) {
    return normalizeOptionalText(value, 200);
}

function resolveExplicitInjectionSource(requestBody) {
    const sourceId = normalizeRequestInjectionSource(
        requestBody?.request_injection_source
        ?? requestBody?.injection_source
        ?? requestBody?.extension_prompt_source
        ?? requestBody?.prompt_injection_source
    );
    const sourceLabel = normalizeRequestInjectionSourceLabel(
        sourceId,
        requestBody?.request_injection_source_label
        ?? requestBody?.injection_source_label
        ?? requestBody?.extension_prompt_source_label
        ?? requestBody?.prompt_injection_source_label
    );

    return {
        sourceId,
        sourceLabel,
    };
}

function collectMessageTexts(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }

    const texts = [];

    function visit(value) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed) {
                texts.push(trimmed);
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

    return texts;
}

function inferPluginFromRequest(requestBody) {
    const explicitPluginId = normalizeRequestPlugin(requestBody?.request_plugin);
    const explicitPluginLabel = normalizeRequestPluginLabel(explicitPluginId, requestBody?.request_plugin_label);
    if (explicitPluginId || explicitPluginLabel) {
        return {
            pluginId: explicitPluginId,
            pluginLabel: explicitPluginLabel,
            matchMode: explicitPluginId ? 'explicit' : 'explicit_label_only',
            matchScore: 0,
        };
    }

    const learnedRuleMatch = findMatchingLearnedPluginRuleForRequest(requestBody);
    if (learnedRuleMatch?.pluginId || learnedRuleMatch?.pluginLabel) {
        return {
            pluginId: learnedRuleMatch.pluginId,
            pluginLabel: learnedRuleMatch.pluginLabel,
            matchMode: learnedRuleMatch.matchMode,
            matchScore: learnedRuleMatch.matchScore,
        };
    }

    const joinedText = collectMessageTexts(requestBody?.messages).join('\n');
    if (!joinedText) {
        return {
            pluginId: null,
            pluginLabel: null,
            matchMode: 'none',
            matchScore: 0,
        };
    }

    for (const rule of PLUGIN_FINGERPRINT_RULES) {
        let hits = 0;
        for (const pattern of rule.markerPatterns) {
            if (pattern.test(joinedText)) {
                hits += 1;
            }
        }

        if (hits >= rule.minHits) {
            return {
                pluginId: rule.pluginId,
                pluginLabel: rule.pluginLabel,
                matchMode: 'fingerprint',
                matchScore: hits,
            };
        }
    }

    return {
        pluginId: null,
        pluginLabel: null,
        matchMode: 'none',
        matchScore: 0,
    };
}

function nowMs() {
    return Date.now();
}

function safeStringifyLength(value) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return null;
    }
}

function createRoleSummary() {
    return {
        count: 0,
        chars: 0,
    };
}

function collectContentStats(content) {
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

function summarizeMessages(messages) {
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

    const topMessages = [...messageSizes]
        .sort((a, b) => b.chars - a.chars)
        .slice(0, 5);

    const recentMessages = messageSizes.slice(-6);

    return {
        mode: 'messages',
        total_messages: messages.length,
        total_chars: messageSizes.reduce((sum, item) => sum + item.chars, 0),
        role_totals: roleTotals,
        top_messages: topMessages,
        recent_messages: recentMessages,
        message_sizes: messageSizes,
    };
}

function summarizePrompt(messages) {
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

function hasRecordedOutput(run) {
    return run.output_bytes > 0 || (typeof run.output_chars === 'number' && run.output_chars > 0);
}

function detectFailedStage(run) {
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

function detectAbnormalType(run) {
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

function isPromptLikelyOverweight(run) {
    const totalChars = run.prompt_breakdown?.total_chars ?? run.prompt_chars ?? 0;
    const totalMessages = run.prompt_breakdown?.total_messages ?? run.message_count ?? 0;
    return totalChars >= 32000 || totalMessages >= 80;
}

function normalizePricingCurrency(value) {
    return value === 'cny' ? 'cny' : 'usd';
}

function normalizeModelName(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : '';
}

function normalizeOptionalPricingNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function normalizePricingConfig(config) {
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
    ].some((fieldName) => normalizeOptionalPricingNumber(config?.[fieldName]) !== null);
}

function convertPricingTimeToMinutes(value) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
        return null;
    }

    const [hours, minutes] = value.split(':').map(Number);
    return (hours * 60) + minutes;
}

function getRunPricingReferenceDate(run) {
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

function getRunPeakValleySelection(run, config) {
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

function getRunCachedInputTokens(usage) {
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

function buildEstimatedPrice(run, settings) {
    const modelName = normalizeModelName(run?.model);
    const modelPrices = settings?.pricing?.model_prices && typeof settings.pricing.model_prices === 'object'
        ? settings.pricing.model_prices
        : {};
    const config = normalizePricingConfig(modelPrices[modelName]);
    if (!config || !hasConfiguredPricingValue(config)) {
        return null;
    }

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

    return {
        currency: config.currency,
        total_cost: (inputCost ?? 0) + (outputCost ?? 0),
        input_cost: inputCost,
        regular_input_cost: regularInputCost,
        cached_input_cost: cachedInputCost,
        output_cost: outputCost,
        cached_input_tokens: boundedCachedInputTokens,
        regular_input_tokens: regularInputTokens,
        note: pricingNote,
    };
}

function buildAbnormalBillingDetail(run, settings) {
    const usage = run?.response_usage;
    const usageTotalTokens = getUsageTokenTotal(usage);
    const hasUsageTokens = usageTotalTokens > 0;
    const modelName = normalizeModelName(run?.model);
    const modelPrices = settings?.pricing?.model_prices && typeof settings.pricing.model_prices === 'object'
        ? settings.pricing.model_prices
        : {};
    const config = normalizePricingConfig(modelPrices[modelName]);
    const hasPricingConfig = Boolean(config && hasConfiguredPricingValue(config));
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

async function buildAbnormalDetail(run) {
    const abnormalType = detectAbnormalType(run);
    if (!abnormalType) {
        return null;
    }

    const settings = await readMonitorSettings().catch(() => null);
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

async function appendRun(run) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, `${JSON.stringify(run)}\n`, 'utf8');
}

function normalizeUsageNumber(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function getNestedValue(source, path) {
    return path.reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), source);
}

function readFirstUsageNumber(source, paths = []) {
    for (const path of paths) {
        const value = normalizeUsageNumber(getNestedValue(source, path));
        if (value !== null) {
            return value;
        }
    }

    return null;
}

function buildResponseUsage(usage) {
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

function buildGeminiResponseUsage(usageMetadata) {
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

function buildAnthropicResponseUsage(usage) {
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

function normalizeCompletionReason(value) {
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

function buildResponseCompletionReasonFromPayload(payload) {
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

function buildResponseUsageFromPayload(payload) {
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

function getUsageTokenTotal(usage) {
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

function shouldReplaceCapturedUsage(currentUsage, nextUsage) {
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

function processSseUsageEvent(run, eventBlock) {
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
        // #region debug-point A:stream-usage-payload
        if (payload?.usage || payload?.usageMetadata || payload?.usage_metadata) {
            console.info('[DEBUG] stream-usage-zero payload', JSON.stringify({
                runId: run.id,
                model: run.model,
                source: run.source,
                usage: payload.usage ?? null,
                usageMetadata: payload.usageMetadata ?? payload.usage_metadata ?? null,
                choicesLength: Array.isArray(payload.choices) ? payload.choices.length : null,
            }));
        }
        // #endregion
        const usage = buildResponseUsageFromPayload(payload);
        const completionReason = buildResponseCompletionReasonFromPayload(payload);
        // #region debug-point B:stream-usage-normalized
        if (usage) {
            console.info('[DEBUG] stream-usage-zero normalized', JSON.stringify({
                runId: run.id,
                model: run.model,
                source: run.source,
                usage,
            }));
        }
        // #endregion
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

function findSseEventBoundary(buffer) {
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

function normalizeRequestPurpose(value) {
    return REQUEST_PURPOSE_VALUES.has(value) ? value : 'chat_main_reply';
}

function resolveRequestPurpose(requestBody, inferredPlugin) {
    const explicitPurpose = normalizeRequestPurpose(requestBody?.request_purpose);
    if (REQUEST_PURPOSE_VALUES.has(requestBody?.request_purpose)) {
        return explicitPurpose;
    }

    if (inferredPlugin?.pluginId || inferredPlugin?.pluginLabel) {
        return 'non_chat_generation';
    }

    return explicitPurpose;
}

export function createGenerationMonitor(request) {
    const startedAtMs = nowMs();
    const requestHost = request?.headers?.['x-forwarded-host']
        ?? request?.headers?.host
        ?? request?.hostname
        ?? '';
    const promptSnapshot = buildPromptMarkerSnapshot({
        messages: request?.body?.messages,
        promptTrace: request?.body?.prompt_trace,
    });
    const inferredPlugin = inferPluginFromRequest(request?.body);
    const explicitInjectionSource = resolveExplicitInjectionSource(request?.body);
    const run = {
        id: crypto.randomUUID(),
        started_at_iso: new Date(startedAtMs).toISOString(),
        started_at_ms: startedAtMs,
        entry_origin: 'main_interface_generation',
        request_purpose: resolveRequestPurpose(request.body, inferredPlugin),
        request_plugin: inferredPlugin.pluginId,
        request_plugin_label: inferredPlugin.pluginLabel,
        request_plugin_match_mode: inferredPlugin.matchMode,
        request_plugin_match_score: inferredPlugin.matchScore,
        request_injection_source: explicitInjectionSource.sourceId,
        request_injection_source_label: explicitInjectionSource.sourceLabel,
        request_chat_key: normalizeRequestChatKey(request.body?.request_chat_key),
        request_chat_id: normalizeRequestChatId(request.body?.request_chat_id),
        request_chat_id_hash: normalizeRequestChatIdHash(request.body?.request_chat_id_hash),
        request_chat_name: normalizeRequestChatName(request.body?.request_chat_name),
        permission_level: inferPermissionLevelFromHost(requestHost, 'cloud_full'),
        stream: Boolean(request.body?.stream),
        source: request.body?.chat_completion_source ?? null,
        model: request.body?.model ?? null,
        user_handle: request.user?.profile?.handle ?? null,
        max_tokens: request.body?.max_tokens ?? null,
        max_completion_tokens: request.body?.max_completion_tokens ?? null,
        message_count: Array.isArray(request.body?.messages) ? request.body.messages.length : null,
        prompt_chars: Array.isArray(request.body?.messages)
            ? safeStringifyLength(request.body.messages)
            : typeof request.body?.messages === 'string'
              ? request.body.messages.length
              : null,
        prompt_markers: promptSnapshot.promptMarkers,
        prompt_trace_keys: promptSnapshot.promptTraceKeys,
        prompt_breakdown: summarizePrompt(request.body?.messages),
        prompt_trace: Array.isArray(request.body?.prompt_trace) ? request.body.prompt_trace : null,
        phases: {},
        metrics: {},
        http_status: null,
        response_usage: null,
        response_finish_reason: null,
        output_bytes: 0,
        output_chars: null,
        error: null,
    };

    let finalized = false;
    let settleStreamParsing = null;
    let streamParsingPromise = Promise.resolve();

    function mark(name) {
        if (!run.phases[name]) {
            run.phases[name] = nowMs();
        }
    }

    function setHttpStatus(status) {
        run.http_status = status;
    }

    function captureJson(json) {
        run.output_chars = safeStringifyLength(json);
        const usage = buildResponseUsageFromPayload(json);
        const completionReason = buildResponseCompletionReasonFromPayload(json);
        if (shouldReplaceCapturedUsage(run.response_usage, usage)) {
            run.response_usage = usage;
        }
        if (completionReason) {
            run.response_finish_reason = completionReason;
        }
    }

    function captureText(text) {
        run.output_chars = typeof text === 'string' ? text.length : null;
    }

    function captureError(error) {
        run.error = error instanceof Error ? error.message : String(error);
    }

    function attachStream(fetchResponse) {
        const body = fetchResponse?.body;
        if (!body || typeof body.on !== 'function') {
            return;
        }

        streamParsingPromise = new Promise((resolve) => {
            settleStreamParsing = resolve;
        });

        const decoder = new StringDecoder('utf8');
        let sseBuffer = '';
        let streamSettled = false;

        function flushSseBuffer(flushRemainder = false) {
            while (true) {
                const boundary = findSseEventBoundary(sseBuffer);
                if (!boundary) {
                    break;
                }

                const eventBlock = sseBuffer.slice(0, boundary.index);
                sseBuffer = sseBuffer.slice(boundary.index + boundary.length);
                processSseUsageEvent(run, eventBlock);
            }

            if (flushRemainder && sseBuffer.trim()) {
                processSseUsageEvent(run, sseBuffer);
                sseBuffer = '';
            }
        }

        function settleStream({ markCompleted = false, markErrored = false, error = null } = {}) {
            if (streamSettled) {
                return;
            }

            streamSettled = true;
            sseBuffer += decoder.end();
            flushSseBuffer(true);

            if (markCompleted) {
                mark('stream_completed');
            }

            if (markErrored) {
                mark('stream_error');
            }

            if (error) {
                captureError(error);
            }

            settleStreamParsing?.();
        }

        body.on('data', (chunk) => {
            mark('first_chunk_received');
            run.output_bytes += Buffer.byteLength(chunk);
            sseBuffer += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
            flushSseBuffer();
        });

        body.on('end', () => {
            settleStream({ markCompleted: true });
        });

        body.on('error', (error) => {
            settleStream({ markErrored: true, error });
        });

        body.on('aborted', () => {
            settleStream({
                markErrored: true,
                error: new Error('Upstream stream was aborted before completion.'),
            });
        });

        body.on('close', () => {
            if (run.phases.stream_completed || run.phases.stream_error) {
                settleStream();
                return;
            }

            settleStream({
                markErrored: true,
                error: new Error('Upstream stream closed before completion.'),
            });
        });
    }

    async function finalize(extra = {}) {
        if (finalized) {
            return;
        }

        finalized = true;
        if (run.stream) {
            await streamParsingPromise;
        }
        const finishedAtMs = nowMs();
        run.finished_at_iso = new Date(finishedAtMs).toISOString();
        run.finished_at_ms = finishedAtMs;

        Object.assign(run, extra);

        const phases = run.phases;
        run.metrics.total_ms = finishedAtMs - startedAtMs;

        if (phases.preprocess_completed) {
            run.metrics.preprocess_ms = phases.preprocess_completed - startedAtMs;
        }

        if (phases.upstream_request_started && phases.upstream_headers_received) {
            run.metrics.upstream_headers_ms = phases.upstream_headers_received - phases.upstream_request_started;
        }

        if (phases.upstream_request_started && phases.first_chunk_received) {
            run.metrics.ttft_ms = phases.first_chunk_received - phases.upstream_request_started;
        }

        if (phases.first_chunk_received && phases.stream_completed) {
            run.metrics.stream_ms = phases.stream_completed - phases.first_chunk_received;
        }

        if (!run.stream && phases.upstream_request_started) {
            run.metrics.nonstream_response_ms = finishedAtMs - phases.upstream_request_started;
        }

        run.abnormal_detail = await buildAbnormalDetail(run);

        await appendRun(run);
    }

    return {
        run,
        mark,
        setHttpStatus,
        captureJson,
        captureText,
        captureError,
        attachStream,
        finalize,
    };
}
