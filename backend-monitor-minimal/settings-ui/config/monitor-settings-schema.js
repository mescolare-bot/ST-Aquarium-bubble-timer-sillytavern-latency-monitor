import {
    ABNORMAL_OPTIMIZATION_SUGGESTION_SCOPES,
    MONITOR_PERMISSION_LEVELS,
    MONITOR_RUNTIME_MODES,
    PRICING_DISPLAY_CURRENCIES,
    cloneMonitorSettingsDefaults,
} from './monitor-settings-default.js';

export const monitorSettingsSchema = {
    runtime: {
        runtime_mode: {
            type: 'enum',
            default: cloneMonitorSettingsDefaults().runtime.runtime_mode,
            values: MONITOR_RUNTIME_MODES,
        },
    },
    display: {
        show_abnormal_optimization_suggestions: {
            type: 'boolean',
            default: cloneMonitorSettingsDefaults().display.show_abnormal_optimization_suggestions,
        },
        abnormal_optimization_suggestion_scope: {
            type: 'enum',
            default: cloneMonitorSettingsDefaults().display.abnormal_optimization_suggestion_scope,
            values: ABNORMAL_OPTIMIZATION_SUGGESTION_SCOPES,
        },
        abnormal_optimization_suggestion_limit: {
            type: 'integer',
            default: cloneMonitorSettingsDefaults().display.abnormal_optimization_suggestion_limit,
            min: 2,
            max: 4,
        },
        show_permission_enhanced_suggestions: {
            type: 'boolean',
            default: cloneMonitorSettingsDefaults().display.show_permission_enhanced_suggestions,
            allowed_permission_levels: MONITOR_PERMISSION_LEVELS,
        },
    },
    pricing: {
        display_currency: {
            type: 'enum',
            default: cloneMonitorSettingsDefaults().pricing.display_currency,
            values: PRICING_DISPLAY_CURRENCIES,
        },
        usd_to_cny_rate: {
            type: 'number',
            default: cloneMonitorSettingsDefaults().pricing.usd_to_cny_rate,
            min: 0.000001,
            max: 999999,
        },
        model_prices: {
            type: 'model_price_map',
            default: cloneMonitorSettingsDefaults().pricing.model_prices,
        },
    },
};
