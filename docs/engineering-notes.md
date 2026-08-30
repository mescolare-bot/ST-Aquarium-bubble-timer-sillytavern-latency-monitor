# 工程约束与根因备忘

这份文档只记录**改代码前必须先知道的事**：踩过的坑、量化过的约束、以及若干"看起来是 bug 其实是数据缺失"的结论。
不是变更日志，不追加流水账。

---

## 一、性能约束（改 `limit` 或自动刷新策略前必读）

`runs.jsonl` 实测 **33.8 MB / 5691 条**，平均每条 6220 B。
其中 `prompt_breakdown` 单字段就占 4653 B（**74.8%**），而列表视图从来不读它。

因此接口层做了投影：`/runs`、`/waiting-queue` 默认剥掉 `prompt_breakdown`，
单条降到约 1570 B；`/runs/:id` 保持返回完整 run，作为按需取详情的通道。

| 场景 | 剥离前 | 剥离后 |
| --- | --- | --- |
| 单条 run | 6220 B | ~1570 B |
| 首屏 limit=20 | 124 KB | 31 KB |
| 只看缓存命中全量（196 条） | 1.2 MB | 0.3 MB |
| 只看异常全量（895 条） | 5.6 MB | 1.4 MB |
| 全部 5691 条 | 33.8 MB | 8.5 MB |

由此得出两条必须保持的约束：

1. **`limit` 必须有上限。** 即便剥掉大字段，全量仍有 8.5 MB，而没有任何视图需要一次拿这么多。
   当前 `MAX_RUNS_PAGE_LIMIT = 2000`（最坏约 3 MB）。
2. **自动刷新只做增量合并。** 手动刷新整包重拉，自动刷新走合并路径。
   剥离字段之后这条从"承重结构"降级为"优化"，但仍不该整包重拉。

落盘侧同理：`summarizeMessages()` 不再写 `top_messages` / `recent_messages`，
它们只是 `message_sizes` 的排序切片，消费方现算即可，重复存储每条白白多出约 1740 B。

---

## 二、只有前端知道的字段，必须在发起生成时随请求体带下去

后端是代理，看不到 SillyTavern 的聊天上下文。凡是"只有前端知道"的信息，
唯一通道是 `injectTrackedRequestMetadata()` —— 它由 fetch 补丁和
`CHAT_COMPLETION_SETTINGS_READY` 事件在发起生成时调用，之后由 `latency-monitor.js` 照单落盘。

目前走这条通道的字段：

| 字段 | 用途 |
| --- | --- |
| `request_chat_key` / `request_chat_id` / `request_chat_id_hash` / `request_chat_name` | 聊天身份 |
| `request_injection_source` / `request_injection_source_label` | 注入来源 |
| `request_floor` | 楼层 |
| `request_client_generation_id` | 本次生成的唯一标识 |

写这类字段时的三个坑：

1. **该函数会被调用两次**（事件一次、fetch 补丁一次）。只在字段缺失时才生成，
   已存在时回读，否则 `state` 里记的值会和真正发出去的请求体对不上。
2. **`0` 是合法值。** `request_floor` 的首层就是 0，判断字段缺失只能用 `== null`，不能用真值判断。
3. **`crypto.randomUUID()` 只在安全上下文可用**，而酒馆常常是 http 直连，必须自带兜底实现。

### 楼层为什么不能用 `message_count` 推

`message_count` 是发给模型的 messages 数组长度（系统提示 + 世界书 + 截断后的历史窗口），
不是楼层。实测同一聊天 96 次连续生成的序列在 9~21 之间来回跳（增 22 / 减 23 / 不变 50）。

楼层口径：取"这次生成产出的消息最终会落在哪个下标"，与 `.mesIDDisplay` 的 `#N` 同为 0 基。
末尾已经是 AI 消息时（重 roll / swipe）要退一格。已实测对齐，无差一。

---

