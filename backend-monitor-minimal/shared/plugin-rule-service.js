// 插件规则的存储层：只负责把规则读出磁盘、写回磁盘。
//
// 特征提取、归一化、合并、匹配这些纯逻辑都在 plugin-rule-match.js，
// 那份不含任何 Node 依赖，精简版直接 import 它把规则存进 IndexedDB。
// 拆分之前这些逻辑和 node:fs 绑在同一个文件里，浏览器 import 不进来，
// 于是精简版一直没有规则学习，等待区打标只能改被标注的那一条。
//
// 本模块的对外签名保持不变：latency-monitor.js 和 server-plugin/index.js
// 仍然只从这里取符号，拆分对它们完全透明。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { normalizeOptionalText } from './run-query.js';
import {
    findMatchingPluginRuleForRequest,
    findMatchingPluginRuleForRun,
    mergeLearnedPluginRule,
    normalizeRuleList,
} from './plugin-rule-match.js';

const LOG_DIR = path.join(process.cwd(), 'data', 'default-user', 'latency-monitor');
const PLUGIN_RULES_FILE = path.join(LOG_DIR, 'plugin-rules.json');

let cachedRulesMtimeMs = -1;
let cachedRules = [];

// 实现统一放在 run-query.js（那份不含任何 Node 依赖，纯前端形态也要用）。
// 这里保留同名导出，是因为已经有调用方从本模块取它。
export { normalizeOptionalText };

// 纯逻辑原样透传，调用方不需要知道它们搬了家。
export {
    UNKNOWN_PLUGIN_ID,
    buildPromptMarkerSnapshot,
    collectPromptMarkersFromMessages,
    collectPromptTraceKeys,
    createLearnedPluginRuleFromRun,
    isUnknownPluginId,
    matchLearnedPluginRuleAgainstRun,
    shouldApplyLearnedRuleToRun,
    slugifyPluginId,
} from './plugin-rule-match.js';

function loadRulesFromDiskSync() {
    try {
        const stat = fs.statSync(PLUGIN_RULES_FILE);
        if (stat.mtimeMs === cachedRulesMtimeMs) {
            return cachedRules;
        }

        const parsed = JSON.parse(fs.readFileSync(PLUGIN_RULES_FILE, 'utf8'));
        cachedRules = normalizeRuleList(parsed);
        cachedRulesMtimeMs = stat.mtimeMs;
        return cachedRules;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            cachedRules = [];
            cachedRulesMtimeMs = -1;
            return cachedRules;
        }

        return cachedRules;
    }
}

export function readPluginRulesSync() {
    return loadRulesFromDiskSync();
}

export function readPluginRuleByIdSync(ruleId) {
    const normalizedRuleId = normalizeOptionalText(ruleId, 80);
    if (!normalizedRuleId) {
        return null;
    }

    return readPluginRulesSync().find((rule) => rule.id === normalizedRuleId) ?? null;
}

async function writePluginRules(rules) {
    await fsp.mkdir(LOG_DIR, { recursive: true });
    await fsp.writeFile(PLUGIN_RULES_FILE, `${JSON.stringify(normalizeRuleList(rules), null, 2)}\n`, 'utf8');
    cachedRulesMtimeMs = -1;
}

export async function upsertLearnedPluginRule(ruleInput) {
    const { rules, rule } = mergeLearnedPluginRule(readPluginRulesSync(), ruleInput);
    if (!rule) {
        return null;
    }

    await writePluginRules(rules);
    return rule;
}

export async function removeLearnedPluginRule(ruleId) {
    const normalizedRuleId = normalizeOptionalText(ruleId, 80);
    if (!normalizedRuleId) {
        return {
            removed: false,
            rule: null,
        };
    }

    const existingRules = readPluginRulesSync();
    const matchedRule = existingRules.find((rule) => rule.id === normalizedRuleId) ?? null;
    if (!matchedRule) {
        return {
            removed: false,
            rule: null,
        };
    }

    await writePluginRules(existingRules.filter((rule) => rule.id !== normalizedRuleId));
    return {
        removed: true,
        rule: matchedRule,
    };
}

export async function setLearnedPluginRuleEnabled(ruleId, enabled) {
    const normalizedRuleId = normalizeOptionalText(ruleId, 80);
    if (!normalizedRuleId) {
        return null;
    }

    const existingRules = readPluginRulesSync();
    const index = existingRules.findIndex((rule) => rule.id === normalizedRuleId);
    if (index < 0) {
        return null;
    }

    const nextRules = [...existingRules];
    nextRules[index] = {
        ...nextRules[index],
        enabled: enabled !== false,
        updated_at: new Date().toISOString(),
    };
    await writePluginRules(nextRules);
    return nextRules[index];
}

export function findMatchingLearnedPluginRuleForRequest(requestBody) {
    return findMatchingPluginRuleForRequest(readPluginRulesSync(), requestBody);
}

export function findMatchingLearnedPluginRuleForRun(run) {
    return findMatchingPluginRuleForRun(readPluginRulesSync(), run);
}
