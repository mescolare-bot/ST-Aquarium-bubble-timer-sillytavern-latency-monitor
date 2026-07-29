import fs from 'node:fs/promises';
import path from 'node:path';

import { cloneMonitorSettingsDefaults } from '../config/monitor-settings-default.js';
import { normalizeMonitorSettings, validateMonitorSettingsUpdate } from './monitor-settings-validator.js';

const SETTINGS_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'monitor-settings.json');

function deepMerge(base, partial) {
    const output = Array.isArray(base) ? [...base] : { ...base };

    for (const [key, value] of Object.entries(partial)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
            output[key] = deepMerge(base[key], value);
        } else {
            output[key] = value;
        }
    }

    return output;
}

async function ensureSettingsDir() {
    await fs.mkdir(SETTINGS_DIR, { recursive: true });
}

export function getMonitorSettingsFilePath() {
    return SETTINGS_FILE;
}

export async function readMonitorSettings() {
    try {
        const content = await fs.readFile(SETTINGS_FILE, 'utf8');
        return normalizeMonitorSettings(JSON.parse(content));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return cloneMonitorSettingsDefaults();
        }

        throw error;
    }
}

export async function writeMonitorSettings(settings) {
    const normalized = normalizeMonitorSettings(settings);
    await ensureSettingsDir();
    await fs.writeFile(SETTINGS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}

export async function updateMonitorSettings(partialSettings) {
    const current = await readMonitorSettings();
    const validatedPartial = validateMonitorSettingsUpdate(partialSettings, current);
    const nextSettings = deepMerge(current, validatedPartial);
    return writeMonitorSettings(nextSettings);
}
