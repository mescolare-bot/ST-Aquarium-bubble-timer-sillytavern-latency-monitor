import {
    abnormalOptimizationContextSuggestionRules,
    abnormalOptimizationFailedGenerationTypes,
    abnormalOptimizationStageSuggestionRules,
    abnormalOptimizationStreamingSuggestionRules,
    abnormalOptimizationSuggestionRules,
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
        suggestions.push('建议先检查 API Key 是否填错、过期，或前后多了空格/前缀');
    }

    const hasInsufficientQuotaEvidence = matchesAnyKeyword(normalizedErrorText, [
        /insufficient_quota/,
        /quota exceeded/,
        /billing hard limit/,
        /quota_error/,
        /credit balance is too low/,
    ]);
    if (hasInsufficientQuotaEvidence) {
        suggestions.push('建议先检查账号余额、套餐额度或计费状态，这更像额度耗尽');
    }

    const hasRateLimitExceededEvidence = matchesAnyKeyword(normalizedErrorText, [
        /rate_limit_exceeded/,
        /rate limit reached/,
        /too many requests/,
        /requests per min/,
        /tokens per min/,
    ]);
    if (hasRateLimitExceededEvidence) {
        suggestions.push('建议先降低并发或稍后重试，这更像瞬时限流，不一定是余额问题');
    }

    const hasDeploymentNotFoundEvidence = matchesAnyKeyword(normalizedErrorText, [
        /deployment.+not found/,
        /deployment_not_found/,
        /unknown deployment/,
    ]);
    if (hasDeploymentNotFoundEvidence) {
        suggestions.push('建议先检查部署名称是否填写正确，这更像部署名而不是模型名有误');
    }

    const hasModelNotFoundEvidence = matchesAnyKeyword(normalizedErrorText, [
        /model.+not found/,
        /model_not_found/,
        /unknown model/,
        /no such model/,
    ]);
    if (hasModelNotFoundEvidence) {
        suggestions.push('建议先检查模型 ID 是否正确，或当前渠道是否支持这个模型');
    }

    const hasContextLengthEvidence = matchesAnyKeyword(normalizedErrorText, [
        /context_length_exceeded/,
        /maximum context length/,
        /too many tokens/,
        /prompt is too long/,
        /max context length/,
    ]);
    if (hasContextLengthEvidence) {
        suggestions.push('建议先减聊天历史、世界书、记忆和检索内容，这更像上下文超限');
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
        suggestions.push('建议先检查输出内容是否触发安全或内容拦截，这类问题重试通常没用');
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
        suggestions.push('建议先检查最大输出长度或直接续写，这更像输出被上限截断');
    }

    const hasConnectionRefusedEvidence = matchesAnyKeyword(normalizedErrorText, [
        /econnrefused/,
        /connection refused/,
    ]);
    if (hasConnectionRefusedEvidence) {
        suggestions.push('建议先检查目标接口地址和端口是否真的可达，这更像对端没有正常接入');
    }

    const hasDnsFailureEvidence = matchesAnyKeyword(normalizedErrorText, [
        /enotfound/,
        /eai_again/,
        /dns/,
        /name resolution/,
    ]);
    if (hasDnsFailureEvidence) {
        suggestions.push('建议先检查域名、代理 DNS 和解析链路，这更像域名解析失败');
    }

    const hasConnectionResetEvidence = matchesAnyKeyword(normalizedErrorText, [
        /econnreset/,
        /socket hang up/,
        /connection reset/,
        /unexpected eof/,
    ]);
    if (hasConnectionResetEvidence) {
        suggestions.push('建议先检查代理或网关稳定性，这更像中途断链或上游主动断开');
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
        suggestions.push('建议检查 API 密钥、权限和账号配置是否正确');
    }

    const hasModelConfigEvidence = !hasDeploymentNotFoundEvidence
        && !hasModelNotFoundEvidence
        && (httpStatus === 404
            || matchesAnyKeyword(normalizedErrorText, [
                /resource not found/,
                /endpoint.+not found/,
            ]));
    if (hasModelConfigEvidence) {
        suggestions.push('建议检查模型名称、接口地址或部署名称是否填写正确');
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
        suggestions.push('建议检查请求参数、上下文体量和接口格式是否符合当前模型要求');
    }

    const hasRateLimitEvidence = !hasInsufficientQuotaEvidence
        && !hasRateLimitExceededEvidence
        && (httpStatus === 429
            || matchesAnyKeyword(normalizedErrorText, [
                /rate limit/,
                /too many requests/,
            ]));
    if (hasRateLimitEvidence) {
        suggestions.push('建议检查额度、限流和账号余额，必要时稍后重试');
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
        suggestions.push('建议检查代理、网关和上游接口地址的连通性');
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
        suggestions.push('建议检查超时设置、代理链路和上游响应稳定性');
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
        suggestions.push('建议优先判断上游服务是否波动，稍后重试或切换模型');
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
    const streamingSuggestions = isStreaming ? abnormalOptimizationStreamingSuggestionRules.streaming : [];
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
    const finalSuggestions = uniqueSuggestions(suggestions).slice(0, limit);

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