## 三、后端只在请求结束后才落盘 run

实测 5751 条记录中 `finished_at_ms` 为空的是 **0 条**，912 条可处置异常中未结束的也是 **0 条**。

**推论：监控在 `/runs` 里永远看不到"正在跑"的那次生成。**

这条约束直接否定了一类实现思路——任何"根据列表里的异常记录判断*当前这次*生成会失败"的逻辑
都是错的，因为它拿到的异常必然属于**已经结束的上一次**。

实测过一例误判：异常记录 16:30:22 就已结束，而当时正在跑的那次 16:31:37 才开始，
两者相隔 75 秒、毫无关系，但"有新异常 + 现在正在生成"两个条件同时成立，于是弹了错误的提示。

正确做法是靠 `request_client_generation_id` 精确比对。
该功能真正要救的场景是：**后端 run 已异常结束、而酒馆 UI 还卡在"生成中"（停止键不消失）**。

---

## 四、聊天维度的历史数据从 2026-08-25 才开始

`request_chat_key` / `request_chat_id` / `request_chat_name` 是后加的字段。
实测 3710 条 `chat_main_reply` 中只有 131 条带这些字段，最早 2026-08-25；
更早的 3579 条**三个字段全部为空**。

因此：

- **聊天口径的日聚合看不到 8-25 之前的数据**，切换 7/14/30 天可能三档结果完全相同。
  这不是 bug，是数据本身没有。界面通过 `scope_earliest_date_key` / `scope_total_days`
  把实际范围说明出来，并弱化超出范围的天数按钮。
- **老记录无法回填聊天归属。** `user_handle` / `model` 区分不了聊天，
  `prompt_markers` 只有 40% 有值且只能认出角色、认不出具体聊天。硬做归属不可信。

同理，`request_floor` 从 2026-08-27 才开始写，更早的记录楼层显示 `-`，无法追溯。

---

## 五、远程部署时踩过的坑

首次安装看 [`installation.md`](installation.md)。这一节只记录**更新已装好的实例**时反复踩到的问题。
下面的 `<SSH_USER>` / `<SSH_HOST>` / `<SSH_PORT>` / `<SSH_KEY>` / `<ST_ROOT>` 请替换成你自己的值。

**SSH 密钥要显式指定。** 如果 `~/.ssh/config` 里没有为目标主机配 `IdentityFile`
（比如只给 `github.com` 配了），不带 `-i` 会直接 `Permission denied (publickey,password)`，
而报错本身不会告诉你缺的是密钥。

```
ssh -p <SSH_PORT> -i <SSH_KEY> <SSH_USER>@<SSH_HOST>
scp -P <SSH_PORT> -i <SSH_KEY> <local> <SSH_USER>@<SSH_HOST>:/tmp/
```

注意 `ssh` 用小写 `-p`、`scp` 用大写 `-P`。

**非 root 账号不能直接写 `<ST_ROOT>`。** 流程是 `scp` 到 `/tmp` 再 `sudo cp` 就位，
之后用 `chown --reference` / `chmod --reference` 从备份文件抄回属主和权限，
否则新文件的属主会变成上传者，服务重启后可能读不到。

**`node` 不在 `sudo` 的 PATH 里**（用 fnm / nvm 之类的版本管理器时尤其如此）。
要跑 `sudo node --check` 得先 `sudo bash -lc "command -v node"` 取绝对路径。

| 本地文件 | 远端路径 |
| --- | --- |
| `index.js` | `<ST_ROOT>/public/scripts/extensions/third-party/st-latency-profiler/index.js` |
| `style.css` | 同上目录 `/style.css` |
| `manifest.json` | 同上目录 `/manifest.json` |
| `backend-monitor-minimal/latency-monitor.js` | `<ST_ROOT>/src/latency-monitor.js` |
| `backend-monitor-minimal/server-plugin/index.js` | `<ST_ROOT>/plugins/st-latency-monitor/index.js` |

