import {
    MONITOR_PERMISSION_LEVELS,
    cloneMonitorSettingsDefaults,
} from '../config/monitor-settings-default.js';
import { monitorSettingsSchema } from '../config/monitor-settings-schema.js';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalPrice(value, fieldPath) {
    if (value === null) {
        return null;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${fieldPath} must be number or null`);
    }

    if (value < 0) {
        throw new Error(`${fieldPath} must be >= 0`);
    }

    return Math.round(value * 1000000) / 1000000;
}

function normalizeFiniteNumber(value, fieldPath, { min = null, max = null } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${fieldPath} must be number`);
    }

    if (typeof min === 'number' && value < min) {
        throw new Error(`${fieldPath} must be >= ${min}`);
    }

    if (typeof max === 'number' && value > max) {
        throw new Error(`${fieldPath} must be <= ${max}`);
    }

    return Math.round(value * 1000000) / 1000000;
}

function normalizeOptionalTimeString(value, fieldPath) {
    if (value === null || value === '') {
        return '';
    }

    if (typeof value !== 'string') {
        throw new Error(`${fieldPath} must be time string or empty`);
    }

    const trimmedValue = value.trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmedValue)) {
        throw new Error(`${fieldPath} must be HH:MM`);
    }

    return trimmedValue;
}

function validatePeakValleySchedule(config, fieldPath) {
    const peakStartTime = config.peak_start_time;
    const peakEndTime = config.peak_end_time;

    if (peakStartTime && peakEndTime && peakStartTime === peakEndTime) {
        throw new Error(`${fieldPath} peak_start_time and peak_end_time must not be equal`);
    }
}

function validateModelPriceMap(value, fieldPath) {
    if (!isPlainObject(value)) {
        throw new Error(`${fieldPath} must be an object`);
    }

    const normalized = {};

    for (const [modelName, config] of Object.entries(value)) {
        const normalizedModelName = typeof modelName === 'string' ? modelName.trim() : '';
        if (!normalizedModelName) {
            throw new Error(`${fieldPath} contains invalid model key`);
        }

        if (normalizedModelName.length > 200) {
            throw new Error(`${fieldPath}.${normalizedModelName} is too long`);
        }

        if (!isPlainObject(config)) {
            throw new Error(`${fieldPath}.${normalizedModelName} must be an object`);
        }

        const supportedFields = new Set([
            'currency',
            'input_price_per_million',
            'cached_input_price_per_million',
            'output_price_per_million',
            'peak_valley_enabled',
            'peak_start_time',
            'peak_end_time',
            'peak_input_price_per_million',
            'peak_cached_input_price_per_million',
            'peak_output_price_per_million',
            'valley_input_price_per_million',
            'valley_cached_input_price_per_million',
            'valley_output_price_per_million',
        ]);
        for (const fieldName of Object.keys(config)) {
            if (!supportedFields.has(fieldName)) {
                throw new Error(`${fieldPath}.${normalizedModelName}.${fieldName} is not supported`);
            }
        }

        const currency = typeof config.currency === 'string' && ['usd', 'cny'].includes(config.currency)
            ? config.currency
            : 'usd';

        const normalizedConfig = {
            currency,
            input_price_per_million: normalizeOptionalPrice(
                config.input_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.input_price_per_million`,
            ),
            cached_input_price_per_million: normalizeOptionalPrice(
                config.cached_input_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.cached_input_price_per_million`,
            ),
            output_price_per_million: normalizeOptionalPrice(
                config.output_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.output_price_per_million`,
            ),
            peak_valley_enabled: Boolean(config.peak_valley_enabled),
            peak_start_time: normalizeOptionalTimeString(
                config.peak_start_time ?? '',
                `${fieldPath}.${normalizedModelName}.peak_start_time`,
            ),
            peak_end_time: normalizeOptionalTimeString(
                config.peak_end_time ?? '',
                `${fieldPath}.${normalizedModelName}.peak_end_time`,
            ),
            peak_input_price_per_million: normalizeOptionalPrice(
                config.peak_input_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.peak_input_price_per_million`,
            ),
            peak_cached_input_price_per_million: normalizeOptionalPrice(
                config.peak_cached_input_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.peak_cached_input_price_per_million`,
            ),
            peak_output_price_per_million: normalizeOptionalPrice(
                config.peak_output_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.peak_output_price_per_million`,
            ),
            valley_input_price_per_million: normalizeOptionalPrice(
                config.valley_input_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.valley_input_price_per_million`,
            ),
            valley_cached_input_price_per_million: normalizeOptionalPrice(
                config.valley_cached_input_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.valley_cached_input_price_per_million`,
            ),
            valley_output_price_per_million: normalizeOptionalPrice(
                config.valley_output_price_per_million ?? null,
                `${fieldPath}.${normalizedModelName}.valley_output_price_per_million`,
            ),
        };

        validatePeakValleySchedule(normalizedConfig, `${fieldPath}.${normalizedModelName}`);
        normalized[normalizedModelName] = normalizedConfig;
    }

    return normalized;
}

function normalizeHostValue(hostValue) {
    if (typeof hostValue !== 'string') {
        return '';
    }

    const firstHost = hostValue.split(',')[0]?.trim().toLowerCase() ?? '';
    if (!firstHost) {
        return '';
    }

    return firstHost.replace(/:\d+$/, '');
}

function isPrivateIpv4(hostname) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
        return false;
    }

    const parts = hostname.split('.').map(Number);
    if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return false;
    }

    if (parts[0] === 10 || parts[0] === 127) {
        return true;
    }

    if (parts[0] === 192 && parts[1] === 168) {
        return true;
    }

    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

