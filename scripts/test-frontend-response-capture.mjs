import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

// Exercise the shipped hook, without importing SillyTavern or executing its UI.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf('function recordLiteGeneration(');
const end = source.indexOf('\nfunction installOutgoingGenerationHook()', start);
assert.ok(start >= 0 && end > start);
const hook = source.slice(start, end);
const stopStart = source.indexOf('function sendClientStopSignal(');
const stopEnd = source.indexOf('\nfunction sendForceStopDiagnostics(', stopStart);
assert.ok(stopStart >= 0 && stopEnd > stopStart);
const stopHook = source.slice(stopStart, stopEnd);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}
function harness({ mode = 'lite', detectedMode = 'lite', settings = {}, initFailure = false } = {}) {
    const gate = deferred();
    const saved = deferred();
    const runs = [];
    const errors = [];
    const state = { recordSourceMode: mode, legacyLiteViewing: false, liteActiveRuns: new Set() };
    let cloneBody;
    const recorder = {
        createLiteRun: body => ({ stream: body.stream, label: body.label }),
        markLiteResponseHeaders: (run, response) => { run.http_status = response.status; },
        consumeLiteResponse: async (run, response) => {
            cloneBody = response.body;
            run.text = await response.text();
        },
        markLiteRunError: (run, error) => { run.error = error; },
        finalizeLiteRun: () => {},
    };
    const context = vm.createContext({
        state, MODULE_NAME: 'test', Date, Promise,
        console: { warn: (...args) => errors.push(args) },
        ensureRecordSourceMode: async () => { await gate.promise; return detectedMode; },
        parseGenerationRequestBody: init => JSON.parse(init.body),
        loadLiteModules: async () => {
            if (initFailure) throw new Error('module unavailable');
            return {
                recorder,
                api: { readLitePluginRules: async () => [], readLiteSettings: async () => settings },
                store: { appendRun: async run => { runs.push(run); saved.resolve(run); } },
            };
        },
        describeUsageCaptureMode: () => 'response_body',
        recordUsageInjectionOutcome: () => {},
    });
    vm.runInContext(hook, context);
    vm.runInContext(stopHook, context);
    return {
        record: (promise, stream = false, label) => context.recordLiteGeneration({ body: JSON.stringify({ stream, label }) }, promise),
        stop: () => context.sendClientStopSignal(),
        gate, saved, runs, errors, state,
        get cloneBody() { return cloneBody; },
    };
}

for (const stream of [false, true]) {
    test(`clones before delayed setup and immediate caller consumption (${stream ? 'SSE' : 'JSON'})`, async () => {
        const h = harness();
        const text = stream ? 'data: {"usage":{"total_tokens":7}}\n\ndata: [DONE]\n\n' : '{"usage":{"total_tokens":7}}';
        const response = new Response(text);
        const promise = Promise.resolve(response);
        h.record(promise, stream);
        assert.equal(await promise.then(r => r.text()), text);
        assert.equal(h.runs.length, 0);
        h.gate.resolve();
        const run = await h.saved.promise;
        assert.equal(run.text, text);
        assert.equal(run.http_status, 200);
        assert.equal(h.errors.length, 0);
    });
}

test('buffers streaming response independently while caller locks original', async () => {
    const h = harness();
    let controller;
    const response = new Response(new ReadableStream({ start(c) { controller = c; } }));
    const promise = Promise.resolve(response);
    h.record(promise, true);
    const reader = (await promise).body.getReader();
    controller.enqueue(new TextEncoder().encode('data: first\n\n'));
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
    controller.close();
    h.gate.resolve();
    assert.equal((await h.saved.promise).text, 'data: first\n\n');
    reader.releaseLock();
});

test('fetch rejection is handled immediately during delayed setup', async () => {
    const h = harness();
    const error = new Error('network failure');
    h.record(Promise.reject(error));
    await tick(); // node:test fails if this creates an unhandled rejection
    h.gate.resolve();
    assert.equal((await h.saved.promise).error, error);
});

test('aborted WS-like stream fails independently in caller and recorder', async () => {
    const h = harness();
    let controller;
    const response = new Response(new ReadableStream({ start(c) { controller = c; } }));
    const promise = Promise.resolve(response);
    h.record(promise, true);
    const caller = (await promise).text();
    const error = new DOMException('The user aborted a request.', 'AbortError');
    controller.error(error);
    await assert.rejects(caller, { name: 'AbortError' });
    h.gate.resolve();
    assert.equal((await h.saved.promise).error.name, 'AbortError');
});

test('stop marks the main reply even after a later side generation already finished', async () => {
    const h = harness();
    const main = deferred();
    const side = deferred();
    h.record(main.promise, true, 'main');
    h.record(side.promise, false, 'side');
    h.gate.resolve();
    side.resolve(new Response('{}'));
    for (let n = 0; n < 20 && h.runs.length < 1; n++) await tick();
    assert.deepEqual(h.runs.map(run => run.label), ['side']);
    h.stop();
    main.resolve(new Response('data: partial\n\n'));
    for (let n = 0; n < 20 && h.runs.length < 2; n++) await tick();
    assert.equal(h.runs.find(run => run.label === 'main').client_stopped, true);
    assert.equal(h.runs.find(run => run.label === 'side').client_stopped, undefined);
    assert.equal(h.state.liteActiveRuns.size, 0);
});

test('known full mode skips cloning and recording', async () => {
    const h = harness({ mode: 'full' });
    let cloned = false;
    h.record(Promise.resolve({ clone() { cloned = true; } }));
    await tick();
    assert.equal(cloned, false);
    assert.equal(h.runs.length, 0);
});

for (const initFailure of [false, true]) {
    test(`abandons clone safely when ${initFailure ? 'module initialization fails' : 'mode detection selects full'}`, async () => {
        const h = harness({ mode: 'unknown', detectedMode: initFailure ? 'lite' : 'full', initFailure });
        let canceled = false;
        h.record(Promise.resolve({ clone: () => ({ body: {
            locked: false,
            cancel() { canceled = true; return Promise.reject(new Error('cancel failed')); },
        } }) }));
        h.gate.resolve();
        await tick();
        assert.equal(canceled, true);
        assert.equal(h.runs.length, 0);
    });
}

test('recording disabled preserves caller response but does not append', async () => {
    const h = harness({ settings: { runtime: { recording_enabled: false } } });
    const promise = Promise.resolve(new Response('ok'));
    h.record(promise);
    assert.equal(await (await promise).text(), 'ok');
    h.gate.resolve();
    for (let n = 0; n < 10 && !h.cloneBody; n++) await tick();
    await tick();
    assert.ok(h.cloneBody);
    assert.equal(h.runs.length, 0);
});
