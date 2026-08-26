# 服务器权限与部署说明

## 当前生产机信息

- 当前真实生产公网 IP：`<SSH_HOST>`
- 旧 IP（不要再用）：`<OLD_HOST>`
- 当前可用登录用户：`admin`
- 当前服务名：`sillytavern.service`

## 当前本机使用的 SSH 密钥

- 私钥路径：
  - `C:\Users\FishBurger\.ssh\sillytavern-server`
- 公钥路径：
  - `C:\Users\FishBurger\.ssh\sillytavern-server.pub`

## 首次接入另一台电脑时要做的事

### 1. 把 SSH 密钥复制到新电脑

至少要把下面两份文件带过去：

- `sillytavern-server`
- `sillytavern-server.pub`

建议仍放到：

- `C:\Users\<你的用户名>\.ssh\`

### 2. 如果新电脑还没被服务器授权

需要登录云服务器网页控制台，在服务器终端里执行：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO6YmIOj+L/R4CyJLFk1El1OWWjNMp0mVK98Kc7FoqJq sillytavern-server' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

注意：

- 这条命令是加到当前登录用户家目录下的 `authorized_keys`
- 这次实际加成功的是 `admin` 账户，不是 `root`

## 当前远端目录映射

### 前端扩展目录

远端：

`/root/SillyTavern/public/scripts/extensions/third-party/st-latency-profiler`

本地对应：

- `manifest.json`
- `index.js`
- `style.css`
- `index.20260730.1818.js`
- `style.20260730.1818.css`

### 后端监控源文件

远端：

`/root/SillyTavern/src/latency-monitor.js`

本地对应：

`backend-monitor-minimal/latency-monitor.js`

### Server Plugin

远端：

`/root/SillyTavern/plugins/st-latency-monitor`

本地对应：

`backend-monitor-minimal/server-plugin/`

### Settings UI

远端：

`/root/SillyTavern/plugins/settings-ui`

本地对应：

`backend-monitor-minimal/settings-ui/`

## 当前已验证可用的登录与提权方式

> **SSH 端口是 <SSH_PORT>，不是默认的 22。** 22 端口会 `Connection reset`。
> 这份文档早期版本的命令省略了 `-p`，等于走 22 端口，全部连不上，已在下面补齐。
> `scp` 对应的参数是大写 `-P <SSH_PORT>`。

### 登录

```powershell
ssh -p <SSH_PORT> -i "$env:USERPROFILE\.ssh\sillytavern-server" <SSH_USER>@<SSH_HOST>
```

### 非交互检测

```powershell
ssh -o BatchMode=yes -p <SSH_PORT> -i "$env:USERPROFILE\.ssh\sillytavern-server" <SSH_USER>@<SSH_HOST> "echo connected && whoami && hostname"
```

### 用 sudo 操作正式目录

```powershell
ssh -o BatchMode=yes -p <SSH_PORT> -i "$env:USERPROFILE\.ssh\sillytavern-server" <SSH_USER>@<SSH_HOST> "sudo systemctl status sillytavern.service --no-pager -n 20"
```

## 当前部署方式

### 步骤 1：先传到临时目录

远端临时目录：

`/home/admin/trae-deploy/`

本次实际使用了这几个子目录：

- `/home/admin/trae-deploy/frontend`
- `/home/admin/trae-deploy/backend`
- `/home/admin/trae-deploy/backend/server-plugin`
- `/home/admin/trae-deploy/backend/settings-ui`

### 步骤 2：用 sudo 覆盖正式目录

用 `scp` 上传到临时目录后，再通过 `sudo cp` 覆盖正式路径。

### 步骤 3：重启服务

```powershell
ssh -o BatchMode=yes -p <SSH_PORT> -i "$env:USERPROFILE\.ssh\sillytavern-server" <SSH_USER>@<SSH_HOST> "sudo systemctl restart sillytavern.service"
```

### 步骤 4：检查服务状态

```powershell
ssh -o BatchMode=yes -p <SSH_PORT> -i "$env:USERPROFILE\.ssh\sillytavern-server" <SSH_USER>@<SSH_HOST> "sudo systemctl status sillytavern.service --no-pager -n 20"
```

## 前端加载关系（2026-08-26 已改）

> 这一节的原方案（`manifest.json` 指向 `index.20260730.1818.js` 这类带日期的副本）**已经废弃**。

带日期的副本方案要求每次修复都把同一份改动写两遍——一遍进 `index.js`，一遍进当期副本，
漏写一边就会出现"改了没生效"。实际也确实反复踩到了。

现在 `manifest.json` 的 `js` / `css` 直接指向 `index.js` 和 `style.css`，
所有修复只改这两个文件本身，仓库里不再保留任何带日期的副本。

代价是**失去了靠文件名换版做的缓存击穿**，所以测试前必须强制刷新（`Ctrl + Shift + R`）。
详见 [`docs/engineering-notes.md`](../../docs/engineering-notes.md)。

## 重要限制

1. 不要在未得到用户明确授权前做云端部署
2. 不要再把旧 IP `<OLD_HOST>` 当成当前生产机
3. 不要假设 `root` 可直接 SSH
4. 不要再新建带日期的 `index.*.js` / `style.*.css` 副本，直接改主文件

