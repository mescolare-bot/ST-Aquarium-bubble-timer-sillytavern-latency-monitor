// 纯前端形态的采集：没有后端插件时，直接在浏览器里把一次生成记成一条 run。
//
// 记录的字段名和后端完全一致，这样面板的渲染逻辑一份就够，不需要为两种形态各写一遍。
// 差异只有两处，都由 record_source 标出来：
//   1. 耗时是端到端的（浏览器发出 → 流结束），比后端多算了酒馆自身的处理时间
//   2. metrics.preprocess_ms 恒为 null——"酒馆预处理"和"上游响应"这两段浏览器拆不开
//
// 除此之外的判定逻辑（异常分类、失败阶段、计价、usage 解析）全部复用 run-analysis.js，
// 和后端跑的是同一份代码，不会出现两种形态给出不同结论的情况。

import {
    buildAbnormalDetail,
    buildResponseCompletionReasonFromPayload,
    buildResponseUsageFromPayload,
    findSseEventBoundary,
    processSseUsageEvent,
    safeStringifyLength,
    shouldReplaceCapturedUsage,
    summarizePrompt,
} from '../backend-monitor-minimal/shared/run-analysis.js';

const RECORD_SOURCE = 'frontend';

function nowMs() {
    return Date.now();
}

function normalizeText(value, maxLength = 120) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function createRunId() {
    if (typeof crypto === 'object' && typeof crypto?.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // 老 Safari 没有 randomUUID，退化成时间戳加随机数即可，这个 id 只用于本地去重。
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 请求发出的瞬间建记录。requestBody 是已经注入过元数据的那一份，
 * 所以 request_* 系列字段直接取用即可，不需要再算一遍。
 *
 * startedAtMs 必须由调用方在请求真正发出的那一刻取好再传进来：
 * 建记录之前可能要先等形态探测，用这里的当前时间会把等待时长算进耗时里。
 */
export function createLiteRun(requestBody, startedAtMs = nowMs()) {
    const promptBreakdown = summarizePrompt(requestBody?.messages);

    return {
        id: createRunId(),
        record_source: RECORD_SOURCE,
        started_at_iso: new Date(startedAtMs).toISOString(),
        started_at_ms: startedAtMs,

        request_purpose: normalizeText(requestBody?.request_purpose) ?? 'chat_main_reply',
        request_plugin: normalizeText(requestBody?.request_plugin),
        request_plugin_label: normalizeText(requestBody?.request_plugin_label),
        request_injection_source: normalizeText(requestBody?.request_injection_source),
        request_injection_source_label: normalizeText(requestBody?.request_injection_source_label),
        request_chat_key: normalizeText(requestBody?.request_chat_key),
        request_chat_id: normalizeText(requestBody?.request_chat_id),
        request_chat_name: normalizeText(requestBody?.request_chat_name),
        request_floor: normalizeNumber(requestBody?.request_floor),
        request_generation_type: normalizeText(requestBody?.request_generation_type),
        request_client_generation_id: normalizeText(requestBody?.request_client_generation_id),

        stream: Boolean(requestBody?.stream),
        source: normalizeText(requestBody?.chat_completion_source),
        model: normalizeText(requestBody?.model),
        max_tokens: normalizeNumber(requestBody?.max_tokens),
        max_completion_tokens: normalizeNumber(requestBody?.max_completion_tokens),
        message_count: Array.isArray(requestBody?.messages) ? requestBody.messages.length : null,
        prompt_chars: safeStringifyLength(requestBody?.messages),
        prompt_breakdown: promptBreakdown,

        // 浏览器侧同样有四个观测点，只是"发给上游"这一点观测不到，
        // 用"请求发出"顶上——对 detectFailedStage 而言语义是等价的。
        phases: {
            upstream_request_started: startedAtMs,
            upstream_headers_received: null,
            first_chunk_received: null,
            stream_completed: null,
        },
        metrics: {
            total_ms: null,
            preprocess_ms: null,
            upstream_headers_ms: null,
            ttft_ms: null,
            stream_ms: null,
        },

        http_status: null,
        response_usage: null,
        response_finish_reason: null,
        output_bytes: 0,
        output_chars: 0,
        error: null,
        client_stopped: false,
        finished_at_iso: null,
        finished_at_ms: null,
        outcome: null,
        abnormal_detail: null,
    };
}

/** fetch 的 promise resolve 就意味着响应头到了，这是浏览器能观测到的第二个点。 */
export function markLiteResponseHeaders(run, response) {
    run.phases.upstream_headers_received = nowMs();
    run.http_status = normalizeNumber(response?.status);
}

function extractDeltaText(payload) {
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    let text = '';

    for (const choice of choices) {
        const delta = choice?.delta ?? choice?.message ?? null;
        if (typeof delta?.content === 'string') {
            text += delta.content;
        } else if (Array.isArray(delta?.content)) {
            for (const part of delta.content) {
                if (typeof part?.text === 'string') {
                    text += part.text;
                }
            }
        }
        if (typeof choice?.text === 'string') {
            text += choice.text;
        }
    }

    return text;
}

async function consumeStreaming(run, body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            if (!value) {
                continue;
            }

            if (run.phases.first_chunk_received === null) {
                run.phases.first_chunk_received = nowMs();
            }
            run.output_bytes += value.byteLength ?? 0;

            buffer += decoder.decode(value, { stream: true });

            let boundary = findSseEventBoundary(buffer);
            while (boundary) {
                const block = buffer.slice(0, boundary.index);
                buffer = buffer.slice(boundary.index + boundary.length);

                processSseUsageEvent(run, block);

                for (const line of block.split(/\r?\n/)) {
                    if (!line.startsWith('data:')) {
                        continue;
                    }
                    const payloadText = line.slice(5).trim();
                    if (!payloadText || payloadText === '[DONE]') {
                        continue;
                    }
                    try {
                        run.output_chars += extractDeltaText(JSON.parse(payloadText)).length;
                    } catch {
                        // 非 JSON 帧忽略，和后端的处理一致。
                    }
                }

                boundary = findSseEventBoundary(buffer);
            }
        }

        if (buffer.trim()) {
            processSseUsageEvent(run, buffer);
        }

        run.phases.stream_completed = nowMs();
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // 拆流时的释放失败没有意义，忽略。
        }
    }
}

