import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

import { getMonitorRuntimeStatus } from '../settings-ui/service/monitor-runtime-status.js';
import {
    chatCompletionsPatchTarget,
    inspectChatCompletionsPatches,
} from '../shared/chat-completions-patch.js';
import {
    getMonitorSettingsFilePath,
    readMonitorSettings,
    updateMonitorSettings,
} from '../settings-ui/service/monitor-settings-store.js';
import {
    createLearnedPluginRuleFromRun,
    matchLearnedPluginRuleAgainstRun,
    readPluginRuleByIdSync,
    readPluginRulesSync,
    removeLearnedPluginRule,
    setLearnedPluginRuleEnabled,
    upsertLearnedPluginRule,
} from '../shared/plugin-rule-service.js';
import {
    buildDailySummary,
    buildSummary,
    filterRunsByAbnormal,
    filterRunsByCacheHit,
    filterRunsByChatKey,
    filterRunsByPurpose,
    normalizeOptionalText,
    normalizeRequestPurpose,
    normalizeUsageValue,
    readRequestedFlag,
    toArchivedRunStub,
    toClientRun,
    toClientRuns,
} from '../shared/run-query.js';

const LOG_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const LOG_FILE = path.join(LOG_DIR, 'runs.jsonl');
// 明细超额时被轮转出去的记录，压成只含统计字段的存根留在这里。
// 只有日聚合读它——明细列表读了也没用，存根里没有排障要看的东西。
const ARCHIVE_FILE = path.join(LOG_DIR, 'runs-archive.jsonl');
// 整份重写先写这里再 rename，见 writeRunsFileAtomic。
const RUNS_TMP_FILE = `${LOG_FILE}.tmp`;
// 轮转跨了"追加存档"和"截短明细"两步，中间崩掉会两头不一致，用标记文件把它变成可回滚的。
const ROTATE_MARKER_FILE = path.join(LOG_DIR, 'runs-rotate.marker.json');
// runs.jsonl 会被整份读取并逐行 JSON.parse，代价随体积线性增长：
// 实测 40.8 MB / 6628 条要 375 ms，面板每刷新一次就付一遍。
// 留 3000 条约 13.5 MB / 45 ms，是"明细够查一个月"和"刷新不卡"之间的平衡点。
const RUNS_RETAINED_COUNT = 3000;
// 判断是否超额要整份读盘，先用 stat 的体积当廉价闸门：
// 低于这个数时无论每条多小都还远没到需要轮转的开销。
const ROTATE_CHECK_BYTES = 8 * 1024 * 1024;
// 超额时一次多切一点，否则条数会长期贴着阈值，导致几乎每次生成都触发重写。
const RUNS_ROTATE_SLACK = 200;
// 未超额时只是一次 stat，一分钟一轮的开销可以忽略。
const ROTATE_INTERVAL_MS = 60 * 1000;
const WAITING_QUEUE_FILE = path.join(LOG_DIR, 'waiting-queue.json');
const PLUGIN_RULE_CANDIDATES_FILE = path.join(LOG_DIR, 'plugin-rule-candidates.jsonl');
const FORCE_STOP_DIAGNOSTICS_FILE = path.join(LOG_DIR, 'force-stop-diagnostics.jsonl');
// 前端在真正中止之前先把生成 id 写进来，latency-monitor 落盘时据此区分
// "用户自己停的" 和 "连接意外断了"——两者的错误文本完全一样，服务端只能靠这个分辨。
const CLIENT_STOP_SIGNALS_FILE = path.join(LOG_DIR, 'client-stop-signals.json');
const CLIENT_STOP_SIGNAL_TTL_MS = 5 * 60 * 1000;

// 诊断记录只在用户手动点"终止生成"时写入，正常一次就几 KB。
// 上限用来挡住前端意外把大对象塞进来，避免重演 frontend-debug.jsonl 涨到 64MB 的旧事。
const MAX_FORCE_STOP_DIAGNOSTICS_BYTES = 32 * 1024;

// 剥掉 prompt_breakdown 之后单条 run 约 1.5KB，这里仍然保留上限：
// 全量 5000+ 条一次返回依然是好几 MB，没有任何视图需要这么多。
// 筛选已经下沉到服务端，命中筛选后的结果集远小于这个上限。
const MAX_RUNS_PAGE_LIMIT = 2000;

// 本体源码有一百多 KB，而 /status 是前端轮询的接口，不能每次都整个读一遍。
// 按 mtime 缓存：文件没动就直接用上次的结论，动过了才重新读。
let patchInspectionCache = { mtimeMs: -1, result: null };

