# backend-monitor-minimal

这是给 SillyTavern 做的最小后台监控方案。

## 目标

先记录每轮对话生成的关键耗时，帮助判断：

- 是前置处理慢
- 是上游模型响应头慢
- 是首 token 慢
- 还是流式输出过程慢

## 当前最小版会记录

- `source`
- `model`
- `stream`
- `message_count`
- `prompt_chars`
- `prompt_breakdown`
- `prompt_trace`
- `max_tokens`
- `total_ms`
- `preprocess_ms`
- `upstream_headers_ms`
- `ttft_ms`
- `stream_ms`
- `http_status`
- `usage`
- `error`

## 文件说明

- `latency-monitor.js`
  - 放到 SillyTavern 的 `src/latency-monitor.js`
  - 提供 JSONL 记录能力

- `server-plugin/index.js`
  - 放到 SillyTavern 的 `plugins/st-latency-monitor/index.js`
  - 提供查看接口

## 查看接口

- `/api/plugins/st-latency-monitor/status`
- `/api/plugins/st-latency-monitor/runs?limit=50`
- `/api/plugins/st-latency-monitor/summary?limit=200`

## 说明

这是最小监控版，不是最终完整版。

它暂时不做：

- 记忆检索内部阶段拆分
- 前端展示面板
- 和 `sillytavern cloud` 管理台联动展示

先把最核心的每轮生成耗时落盘，再逐步扩展。

## prompt_breakdown 现在会拆什么

- 每个 `role` 的消息条数和字符数
- 每条 message 的字符数
- 每条 message 的文本分片数
- 每条 message 的图片/音频/工具分片数
- 最大的 5 条 message
- 最近的 6 条 message

这样可以直接看出：

- 是系统提示太大
- 是历史对话太长
- 还是某一条超长用户/助手消息拖慢了生成

## prompt_trace 现在会记录什么

内部使用英文 key，展示使用中文标签。

当前会记录这些来源：

- `system_prompt` -> `系统提示词`
- `char_description` -> `角色描述`
- `char_personality` -> `角色性格`
- `scenario` -> `场景`
- `user_persona` -> `用户人设`
- `world_info` -> `世界书`
- `authors_note` -> `作者注释`
- `instruct` -> `指令模式`
- `chat_history` -> `聊天历史`
- `examples` -> `示例对话`
- `extension_prompt` -> `扩展提示词`
- `memory_summary` -> `记忆 / 摘要`
- `smart_context` -> `智能上下文`
- `chat_vectors` -> `聊天向量检索`
- `data_bank_vectors` -> `资料库向量检索`
- `chat_injects` -> `聊天注入`
- `prompt_bias` -> `提示词偏置`
- `before_scenario_anchor` -> `场景前锚点`
- `after_scenario_anchor` -> `场景后锚点`