覆盖前先备份（惯例后缀 `.bak-YYYYMMDD-HHMMSS`），之后
`sudo systemctl restart sillytavern`。

### 测试时必须先强制刷新

`manifest.json` 指向不带日期的 `index.js`，**没有靠文件名换版做缓存击穿**。
浏览器很可能继续用旧缓存，所以每次测新版本都要 `Ctrl + Shift + R`，
或开 DevTools → Network 勾 `Disable cache` 后再刷。

改动"又没生效"时，先确认这一步，再怀疑代码。

---

## 六、未收口的问题：流式 usage 归零

现象：`流式抗截断/gemini-*`、`假流式/gemini-*` 的记录能写入 `response_usage`，
但 prompt / completion / total 全为 0，导致预估价格恒为 0。
线上占比：全量 3.7%，2026-08-26 当天 8.6%。

已经排除的方向（都验证过，不要重走）：

- 不是 `stream_options.include_usage` 没发出去，它已生效。
- 不是字段名映射不上，监控器能正常解析流式事件里的 `usage`。
- 不是前端价格展示的问题，`runs.jsonl` 里落盘的就是 `0/0/0`。

已确认的两个真实成因，对应的修复都已在代码里：

1. **流中同时存在 0 和非 0 的 usage 事件，后来的 0 会覆盖前面抓到的真实值。**
   实测 `runId = 93b38238-…` 的日志里先是大量 `0/0/0`，后出现 `70848/6217/77065`，最终落盘却是 `0/0/0`。
   → `shouldReplaceCapturedUsage()` 现在禁止用零总量覆盖已有的非零总量。
2. **`finalize()` 不等流式解析结束就落盘。**
   实测 `runId = 2200e72f-…` 日志里出现了 `91399/4264/95663`，但同 id 记录仍是 `0/0/0`。
   → `finalize()` 现在在 `run.stream` 时先 `await streamParsingPromise`。

两处修完后归零仍未清零，说明**还有第三个成因没找到**，很可能是上游兼容层本身就只回了占位 usage
（假设 B「上游返回的数值本身就是 0」当时只是"部分确认"）。下一步应该从上游响应原文取证，而不是继续改解析逻辑。

---

## 七、未收口的问题：一键终止在真卡死时无效

本节结论均来自实读 `<ST_ROOT>/public/script.js`，不是推测。行号取自实测版本，升级酒馆后需重新核对。

### 先决事实：`stopGeneration()` 能掐断什么

```js
export function stopGeneration() {
    let stopped = false;
    if (streamingProcessor) { streamingProcessor.onStopStreaming(); stopped = true; }
    if (abortController) { abortController.abort('Clicked stop button'); hideStopButton(); stopped = true; }
    eventSource.emit(event_types.GENERATION_STOPPED);
    return stopped;
}
```

两条必须记住的：

1. **返回值没有信息量。** 模块级 `abortController` 在文件加载时就已 `new`，恒为真值，所以返回值恒为 `true`。
   只有"调用是否抛异常"能说明问题。
2. **流式请求用的是 `streamingProcessor.abortController.signal`，不是模块级那个。**
   而 `streamingProcessor` 在源码里有 6 处会被置 `null`。一旦置空，`stopGeneration()` 就再也掐不断任何东西，
   只剩下 abort 一个没人监听的 controller，外加 emit 一个事件。

### 三层兜底会在同一场景下同时失效

触发场景：**流已经断了，但酒馆 UI 还锁着。**

| 层 | 机制 | 失效原因 |
| --- | --- | --- |
| 1 | `stopGeneration()` | `streamingProcessor` 已置 null，调用变成空转 |
| 2 | `abortTrackedGenerationRequests()` | 兜底句柄已被提前撤销，见下 |
| 3 | `forceUnlockSillyTavernSendUi()` | 提前返回并谎报成功，见缺陷二 |

