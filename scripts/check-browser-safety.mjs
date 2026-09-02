// 沿 import 图走一遍，确认纯前端形态要加载的模块里没有任何 Node 依赖。
import fs from 'node:fs';
import path from 'node:path';

// 纯前端形态下浏览器会加载的入口。这些模块及其依赖必须完全不含 Node 依赖，
// 否则贴 git 安装的用户一打开面板就是白屏，而且报错发生在模块加载阶段、很难定位。
const ENTRIES = [
    'backend-monitor-minimal/shared/run-analysis.js',
    'backend-monitor-minimal/shared/run-query.js',
    'lite/run-recorder.js',
    'lite/run-store.js',
    'lite/local-api.js',
];
const seen = new Set();
const problems = [];

function walk(file) {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    seen.add(abs);

    if (!fs.existsSync(abs)) {
        problems.push({ file, issue: `文件不存在` });
        return;
    }

    const src = fs.readFileSync(abs, 'utf8');

    for (const m of src.matchAll(/^import\s+[^'"]*from\s+['"]([^'"]+)['"]|^import\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1] ?? m[2];
        if (spec.startsWith('node:')) {
            problems.push({ file, issue: `import 了 Node 内置模块 ${spec}` });
        } else if (!spec.startsWith('.') && !spec.startsWith('/')) {
            problems.push({ file, issue: `import 了裸包名 ${spec}（浏览器无法解析）` });
        } else {
            walk(path.join(path.dirname(abs), spec));
        }
    }

    // 运行期才会炸的全局。按"语句"而不是按行判断：守卫和使用常常跨行
    // （三元表达式、多行条件），按行扫会把已经守卫好的写法误报成问题。
    const withoutComments = src.replace(/^\s*\/\/.*$/gm, '');
    const statements = withoutComments.split(/;|\n\s*\n/);
    const globals = [
        [/\bprocess\b/, 'process'],
        [/\b__dirname\b/, '__dirname'],
        [/\brequire\s*\(/, 'require()'],
        [/\bBuffer\b/, 'Buffer'],
    ];
    for (const stmt of statements) {
        const guarded = /typeof\s+process\s*[!=]==?\s*'undefined'/.test(stmt);
        for (const [re, label] of globals) {
            if (!re.test(stmt)) continue;
            if (label === 'process' && guarded) continue;
            problems.push({ file, issue: `用到 ${label} 且无守卫：${stmt.trim().replace(/\s+/g, ' ').slice(0, 90)}` });
        }
    }
}

ENTRIES.forEach(walk);

console.log(`=== 从 ${ENTRIES.join(', ')} 出发，共走到 ${seen.size} 个模块 ===`);
for (const f of seen) console.log('  ' + path.relative(process.cwd(), f).replace(/\\/g, '/'));

console.log(`\n=== 浏览器安全性问题 ===`);
if (!problems.length) {
    console.log('  无。整条链可以直接在浏览器里 import。');
} else {
    for (const p of problems) console.log(`  [${p.file}] ${p.issue}`);
    process.exitCode = 1;
}