async function consumeJson(run, response) {
    const text = await response.text();
    run.phases.first_chunk_received = nowMs();
    run.phases.stream_completed = run.phases.first_chunk_received;
    run.output_bytes = text.length;

    try {
        const payload = JSON.parse(text);
        const usage = buildResponseUsageFromPayload(payload);
        const completionReason = buildResponseCompletionReasonFromPayload(payload);
        if (shouldReplaceCapturedUsage(run.response_usage, usage)) {
            run.response_usage = usage;
        }
        if (completionReason) {
            run.response_finish_reason = completionReason;
        }
        run.output_chars = extractDeltaText(payload).length;
    } catch {
        // 酒馆报错时返回的可能不是 JSON，把原文当作错误信息留下。
        run.error = text.slice(0, 500) || null;
    }
}

/**
 * 读克隆出来的响应体。必须传克隆件——原件要留给酒馆自己消费。
 */
export async function consumeLiteResponse(run, clonedResponse) {
    try {
        if (run.stream && clonedResponse.body && typeof clonedResponse.body.getReader === 'function') {
            await consumeStreaming(run, clonedResponse.body);
        } else {
            await consumeJson(run, clonedResponse);
        }
    } catch (error) {
        run.error = error instanceof Error ? error.message : String(error);
    }
}

export function markLiteRunError(run, error) {
    run.error = error instanceof Error ? error.message : String(error);
}

export function markLiteRunStopped(run) {
    run.client_stopped = true;
}

/**
 * 收尾：算耗时、定 outcome、跑异常判定。settings 由调用方给，
 * 和后端一样——这个函数本身不碰任何存储。
 */
export function finalizeLiteRun(run, settings) {
    const finishedAtMs = nowMs();
    run.finished_at_ms = finishedAtMs;
    run.finished_at_iso = new Date(finishedAtMs).toISOString();

    const { upstream_request_started: started, upstream_headers_received: headers,
        first_chunk_received: firstChunk, stream_completed: completed } = run.phases;

    run.metrics.total_ms = finishedAtMs - started;
    // 这一段含酒馆自身的预处理，和后端的同名字段不是一回事，靠 record_source 区分。
    run.metrics.upstream_headers_ms = headers === null ? null : headers - started;
    run.metrics.ttft_ms = firstChunk === null ? null : firstChunk - started;
    run.metrics.stream_ms = firstChunk === null || completed === null ? null : completed - firstChunk;

    if (run.error) {
        run.outcome = run.phases.first_chunk_received === null ? 'error_response' : 'exception';
    } else {
        run.outcome = run.stream ? 'stream' : 'json';
    }

    if (run.output_chars === 0) {
        run.output_chars = null;
    }

    run.abnormal_detail = buildAbnormalDetail(run, settings);
    return run;
}
