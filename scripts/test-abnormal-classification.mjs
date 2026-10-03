import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAbnormalType } from '../backend-monitor-minimal/shared/run-analysis.js';

function streamRun({ error = null, clientStopped = false, completed = false, outputChars = 120 } = {}) {
    return {
        stream: true,
        http_status: 200,
        error,
        client_stopped: clientStopped,
        output_chars: outputChars,
        phases: {
            upstream_request_started: 1,
            upstream_headers_received: 2,
            first_chunk_received: 3,
            ...(completed ? { stream_completed: 4 } : {}),
        },
    };
}

test('Chrome lite stop wording is classified as client_stopped', () => {
    const run = streamRun({ error: 'BodyStreamBuffer was aborted', clientStopped: true });
    assert.equal(detectAbnormalType(run), 'client_stopped');
});

test('server abort wording with stop signal stays client_stopped', () => {
    const run = streamRun({ error: 'The operation was aborted.', clientStopped: true });
    assert.equal(detectAbnormalType(run), 'client_stopped');
});

test('server abort wording without stop signal stays client_disconnected', () => {
    const run = streamRun({ error: 'The operation was aborted.' });
    assert.equal(detectAbnormalType(run), 'client_disconnected');
});

test('stop flag on a generation that completed normally is not abnormal', () => {
    const run = streamRun({ clientStopped: true, completed: true });
    assert.equal(detectAbnormalType(run), null);
});

test('unrecognized abort wording without stop flag stays stream_interrupted', () => {
    const run = streamRun({ error: 'BodyStreamBuffer was aborted' });
    assert.equal(detectAbnormalType(run), 'stream_interrupted');
});

test('stop before any output is client_stopped, not failed_without_output', () => {
    const run = streamRun({ error: 'BodyStreamBuffer was aborted', clientStopped: true, outputChars: 0 });
    run.phases = { upstream_request_started: 1 };
    assert.equal(detectAbnormalType(run), 'client_stopped');
});