// 只装了前端、没打本体补丁时，面板一切正常但记录永远是空的，而且不报任何错。
// 这是这个项目最容易踩的坑，所以让服务端自己把它检出来，别再靠文档提醒。
async function inspectInstalledPatches() {
    const target = path.join(process.cwd(), ...chatCompletionsPatchTarget.split('/'));

    try {
        const { mtimeMs } = await fs.stat(target);
        if (mtimeMs !== patchInspectionCache.mtimeMs) {
            patchInspectionCache = {
                mtimeMs,
                result: inspectChatCompletionsPatches(await fs.readFile(target, 'utf8')),
            };
        }
        return patchInspectionCache.result;
    } catch {
        // 读不到本体源码（权限或路径不对）时不猜，让前端按"未知"处理。
        return null;
    }
}


function slugifyPluginId(value) {
    const normalized = normalizeOptionalText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || '';
}


function readRequestedPurpose(value) {
    if (value === 'chat_main_reply' || value === 'non_chat_generation' || value === 'plugin_internal_request') {
        return value;
    }

    return '';
}

function readRequestedChatKey(value) {
    return normalizeOptionalText(value, 200) || '';
}


async function readRunEntries() {
    try {
        const content = await fs.readFile(LOG_FILE, 'utf8');
        return content
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
                try {
                    return {
                        line,
                        run: JSON.parse(line),
                    };
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

// runs.jsonl 的整份重写有四个入口：改单条、回填插件规则、清空、轮转。
// 它们都是"整份读进来、整份写回去"，两个重叠就会互相覆盖——后写的那份基于旧快照，
// 中间那次改动直接消失，轮转和清空撞上时还会让存档和明细同时留着同一批记录。
// 所以读也要进队列，只锁写没有用。
let runsWriteChain = Promise.resolve();

function serializeRunsWrite(task) {
    // 前一个失败不能卡住后面的，成功失败两条路都接上。
    const result = runsWriteChain.then(task, task);
    runsWriteChain = result.catch(() => {});
    return result;
}

// writeFile 会先把原文件截断再写，中途被杀就只剩半个文件。
// 写临时文件再 rename，同一文件系统内 rename 是原子的：
// 崩溃时要么是完整的旧内容，要么是完整的新内容，不会有截断态。
async function writeRunsFileAtomic(content) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.writeFile(RUNS_TMP_FILE, content, 'utf8');
    await fs.rename(RUNS_TMP_FILE, LOG_FILE);
}

async function rewriteRunEntries(entries) {
    const nextContent = entries.map((entry) => entry.line).join('\n');
    await writeRunsFileAtomic(nextContent ? `${nextContent}\n` : '');
}

// 轮转要先把超额记录追加到存档、再把明细截短。中间崩掉两头就对不上：
// 存根已经进存档而明细还没截短，日聚合从此重复计数，而且不会有任何报错。
// 标记文件里记下追加之前存档有多长，重启后按临时文件还在不在判断截短生效没有：
// rename 会把临时文件消耗掉，它还在就说明没生效，把存档截回去等下一轮重做即可。
async function recoverInterruptedRotation() {
    let marker = null;
    try {
        marker = JSON.parse(await fs.readFile(ROTATE_MARKER_FILE, 'utf8'));
    } catch {
        // 没有标记说明上一次轮转完整走完了，只可能留下别处写了一半的临时文件。
        await fs.rm(RUNS_TMP_FILE, { force: true });
        return;
    }

    const tmpLeftBehind = await fs.stat(RUNS_TMP_FILE).then(() => true, () => false);
    if (tmpLeftBehind && Number.isFinite(marker?.archive_size_before)) {
        await fs.truncate(ARCHIVE_FILE, marker.archive_size_before).catch(() => {});
        await fs.rm(RUNS_TMP_FILE, { force: true });
    }

    await fs.rm(ROTATE_MARKER_FILE, { force: true });
}

async function rotateRuns() {
    await recoverInterruptedRotation();

    let size;
    try {
        size = (await fs.stat(LOG_FILE)).size;
    } catch {
        return;
    }

    if (size < ROTATE_CHECK_BYTES) {
        return;
    }

    // 按字节读：下面要靠长度差认出轮转期间新追加的内容，字符数在中文下对不上字节数。
    const snapshot = await fs.readFile(LOG_FILE);
    const lines = snapshot.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length <= RUNS_RETAINED_COUNT + RUNS_ROTATE_SLACK) {
        return;
    }

    const dropped = lines.slice(0, lines.length - RUNS_RETAINED_COUNT);
    const kept = lines.slice(lines.length - RUNS_RETAINED_COUNT);

    const stubs = [];
    for (const line of dropped) {
        try {
            const stub = toArchivedRunStub(JSON.parse(line));
            if (stub) {
                stubs.push(JSON.stringify(stub));
            }
        } catch {
            // 解析不出来的行本来也进不了统计，跟着丢掉即可。
        }
    }

    await fs.mkdir(LOG_DIR, { recursive: true });
    // 下面的顺序是定死的，改动前请先读上面 recoverInterruptedRotation 的说明。
    await fs.writeFile(RUNS_TMP_FILE, `${kept.join('\n')}\n`, 'utf8');

    const archiveSizeBefore = await fs.stat(ARCHIVE_FILE).then((stat) => stat.size, () => 0);
    await fs.writeFile(ROTATE_MARKER_FILE, JSON.stringify({ archive_size_before: archiveSizeBefore }), 'utf8');

    if (stubs.length) {
        await fs.appendFile(ARCHIVE_FILE, `${stubs.join('\n')}\n`, 'utf8');
    }

    // latency-monitor.js 落盘走的是另一个模块实例，排不进这条队列，只能自己接住：
    // 它只会往尾巴上追加，所以超出快照长度的那一段就是轮转期间新写进来的，补回去。
    //
    // 这里只按偏移量读尾巴、不整份重读：整份重读一次要十几毫秒，
    // 那段时间里又会有新的追加进来，补一轮多一轮，永远追不上。
    // 只读增量是几十微秒，循环很快就收敛，剩下的窗口只有最后那次 rename。
    let capturedLength = snapshot.length;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const handle = await fs.open(LOG_FILE, 'r');
        try {
            const { size } = await handle.stat();
            if (size <= capturedLength) {
                break;
            }

            const tail = Buffer.alloc(size - capturedLength);
            await handle.read(tail, 0, tail.length, capturedLength);
            await fs.appendFile(RUNS_TMP_FILE, tail);
            capturedLength = size;
        } finally {
            await handle.close();
        }
    }

    await fs.rename(RUNS_TMP_FILE, LOG_FILE);
    await fs.rm(ROTATE_MARKER_FILE, { force: true });
}

