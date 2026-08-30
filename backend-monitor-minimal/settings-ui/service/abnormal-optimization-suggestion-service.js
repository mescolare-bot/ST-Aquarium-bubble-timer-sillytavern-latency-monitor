import {
    abnormalOptimizationContextSuggestionRules,
    abnormalOptimizationFailedGenerationTypes,
    abnormalOptimizationStageSuggestionRules,
    abnormalOptimizationStreamingRelevantTypes,
    abnormalOptimizationStreamingSuggestionRules,
    abnormalOptimizationSuggestionRules,
    abnormalOptimizationSuppressedTypes,
} from '../config/abnormal-optimization-suggestion-rules.js';
import { cloneMonitorSettingsDefaults } from '../config/monitor-settings-default.js';
import { resolvePermissionLevel } from './monitor-settings-validator.js';

function getSuggestionScope(settings) {
    return settings?.display?.abnormal_optimization_suggestion_scope
        ?? cloneMonitorSettingsDefaults().display.abnormal_optimization_suggestion_scope;
}

function getSuggestionLimit(settings) {
    return settings?.display?.abnormal_optimization_suggestion_limit
        ?? cloneMonitorSettingsDefaults().display.abnormal_optimization_suggestion_limit;
}

function shouldUsePermissionEnhancedSuggestions(settings, permissionLevel) {
    if (permissionLevel === 'no_backend') {
        return false;
    }

    return settings?.display?.show_permission_enhanced_suggestions !== false;
}

function shouldShowSuggestions(settings, abnormalType) {
    if (settings?.display?.show_abnormal_optimization_suggestions === false) {
        return false;
    }

    if (!abnormalType) {
        return false;
    }

    // 这类不是故障，无论范围设成什么都不给建议。
    if (abnormalOptimizationSuppressedTypes.includes(abnormalType)) {
        return false;
    }

    const scope = getSuggestionScope(settings);
    if (scope === 'all_abnormal') {
        return true;
    }

    return abnormalOptimizationFailedGenerationTypes.includes(abnormalType);
}

function uniqueSuggestions(values) {
    const seen = new Set();
    const output = [];

    for (const value of values) {
        if (typeof value !== 'string' || !value.length || seen.has(value)) {
            continue;
        }

        seen.add(value);
        output.push(value);
    }

    return output;
}

// 同一个意思换个措辞写两遍会白白吃掉本就只有三条的名额，而字面去重抓不到。
// 这里只收口实际会撞车的几个主题，先出现的留下（证据类排在最前，优先级最高）。
const SUGGESTION_TOPIC_PATTERNS = [
    /最大输出长度|长度上限/,
    /续写/,
    /流式输出/,
    /聊天历史/,
    /代理和网络|代理节点/,
];

// 一条建议可能同时压中多个主题（"调大上限，或者直接续写"就同时占了上限和续写），
// 所以要把命中的主题全部登记，否则后面单说"续写"的那条还是会漏进来。
function dedupeSuggestionsByTopic(values) {
    const seenTopics = new Set();
    const output = [];

    for (const value of uniqueSuggestions(values)) {
        const topicIndexes = [];
        SUGGESTION_TOPIC_PATTERNS.forEach((pattern, index) => {
            if (pattern.test(value)) {
                topicIndexes.push(index);
            }
        });

        if (topicIndexes.some((index) => seenTopics.has(index))) {
            continue;
        }

        for (const index of topicIndexes) {
            seenTopics.add(index);
        }

        output.push(value);
    }

    return output;
}

