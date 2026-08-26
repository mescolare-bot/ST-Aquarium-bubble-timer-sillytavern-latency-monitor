export const MONITOR_PERMISSION_LEVELS = [
    'no_backend',
    'local_full',
    'cloud_full',
];

export const MONITOR_RUNTIME_MODES = [
    'auto',
    ...MONITOR_PERMISSION_LEVELS,
];

export const ABNORMAL_OPTIMIZATION_SUGGESTION_SCOPES = [
    'failed_generation_only',
    'all_abnormal',
];

export const PRICING_DISPLAY_CURRENCIES = [
    'usd',
    'cny',
];

export const monitorSettingsDefaults = {
    runtime: {
        runtime_mode: 'auto',
    },
    display: {
        show_abnormal_optimization_suggestions: true,
        abnormal_optimization_suggestion_scope: 'failed_generation_only',
        abnormal_optimization_suggestion_limit: 3,
        show_permission_enhanced_suggestions: true,
    },
    pricing: {
        display_currency: 'usd',
        usd_to_cny_rate: 7.2,
        model_prices: {},
    },
};

export function cloneMonitorSettingsDefaults() {
    return JSON.parse(JSON.stringify(monitorSettingsDefaults));
}
