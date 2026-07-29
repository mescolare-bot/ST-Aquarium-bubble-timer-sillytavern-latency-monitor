import {
    MONITOR_PERMISSION_LEVELS,
    cloneMonitorSettingsDefaults,
} from '../config/monitor-settings-default.js';
import { monitorSettingsSchema } from '../config/monitor-settings-schema.js';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    const envPermissionLevel = typeof process.env.ST_MONITOR_PERMISSION_LEVEL === 'string'
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
    };
}
