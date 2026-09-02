// 检查文件里被调用的函数名是否都有来源（本地声明 / import / 已知全局）。
// 抽取式重构最容易出的错就是漏 import，而这种错语法检查查不出来。
import fs from 'node:fs';

const FILES = [
    'backend-monitor-minimal/server-plugin/index.js',
    'backend-monitor-minimal/latency-monitor.js',
    'backend-monitor-minimal/shared/run-query.js',
    'backend-monitor-minimal/shared/run-analysis.js',
    'lite/run-recorder.js',
    'lite/run-store.js',
    'lite/local-api.js',
];

const GLOBALS = new Set([
    'require', 'import', 'export', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof',
    'function', 'await', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'try', 'finally',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'Map', 'Set', 'Promise',
    'Error', 'TypeError', 'RangeError', 'RegExp', 'Symbol', 'BigInt', 'Infinity', 'NaN', 'parseInt',
    'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'crypto', 'TextDecoder',
    'TextEncoder', 'ReadableStream', 'Response', 'Request', 'fetch', 'structuredClone', 'queueMicrotask',
    'async', 'process', 'Buffer', 'URL', 'URLSearchParams', 'AbortController', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect',
]);

let anyProblem = false;

for (const file of FILES) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');

    const known = new Set(GLOBALS);

    // 本文件声明的一切（含嵌套，宽松处理：只要文件里出现过声明就算数）
    for (const m of src.matchAll(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
    for (const m of src.matchAll(/(?:^|\s)(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
    for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*(?::\s*)?\(?[^)]*\)?\s*=>/g)) known.add(m[1]);
    // 解构声明
    for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]+)\}/g)) {
        m[1].split(',').forEach((p) => known.add(p.split(':').pop().split('=')[0].trim()));
    }
    // import 进来的
    for (const m of src.matchAll(/import\s+(?:\*\s+as\s+([\w$]+)|\{([^}]+)\}|([\w$]+))\s+from/g)) {
        if (m[1]) known.add(m[1]);
        if (m[3]) known.add(m[3]);
        if (m[2]) m[2].split(',').forEach((p) => known.add(p.trim().split(/\s+as\s+/).pop().trim()));
    }
    // 函数形参
    for (const m of src.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) {
        m[1].split(',').forEach((p) => {
            const name = p.trim().split('=')[0].trim().replace(/^\.\.\./, '');
            if (/^[A-Za-z_$][\w$]*$/.test(name)) known.add(name);
        });
    }

    const problems = [];
    lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const stripped = line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
        for (const m of stripped.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
            const name = m[1];
            if (!known.has(name)) problems.push(`  第 ${i + 1} 行调用了 ${name}：${line.trim().slice(0, 70)}`);
        }
    });

    console.log(`=== ${file} ===`);
    if (problems.length) {
        anyProblem = true;
        problems.slice(0, 12).forEach((p) => console.log(p));
        if (problems.length > 12) console.log(`  …还有 ${problems.length - 12} 处`);
    } else {
        console.log('  所有被调用的名字都有来源');
    }
}

process.exitCode = anyProblem ? 1 : 0;
