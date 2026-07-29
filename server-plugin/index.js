const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const DATA_DIR = path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "runs.jsonl");
const LOG_FILE_LABEL = "plugins/st-latency-profiler-server/data/runs.jsonl";

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function clampInt(value, defaultValue, min, max) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed)) {
        return defaultValue;
    }

    return Math.max(min, Math.min(max, parsed));
}

function sanitizeRun(body) {
    if (!body || typeof body !== "object") {
        return null;
    }

    return {
        runId: body.runId ?? null,
        createdAtIso: typeof body.createdAtIso === "string" ? body.createdAtIso : new Date().toISOString(),
        receivedAtIso: new Date().toISOString(),
        trigger: typeof body.trigger === "string" ? body.trigger : "unknown",
        chatKey: body.chatKey ?? "unknown",
        tokenCount: Number.isFinite(Number(body.tokenCount)) ? Number(body.tokenCount) : 0,
        promptChars: Number.isFinite(Number(body.promptChars)) ? Number(body.promptChars) : null,
        promptItems: Number.isFinite(Number(body.promptItems)) ? Number(body.promptItems) : null,
        metrics: body.metrics && typeof body.metrics === "object" ? body.metrics : {},
        fetches: Array.isArray(body.fetches) ? body.fetches.slice(0, 50) : [],
    };
}

async function appendRuns(runs) {
    ensureDataDir();
    const lines = runs.map((run) => `${JSON.stringify(run)}\n`).join("");
    await fs.promises.appendFile(LOG_FILE, lines, "utf8");
}

async function readRuns(limit = 20) {
    try {
        const content = await fs.promises.readFile(LOG_FILE, "utf8");
        const rows = content
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

        return rows;
    } catch (error) {
        if (error && error.code === "ENOENT") {
            return [];
        }

        throw error;
    }
}

async function countRuns() {
    try {
        const content = await fs.promises.readFile(LOG_FILE, "utf8");
        return content.split(/\r?\n/).filter(Boolean).length;
    } catch (error) {
        if (error && error.code === "ENOENT") {
            return 0;
        }

        throw error;
    }
}

async function init(router) {
    ensureDataDir();
    router.use(express.json({ limit: "512kb" }));

    router.get("/status", async (req, res) => {
        const storedRuns = await countRuns();

        res.json({
            ok: true,
            plugin: info.id,
            version: info.version,
            mode: "server-companion",
            storedRuns,
            logFile: LOG_FILE_LABEL,
            capabilities: [
                "store-client-runs",
                "read-recent-runs",
            ],
        });
    });

    router.get("/runs", async (req, res) => {
        const limit = clampInt(req.query.limit, 20, 1, 200);
        const runs = await readRuns(limit);

        res.json({
            ok: true,
            count: runs.length,
            runs,
        });
    });

    router.post("/runs", async (req, res) => {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        const sanitized = items.map(sanitizeRun).filter(Boolean);

        if (!sanitized.length) {
            return res.status(400).json({
                ok: false,
                error: "No valid runs in request body.",
            });
        }

        await appendRuns(sanitized);

        return res.json({
            ok: true,
            accepted: sanitized.length,
        });
    });

    console.log(`[${info.id}] server plugin loaded`);
}

async function exit() {
    return Promise.resolve();
}

const info = {
    id: "st-latency-profiler-server",
    name: "Latency Profiler Server Companion",
    description: "Stores client-side SillyTavern latency runs on the server for cloud deployments.",
    version: "0.1.0",
};

module.exports = {
    init,
    exit,
    info,
};
