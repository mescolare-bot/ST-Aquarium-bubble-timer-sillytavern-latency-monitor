import test from 'node:test';
import assert from 'node:assert/strict';
import {
    extractResponseText,
    buildResponseUsageFromPayload,
    buildResponseCompletionReasonFromPayload,
    processSseUsageEvent,
} from '../backend-monitor-minimal/shared/run-analysis.js';

const nativeResponse = {
    candidates: [{
        content: { parts: [{ thought: true, text: 'private reasoning' }, { text: '你好' }, { text: '世界' }] },
        finishReason: 'STOP',
    }],
    usageMetadata: {
        promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6,
        totalTokenCount: 20, cachedContentTokenCount: 3,
    },
};

test('native Gemini JSON counts visible text and keeps usage and finish reason', () => {
    assert.equal(extractResponseText(nativeResponse), '你好世界');
    const usage = buildResponseUsageFromPayload(nativeResponse);
    assert.equal(usage.prompt_tokens, 10);
    assert.equal(usage.completion_tokens, 4);
    assert.equal(usage.reasoning_tokens, 6);
    assert.equal(usage.total_tokens, 20);
    assert.equal(usage.cached_tokens, 3);
    assert.equal(buildResponseCompletionReasonFromPayload(nativeResponse), 'stop');
});

test('native Gemini SSE accumulates only visible text and captures final usage', () => {
    const run = { output_chars: 0, response_usage: null };
    processSseUsageEvent(run, 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }] } }] }));
    assert.equal(run.output_chars, 0);
    processSseUsageEvent(run, 'data: ' + JSON.stringify(nativeResponse));
    assert.equal(run.output_chars, 4);
    assert.equal(run.response_usage.reasoning_tokens, 6);
    assert.equal(run.response_finish_reason, 'stop');
});

test('thought-only, blocked and tool-only Gemini responses are not visible text', () => {
    for (const parts of [[{ thought: true, text: 'hidden' }], [{ functionCall: { name: 'lookup' } }]]) {
        assert.equal(extractResponseText({ candidates: [{ content: { parts } }] }), '');
    }
    assert.equal(extractResponseText({ promptFeedback: { blockReason: 'SAFETY' } }), '');
    assert.equal(buildResponseCompletionReasonFromPayload({ promptFeedback: { blockReason: 'SAFETY' } }), 'safety');
});

test('legacy Gemini string output remains visible', () => {
    assert.equal(extractResponseText({ candidates: [{ output: 'legacy answer' }] }), 'legacy answer');
});

test('an OpenAI wrapper does not double-count native candidates', () => {
    const wrapped = { ...nativeResponse, choices: [{ message: { content: 'wrapped answer' } }] };
    assert.equal(extractResponseText(wrapped), 'wrapped answer');
});

test('OpenAI JSON and SSE text and usage remain compatible', () => {
    assert.equal(extractResponseText({ choices: [{ message: { content: 'existing answer' } }] }), 'existing answer');
    const run = { output_chars: 0, response_usage: null };
    processSseUsageEvent(run, 'data: ' + JSON.stringify({
        choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }));
    assert.equal(run.output_chars, 2);
    assert.equal(run.response_usage.total_tokens, 4);
    assert.equal(run.response_finish_reason, 'stop');
});
