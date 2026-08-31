# 安装指南

> **先读这一段再动手。**
>
> 这个扩展**必须修改 SillyTavern 本体的一个源码文件**才能工作。如果你不接受改动酒馆本体，
> 这个扩展对你没用，可以到此为止。
>
> **不能只在酒馆界面里贴仓库地址装。** 那样只会装上前端，后端和补丁一样都不会装，
> 结果是面板打得开、插件显示加载成功、接口全返回 200，但记录永远是空的。
> 安装必须在**服务器上**执行，因为浏览器写不了 `src/`、`plugins/` 和 `config.yaml`。

下文的 `<ST_ROOT>` 指你的 SillyTavern 根目录（源码安装通常是 `SillyTavern/`）。

## 一键安装（推荐）

在**能访问酒馆文件的机器上**（通常就是跑酒馆的那台服务器）：

```bash
git clone https://github.com/mescolare-bot/ST-Aquarium-bubble-timer-sillytavern-latency-monitor.git
cd ST-Aquarium-bubble-timer-sillytavern-latency-monitor
node install.mjs <ST_ROOT>
```

脚本会把六处文件放好、给本体打上全部补丁、开启服务端插件开关。之后重启酒馆，
再在浏览器里按 `Ctrl + Shift + R` 强制刷新就行。

补丁部分是**幂等**的：每一处先按内容特征判断是否已经打过，打过就跳过。所以升级酒馆之后
直接重跑一次即可，不会重复插入，也不会覆盖你手工改的别的东西。

```bash
node install.mjs <ST_ROOT> --dry-run     # 只报告会做什么，不写任何文件
node install.mjs <ST_ROOT> --uninstall   # 还原本体并删掉装进去的文件
```

第一次打补丁前，脚本会把原始的 `chat-completions.js` 备份成
`chat-completions.js.st-latency-monitor.bak`（只在这个备份不存在时创建，
所以它始终是最干净的那一份）。打完补丁会自动跑一次 `node --check`，
万一失败会立刻从备份还原。

如果脚本报告**找不到锚点代码**，说明你的酒馆版本和补丁不匹配，它会告诉你是哪一处，
然后原样退出、不改动本体。这种情况按下面的手动步骤自己定位。

装完之后面板会自己检查补丁装全了没有。**少装或漏装时，记录列表上方会直接显示缺了哪几处
以及各自的后果**，不用再靠翻文档排查。

---

以下是手动安装步骤，只有在脚本跑不通时才需要。

## 组成部分

这个项目由三块组成，缺任何一块都不完整：

| 部分 | 作用 |
| --- | --- |
| 前端扩展 | 监控面板的界面，装在酒馆的第三方扩展目录 |
| 后端监控模块 | 真正采集耗时和 usage 并落盘，装进酒馆的 `src/` |
| server plugin | 提供 `/runs`、`/summary` 等查询接口给前端读 |

## 前置条件

- 能直接改酒馆源码文件的权限
- 服务端插件功能已开启（见第 5 步）

### 关于版本兼容性（重要）

**本文的补丁只在 SillyTavern 1.18.0 上实际验证过。**

`manifest.json` 里写的 `minimum_client_version: 1.12.6` 是历史遗留值，从未在该版本上验证，
不要当成兼容性承诺。

第 4 步的补丁靠**精确匹配原始代码字符串**来定位插入点，而这些字符串会随酒馆版本变化。
如果你的版本不同，很可能出现"照着文档找不到那段代码"的情况。遇到这种情况：

- 不要硬套本文给出的原始代码片段，以你自己文件里的实际内容为准
- 关键是**语义位置**对：在哪一步创建 monitor、在 fetch 前后打点、在流式/非流式/错误/异常
  四个出口分别收尾。只要这几个位置对了，具体上下文长什么样不影响功能
- `CHAT_COMPLETION_SOURCES` 的成员各版本有增减，以你这版实际存在的为准

---

## 1. 装前端扩展

把仓库根目录这三个文件放进去：

```
<ST_ROOT>/public/scripts/extensions/third-party/st-latency-profiler/
├── index.js
├── style.css
└── manifest.json
```

目录不存在就自己建。

## 2. 装后端监控模块

```
backend-monitor-minimal/latency-monitor.js  →  <ST_ROOT>/src/latency-monitor.js
```

## 3. 装 server plugin

```
backend-monitor-minimal/server-plugin/index.js  →  <ST_ROOT>/plugins/st-latency-monitor/index.js
```

### 3.1 共享模块要放两遍（很容易漏）

`settings-ui/` 和 `shared/` 这两个目录，**同一份内容需要复制到两个位置**：

