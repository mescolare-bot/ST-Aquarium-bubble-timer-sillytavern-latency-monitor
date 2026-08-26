import { readMonitorSettings } from './monitor-settings-store.js';
import { inferPermissionLevelFromHost, resolvePermissionLevel } from './monitor-settings-validator.js';

export async function getMonitorRuntimeStatus(request = null) {
    const settings = await readMonitorSettings();
    const requestHost = request?.headers?.['x-forwarded-host']
        ?? request?.headers?.host
        ?? request?.hostname
        ?? '';
    const detectedPermissionLevel = inferPermissionLevelFromHost(requestHost, 'cloud_full');
    const permissionLevel = resolvePermissionLevel(settings, detectedPermissionLevel);

    return {
        monitor_enabled: true,
        background_auto_monitor_enabled: true,
        runtime_mode: settings.runtime.runtime_mode,
        effective_runtime_mode: permissionLevel,
        detected_permission_level: detectedPermissionLevel,
        current_floor_only: true,
        history_scan_forbidden: true,
        permission_level: permissionLevel,
        settings,
    };
}
