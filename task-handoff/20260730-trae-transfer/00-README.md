# 鱼缸后端监控交接包

这份交接包的目标是让新的 Trae 账号接手后，不需要重新摸索项目结构、部署路径和已知坑点，就能继续往下做。

## 当前项目定位

- 项目名称：`st-latency-profiler`
- 使用场景：SillyTavern 插件，做“鱼缸后端监控”
- 当前前端入口：项目根目录下的 `manifest.json`、`index.js`、`style.css`
- 当前线上实际加载版本：
  - `manifest.json` -> `index.20260730.1818.js`
  - `manifest.json` -> `style.20260730.1818.css`
- 当前线上部署状态：已部署，SillyTavern 服务已重启，服务状态为 `active`

## 交接文档顺序

1. `00-README.md`
   - 总入口
2. `01-current-status-and-pending.md`
   - 当前完成状态、未完成事项、风险项
3. `02-server-and-deploy.md`
   - 服务器、SSH、部署路径、部署方法
4. `03-critical-pitfalls.md`
   - 这次项目里最容易再次踩的坑
5. `04-next-agent-checklist.md`
   - 新账号接手时的建议工作顺序

## 当前最关键结论

1. 用户要求所有高风险操作，尤其是云端部署，必须先明确同意。
2. 本项目已经踩过一次“改了 `index.js/style.css`，但线上实际加载的是旧版本化文件”的坑。
3. 当前线上要看的不是 `index.js/style.css`，而是 `manifest.json` 指向的版本化文件。
4. 当前真实服务器不是旧的 `<OLD_HOST>`，而是 `<SSH_HOST>`。
5. 当前可用登录用户是 `admin`，不是 `root`；上线操作依赖 `sudo`。

## 当前主文件

- 前端主文件：
  - `manifest.json`
  - `index.js`
  - `style.css`
  - `index.20260730.1818.js`
  - `style.20260730.1818.css`
- 后端与服务相关：
  - `backend-monitor-minimal/latency-monitor.js`
  - `backend-monitor-minimal/server-plugin/index.js`
  - `backend-monitor-minimal/settings-ui/...`

## 当前工作区状态提醒

当前仓库不是干净树，存在已修改和未跟踪文件。接手时不要直接做任何回滚、`reset --hard`、`checkout --` 之类操作。