```
backend-monitor-minimal/settings-ui/  →  <ST_ROOT>/src/settings-ui/
backend-monitor-minimal/settings-ui/  →  <ST_ROOT>/plugins/settings-ui/

backend-monitor-minimal/shared/       →  <ST_ROOT>/src/shared/
backend-monitor-minimal/shared/       →  <ST_ROOT>/plugins/shared/
```

原因是这两个模块被两个不同位置的文件用相对路径引入，而它们各自的相对位置不同：

```1:12:backend-monitor-minimal/latency-monitor.js
import { generateAbnormalOptimizationSuggestions } from './settings-ui/service/abnormal-optimization-suggestion-service.js';
import { readMonitorSettings } from './settings-ui/service/monitor-settings-store.js';
import { inferPermissionLevelFromHost } from './settings-ui/service/monitor-settings-validator.js';
// ...
} from './shared/plugin-rule-service.js';
```

`latency-monitor.js` 装在 `src/` 下，所以 `./settings-ui/` 解析成 `src/settings-ui/`；
而 `server-plugin/index.js` 装在 `plugins/st-latency-monitor/` 下，用的是 `../settings-ui/`，
解析成 `plugins/settings-ui/`。两处指向不同的真实目录，因此必须各放一份。

**少放任何一个，酒馆启动时都会因为 import 失败而起不来。**

### 3.2 依赖

`server-plugin/package.json` 里没有声明任何依赖，它只用 `express`（酒馆本体已经有了）
和 node 内置模块。所以**不需要在 plugin 目录里跑 `npm install`**。

---

## 4. 给酒馆本体打补丁（必须）

要改的文件：`<ST_ROOT>/src/endpoints/backends/chat-completions.js`

**先备份**：`cp chat-completions.js chat-completions.js.bak`

一共 9 处插入。每一处都是"找到锚点，在它前后插入几行"，不要删除任何原有代码。

> 这些插入点的权威定义在 [`backend-monitor-minimal/shared/chat-completions-patch.js`](../backend-monitor-minimal/shared/chat-completions-patch.js)
> ——安装脚本和面板自检都读它。本节内容如果和那个文件对不上，以那个文件为准。

### 4.1 加 import

在文件顶部的 import 区，`../google.js` 那一行后面加：

```js
import { createGenerationMonitor } from '../../latency-monitor.js';
```

（路径是 `../../`，因为这个文件在 `src/endpoints/backends/`，要回到 `src/`。）

### 4.2 在 /generate 路由开头声明 monitor

找到：

```js
router.post('/generate', async function (request, response) {
    try {
        if (!request.body) return response.status(400).send({ error: true });
```

改成：

```js
router.post('/generate', async function (request, response) {
    let monitor = null;

    try {
        if (!request.body) return response.status(400).send({ error: true });
```

### 4.3 创建 monitor

找到处理 `json_schema` 的那一段：

```js
        if (request.body.json_schema?.value) {
            request.body.json_schema.value = flattenSchema(request.body.json_schema.value, request.body.chat_completion_source);
        }
```

在它后面插入：

```js
        const monitorableSources = [
            CHAT_COMPLETION_SOURCES.OPENAI,
            CHAT_COMPLETION_SOURCES.OPENROUTER,
            CHAT_COMPLETION_SOURCES.CUSTOM,
            CHAT_COMPLETION_SOURCES.PERPLEXITY,
            CHAT_COMPLETION_SOURCES.GROQ,
            CHAT_COMPLETION_SOURCES.FIREWORKS,
            CHAT_COMPLETION_SOURCES.NANOGPT,
            CHAT_COMPLETION_SOURCES.POLLINATIONS,
            CHAT_COMPLETION_SOURCES.MOONSHOT,
            CHAT_COMPLETION_SOURCES.COMETAPI,
            CHAT_COMPLETION_SOURCES.ZAI,
            CHAT_COMPLETION_SOURCES.SILICONFLOW,
            CHAT_COMPLETION_SOURCES.WORKERS_AI,
        ];

        if (monitorableSources.includes(request.body.chat_completion_source)) {
            monitor = createGenerationMonitor(request);
            monitor.mark('preprocess_completed');
        }
```

这个名单决定了哪些接入源会被监控。你用的源不在里面就不会有记录——需要的话自己加，
名字以你这版酒馆 `CHAT_COMPLETION_SOURCES` 里实际有的为准（不同版本会增减）。

### 4.4 向上游索取流式 usage（漏了会没有 token 数）

找到组装请求体之后、处理 CUSTOM 排除项之前的位置：

