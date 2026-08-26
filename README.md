# ST Aquarium Bubble Timer SillyTavern Latency Monitor

鱼缸后端监控扩展仓库。

## 主要内容

- 前端入口：`index.js`、`style.css`
- 扩展清单：`manifest.json`
- 后端监控：`backend-monitor-minimal/`
- 扩展打包信息：`backend-monitor-extension-package.json`

## 改代码之前先读

[`docs/engineering-notes.md`](docs/engineering-notes.md) 记录了几条量化过的工程约束和
"看起来是 bug 其实是数据缺失"的结论，包括：

- 接口载荷体积约束（为什么 `limit` 必须有上限、为什么列表不下发 `prompt_breakdown`）
- 只有前端知道的字段该怎么随请求体下发，以及三个必踩的坑
- 后端只在请求结束后才落盘 run，由此否定的一类实现思路
- 聊天维度历史数据的起始日期限制
- 部署路径与**测试前必须强制刷新**的原因