function normalizeSuggestionErrorText(value) {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

function matchesAnyKeyword(text, patterns) {
    if (!text) {
        return false;
    }

    return patterns.some((pattern) => pattern.test(text));
}

function buildEvidenceSuggestions({ httpStatus = null, errorText = '', completionReason = '' } = {}) {
    const normalizedErrorText = normalizeSuggestionErrorText(errorText);
    const normalizedCompletionReason = normalizeSuggestionErrorText(completionReason);
    const suggestions = [];

    const hasInvalidApiKeyEvidence = matchesAnyKeyword(normalizedErrorText, [
        /invalid_api_key/,
        /incorrect api key/,
        /invalid api key/,
        /api key.+invalid/,
        /authentication failed/,
    ]);
    if (hasInvalidApiKeyEvidence) {
        suggestions.push('API Key 可能填错、过期，或者前后多了空格，先核对一遍');
    }

    const hasInsufficientQuotaEvidence = matchesAnyKeyword(normalizedErrorText, [
        /insufficient_quota/,
        /quota exceeded/,
        /billing hard limit/,
        /quota_error/,
        /credit balance is too low/,
    ]);
    if (hasInsufficientQuotaEvidence) {
        suggestions.push('账号余额或套餐额度大概率用完了，去服务方后台看一眼');
    }

    const hasRateLimitExceededEvidence = matchesAnyKeyword(normalizedErrorText, [
        /rate_limit_exceeded/,
        /rate limit reached/,
        /too many requests/,
        /requests per min/,
        /tokens per min/,
    ]);
    if (hasRateLimitExceededEvidence) {
        suggestions.push('这是瞬时限流，不是余额问题，等一两分钟再发或降低并发');
    }

    const hasDeploymentNotFoundEvidence = matchesAnyKeyword(normalizedErrorText, [
        /deployment.+not found/,
        /deployment_not_found/,
        /unknown deployment/,
    ]);
    if (hasDeploymentNotFoundEvidence) {
        suggestions.push('部署名称填错了，注意这一栏要填部署名，不是模型名');
    }

    const hasModelNotFoundEvidence = matchesAnyKeyword(normalizedErrorText, [
        /model.+not found/,
        /model_not_found/,
        /unknown model/,
        /no such model/,
    ]);
    if (hasModelNotFoundEvidence) {
        suggestions.push('模型 ID 填错了，或者当前渠道不支持这个模型');
    }

    const hasContextLengthEvidence = matchesAnyKeyword(normalizedErrorText, [
        /context_length_exceeded/,
        /maximum context length/,
        /too many tokens/,
        /prompt is too long/,
        /max context length/,
    ]);
    if (hasContextLengthEvidence) {
        suggestions.push('上下文超出了模型上限，先砍掉一部分聊天历史、世界书和记忆');
    }

    const hasContentFilterEvidence = matchesAnyKeyword(normalizedErrorText, [
        /content_filter/,
        /safety/,
        /blocked/,
        /filtered/,
        /policy/,
        /moderation/,
    ]) || matchesAnyKeyword(normalizedCompletionReason, [
        /content_filter/,
        /safety/,
        /prohibited_content/,
        /blocklist/,
    ]);
    if (hasContentFilterEvidence) {
        suggestions.push('内容触发了安全拦截，重试没用，改写这一楼的内容再发');
    }

    const hasOutputLimitEvidence = matchesAnyKeyword(normalizedErrorText, [
        /max_tokens/,
        /finish_reason.+length/,
        /completion truncated/,
        /output truncated/,
    ]) || matchesAnyKeyword(normalizedCompletionReason, [
        /^length$/,
        /max_tokens/,
    ]);
    if (hasOutputLimitEvidence) {
        suggestions.push('输出被长度上限截断了，调大最大输出长度，或者直接让它续写');
    }

    const hasConnectionRefusedEvidence = matchesAnyKeyword(normalizedErrorText, [
        /econnrefused/,
        /connection refused/,
    ]);
    if (hasConnectionRefusedEvidence) {
        suggestions.push('接口地址或端口连不上，先确认那边的服务是不是真的在跑');
    }

    const hasDnsFailureEvidence = matchesAnyKeyword(normalizedErrorText, [
        /enotfound/,
        /eai_again/,
        /dns/,
        /name resolution/,
    ]);
    if (hasDnsFailureEvidence) {
        suggestions.push('域名解析失败，检查地址有没有写错，以及代理的 DNS 设置');
    }

    const hasConnectionResetEvidence = matchesAnyKeyword(normalizedErrorText, [
        /econnreset/,
        /socket hang up/,
        /connection reset/,
        /unexpected eof/,
    ]);
    if (hasConnectionResetEvidence) {
        suggestions.push('连接中途被断开了，检查代理或网关是否稳定');
    }

    const hasAuthEvidence = !hasInvalidApiKeyEvidence && (httpStatus === 401
        || httpStatus === 403
        || matchesAnyKeyword(normalizedErrorText, [
            /unauthorized/,
            /forbidden/,
            /authentication/,
            /auth token/,
            /permission denied/,
            /access denied/,
        ]));
    if (hasAuthEvidence) {
        suggestions.push('密钥或账号权限有问题，先核对 API 密钥和账号配置');
    }

    const hasModelConfigEvidence = !hasDeploymentNotFoundEvidence
        && !hasModelNotFoundEvidence
        && (httpStatus === 404
            || matchesAnyKeyword(normalizedErrorText, [
                /resource not found/,
                /endpoint.+not found/,
            ]));
    if (hasModelConfigEvidence) {
        suggestions.push('模型名称、接口地址、部署名称这三个里有一个填错了');
    }

    const hasRequestConfigEvidence = !hasContextLengthEvidence
        && (httpStatus === 400
            || httpStatus === 422
            || matchesAnyKeyword(normalizedErrorText, [
                /invalid request/,
                /bad request/,
                /invalid parameter/,
                /unsupported/,
                /malformed/,
                /invalid_request_error/,
            ]));
    if (hasRequestConfigEvidence) {
        suggestions.push('当前模型不接受这次的请求参数，先检查接口格式和上下文大小');
    }

    const hasRateLimitEvidence = !hasInsufficientQuotaEvidence
        && !hasRateLimitExceededEvidence
        && (httpStatus === 429
            || matchesAnyKeyword(normalizedErrorText, [
                /rate limit/,
                /too many requests/,
            ]));
    if (hasRateLimitEvidence) {
        suggestions.push('额度或限流拦住了这次请求，先看余额，再考虑等会儿重试');
    }

    const hasConnectivityEvidence = !hasConnectionRefusedEvidence
        && !hasDnsFailureEvidence
        && !hasConnectionResetEvidence
        && matchesAnyKeyword(normalizedErrorText, [
            /network error/,
            /fetch failed/,
            /unable to connect/,
            /proxy/,
            /tunnel/,
            /certificate/,
            /tls/,
            /ssl/,
        ]);
    if (hasConnectivityEvidence) {
        suggestions.push('连不上上游接口，检查代理、网关和接口地址');
    }

    const hasTimeoutEvidence = httpStatus === 408
        || httpStatus === 504
        || matchesAnyKeyword(normalizedErrorText, [
            /timeout/,
            /timed out/,
            /time out/,
            /etimedout/,
        ]);
    if (hasTimeoutEvidence) {
        suggestions.push('这次请求超时了，调大超时时间，或者换一个响应更快的模型');
    }

    const hasUpstreamInstabilityEvidence = (typeof httpStatus === 'number' && httpStatus >= 500)
        || matchesAnyKeyword(normalizedErrorText, [
            /bad gateway/,
            /gateway timeout/,
            /service unavailable/,
            /internal server error/,
            /server error/,
            /upstream/,
            /overloaded/,
            /temporarily unavailable/,
        ]);
    if (hasUpstreamInstabilityEvidence) {
        suggestions.push('上游服务在波动，等几分钟再试，或者换一个模型');
    }

    return uniqueSuggestions(suggestions).slice(0, 2);
}

export function generateAbnormalOptimizationSuggestions({
    settings = cloneMonitorSettingsDefaults(),
    permissionLevel,
    abnormalType,
    failedStage,
    isStreaming = false,
    suspectedContextOverweight = false,
    httpStatus = null,
    errorText = '',
    completionReason = '',
} = {}) {
    const resolvedPermissionLevel = resolvePermissionLevel(settings, permissionLevel ?? 'local_full');

    if (!shouldShowSuggestions(settings, abnormalType)) {
        return {
            show_optimization_suggestions: false,
            optimization_suggestions: null,
            permission_level: resolvedPermissionLevel,
        };
    }

    const suggestions = [];
    const abnormalRule = abnormalOptimizationSuggestionRules[abnormalType];
    const usePermissionEnhancedSuggestions = shouldUsePermissionEnhancedSuggestions(settings, resolvedPermissionLevel);
    const baseSuggestions = abnormalRule?.base ?? [];
    const permissionSuggestions = usePermissionEnhancedSuggestions && abnormalRule?.[resolvedPermissionLevel]
        ? abnormalRule[resolvedPermissionLevel]
        : [];
    const stageSuggestions = abnormalOptimizationStageSuggestionRules[failedStage] ?? [];
    const streamingSuggestions = isStreaming && abnormalOptimizationStreamingRelevantTypes.includes(abnormalType)
        ? abnormalOptimizationStreamingSuggestionRules.streaming
        : [];
    const contextSuggestions = suspectedContextOverweight ? abnormalOptimizationContextSuggestionRules : [];
    const evidenceSuggestions = buildEvidenceSuggestions({ httpStatus, errorText, completionReason });

    suggestions.push(...evidenceSuggestions);

    if (baseSuggestions.length) {
        suggestions.push(baseSuggestions[0]);
    }

    suggestions.push(...permissionSuggestions);
    suggestions.push(...stageSuggestions);
    suggestions.push(...streamingSuggestions);
    suggestions.push(...contextSuggestions);
    suggestions.push(...baseSuggestions.slice(1));

    const limit = getSuggestionLimit(settings);
    const finalSuggestions = dedupeSuggestionsByTopic(suggestions).slice(0, limit);

    if (!finalSuggestions.length) {
        return {
            show_optimization_suggestions: false,
            optimization_suggestions: null,
            permission_level: resolvedPermissionLevel,
        };
    }

    return {
        show_optimization_suggestions: true,
        permission_level: resolvedPermissionLevel,
        optimization_suggestions: {
            button_label: '查看优化建议',
            section_title: '建议操作方向',
            permission_level: resolvedPermissionLevel,
            used_permission_enhanced_suggestions: usePermissionEnhancedSuggestions,
            trigger_scope: getSuggestionScope(settings),
            suggestions: finalSuggestions,
        },
    };
}