```js
            'n': request.body.n,
            ...bodyParams,
        };

        if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM) {
```

在那个 `};` 和 `if` 之间插入：

```js
        if (request.body.stream && [
            CHAT_COMPLETION_SOURCES.OPENAI,
            CHAT_COMPLETION_SOURCES.CUSTOM,
        ].includes(request.body.chat_completion_source)) {
            requestBody.stream_options = {
                ...(requestBody.stream_options ?? {}),
                include_usage: true,
            };
        }
```

OpenAI 兼容接口在流式模式下默认**不返回** usage，必须显式索取。漏掉这一处的话，
其它功能都正常，只有流式生成的 token 数和成本估算会一直是空的——又是一个不报错的坑。

### 4.5 记录上游请求

找到：

```js
        console.debug('Chat Completion request:', requestBody);

        const fetchResponse = await fetch(endpointUrl, config);
```

改成：

```js
        console.debug('Chat Completion request:', requestBody);

        monitor?.mark('upstream_request_started');
        const fetchResponse = await fetch(endpointUrl, config);
        monitor?.setHttpStatus(fetchResponse.status);
        monitor?.mark('upstream_headers_received');
```

### 4.6 流式分支

找到：

```js
        if (request.body.stream) {
            console.info('Streaming request in progress');
            return await forwardFetchResponse(fetchResponse, response);
        }
```

改成：

```js
        if (request.body.stream) {
            console.info('Streaming request in progress');
            monitor?.attachStream(fetchResponse);
            const result = await forwardFetchResponse(fetchResponse, response);
            await monitor?.finalize({ outcome: 'stream' });
            return result;
        }
```

### 4.7 非流式分支

找到：

```js
        if (fetchResponse.ok) {
            /** @type {any} */
            const json = await fetchResponse.json();
            console.debug('Chat Completion response:', json);
            return response.send(json);
```

在 `return` 之前插入两行：

```js
            monitor?.captureJson(json);
            await monitor?.finalize({ outcome: 'json' });
```

### 4.8 错误分支和 catch

上游返回错误的分支，在 `console.error('Chat completion request error: ', ...)` 后面加：

```js
            monitor?.captureText(responseText);
            monitor?.captureError(new Error(message));
            await monitor?.finalize({ outcome: 'error_response' });
```

最外层的 catch，在 `console.error('Generation failed', error);` **之前**加：

```js
        monitor?.captureError(error);
        await monitor?.finalize({ outcome: 'exception' });
```

### 4.9 检查语法

```bash
node --check <ST_ROOT>/src/endpoints/backends/chat-completions.js
```

> **这个补丁会在酒馆升级时被覆盖。** 每次更新 SillyTavern 之后都要重新打一遍，
> 而且锚点代码可能已经变了，要对着新版本重新找位置。

---

## 5. 开启服务端插件

编辑 `<ST_ROOT>/config.yaml`：

```yaml
enableServerPlugins: true
```

## 6. 重启并验证

```bash
sudo systemctl restart sillytavern     # 或你自己的启动方式
```

启动日志里应该能看到：

```
Initializing plugin from <ST_ROOT>/plugins/st-latency-monitor/index.js
1 server plugin(s) are currently loaded.
```

没看到这两行说明第 3 步或第 5 步有问题。

然后在浏览器里**强制刷新**（`Ctrl + Shift + R`），打开监控面板，发一条消息，看有没有记录。

> `manifest.json` 直接指向 `index.js` / `style.css`，没有靠文件名换版做缓存击穿，
> 所以每次更新之后都必须强制刷新，否则浏览器会继续跑旧缓存。
> 出现"改了没生效"时，先确认这一步，再怀疑代码。

---

## 数据存在哪

```
<ST_ROOT>/data/default-user/latency-monitor/runs.jsonl
```

每次生成追加一行 JSON。这个文件会一直增长，实测约 **6 KB 一条**，
自己留意磁盘占用（面板里有清理功能）。

### 已知限制：多用户

数据路径里的 `default-user` 是**写死的**，不会跟随当前登录用户变化。
所以酒馆开多用户时，所有人的记录会混进同一个目录，也没有任何隔离。

目前这个扩展只适合单用户实例使用。

---

## 卸载

```bash
node install.mjs <ST_ROOT> --uninstall
```

会从备份还原 `chat-completions.js`，并删掉装进去的六处文件和目录。之后重启酒馆。

手动卸载的话：删掉第 1、2、3 步放进去的文件和目录，用备份还原 `chat-completions.js`，重启。

两种方式都**不会**动 `data/default-user/latency-monitor/` 里的历史记录，不需要就自己删。
