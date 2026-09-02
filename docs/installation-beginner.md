# 零基础安装指南（完整版）

这份文档假设你**完全没碰过命令行**。每一步都写了要敲什么、应该看到什么、
看到别的东西说明什么。

只想快速用上、不想碰服务器的，别看这篇——回 [README](../README.md) 装精简版，
三步就完事，也不会改你服务器上的任何东西。

---

## 第 0 步：先搞清楚酒馆跑在哪台机器上

这决定了后面所有步骤，**一定要先确认**。

打开你平时用的酒馆页面，看地址栏：

| 地址栏长什么样 | 说明 | 走哪条路 |
| --- | --- | --- |
| `localhost:8000` 或 `127.0.0.1:8000` | 酒馆就跑在你现在这台电脑上 | 走 **A 路线** |
| 一串数字比如 `123.45.67.89:8000` | 酒馆跑在别的机器（服务器）上 | 走 **B 路线** |
| 一个域名比如 `tavern.xxx.com` | 同上，跑在别的机器上 | 走 **B 路线** |

> 为什么必须在酒馆那台机器上装？因为完整版要改酒馆自己的程序文件和配置文件，
> 浏览器没有权限动别人机器上的文件。这是浏览器的安全限制，绕不过去。

---

## A 路线：酒馆跑在你自己这台电脑上

### A1. 打开命令行

**Windows**：按 `Win` 键，输入 `powershell`，回车。会弹出一个蓝色或黑色的窗口，
里面有一行以 `PS C:\Users\你的名字>` 结尾的文字。这就是命令行，接下来所有命令都敲在这里。

**Mac**：按 `Command + 空格`，输入 `终端`，回车。弹出的白色或黑色窗口就是。

敲命令的方式是：输入一行文字，然后按回车。下文所有 `代码块里的内容` 都是要敲进去的命令。

### A2. 确认 Node.js 装了

敲：

```
node -v
```

**应该看到**类似 `v20.11.0` 或 `v22.3.0` 这样的版本号。数字大于等于 `v18` 就行。

