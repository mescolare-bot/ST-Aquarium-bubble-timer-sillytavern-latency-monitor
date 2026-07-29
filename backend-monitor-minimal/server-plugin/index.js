import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

import { getMonitorRuntimeStatus } from '../settings-ui/service/monitor-runtime-status.js';
import {
    getMonitorSettingsFilePath,
    readMonitorSettings,
    updateMonitorSettings,
} from '../settings-ui/service/monitor-settings-store.js';

const LOG_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const LOG_FILE = path.join(LOG_DIR, 'runs.jsonl');

async function readRuns(limit = 50) {
    try {
        const content = await fs.readFile(LOG_FILE, 'utf8');
        return content
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-limit)
            .reverse()
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

async function readRunById(runId) {
    if (typeof runId !== 'string' || !runId.length) {
        return null;
    }

    const runs = await readRuns(500);
    return runs.find((run) => run?.id === runId) ?? null;
}

async function countRuns() {
    try {
        const content = await fs.readFile(LOG_FILE, 'utf8');
        return content.split(/\r?\n/).filter(Boolean).length;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return 0;
        }

        throw error;
    }
}

async function clearRuns() {
    const existingRuns = await countRuns();

    try {
        await fs.mkdir(LOG_DIR, { recursive: true });
        await fs.writeFile(LOG_FILE, '', 'utf8');
        return existingRuns;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return 0;
        }

        throw error;
    }
}

function average(numbers) {
    const valid = numbers.filter((n) => typeof n === 'number' && Number.isFinite(n));
    if (!valid.length) {
        return null;
    }

    return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 100) / 100;
}

function buildSummary(runs) {
    return {
        total_runs: runs.length,
        avg_total_ms: average(runs.map((run) => run.metrics?.total_ms)),
        avg_preprocess_ms: average(runs.map((run) => run.metrics?.preprocess_ms)),
        avg_upstream_headers_ms: average(runs.map((run) => run.metrics?.upstream_headers_ms)),
        avg_ttft_ms: average(runs.map((run) => run.metrics?.ttft_ms)),
        avg_stream_ms: average(runs.map((run) => run.metrics?.stream_ms)),
    };
}

export async function init(router) {
    router.use(express.json({ limit: '256kb' }));

    router.get('/status', async (_req, res) => {
        const storedRuns = await countRuns();
        const runtimeStatus = await getMonitorRuntimeStatus();
        res.json({
            ok: true,
            plugin: info.id,
            version: info.version,
            stored_runs: storedRuns,
            log_file: 'data/default-user/latency-monitor/runs.jsonl',
            settings_file: path.relative(process.cwd(), getMonitorSettingsFilePath()).replace(/\\/g, '/'),
            permission_level: runtimeStatus.permission_level,
            current_floor_only: runtimeStatus.current_floor_only,
            history_scan_forbidden: runtimeStatus.history_scan_forbidden,
        });
    });

    router.get('/settings', async (_req, res) => {
        const settings = await readMonitorSettings();
        res.json({
            ok: true,
            settings,
        });
    });

    router.post('/settings', async (req, res) => {
        try {
            const settings = await updateMonitorSettings(req.body ?? {});
            res.json({
                ok: true,
                settings,
            });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.get('/runs', async (req, res) => {
        const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
        const runs = await readRuns(limit);
        res.json({
            ok: true,
            count: runs.length,
            runs,
        });
    });

    router.delete('/runs', async (_req, res) => {
        try {
            const clearedCount = await clearRuns();
            res.json({
                ok: true,
                cleared_count: clearedCount,
            });
        } catch (error) {
            res.status(500).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.get('/runs/:id', async (req, res) => {
        const run = await readRunById(req.params.id);
        if (!run) {
            return res.status(404).json({
                ok: false,
                error: 'Run not found.',
            });
        }

        return res.json({
            ok: true,
            run,
        });
    });

    router.get('/summary', async (req, res) => {
        const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
        const runs = await readRuns(limit);
        const runtimeStatus = await getMonitorRuntimeStatus();
        res.json({
            ok: true,
            summary: buildSummary(runs),
            permission_level: runtimeStatus.permission_level,
        });
    });
}

export async function exit() {
    return Promise.resolve();
}

export const info = {
    id: 'st-latency-monitor',
    name: 'ST Latency Monitor',
    description: 'Reads generation latency monitoring logs and exposes them through API routes.',
    version: '0.1.0',
};
