import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chatCompletionsPatches, getChatCompletionsPatches, inspectChatCompletionsPatches } from '../backend-monitor-minimal/shared/chat-completions-patch.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const targetRelative = 'src/endpoints/backends/chat-completions.js';
const luker = `import { runLukerDispatch } from '../../luker-dispatch/runner.js';
router.post('/generate', async function (req, res) {
    return runLukerDispatch(req, res, {
        endpoint: 'chat-completions',
        select: (b) => selectChatCompletionDispatch(b),
    });
});
`;
// Syntax-valid provider fixtures exercise the production patch anchors without
// importing SillyTavern or making any model requests.
const p = Object.fromEntries(chatCompletionsPatches.map(patch => [patch.id, patch.anchor]));
const gemini = `/**
${p['gemini-signature']}
    const stream = request.body.stream;
    const apiName = 'Google AI Studio';
    const body = {}, headers = {}, controller = new AbortController(), url = 'https://fixture.invalid';
    try {
${p['gemini-fetch']}
        if (stream) {
            try {
${p['gemini-stream']}
            } catch (error) {
${p['gemini-stream-error']}
            }
        } else {
${p['gemini-json']}
            if (!candidates || candidates.length === 0) {
                const message = 'No candidates';
${p['gemini-no-candidate']}
            if (!responseContent) {
${p['gemini-empty']}
            }
            return response.send(responseContent);
        }
    } catch (error) {
${p['gemini-exception']}
    }
}
`;
const vanilla = `${p.import}
${gemini}
${p.declare}
${p.create}
        switch (request.body.chat_completion_source) {
${p['gemini-dispatch']}
        }
        const requestBody = {
${p.usage}
${p.fetch}
${p.stream}
        if (fetchResponse.ok) {
${p.json}
        } else {
${p.error}
        }
${p.exception}
    }
});
`;
function patch(source, entries = getChatCompletionsPatches(source)) {
    for (const entry of entries) {
        if (!source.includes(entry.detect)) source = source.replace(entry.anchor, entry.build(entry.anchor));
    }
    return source;
}
const legacyVanilla = patch(vanilla, chatCompletionsPatches.filter(entry => !entry.id.startsWith('gemini-')));
for (const [name, source, count] of [['Luker', luker, 2], ['vanilla', vanilla, 19]]) {
    test(`${name}: descriptor selection, partial detection, and idempotence`, () => {
        assert.equal(inspectChatCompletionsPatches(source).state, 'absent');
        assert.equal(getChatCompletionsPatches(source).length, count);
        const first = getChatCompletionsPatches(source)[0];
        assert.equal(inspectChatCompletionsPatches(source.replace(first.anchor, first.build(first.anchor))).state, 'partial');
        const result = patch(source);
        assert.equal(inspectChatCompletionsPatches(result).state, 'complete');
        assert.equal(inspectChatCompletionsPatches(result).total, count);
        assert.equal(patch(result), result);
    });
}
test('old vanilla backend reports the ten missing Gemini patches', () => {
    const inspection = inspectChatCompletionsPatches(legacyVanilla);
    assert.equal(inspection.state, 'partial');
    assert.equal(inspection.missing.length, 10);
    assert.ok(inspection.missing.every(entry => entry.id.startsWith('gemini-')));
    assert.equal(patch(legacyVanilla), patch(vanilla));
});
function fixture(t, source) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquarium-installer-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = path.join(root, targetRelative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(root, 'config.yaml'), 'enableServerPlugins: false\n');
    const duplicate = path.join(root, 'public/scripts/extensions/third-party/old-aquarium');
    fs.mkdirSync(duplicate, { recursive: true });
    fs.copyFileSync(path.join(repo, 'manifest.json'), path.join(duplicate, 'manifest.json'));
    return { root, target, duplicate };
}
function install(root, ...args) {
    return spawnSync(process.execPath, [path.join(repo, 'install.mjs'), root, ...args], { encoding: 'utf8' });
}
function success(result) {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
for (const [name, source] of [
    ['Luker', luker], ['vanilla', vanilla],
    ['vanilla existing backend', legacyVanilla],
    ['vanilla CRLF', vanilla.replace(/\n/g, '\r\n')],
    ['Luker CRLF', luker.replace(/\n/g, '\r\n')],
]) {
    test(`${name}: install twice, dry run, and uninstall`, t => {
        const { root, target, duplicate } = fixture(t, source);
        success(install(root, '--dry-run'));
        assert.equal(fs.readFileSync(target, 'utf8'), source);
        assert.ok(fs.existsSync(duplicate));
        assert.ok(!fs.existsSync(path.join(root, 'src/latency-monitor.js')));
        success(install(root));
        assert.ok(!fs.existsSync(duplicate));
        assert.ok(fs.existsSync(path.join(root, 'src/luker-latency-monitor.js')));
        const installed = fs.readFileSync(target, 'utf8');
        assert.equal(inspectChatCompletionsPatches(installed).state, 'complete');
        assert.equal(fs.readFileSync(target + '.st-latency-monitor.bak', 'utf8'), source);
        if (name.endsWith('CRLF')) assert.ok(!/(?<!\r)\n/.test(installed));
        success(install(root));
        assert.equal(fs.readFileSync(target, 'utf8'), installed);
        success(install(root, '--uninstall'));
        assert.equal(fs.readFileSync(target, 'utf8'), source);
        assert.ok(!fs.existsSync(path.join(root, 'src/luker-latency-monitor.js')));
    });
}
for (const [name, source] of [
    ['unknown dispatcher shape', luker.replace('select: (b)', 'select: (body)')],
    ['duplicate anchor', luker.replace('select: (b) => selectChatCompletionDispatch(b),', 'select: (b) => selectChatCompletionDispatch(b),\n        select: (b) => selectChatCompletionDispatch(b),')],
    ['invalid syntax', luker + '\nthis is not JavaScript !!!'],
]) {
    test(`${name}: fails before destructive file placement`, t => {
        const { root, target, duplicate } = fixture(t, source);
        assert.notEqual(install(root).status, 0);
        assert.ok(fs.existsSync(duplicate));
        assert.equal(fs.readFileSync(target, 'utf8'), source);
        assert.equal(fs.readFileSync(path.join(root, 'config.yaml'), 'utf8'), 'enableServerPlugins: false\n');
        assert.ok(!fs.existsSync(path.join(root, 'src/latency-monitor.js')));
        assert.ok(!fs.existsSync(target + '.st-latency-monitor.bak'));
    });
}