export function inferPermissionLevelFromHost(hostValue, fallback = 'cloud_full') {
    const hostname = normalizeHostValue(hostValue);
    if (!hostname) {
        return fallback;
    }

    if (
        hostname === 'localhost'
        || hostname === '::1'
        || hostname.endsWith('.local')
        || isPrivateIpv4(hostname)
    ) {
        return 'local_full';
    }

    return 'cloud_full';
}

function validateField(rule, value, fieldPath, resolvedPermissionLevel) {
    if (rule.type === 'boolean') {
        if (typeof value !== 'boolean') {
            throw new Error(`${fieldPath} must be boolean`);
        }

        if (Array.isArray(rule.allowed_permission_levels)
            && !rule.allowed_permission_levels.includes(resolvedPermissionLevel)
            && value !== false) {
            throw new Error(`${fieldPath} is not available for current permission level`);
        }

        return value;
    }

    if (rule.type === 'enum') {
        if (typeof value !== 'string' || !rule.values.includes(value)) {
            throw new Error(`${fieldPath} has invalid enum value`);
        }

        return value;
    }

    if (rule.type === 'integer') {
        if (!Number.isInteger(value)) {
            throw new Error(`${fieldPath} must be integer`);
        }

        if (typeof rule.min === 'number' && value < rule.min) {
            throw new Error(`${fieldPath} must be >= ${rule.min}`);
        }

        if (typeof rule.max === 'number' && value > rule.max) {
            throw new Error(`${fieldPath} must be <= ${rule.max}`);
        }

        return value;
    }

    if (rule.type === 'number') {
        return normalizeFiniteNumber(value, fieldPath, {
            min: rule.min,
            max: rule.max,
        });
    }

    if (rule.type === 'model_price_map') {
        return validateModelPriceMap(value, fieldPath);
    }

    throw new Error(`${fieldPath} has unsupported rule type`);
}

function normalizeSection(sectionName, inputSection, schemaSection, targetSection, resolvedPermissionLevel) {
    if (!isPlainObject(inputSection)) {
        return;
    }

    for (const [fieldName, value] of Object.entries(inputSection)) {
        const rule = schemaSection[fieldName];
        if (!rule) {
            throw new Error(`${sectionName}.${fieldName} is not supported`);
        }

        targetSection[fieldName] = validateField(rule, value, `${sectionName}.${fieldName}`, resolvedPermissionLevel);
    }
}

export function resolvePermissionLevel(settings = {}, fallback = 'local_full') {
    const runtimeMode = settings?.runtime?.runtime_mode;
    // 纯前端形态下这个文件会被浏览器直接 import，那里没有 process，
    // 少了这层判断整条 import 链会在加载阶段就抛 ReferenceError。
    const envPermissionLevel = typeof process !== 'undefined' && typeof process.env?.ST_MONITOR_PERMISSION_LEVEL === 'string'
        ? process.env.ST_MONITOR_PERMISSION_LEVEL.trim()
        : '';

    if (MONITOR_PERMISSION_LEVELS.includes(envPermissionLevel)) {
        return envPermissionLevel;
    }

    if (MONITOR_PERMISSION_LEVELS.includes(runtimeMode)) {
        return runtimeMode;
    }

    return fallback;
}

export function validateMonitorSettingsUpdate(input, baseSettings = cloneMonitorSettingsDefaults()) {
    if (!isPlainObject(input)) {
        throw new Error('settings update payload must be an object');
    }

    const resolvedPermissionLevel = resolvePermissionLevel({
        ...baseSettings,
        ...input,
        runtime: {
            ...(baseSettings.runtime ?? {}),
            ...(input.runtime ?? {}),
        },
    });

    const normalized = {};

    for (const [sectionName, sectionValue] of Object.entries(input)) {
        const schemaSection = monitorSettingsSchema[sectionName];
        if (!schemaSection) {
            throw new Error(`${sectionName} section is not supported`);
        }

        if (!isPlainObject(sectionValue)) {
            throw new Error(`${sectionName} must be an object`);
        }

        normalized[sectionName] = {};
        normalizeSection(sectionName, sectionValue, schemaSection, normalized[sectionName], resolvedPermissionLevel);
    }

    return normalized;
}

export function normalizeMonitorSettings(input = {}) {
    const defaults = cloneMonitorSettingsDefaults();
    const merged = {
        runtime: {
            ...defaults.runtime,
            ...(isPlainObject(input.runtime) ? input.runtime : {}),
        },
        display: {
            ...defaults.display,
            ...(isPlainObject(input.display) ? input.display : {}),
        },
        pricing: {
            ...defaults.pricing,
            ...(isPlainObject(input.pricing) ? input.pricing : {}),
        },
    };

    const validated = validateMonitorSettingsUpdate(merged, defaults);
    const resolvedPermissionLevel = resolvePermissionLevel(validated);

    if (!MONITOR_PERMISSION_LEVELS.includes(resolvedPermissionLevel)) {
        merged.display.show_permission_enhanced_suggestions = false;
    }

    if (resolvedPermissionLevel === 'no_backend') {
        merged.display.show_permission_enhanced_suggestions = false;
    }

    return {
        runtime: {
            ...defaults.runtime,
            ...validated.runtime,
        },
        display: {
            ...defaults.display,
            ...validated.display,
        },
        pricing: {
            ...defaults.pricing,
            ...validated.pricing,
        },
    };
}
