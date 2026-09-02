// 纯前端形态的落盘层，用 IndexedDB。
//
// 为什么不用 localStorage：单条 run 带上 prompt_breakdown 平均 5KB 左右，
// localStorage 通常只有 5MB 且是同步 API，几百条就会写满并卡住主线程。
//
// 这一层只管存取，不做任何筛选和统计——那些走 shared/run-query.js，
// 和后端用的是同一份实现。

const DB_NAME = 'st-latency-monitor';
const DB_VERSION = 1;
const RUNS_STORE = 'runs';
const META_STORE = 'meta';

// 浏览器这边没人帮忙轮转日志，不设上限迟早把用户的磁盘配额吃满，
// 配额满了之后 IndexedDB 会直接开始写失败。按时间倒序保留最近这么多条。
const DEFAULT_MAX_RUNS = 5000;

let dbPromise = null;

function openDatabase() {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('这个浏览器不支持 IndexedDB，精简模式无法记录。'));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(RUNS_STORE)) {
                const store = db.createObjectStore(RUNS_STORE, { keyPath: 'id' });
                // 列表和聚合永远按开始时间倒序取，没有索引就得全表读出来再排。
                store.createIndex('started_at_ms', 'started_at_ms', { unique: false });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('打开 IndexedDB 失败。'));
    });

    return dbPromise;
}

function runTransaction(storeName, mode, work) {
    return openDatabase().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;

        try {
            result = work(store);
        } catch (error) {
            reject(error);
            return;
        }

        // 必须等事务 complete 而不是等单个请求 success：写操作在事务提交前
        // 都还可能回滚，提前 resolve 会让"写完了"这个结论不成立。
        tx.oncomplete = () => resolve(result instanceof IdbRequestBox ? result.value : result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败。'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止。'));
    }));
}

// 把 IDBRequest 的结果带出事务：请求的 onsuccess 早于事务 oncomplete，
// 这个小盒子负责在两者之间把值接住。
class IdbRequestBox {
    constructor(request) {
        this.value = undefined;
        request.onsuccess = () => {
            this.value = request.result;
        };
    }
}

function box(request) {
    return new IdbRequestBox(request);
}

export async function appendRun(run) {
    await runTransaction(RUNS_STORE, 'readwrite', (store) => {
        store.put(run);
    });
    await pruneRuns();
}

/** 按开始时间倒序返回全部记录。筛选和分页交给调用方用 run-query 做。 */
export async function readAllRuns() {
    const result = await runTransaction(RUNS_STORE, 'readonly', (store) => {
        return box(store.index('started_at_ms').getAll());
    });
    const runs = Array.isArray(result) ? result : [];
    // 索引是升序的，面板要的是最新在前。
    return runs.reverse();
}

export async function readRunById(id) {
    const result = await runTransaction(RUNS_STORE, 'readonly', (store) => box(store.get(id)));
    return result ?? null;
}

export async function countRuns() {
    const result = await runTransaction(RUNS_STORE, 'readonly', (store) => box(store.count()));
    return typeof result === 'number' ? result : 0;
}

export async function updateRunById(id, updater) {
    const existing = await readRunById(id);
    if (!existing) {
        return null;
    }
    const updated = updater(existing);
    await runTransaction(RUNS_STORE, 'readwrite', (store) => {
        store.put(updated);
    });
    return updated;
}

/**
 * scope 为 normal_only 时只删没有异常的记录，和后端同名参数的语义一致。
 * runIds 非空时只删这些 id。
 */
export async function clearRuns(scope = 'all', runIds = []) {
    const all = await readAllRuns();
    const idFilter = Array.isArray(runIds) && runIds.length ? new Set(runIds) : null;

    const toDelete = all.filter((run) => {
        if (idFilter && !idFilter.has(run.id)) {
            return false;
        }
        if (scope === 'normal_only' && run?.abnormal_detail?.abnormal_type) {
            return false;
        }
        return true;
    });

    await runTransaction(RUNS_STORE, 'readwrite', (store) => {
        for (const run of toDelete) {
            store.delete(run.id);
        }
    });

    return {
        deletedCount: toDelete.length,
        remainingCount: all.length - toDelete.length,
        selectedCount: idFilter ? idFilter.size : all.length,
    };
}

async function pruneRuns(maxRuns = DEFAULT_MAX_RUNS) {
    const total = await countRuns();
    if (total <= maxRuns) {
        return 0;
    }

    const all = await readAllRuns();
    const stale = all.slice(maxRuns);
    await runTransaction(RUNS_STORE, 'readwrite', (store) => {
        for (const run of stale) {
            store.delete(run.id);
        }
    });
    return stale.length;
}

export async function readMeta(key, fallback = null) {
    const result = await runTransaction(META_STORE, 'readonly', (store) => box(store.get(key)));
    return result === undefined ? fallback : result;
}

export async function writeMeta(key, value) {
    await runTransaction(META_STORE, 'readwrite', (store) => {
        store.put(value, key);
    });
    return value;
}

/** 存储用量，给设置页显示"本地占了多少"用。浏览器不支持时返回 null。 */
export async function estimateStorageUsage() {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
        return null;
    }
    try {
        const { usage, quota } = await navigator.storage.estimate();
        return { usage: usage ?? null, quota: quota ?? null };
    } catch {
        return null;
    }
}
