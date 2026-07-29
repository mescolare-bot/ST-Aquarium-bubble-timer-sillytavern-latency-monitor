import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { generateAbnormalOptimizationSuggestions } from './settings-ui/service/abnormal-optimization-suggestion-service.js';
import { readMonitorSettings } from './settings-ui/service/monitor-settings-store.js';

const LOG_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const LOG_FILE = path.join(LOG_DIR, 'runs.jsonl');

function nowMs() {
    return Date.now();
}

function safeStringifyLength(value) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return null;
    }
}

function createRoleSummary() {
    return {
        count: 0,
        chars: 0,
    };
}

function collectContentStats(content) {
    const stats = {
        chars: 0,
        part_count: 0,
        text_parts: 0,
        image_parts: 0,
        audio_parts: 0,
        tool_parts: 0,
        other_parts: 0,
    };

    function visit(value) {
        if (typeof value === 'string') {
            stats.chars += value.length;
            stats.part_count += 1;
            stats.text_parts += 1;
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item);
            }
            return;
        }

        if (!value || typeof value !== 'object') {
            return;
        }

        stats.part_count += 1;

        const type = typeof value.type === 'string' ? value.type : 'object';
        if (typeof value.text === 'string') {
            stats.chars += value.text.length;
        }

        if (typeof value.content === 'string') {
            stats.chars += value.content.length;
        }

        if (Array.isArray(value.content)) {
            visit(value.content);
        }

        if (type.includes('text')) {
            stats.text_parts += 1;
        } else if (type.includes('image')) {
            stats.image_parts += 1;
        } else if (type.includes('audio')) {
            stats.audio_parts += 1;
        } else if (type.includes('tool')) {
            stats.tool_parts += 1;
        } else {
            stats.other_parts += 1;
        }
    }

    visit(content);
    return stats;
}

function summarizeMessages(messages) {
    if (!Array.isArray(messages)) {
        return null;
    }

    const roleTotals = {};
    const messageSizes = messages.map((message, index) => {
        const role = typeof message?.role === 'string' ? message.role : 'unknown';
        const name = typeof message?.name === 'string' ? message.name : null;
        const contentStats = collectContentStats(message?.content);
        const toolCallCount = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0;

        if (!roleTotals[role]) {
            roleTotals[role] = createRoleSummary();
        }

        roleTotals[role].count += 1;
        roleTotals[role].chars += contentStats.chars;

        return {
            index,
            role,
            name,
            chars: contentStats.chars,
            part_count: contentStats.part_count,
            text_parts: contentStats.text_parts,
            image_parts: contentStats.image_parts,
            audio_parts: contentStats.audio_parts,
            tool_parts: contentStats.tool_parts,
            other_parts: contentStats.other_parts,
            tool_call_count: toolCallCount,
        };
    });

    const topMessages = [...messageSizes]
        .sort((a, b) => b.chars - a.chars)
        .slice(0, 5);

    const recentMessages = messageSizes.slice(-6);

    return {
        mode: 'messages',
        total_messages: messages.length,
        total_chars: messageSizes.reduce((sum, item) => sum + item.chars, 0),
        role_totals: roleTotals,
        top_messages: topMessages,
        recent_messages: recentMessages,
        message_sizes: messageSizes,
    };
}

function summarizePrompt(messages) {
    if (Array.isArray(messages)) {
        return summarizeMessages(messages);
    }

    if (typeof messages === 'string') {
        return {
            mode: 'text',
            total_messages: null,
            total_chars: messages.length,
        };
    }

    return null;
}

function hasRecordedOutput(run) {
    return run.output_bytes > 0 || (typeof run.output_chars === 'number' && run.output_chars > 0);
}

function detectFailedStage(run) {
    const phases = run.phases ?? {};

    if (!phases.upstream_request_started) {
        return 'preprocess';
    }

    if (!phases.upstream_headers_received) {
        return 'request_model';
    }

    if (!phases.first_chunk_received) {
        return 'before_first_output';
    }

    if (run.stream && !phases.stream_completed) {
        return 'full_return';
    }

    if (phases.stream_error) {
        return 'full_return';
    }

    return null;
}

function detectAbnormalType(run) {
    const phases = run.phases ?? {};
    const errorText = String(run.error ?? '').toLowerCase();
    const hasOutput = hasRecordedOutput(run);
    const hasError = Boolean(run.error) || (typeof run.http_status === 'number' && run.http_status >= 400);
    const isTimeout = /timeout|timed out|time out/.test(errorText);
    const isStreamInterrupted = Boolean(run.stream && phases.first_chunk_received && !phases.stream_completed);
    const isSuspectedIncompleteGeneration = Boolean(run.stream && hasOutput && !phases.stream_completed && !hasError);

    if (!hasError && !isSuspectedIncompleteGeneration && !isStreamInterrupted) {
        return null;
    }

    if (isTimeout) {
        return 'request_timeout';
    }

    if (isStreamInterrupted) {
        return 'stream_interrupted';
    }

    if (isSuspectedIncompleteGeneration) {
        return 'suspected_incomplete_generation';
    }

    if (hasError && !hasOutput) {
        return 'failed_without_output';
    }

    if (hasError && hasOutput) {
        return 'failed_after_partial_output';
    }

    if (hasError) {
        return 'failed_generation';
    }

    return null;
}

