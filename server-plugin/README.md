# st-latency-profiler-server

这是 `st-latency-profiler` 的可选服务器插件。

## 作用

它不会替普通用户增加复杂设置，也不会去拆“记忆检索”和“模型内部思维链”。

这个插件当前只做两件事：

1. 让前端扩展识别到“增强模式”
2. 把前端收集到的每次耗时记录保存到服务器

适合：

- 自建云酒馆
- 想集中保留日志的管理员
- 希望多位普通用户都能把记录交到同一台服务器的人

## 安装

把这个文件夹放到 SillyTavern 的 `plugins` 目录中，例如：

```text
SillyTavern/plugins/st-latency-profiler-server
```

确保该目录里至少有：

```text
st-latency-profiler-server/
├── index.js
└── README.md
```

然后在 `config.yaml` 里开启：

```yaml
enableServerPlugins: true
```

重启 SillyTavern。

## 前端如何配合

服务器插件装好后：

1. 打开前端扩展 `Latency Profiler`
2. 点一次 `刷新模式`
3. 看到“增强模式：已检测到服务器插件”
4. 勾选 `同步到服务器`

之后每次生成完成，前端会把该次统计结果 POST 到服务器插件。

## 接口

- `GET /api/plugins/st-latency-profiler-server/status`
  - 返回插件状态、版本、记录数
- `GET /api/plugins/st-latency-profiler-server/runs?limit=20`
  - 返回最近记录
- `POST /api/plugins/st-latency-profiler-server/runs`
  - 写入一条或多条记录

## 日志位置

默认保存在插件目录下：

```text
server-plugin/data/runs.jsonl
```

实际运行时会显示为服务器上的真实绝对路径。

## 说明

这是一个“服务器伴侣版”，不是对 SillyTavern 核心生成流程的深度侵入式改造。

所以它的定位是：

- 集中保存
- 统一查看
- 云环境下让普通用户也能交日志

而不是：

- 精确拆内部记忆阶段
- 精确拆模型内部隐藏推理
