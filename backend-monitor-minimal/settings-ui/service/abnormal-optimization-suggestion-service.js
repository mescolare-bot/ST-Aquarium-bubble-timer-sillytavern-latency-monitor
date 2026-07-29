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

export function generateAbnormalOptimizationSuggestions({
    settings = cloneMonitorSettingsDefaults(),
    permissionLevel,
    abnormalType,
    failedStage,
    isStreaming = false,
    suspectedContextOverweight = false,
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