第二层值得单独说明：`monitorGenerationResponseLifecycle()` 克隆响应、把克隆流读完就调 `removeActiveGenerationRequest()`。
**只要服务端把流关掉了——哪怕内容根本没返回完、酒馆那边还卡着——克隆流就算读完**，句柄随即撤销。
于是恰恰在最需要它的时候 `abortable` 为 0。

### 缺陷一：`sillyTavernGenerationActive` 永久泄漏（已实锤）

酒馆的生成事件是不对称的：

- `GENERATION_STARTED` 在 `Generate()` 入口**无条件** emit，全文件仅此一处。
- `GENERATION_ENDED` 全文件**也只有一处** emit——在 `hideStopButton()` 内，且被 NOOP 守卫包着，
  只有 `#mes_stop` 当前不是 `display:none` 时才发。

而 `showStopButton()` 要到 `finishGenerating()` 里才调用。在那之前的一整排早退路径——
斜杠命令拦截、kobold 流式不支持、horde 被禁、服务器 ping 失败，以及**所有 dry run**——
都已经 emit 过 STARTED，却因为停止键从未显示而**永远不会 emit ENDED**。

监控清除该标志的唯一途径就是 ENDED / STOPPED 这两个事件，于是标志永久停在 `true`。

实测证据：一次完全空转的点击（确认无生成在跑）记录显示 `streaming_processor: null`、
跟踪请求 `0/0`、`is_send_press: false`、`data-generating` 不存在、发送键正常可见，
而 `generation_active` 仍为 `true`。

后果：`openManualForceStopGenerationDialog()` 靠 `isSillyTavernGenerationLikelyActive()` 选 normal / rescue，
标志恒真意味着 **rescue 模式实际上永远进不去**。

### 缺陷二：强制解锁提前返回并谎报成功（已实锤）

`forceUnlockSillyTavernSendUi()` 先等 1 秒观察 `isSillyTavernSendUiLocked()`，
一旦判定"没锁"就直接返回 `selfRecovered: true`，**一个恢复动作都不做**，
对外文案却是"酒馆已自行解除生成锁，发送按钮可用"。

该判定只看四个标志：`data-generating` / `data-swiping` / `is_send_press` / swipeState。
只要卡死状态没体现在这四个标志上，它就原样报成功。

顺带纠正一个容易走偏的猜测：**`activateSendButtons()` 是 export 的，而且它自己就设 `is_send_press = false`**，
所以"扩展无权解锁"不成立，解锁能力是够的，问题出在判定和时机。
（真正没被 export 的是 `unblockGeneration()`，但它多做的那几件事扩展并不需要。）

### 诊断通道

`POST /force-stop-diagnostics` → `<ST_ROOT>/data/default-user/latency-monitor/force-stop-diagnostics.jsonl`。

只在手动点终止时写，一次点击一条记录，内含四张只读快照：
`dialog-open` / `before-stop` / `after-stop` / `after-unlock`。
服务端补 `received_at`（前端时钟不可信），32 KB 上限防止意外灌入大对象。

| 快照字段 | 用来判定 |
| --- | --- |
| `streaming_processor` | 第一层：为 null 即 `stopGeneration()` 空转 |
| `tracked_requests.abortable` | 第二层：为 0 即兜底句柄已被提前撤销 |
| `send_ui_lock.locked` | 第三层：为 false 即会走谎报成功的分支 |
| `buttons.*_display` | 状态标志与按钮真实可见性是否脱节 |

采集全部只读，逐项兜错，上报 fire-and-forget 且吞掉所有异常——诊断本身不得影响终止流程。

### 仍未确定的部分

上面两个缺陷**都不足以单独解释"卡死时点了完全没用"**：真卡死时泄漏的标志同样是 `true`，
`stopGeneration()` 照样会被调用。

**结论需要一条真实卡死的诊断记录。在拿到之前不要凭推测改终止逻辑。**
