import { readMonitorSettings } from './monitor-settings-store.js';
import { resolvePermissionLevel } from './monitor-settings-validator.js';

export async function getMonitorRuntimeStatus() {
    const settings = await readMonitorSettings();
    const permissionLevel = resolvePermissionLevel(settings);

    return {
        monitor_enabled: true,
        background_auto_monitor_enabled: true,
        runtime_mode: settings.runtime.runtime_mode,
        effective_runtime_mode: permissionLevel,
        current_floor_only: true,
        history_scan_forbidden: true,
        permission_level: permissionLevel,
        settings,
    };
}