**如果看到** `不是内部或外部命令` / `command not found`，说明没装 Node.js。
但酒馆本身就是靠 Node.js 跑的，你能打开酒馆说明它一定装了——多半是装在别处没加进
命令行的搜索路径。最省事的办法是去 [nodejs.org](https://nodejs.org/) 下载安装包重装一遍，
安装时一路点下一步即可。装完**关掉命令行窗口重新打开**，再敲一次 `node -v`。

### A3. 确认 git 装了

敲：

```
git --version
```

**应该看到**类似 `git version 2.43.0`。

**如果没有**，去 [git-scm.com](https://git-scm.com/downloads) 下载安装，一路下一步。
装完同样要**关掉命令行重新打开**。

### A4. 找到酒馆根目录

"根目录"就是酒馆程序所在的那个文件夹。它里面应该有一个叫 `public` 的文件夹、
一个 `config.yaml` 文件。

如果你平时是双击某个 `Start.bat` 或 `启动.bat` 启动酒馆的，**那个 bat 文件所在的文件夹
就是根目录**。

在文件管理器里打开那个文件夹，点一下地址栏，把完整路径复制下来，类似：

```
C:\SillyTavern
```

或者 Mac 上：

```
/Users/你的名字/SillyTavern
```

### A5. 下载本项目

敲（一行一行来，每行敲完按回车）：

```
cd ~
git clone https://github.com/mescolare-bot/ST-Aquarium-bubble-timer-sillytavern-latency-monitor.git
cd ST-Aquarium-bubble-timer-sillytavern-latency-monitor
```

**应该看到** `Cloning into ...` 然后是一串进度，最后回到命令提示符。

**如果看到** `fatal: destination path ... already exists`，说明之前下载过了。
敲 `cd ST-Aquarium-bubble-timer-sillytavern-latency-monitor` 然后 `git pull` 更新即可。

现在直接跳到 [第 1 步：装](#第-1-步装)。

---

## B 路线：酒馆跑在服务器上

### B1. 你需要三样东西

在开始之前，你手上必须有：

1. **服务器地址**：一串数字（比如 `123.45.67.89`）或域名
2. **登录用的用户名**：常见的是 `root` 或 `ubuntu`
3. **密码，或者一个密钥文件**（后缀通常是 `.pem`，或者没有后缀）

**这三样只能问给你开服务器的人要，或者去你买服务器的网站后台看。** 没有这些就登不上去，
也没有别的办法。

### B2. 打开命令行

同 A1。Windows 用 PowerShell，Mac 用终端。

### B3. 登录服务器

**用密码登录**，敲（把 `用户名` 和 `服务器地址` 换成你自己的）：

```
ssh 用户名@服务器地址
```

**用密钥文件登录**：

```
ssh -i 密钥文件的完整路径 用户名@服务器地址
```

**如果服务器端口不是默认的 22**（开服务器的人会告诉你），要加 `-p`：

```
ssh -p 端口号 -i 密钥文件路径 用户名@服务器地址
```

第一次连接会问：

```
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

敲 `yes` 回车。这是正常的，只会问一次。

然后会让你输密码。**注意：输密码时屏幕上不会有任何显示**，不会有星号也不会有光标移动，
这是正常的安全设计，照常输完按回车即可。

**登录成功**后命令提示符会变，通常变成 `用户名@主机名:~$` 或 `root@主机名:~#` 的样子。
从这一刻起，你敲的所有命令都是在**服务器上**执行，不再是你自己的电脑。

**常见报错**：

| 报错 | 意思 | 怎么办 |
| --- | --- | --- |
| `Connection refused` | 端口不对，或者服务器上没开 SSH | 问开服务器的人要正确端口 |
| `Connection timed out` | 地址不对，或者防火墙挡了 | 核对地址；问对方是否限制了来源 IP |
| `Permission denied (publickey)` | 服务器只认密钥不认密码 | 用 `-i 密钥文件` 的方式登录 |
| `Permission denied, please try again` | 密码错了 | 重新输。注意输密码时屏幕无显示是正常的 |
| `WARNING: UNPROTECTED PRIVATE KEY FILE` | 密钥文件权限太开放 | Mac/Linux 上敲 `chmod 600 密钥文件路径` 后重试 |

### B4. 确认服务器上有 node 和 git

登录成功后，敲：

```
node -v
git --version
```

**应该看到**两个版本号。酒馆跑在这台机器上，Node.js 一定是有的。

**如果 `node -v` 说找不到命令**，多半是 Node 装在了某个特殊路径下。试试：

```
which node || ls /usr/local/bin/node /usr/bin/node ~/.nvm/versions/node/*/bin/node 2>/dev/null
```

有输出的话，把那个完整路径记下来，后面执行时用完整路径代替 `node`。

### B5. 找到酒馆根目录

敲：

```
ls ~/SillyTavern/config.yaml
```

**看到路径回显**就说明根目录是 `~/SillyTavern`。

**看到** `No such file or directory` 就换个地方找：

```
find / -name "chat-completions.js" -path "*endpoints/backends*" 2>/dev/null
```

这条会扫全盘，可能要等十几秒。输出类似：

```
/root/SillyTavern/src/endpoints/backends/chat-completions.js
```

那么 `/root/SillyTavern` 就是根目录。**把它记下来**，下一步要用。

**如果什么都没输出**，说明这台机器上没有酒馆，你可能登错服务器了。

### B6. 下载本项目

```
cd ~
git clone https://github.com/mescolare-bot/ST-Aquarium-bubble-timer-sillytavern-latency-monitor.git
cd ST-Aquarium-bubble-timer-sillytavern-latency-monitor
```

---

## 第 1 步：装

先**空跑一次**看看会改什么，这一步不会真的动任何文件：

```
node install.mjs 你的酒馆根目录 --dry-run
```

比如 `node install.mjs /root/SillyTavern --dry-run`。

**应该看到**三个阶段，每行前面是一个灰色的点：

```
SillyTavern 根目录：/root/SillyTavern
dry-run 模式，只检查不写入

[1/3] 放置文件
  · 将写入 public/scripts/extensions/third-party/st-latency-profiler/index.js
  ...
[2/3] 给本体打补丁
  ...
[3/3] 开启服务端插件
```

**如果看到** `这里不像 SillyTavern 根目录`，说明路径给错了，回上一步重新确认。

**如果 `[2/3]` 里出现红色的 `✗ 找不到锚点代码`**，说明你的酒馆版本和补丁对不上
（本项目只在 SillyTavern 1.18.0 上验证过）。这种情况脚本装不了，需要照
[`installation.md`](installation.md) 手动找位置插入，或者退回去用精简版。

空跑没问题的话，去掉 `--dry-run` 真正执行：

```
node install.mjs 你的酒馆根目录
```

**成功的标志**是最后出现：

```
安装完成。接下来：
  1. 重启 SillyTavern
  2. 启动日志里应能看到 "1 server plugin(s) are currently loaded."
  3. 浏览器里按 Ctrl + Shift + R 强制刷新
```

> 脚本在动酒馆本体之前会自动备份一份，打完补丁还会做语法检查，检查不过会自动还原。
> 所以这一步失败不会把你的酒馆搞坏。

---

## 第 2 步：重启酒馆

怎么重启取决于你平时怎么启动它：

| 平时怎么启动 | 怎么重启 |
| --- | --- |
| 双击 `Start.bat` / `启动.bat` | 关掉那个黑窗口，重新双击 |
| 命令行里 `npm start` 跑着 | 在那个窗口按 `Ctrl + C`，再敲 `npm start` |
| 用 pm2 管着 | `pm2 restart all` |
| 用 systemd 管着（服务器常见） | `sudo systemctl restart sillytavern` |
| 装在 Docker 里 | `docker restart 容器名` |

**不知道属于哪种**？在服务器上敲 `systemctl list-units | grep -i silly`，有输出就是 systemd 那种。

### 确认插件加载了

重启后看启动日志，应该有一行：

```
1 server plugin(s) are currently loaded.
```

systemd 的话敲：

```
sudo journalctl -u sillytavern -n 30 --no-pager
```

**如果显示 `0 server plugin(s)`**，说明服务端插件没开起来。检查酒馆根目录下的
`config.yaml` 里有没有 `enableServerPlugins: true`（脚本应该已经改好了）。

---

## 第 3 步：强制刷新浏览器

回到酒馆页面，按 `Ctrl + Shift + R`（Mac 上是 `Command + Shift + R`）。

**这一步不能省。** 本项目的文件名是固定的，不带版本号，普通刷新会继续用浏览器缓存里的旧
文件，你会觉得"装了但没反应"。改动之后"又没生效"时，先怀疑这一步。

---

## 第 4 步：确认装成功了

页面右下角应该出现一个悬浮图标，点开就是监控面板。

然后**随便发一条消息**，回到面板，应该能看到刚才那次生成的记录。

| 现象 | 说明 |
| --- | --- |
| 图标是你设定的颜色，记录正常出现 | 完整版装好了 |
| 图标是**琥珀色**，记录也有 | 跑在精简版上，说明后端没装成功，回第 1 步看 `[3/3]` 有没有报错 |
| 图标是**红色** | 连不上后端，看第 2 步的插件加载日志 |
| 记录列表上方有黄色警告条 | 补丁没打全，警告条上会写明缺了哪几处、各自的后果 |
| 面板打得开但记录永远是空的 | 后端或补丁没装上，同样看第 1 步和第 2 步 |

---

## 之后怎么更新

在你下载本项目的那个文件夹里：

```
git pull
node install.mjs 你的酒馆根目录
```

脚本是幂等的，重复跑不会重复插入补丁。**酒馆自己升级之后也要重跑一次**，
因为酒馆升级会覆盖掉打过的补丁。

## 怎么卸载

```
node install.mjs 你的酒馆根目录 --uninstall
```

会把酒馆本体从备份还原，并删掉装进去的文件。**历史记录不会删**，
在酒馆根目录的 `data/*/latency-monitor/` 下，不需要就自己删。
