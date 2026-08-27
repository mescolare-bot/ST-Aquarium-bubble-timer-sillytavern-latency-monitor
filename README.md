# 鱼缸后端监控 · SillyTavern Latency Monitor

给 SillyTavern 做的生成链路监控面板。每次生成花在哪一段、上游到底收了多少 token、
哪些请求出了异常、大概花了多少钱——这些都记下来并在面板里展示。

## 能看到什么

- **分段耗时**：前置处理、上游响应头、首 token、流式输出各占多久，卡在哪一段一眼能看出来
- **prompt 体积拆解**：按 role 统计条数和字符数，定位是系统提示太大、历史太长、还是某条超长消息拖慢了生成
- **异常诊断**：识别可处置的异常类型并给出优化建议
- **成本估算**：按模型配置的价格换算，支持缓存命中和峰谷计价
- **历史与聚合**：按用途筛选、按聊天归组、7/14/30 天日聚合
- **等待队列**：查看和管理等待中的请求

## 安装

**这个扩展需要手动修改 SillyTavern 本体的一个源码文件才能工作**，没有一键安装。

完整步骤见 [`docs/installation.md`](docs/installation.md)。

最容易踩的坑先说在前面：

- 漏打本体补丁的话，面板打得开、插件也加载成功，但**记录永远是空的，且没有任何报错**
- `settings-ui/` 和 `shared/` 这两个目录**同一份要放两个位置**，少一个酒馆起不来
- 更新之后必须 `Ctrl + Shift + R` 强制刷新，否则浏览器还在跑旧缓存

## 仓库结构

```
index.js / style.css / manifest.json   前端扩展（装进酒馆的第三方扩展目录）
backend-monitor-minimal/
  latency-monitor.js                   后端采集与落盘（装进酒馆 src/）
  server-plugin/index.js               查询接口（装进酒馆 plugins/）
  settings-ui/  shared/                两处共享模块，各需放两遍
docs/
  installation.md                      安装指南
  engineering-notes.md                 改代码之前必读
```

## 改代码之前先读

[`docs/engineering-notes.md`](docs/engineering-notes.md) 记录了几条量化过的工程约束，
以及若干"看起来是 bug、其实是数据缺失"的结论：

- 接口载荷体积约束——为什么 `limit` 必须有上限、为什么列表不下发 `prompt_breakdown`
- 只有前端知道的字段该怎么随请求体下发，以及三个必踩的坑（含"`0` 是合法楼层"）
- 后端只在请求结束后才落盘，由此**否定掉的一整类实现思路**
- 聊天维度历史数据的起始日期限制
- 远程部署与更新时反复踩到的问题

## 已知限制

- **只在 SillyTavern 1.18.0 上验证过。** 本体补丁靠精确匹配原始代码定位，
  其他版本可能找不到对应位置，需要自己按语义找。`manifest.json` 里的
  `minimum_client_version: 1.12.6` 是历史遗留值，不构成兼容性承诺。
- **只支持单用户实例。** 数据路径里的 `default-user` 是写死的，多用户时记录会混在一起。
- **本体补丁会被酒馆升级覆盖**，每次更新后要重新打。
- **流式 usage 偶发归零**（约 3.7%），成因尚未完全查清，详见工程笔记第六节。

## License

[MIT](LICENSE)