async function readRuns(limit = 50, offset = 0) {
    try {
        const entries = await readRunEntries();
        const lines = entries.map((entry) => entry.line);
        const safeOffset = Math.max(0, Number(offset) || 0);
        const endIndex = Math.max(0, lines.length - safeOffset);
        const startIndex = Math.max(0, endIndex - limit);

        return entries
            .slice(startIndex, endIndex)
            .reverse()
            .map((entry) => entry.run);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

async function readAllRuns() {
    const entries = await readRunEntries();
    return entries
        .map((entry) => entry?.run)
        .filter(Boolean)
        .reverse();
}

// 存根保留的是一条一条的记录而不是算好的日行，所以按用途/聊天筛选、p95、
// 摘要在存档期一样精确——直接和现存记录拼在一起交给 buildDailySummary 就行。
async function readArchivedRunStubs() {
    try {
        const content = await fs.readFile(ARCHIVE_FILE, 'utf8');
        return content
            .split(/\r?\n/)
            .filter(Boolean)
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

// 日聚合的口径 = 已轮转出去的存根 + 现存明细。两边都是完整记录形状，
// buildDailySummary 按日期分桶，不在意顺序，直接拼接即可。
async function readRunsForDailySummary() {
    const [archived, live] = await Promise.all([readArchivedRunStubs(), readAllRuns()]);
    return archived.length ? archived.concat(live) : live;
}

async function readRunById(runId) {
    if (typeof runId !== 'string' || !runId.length) {
        return null;
    }

    const runs = await readRuns(500);
    return runs.find((run) => run?.id === runId) ?? null;
}

async function updateRunById(runId, updater) {
    if (typeof runId !== 'string' || !runId.trim() || typeof updater !== 'function') {
        return null;
    }

    // 读和写要在同一次排队里：中间被轮转或清空插进来，这次修改会被旧快照覆盖掉。
    return serializeRunsWrite(async () => {
        const entries = await readRunEntries();
        let updatedRun = null;
        const nextEntries = entries.map((entry) => {
            if (entry?.run?.id !== runId) {
                return entry;
            }

            const nextRun = updater({ ...entry.run });
            if (!nextRun || typeof nextRun !== 'object') {
                return entry;
            }

            updatedRun = nextRun;
            return {
                line: JSON.stringify(nextRun),
                run: nextRun,
            };
        });

        if (!updatedRun) {
            return null;
        }

        await rewriteRunEntries(nextEntries);
        return updatedRun;
    });
}

async function countRuns() {
    const entries = await readRunEntries();
    return entries.length;
}

function normalizeRunIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(new Set(
        value
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
    ));
}

function shouldDeleteRun(entry, scope, selectedRunIds) {
    const runId = entry.run?.id;
    const selectedOnly = selectedRunIds.length > 0;
    if (selectedOnly && (!runId || !selectedRunIds.includes(runId))) {
        return false;
    }

    if (scope === 'normal_only') {
        return !entry.run?.abnormal_detail?.abnormal_type;
    }

    return true;
}

async function clearRuns(scope = 'all', selectedRunIds = []) {
    const normalizedRunIds = normalizeRunIds(selectedRunIds);

    return serializeRunsWrite(async () => {
        const entries = await readRunEntries();
        const existingRuns = entries.length;

        try {
            const keptEntries = entries.filter((entry) => !shouldDeleteRun(entry, scope, normalizedRunIds));
            const nextContent = keptEntries.map((entry) => entry.line).join('\n');
            await writeRunsFileAtomic(nextContent ? `${nextContent}\n` : '');

            // 清空全部时存档也要跟着清，否则明细空了、趋势图里还留着存档期的历史，
            // 用户只会觉得没删干净。按勾选删和只删异常不动存档：
            // 存根为了省体积没留 id，对应不到具体是哪几条。
            if (scope === 'all' && !normalizedRunIds.length) {
                await fs.rm(ARCHIVE_FILE, { force: true });
            }

            return {
                deletedCount: existingRuns - keptEntries.length,
                remainingCount: keptEntries.length,
                selectedCount: normalizedRunIds.length,
            };
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return {
                    deletedCount: 0,
                    remainingCount: 0,
                    selectedCount: normalizedRunIds.length,
                };
            }

            throw error;
        }
    });
}

async function readWaitingQueueEntries() {
    try {
        const raw = await fs.readFile(WAITING_QUEUE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter((item) => typeof item?.run_id === 'string' && item.run_id.trim()).map((item) => ({
            run_id: item.run_id.trim(),
            created_at: normalizeOptionalText(item.created_at) || new Date().toISOString(),
            status: normalizeOptionalText(item.status) || 'pending',
            plugin_label: normalizeOptionalText(item.plugin_label),
            plugin_id: normalizeOptionalText(item.plugin_id),
        }));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

async function writeWaitingQueueEntries(entries) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.writeFile(WAITING_QUEUE_FILE, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

async function addWaitingQueueEntry(runId) {
    const run = await readRunById(runId);
    if (!run) {
        throw new Error('Run not found.');
    }

    const entries = await readWaitingQueueEntries();
    const existingEntry = entries.find((entry) => entry.run_id === runId);
    if (existingEntry) {
        return existingEntry;
    }

    const nextEntry = {
        run_id: runId,
        created_at: new Date().toISOString(),
        status: 'pending',
        plugin_label: '',
        plugin_id: '',
    };
    entries.unshift(nextEntry);
    await writeWaitingQueueEntries(entries);
    return nextEntry;
}

async function removeWaitingQueueEntry(runId) {
    const entries = await readWaitingQueueEntries();
    const nextEntries = entries.filter((entry) => entry.run_id !== runId);
    const changed = nextEntries.length !== entries.length;
    if (changed) {
        await writeWaitingQueueEntries(nextEntries);
    }
    return changed;
}

async function appendPluginRuleCandidate(candidate) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(PLUGIN_RULE_CANDIDATES_FILE, `${JSON.stringify(candidate)}\n`, 'utf8');
}

async function appendForceStopDiagnostics(record) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(FORCE_STOP_DIAGNOSTICS_FILE, `${JSON.stringify(record)}\n`, 'utf8');
}

// 这里是唯一的写者，latency-monitor 那侧只读，所以不需要额外的并发保护。
// 每次写入顺带丢掉过期项，文件长期只有个位数条目。
async function recordClientStopSignal(clientGenerationId) {
    await fs.mkdir(LOG_DIR, { recursive: true });

    let current = {};
    try {
        const parsed = JSON.parse(await fs.readFile(CLIENT_STOP_SIGNALS_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            current = parsed;
        }
    } catch {
        // 文件不存在或内容损坏都当作空表重建。
    }

    const nowMs = Date.now();
    const next = {};
    for (const [id, at] of Object.entries(current)) {
        if (Number.isFinite(at) && nowMs - at < CLIENT_STOP_SIGNAL_TTL_MS) {
            next[id] = at;
        }
    }
    next[clientGenerationId] = nowMs;

    await fs.writeFile(CLIENT_STOP_SIGNALS_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function readWaitingQueueRuns() {
    const queueEntries = await readWaitingQueueEntries();
    if (!queueEntries.length) {
        return [];
    }

    const runs = await readRuns(1000000, 0);
    const runMap = new Map(runs.map((run) => [run?.id, run]));

    return queueEntries.map((entry) => ({
        ...entry,
        run: toClientRun(runMap.get(entry.run_id) ?? null),
    }));
}

function shouldApplyLearnedRuleToRun(run, match) {
    if (!run || !match?.pluginLabel) {
        return false;
    }

    const normalizedPurpose = normalizeRequestPurpose(run.request_purpose);
    const currentMatchMode = normalizeOptionalText(run.request_plugin_match_mode);
    const currentPlugin = normalizeOptionalText(run.request_plugin);
    const currentPluginLabel = normalizeOptionalText(run.request_plugin_label);

    if (currentMatchMode === 'explicit' || currentMatchMode === 'fingerprint' || currentMatchMode === 'manual_waiting_queue') {
        return false;
    }

    if (normalizedPurpose === 'non_chat_generation'
        && currentPlugin
        && currentPlugin !== 'unknown_plugin'
        && currentPluginLabel
        && currentPluginLabel !== match.pluginLabel) {
        return false;
    }

    return true;
}

async function backfillRunsWithLearnedRule(rule, excludedRunId = '') {
    if (!rule) {
        return {
            updatedCount: 0,
            updatedRuns: [],
        };
    }

    // 同样是整份读改写，必须和改单条、清空、轮转排同一条队。
    return serializeRunsWrite(async () => {
        const entries = await readRunEntries();
        const updatedRuns = [];
        const nextEntries = entries.map((entry) => {
            const run = entry?.run;
            if (!run || run.id === excludedRunId) {
                return entry;
            }

            const match = matchLearnedPluginRuleAgainstRun(rule, run);
            if (!match || match.ruleId !== rule.id || !shouldApplyLearnedRuleToRun(run, match)) {
                return entry;
            }

            const updatedRun = {
                ...run,
                request_purpose: 'non_chat_generation',
                request_plugin: match.pluginId || 'unknown_plugin',
                request_plugin_label: match.pluginLabel,
                request_plugin_match_mode: match.matchMode,
                request_plugin_match_score: match.matchScore,
            };
            updatedRuns.push(updatedRun);
            return {
                line: JSON.stringify(updatedRun),
                run: updatedRun,
            };
        });

        if (!updatedRuns.length) {
            return {
                updatedCount: 0,
                updatedRuns: [],
            };
        }

        await rewriteRunEntries(nextEntries);
        return {
            updatedCount: updatedRuns.length,
            updatedRuns,
        };
    });
}

async function buildPluginRuleSummaries() {
    const rules = readPluginRulesSync();
    const entries = await readRunEntries();
    const runs = entries.map((entry) => entry?.run).filter(Boolean);

    return rules.map((rule) => {
        let matchedRuns = 0;
        let activeRuns = 0;
        let pendingRuns = 0;

        for (const run of runs) {
            const match = matchLearnedPluginRuleAgainstRun(rule, run);
            if (!match || match.ruleId !== rule.id) {
                continue;
            }

            matchedRuns += 1;
            if (run.request_plugin_match_mode === 'learned_rule'
                && normalizeOptionalText(run.request_plugin_label) === rule.plugin_label
                && normalizeOptionalText(run.request_plugin) === rule.plugin_id) {
                activeRuns += 1;
            }
            if (shouldApplyLearnedRuleToRun(run, match)) {
                pendingRuns += 1;
            }
        }

        return {
            ...rule,
            matched_runs: matchedRuns,
            active_runs: activeRuns,
            pending_runs: pendingRuns,
            sample_count: Number(rule.sample_count) || (Array.isArray(rule.sample_run_ids) ? rule.sample_run_ids.length : 0),
        };
    }).sort((left, right) => {
        const leftUpdated = left.updated_at ? Date.parse(left.updated_at) : 0;
        const rightUpdated = right.updated_at ? Date.parse(right.updated_at) : 0;
        return rightUpdated - leftUpdated;
    });
}

function normalizeModelName(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : '';
}


function normalizeOptionalPricingValue(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function hasConfiguredPricingValue(config) {
    return [
        'input_price_per_million',
        'cached_input_price_per_million',
        'output_price_per_million',
        'peak_input_price_per_million',
        'peak_cached_input_price_per_million',
        'peak_output_price_per_million',
        'valley_input_price_per_million',
        'valley_cached_input_price_per_million',
        'valley_output_price_per_million',
    ].some((fieldName) => normalizeOptionalPricingValue(config?.[fieldName]) !== null);
}

function hasUsageData(run) {
    return normalizeUsageValue(run?.response_usage?.prompt_tokens) !== null
        || normalizeUsageValue(run?.response_usage?.completion_tokens) !== null
        || normalizeUsageValue(run?.response_usage?.total_tokens) !== null;
}

async function readPricingModelCatalog() {
    const settings = await readMonitorSettings();
    const configuredModelPrices = settings?.pricing?.model_prices && typeof settings.pricing.model_prices === 'object'
        ? settings.pricing.model_prices
        : {};
    const entries = await readRunEntries();
    const modelMap = new Map();

    for (const entry of entries) {
        const run = entry?.run;
        const modelName = normalizeModelName(run?.model);
        if (!modelName) {
            continue;
        }

        const current = modelMap.get(modelName) ?? {
            model: modelName,
            run_count: 0,
            supports_usage: false,
            last_seen_at: run?.started_at_iso || null,
        };

        current.run_count += 1;
        current.supports_usage = current.supports_usage || hasUsageData(run);

        if (!current.last_seen_at && run?.started_at_iso) {
            current.last_seen_at = run.started_at_iso;
        }

        modelMap.set(modelName, current);
    }

    for (const [modelName, config] of Object.entries(configuredModelPrices)) {
        const normalizedModelName = normalizeModelName(modelName);
        if (!normalizedModelName) {
            continue;
        }

        const current = modelMap.get(normalizedModelName) ?? {
            model: normalizedModelName,
            run_count: 0,
            supports_usage: false,
            last_seen_at: null,
        };

        current.configured = true;
        current.supports_usage = current.supports_usage
            || hasConfiguredPricingValue(config);

        modelMap.set(normalizedModelName, current);
    }

    return Array.from(modelMap.values()).sort((left, right) => {
        const leftSeen = left.last_seen_at ? Date.parse(left.last_seen_at) : 0;
        const rightSeen = right.last_seen_at ? Date.parse(right.last_seen_at) : 0;
        return rightSeen - leftSeen || left.model.localeCompare(right.model);
    });
}


let rotateTimer = null;

export async function init(router) {
    router.use(express.json({ limit: '256kb' }));

    // 轮转必须和上面几处整份重写排同一条队，所以放在插件这侧定时跑，
    // 而不是 latency-monitor.js 落盘时顺手做——那边是另一个模块实例，共用不到这把锁。
    rotateTimer = setInterval(() => {
        serializeRunsWrite(rotateRuns).catch((error) => {
            console.error('[st-latency-monitor] 轮转 runs.jsonl 失败：', error);
        });
    }, ROTATE_INTERVAL_MS);
    rotateTimer.unref?.();

    router.get('/status', async (req, res) => {
        const storedRuns = await countRuns();
        const runtimeStatus = await getMonitorRuntimeStatus(req);
        const patchStatus = await inspectInstalledPatches();
        res.json({
            ok: true,
            patch_state: patchStatus?.state ?? 'unknown',
            patch_present_count: patchStatus?.present_count ?? null,
            patch_total: patchStatus?.total ?? null,
            patch_missing: patchStatus?.missing ?? [],
            plugin: info.id,
            version: info.version,
            stored_runs: storedRuns,
            log_file: 'data/default-user/latency-monitor/runs.jsonl',
            settings_file: path.relative(process.cwd(), getMonitorSettingsFilePath()).replace(/\\/g, '/'),
            runtime_mode: runtimeStatus.runtime_mode,
            effective_runtime_mode: runtimeStatus.effective_runtime_mode,
            detected_permission_level: runtimeStatus.detected_permission_level,
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

    router.get('/pricing-models', async (_req, res) => {
        const models = await readPricingModelCatalog();
        res.json({
            ok: true,
            models,
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
        const limit = Math.max(1, Math.min(MAX_RUNS_PAGE_LIMIT, Number(req.query.limit) || 50));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const requestedPurpose = readRequestedPurpose(req.query.request_purpose);
        const requestedChatKey = readRequestedChatKey(req.query.request_chat_key);
        const abnormalOnly = readRequestedFlag(req.query.abnormal_only);
        const cacheHitOnly = readRequestedFlag(req.query.cache_hit);
        const includePromptBreakdown = readRequestedFlag(req.query.include_prompt_breakdown);
        const allRuns = await readRuns(1000000, 0);
        const filteredRuns = filterRunsByCacheHit(
            filterRunsByAbnormal(
                filterRunsByChatKey(filterRunsByPurpose(allRuns, requestedPurpose), requestedChatKey),
                abnormalOnly,
            ),
            cacheHitOnly,
        );
        const total = filteredRuns.length;
        const runs = toClientRuns(filteredRuns.slice(offset, offset + limit), includePromptBreakdown);
        res.json({
            ok: true,
            total,
            count: runs.length,
            limit,
            max_limit: MAX_RUNS_PAGE_LIMIT,
            offset,
            request_purpose: requestedPurpose || null,
            request_chat_key: requestedChatKey || null,
            abnormal_only: abnormalOnly,
            cache_hit: cacheHitOnly,
            include_prompt_breakdown: includePromptBreakdown,
            runs,
        });
    });

    router.delete('/runs', async (req, res) => {
        try {
            const scope = req.query.scope === 'normal_only' ? 'normal_only' : 'all';
            const runIds = normalizeRunIds(req.body?.run_ids);
            const result = await clearRuns(scope, runIds);
            res.json({
                ok: true,
                scope,
                cleared_count: result.deletedCount,
                remaining_count: result.remainingCount,
                selected_count: result.selectedCount,
            });
        } catch (error) {
            res.status(500).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    // 单条详情按需返回完整 run，包含列表接口已经剥掉的 prompt_breakdown。
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
        const requestedPurpose = readRequestedPurpose(req.query.request_purpose);
        const requestedChatKey = readRequestedChatKey(req.query.request_chat_key);
        const groupBy = normalizeOptionalText(req.query.group_by);
        const days = Math.max(1, Math.min(365, Number(req.query.days) || 14));
        const runs = filterRunsByChatKey(
            filterRunsByPurpose(
                groupBy === 'day' ? await readRunsForDailySummary() : await readRuns(limit),
                requestedPurpose,
            ),
            requestedChatKey,
        );
        const runtimeStatus = await getMonitorRuntimeStatus(req);
        res.json({
            ok: true,
            summary: buildSummary(runs),
            daily_summary: groupBy === 'day' ? buildDailySummary(runs, days) : null,
            permission_level: runtimeStatus.permission_level,
            request_purpose: requestedPurpose || null,
            request_chat_key: requestedChatKey || null,
        });
    });

    router.get('/plugin-rules', async (_req, res) => {
        const rules = await buildPluginRuleSummaries();
        res.json({
            ok: true,
            count: rules.length,
            rules,
        });
    });

    router.post('/plugin-rules/:id/reapply', async (req, res) => {
        try {
            const ruleId = normalizeOptionalText(req.params.id);
            if (!ruleId) {
                throw new Error('rule id is required.');
            }

            const rule = readPluginRuleByIdSync(ruleId);
            if (!rule) {
                return res.status(404).json({
                    ok: false,
                    error: 'Rule not found.',
                });
            }

            const backfillResult = await backfillRunsWithLearnedRule(rule);
            res.json({
                ok: true,
                rule,
                matched_runs: backfillResult.updatedCount,
                matched_run_ids: backfillResult.updatedRuns.map((run) => run.id),
            });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.patch('/plugin-rules/:id', async (req, res) => {
        try {
            const ruleId = normalizeOptionalText(req.params.id);
            if (!ruleId) {
                throw new Error('rule id is required.');
            }

            const enabled = req.body?.enabled !== false;
            const updatedRule = await setLearnedPluginRuleEnabled(ruleId, enabled);
            if (!updatedRule) {
                return res.status(404).json({
                    ok: false,
                    error: 'Rule not found.',
                });
            }

            return res.json({
                ok: true,
                rule: updatedRule,
            });
        } catch (error) {
            return res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.delete('/plugin-rules/:id', async (req, res) => {
        try {
            const result = await removeLearnedPluginRule(req.params.id);
            if (!result.removed) {
                return res.status(404).json({
                    ok: false,
                    error: 'Rule not found.',
                });
            }

            return res.json({
                ok: true,
                removed: true,
                rule: result.rule,
            });
        } catch (error) {
            return res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.get('/waiting-queue', async (_req, res) => {
        const entries = await readWaitingQueueRuns();
        res.json({
            ok: true,
            count: entries.length,
            entries,
        });
    });

    router.post('/waiting-queue', async (req, res) => {
        try {
            const runId = normalizeOptionalText(req.body?.run_id);
            if (!runId) {
                throw new Error('run_id is required.');
            }

            const entry = await addWaitingQueueEntry(runId);
            res.json({
                ok: true,
                entry,
            });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.delete('/waiting-queue/:id', async (req, res) => {
        const removed = await removeWaitingQueueEntry(req.params.id);
        res.json({
            ok: true,
            removed,
            run_id: req.params.id,
        });
    });

    router.post('/waiting-queue/:id/label', async (req, res) => {
        try {
            const runId = normalizeOptionalText(req.params.id);
            const pluginLabel = normalizeOptionalText(req.body?.plugin_label);
            const pluginId = slugifyPluginId(req.body?.plugin_id || pluginLabel);
            if (!runId) {
                throw new Error('run id is required.');
            }
            if (!pluginLabel) {
                throw new Error('plugin_label is required.');
            }

            const updatedRun = await updateRunById(runId, (run) => ({
                ...run,
                request_purpose: 'non_chat_generation',
                request_plugin: pluginId || 'unknown_plugin',
                request_plugin_label: pluginLabel,
                request_plugin_match_mode: 'manual_waiting_queue',
                request_plugin_match_score: 1,
            }));

            if (!updatedRun) {
                throw new Error('Run not found.');
            }

            const queueEntries = await readWaitingQueueEntries();
            const nextEntries = queueEntries.filter((entry) => entry.run_id !== runId);
            await writeWaitingQueueEntries(nextEntries);

            await appendPluginRuleCandidate({
                run_id: runId,
                plugin_label: pluginLabel,
                plugin_id: pluginId,
                created_at: new Date().toISOString(),
                source: updatedRun.source ?? null,
                model: updatedRun.model ?? null,
                note: 'created_from_waiting_queue',
            });

            const learnedRule = createLearnedPluginRuleFromRun(updatedRun, pluginLabel, pluginId, runId);
            const savedLearnedRule = learnedRule ? await upsertLearnedPluginRule(learnedRule) : null;
            const backfillResult = savedLearnedRule
                ? await backfillRunsWithLearnedRule(savedLearnedRule, runId)
                : { updatedCount: 0, updatedRuns: [] };

            res.json({
                ok: true,
                run: toClientRun(updatedRun),
                queue_entry: null,
                removed_from_waiting_queue: true,
                learned_rule_created: Boolean(savedLearnedRule),
                learned_rule: savedLearnedRule,
                matched_runs: backfillResult.updatedCount,
                matched_run_ids: backfillResult.updatedRuns.map((run) => run.id),
            });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.post('/force-stop-diagnostics', async (req, res) => {
        try {
            const payload = req.body;
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                throw new Error('diagnostics payload must be an object.');
            }

            const serialized = JSON.stringify(payload);
            if (Buffer.byteLength(serialized, 'utf8') > MAX_FORCE_STOP_DIAGNOSTICS_BYTES) {
                throw new Error('diagnostics payload is too large.');
            }

            // 前端时间可能因为设备时钟漂移不可信，落盘时间以服务端为准。
            await appendForceStopDiagnostics({
                ...payload,
                received_at: new Date().toISOString(),
            });

            res.json({ ok: true });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });

    router.post('/client-stop-signal', async (req, res) => {
        try {
            const clientGenerationId = normalizeOptionalText(req.body?.client_generation_id);
            if (!clientGenerationId) {
                throw new Error('client_generation_id is required.');
            }

            await recordClientStopSignal(clientGenerationId);
            res.json({ ok: true });
        } catch (error) {
            res.status(400).json({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}

export async function exit() {
    if (rotateTimer) {
        clearInterval(rotateTimer);
        rotateTimer = null;
    }

    return Promise.resolve();
}

export const info = {
    id: 'st-latency-monitor',
    name: 'ST Latency Monitor',
    description: 'Reads generation latency monitoring logs and exposes them through API routes.',
    version: '0.1.0',
};