function isPromptLikelyOverweight(run) {
    const totalChars = run.prompt_breakdown?.total_chars ?? run.prompt_chars ?? 0;
    const totalMessages = run.prompt_breakdown?.total_messages ?? run.message_count ?? 0;
    return totalChars >= 32000 || totalMessages >= 80;
}

async function buildAbnormalDetail(run) {
    const abnormalType = detectAbnormalType(run);
    if (!abnormalType) {
        return null;
    }

    const settings = await readMonitorSettings().catch(() => null);
    const failedStage = detectFailedStage(run);
    const suggestionResult = generateAbnormalOptimizationSuggestions({
        settings: settings ?? undefined,
        abnormalType,
        failedStage,
        isStreaming: run.stream,
        suspectedContextOverweight: isPromptLikelyOverweight(run),
    });

    return {
        abnormal_type: abnormalType,
        failed_stage: failedStage,
        has_partial_output: hasRecordedOutput(run),
        is_streaming: run.stream,
        is_timeout: abnormalType === 'request_timeout',
        show_optimization_suggestions: suggestionResult.show_optimization_suggestions,
        optimization_suggestions: suggestionResult.optimization_suggestions,
        permission_level: suggestionResult.permission_level,
    };
}

async function appendRun(run) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, `${JSON.stringify(run)}\n`, 'utf8');
}

export function createGenerationMonitor(request) {
    const startedAtMs = nowMs();
    const run = {
        id: crypto.randomUUID(),
        started_at_iso: new Date(startedAtMs).toISOString(),
        started_at_ms: startedAtMs,
        stream: Boolean(request.body?.stream),
        source: request.body?.chat_completion_source ?? null,
        model: request.body?.model ?? null,
        user_handle: request.user?.profile?.handle ?? null,
        max_tokens: request.body?.max_tokens ?? null,
        max_completion_tokens: request.body?.max_completion_tokens ?? null,
        message_count: Array.isArray(request.body?.messages) ? request.body.messages.length : null,
        prompt_chars: Array.isArray(request.body?.messages)
            ? safeStringifyLength(request.body.messages)
            : typeof request.body?.messages === 'string'
              ? request.body.messages.length
              : null,
        prompt_breakdown: summarizePrompt(request.body?.messages),
        prompt_trace: Array.isArray(request.body?.prompt_trace) ? request.body.prompt_trace : null,
        phases: {},
        metrics: {},
        http_status: null,
        response_usage: null,
        output_bytes: 0,
        output_chars: null,
        error: null,
    };

    let finalized = false;

    function mark(name) {
        if (!run.phases[name]) {
            run.phases[name] = nowMs();
        }
    }

    function setHttpStatus(status) {
        run.http_status = status;
    }

    function captureJson(json) {
        run.output_chars = safeStringifyLength(json);
        if (json?.usage) {
            run.response_usage = {
                prompt_tokens: json.usage.prompt_tokens ?? null,
                completion_tokens: json.usage.completion_tokens ?? null,
                total_tokens: json.usage.total_tokens ?? null,
            };
        }
    }

    function captureText(text) {
        run.output_chars = typeof text === 'string' ? text.length : null;
    }

    function captureError(error) {
        run.error = error instanceof Error ? error.message : String(error);
    }

    function attachStream(fetchResponse) {
        const body = fetchResponse?.body;
        if (!body || typeof body.on !== 'function') {
            return;
        }

        body.on('data', (chunk) => {
            mark('first_chunk_received');
            run.output_bytes += Buffer.byteLength(chunk);
        });

        body.on('end', () => {
            mark('stream_completed');
        });

        body.on('error', (error) => {
            mark('stream_error');
            captureError(error);
        });
    }

    async function finalize(extra = {}) {
        if (finalized) {
            return;
        }

        finalized = true;
        const finishedAtMs = nowMs();
        run.finished_at_iso = new Date(finishedAtMs).toISOString();
        run.finished_at_ms = finishedAtMs;

        Object.assign(run, extra);

        const phases = run.phases;
        run.metrics.total_ms = finishedAtMs - startedAtMs;

        if (phases.preprocess_completed) {
            run.metrics.preprocess_ms = phases.preprocess_completed - startedAtMs;
        }

        if (phases.upstream_request_started && phases.upstream_headers_received) {
            run.metrics.upstream_headers_ms = phases.upstream_headers_received - phases.upstream_request_started;
        }

        if (phases.upstream_request_started && phases.first_chunk_received) {
            run.metrics.ttft_ms = phases.first_chunk_received - phases.upstream_request_started;
        }

        if (phases.first_chunk_received && phases.stream_completed) {
            run.metrics.stream_ms = phases.stream_completed - phases.first_chunk_received;
        }

        if (!run.stream && phases.upstream_request_started) {
            run.metrics.nonstream_response_ms = finishedAtMs - phases.upstream_request_started;
        }

        run.abnormal_detail = await buildAbnormalDetail(run);

        await appendRun(run);
    }

    return {
        run,
        mark,
        setHttpStatus,
        captureJson,
        captureText,
        captureError,
        attachStream,
        finalize,
    };
}
