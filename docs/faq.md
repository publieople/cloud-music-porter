# 常见问题

## 概念

### 「补全云盘」是什么原理？

网易云音乐里，会员歌曲对非会员只放 30 秒试听；但「音乐云盘」里的音频按你自己的文件完整播放。把同一首歌的音频放进云盘、再把云盘条目匹配到这首歌上，歌单里点开就是完整播放。

本工具只是把「找歌 → 下载 → 上传 → 匹配」这套手工流程自动化，**音频来自你自己安装的音源**。

### 需要开通会员吗？

不需要。云盘是账号自带的功能，但容量随账号不同（常见 60GB 量级），以 `cmporter status` 显示的为准。

### 会不会改动我的歌单或删我的云盘？

不会。工具对歌单只读；对云盘只做新增和匹配，删除只发生在你显式执行 `cmporter cloud --delete` 时。

### 用这个有账号风险吗？

工具只在你本机用你的登录态调用网易云官方接口，不会把 cookie 发到第三方。风险主要来自平台服务条款，以及请求频率——`config.delayMs` 可以调大以放慢请求。是否使用、怎么使用由你自己判断。

## 音源

### 为什么只支持 LX Music 和 MusicFree？

因为「仓库不内置任何音源」是硬性边界。LX Music 自定义源和 MusicFree 插件是现成的、很多人在用的两类音源形态：工具只需要读你本机已经装好的东西，不必分发任何音源文件。接入其他来源需要专门的适配器，不在 v0.1.0 范围内。

### 为什么搜索必须依赖 MusicFree 插件？

LX 自定义源规范**只定义了播放地址解析，没有搜索接口**。要自动找歌就必须有一个能搜索的音源，MusicFree 插件接口自带 `search`，所以搜索层用它。

### 我只配了 LX 源，能用吗？

可以解析，但自动搜索仍然需要 MusicFree 插件。`sourceMode: "lx"` 的意思是「解析只用 LX」，搜索层照旧用 MusicFree 插件；如果某个候选映射不到 LX 平台，工具会直接报错而不是回退，这时把 `sourceMode` 改回 `auto` 或 `musicfree` 即可。

### 搜出来一堆同名歌，工具怎么选？

按标题、艺人、时长给候选打分，取最像的；时长差得多的视为不同版本直接跳过。日志里能看到候选与命中结果，觉得不对可以换音源或换歌试。

### 音源脚本和插件安全吗？

都是第三方代码，需要你自己判断来源是否可信。LX 自定义源在 `node:vm` 里执行（只隔离全局变量，**不是安全沙箱**）；MusicFree 插件在工具进程内运行。请只安装你信任的音源。

## 登录与 cookie

### cookie 存在哪？安全吗？

登录凭证保存在本地 `~/.cloud-music-porter/data/cookie.json`（Windows 为 `%USERPROFILE%\.cloud-music-porter\data\cookie.json`，明文 JSON），只在本机使用，不会上传到第三方，也不会进 git。建议收紧文件权限、不要放在同步盘，详见 [SECURITY.md](../SECURITY.md)。

### cookie 失效了怎么办？

重新执行 `cmporter login` 扫码，或用 `cmporter login --cookie "MUSIC_U=..."` 粘贴新的 cookie，成功后旧的会被覆盖。

### 扫码没反应 / 二维码过期？

重新运行 `cmporter login` 刷新二维码，确保手机上的 App 已登录。没有图形界面的服务器环境请用 `--cookie`。

## 同步与云盘

### 「匹配」是什么？为什么这么重要？

匹配是告诉网易云「云盘里这个音频就是歌单里这首歌」。不匹配的话，云盘里虽然有文件、也能在云盘里播，但歌单里点开还是原来的试听状态。新导入的歌会自动尝试匹配，历史遗留的用 `cmporter match` 补。

### 提示「当前歌曲不支持匹配」怎么办？

这是网易云侧的限制，没有绕过办法。这类歌在云盘里能完整播放，只是不会挂到歌单条目上，忽略即可。

### 「秒传」和「真上传」有什么区别？

上传前工具会调 `/api/cloud/upload/check/v2` 问网易云「这个文件你有了吗」：

- `upload=1`：已有相同文件，直接导入，不传数据（秒传）；
- `upload=2`：没有，需要真正分块上传，再落库发布；
- `upload=0`：这首歌已经在云盘，跳过。

### 上传失败 409 怎么办？

409 一般意味着「音频没被正确处理」。常见原因：

- 音频格式不支持或文件损坏：确认是 mp3 / flac / m4a / wav 等常见格式；
- 文件时长、码率等元信息异常：换一个音源候选；
- 上传节点临时故障或分块不完整：直接重跑同一首。

先看 `~/.cloud-music-porter/data/logs/` 里对应的报错，再重跑；也可以用 `--force` 强制重试。多次失败说明该音源给出的文件有问题，换源。

### 云盘容量多大？满了怎么办？

常见是 60GB 量级，随账号不同，`cmporter status` 会显示已用/总量。空间不够时：

- 用 `--quality 320k` 代替 FLAC（单曲约 8–10MB，FLAC 约 20–40MB）；
- 用 `cmporter cloud --limit 50` 查看条目（默认列最近 30 条），`cmporter cloud --delete <id,...>` 清理不需要的；
- 用 `--max-gb` 控制单次写入云盘的总量（GB，按文件大小累计，秒传导入与真正上传都计入；默认 0 表示按云盘剩余空间的 95%）。

### 扫描显示「云盘已匹配」或「云盘有副本」，但歌单里还是试听？

先分清两种状态：

- **云盘已匹配**：已经关联到歌曲本体，正常情况下点开就是完整播放；如果还是试听，可能是客户端缓存，重启网易云或换个端再看。
- **云盘有副本（未匹配）**：音频在云盘里、但没关联到这首歌 → 跑 `cmporter match --liked` 补匹配。

如果云盘里那条已经被删了，重新 `sync`，工具会按当前云盘索引重新导入。

### 云盘里怎么出现了我没收藏的歌？

可能是你之前用 `--all` 或别的歌单跑过同步（云盘不区分来源），也可能是同名不同版本的多个条目。`cmporter cloud` 可以查看，确认不需要再用 `--delete` 删掉。

### 下架 / 无版权的歌能补吗？

不能。播放接口直接返回 404 说明平台当前没有这首歌的合法可播地址，任何音源都补不了。建议跳过，或自己准备本地文件。

### 酷我 128k 兜底是什么？

当高音质解析都失败时，部分平台通道只能给出 128k mp3，工具会把它当作最后兜底，保证「能完整播放」而不是没有。结果里会标注实际拿到的质量；介意音质就换音源重试。

### 会不会重复上传同一首歌？

相同文件会命中秒传检查（`upload=0/1`）不会重复上传；但不同音质、不同版本的同名歌是不同文件，云盘里会出现多个条目。想避免就用同一套音源和固定质量。

### `import` 命令是做什么的？

把你**本地已有**的音频直接导入云盘，不经过音源搜索与下载：

```bash
cmporter import "D:\Music\我的下载" --dry-run
cmporter import "D:\Music\我的下载" --quality flac --limit 20
```

- 递归扫描目录里的音频文件，文件名按 `歌名 - 歌手.ext` 解析成查询词；
- 用网易云曲库搜索找到对应歌曲，再走 `check/v2` → 秒传或真上传 → 匹配；
- 支持 `--dry-run` 先看会处理哪些歌、`--limit` / `--offset` 分批、`--max-gb` 控制写入云盘的总量（秒传与上传都计入）；
- 适合补那些音源搜不到、但你自己有文件的歌。音频请确保是你合法获取的。

### 能批量删云盘里的歌吗？

可以按 id 删：先 `cmporter cloud`（默认列出最近 30 条，`--limit` 可调）拿到 id，再 `cmporter cloud --delete id1,id2`。没有「按歌名批量删」的开关，删除请谨慎（云盘回收站里也许还能恢复，但不要依赖）。

## 网络与代理

### 需要代理吗？

在中国大陆直连一般即可；海外访问网易云接口可能受区域限制或变慢。如果你需要代理，请在启动工具前设置 Node 认识的环境变量：

```bash
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890
cmporter doctor
```

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
cmporter doctor
```

### 报证书 / TLS 错误怎么办？

常见于公司代理、抓包软件或杀毒软件的 HTTPS 拦截。可以让 Node 信任代理的根证书：

```bash
export NODE_EXTRA_CA_CERTS=/path/to/proxy-root-ca.pem
```

```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\path\to\proxy-root-ca.pem"
```

工具不会替你关闭证书校验。不要通过降低 TLS 安全性的方式绕过。

### 下载慢或频繁失败？

音源服务器本身的速度和稳定性占大头，网易云接口另有频率限制。可以把 `config.delayMs` 调大、分批跑（`--limit` / `--offset`），换个时段再试。

## 其他

### 配置和数据存在哪？换机器 / 多账号怎么办？

默认都在 `~/.cloud-music-porter/`（Windows 为 `%USERPROFILE%\.cloud-music-porter\`；下表路径相对这个根目录）：

| 路径 | 内容 |
| --- | --- |
| `config.json` | 配置 |
| `data/cookie.json` | 登录态（明文） |
| `data/state.json` | 同步记录 |
| `data/runs/`、`data/logs/`、`data/tmp/` | 运行记录、日志、临时文件 |

换根目录（迁移到别的盘、给另一个账号单独一套）就设环境变量 `CMPORTER_HOME`：

```bash
export CMPORTER_HOME=/data/cmporter-account2
cmporter login
```

```powershell
$env:CMPORTER_HOME = "D:\cmporter-account2"
cmporter login
```

cookie 是明文，迁移时不要把整个目录随手上传或放进共享盘。

### `doctor` 报了 ✘ 或退出码 2 怎么办？

`cmporter doctor` 会检查 7 项：运行环境、配置、ffprobe、登录、音乐云盘、MusicFree 插件、LX Music 自定义源。每项带 ✔ / ! / ✘ 和修复提示，**出现 ✘ 时退出码为 2**（脚本可以用它判断环境是否就绪）；只有 ! 提醒时退出码仍是 0。

- ✘ 在「MusicFree 插件」：没有可用插件，搜索会拿不到候选——先去 MusicFree 装插件，或用 `CMPORTER_MF_PLUGINS` / `musicFreePluginsDir` 指定目录；
- ✘ 在「登录」：cookie 缺失或失效，重新 `cmporter login`；
- ! 在「ffprobe」或「LX Music 源」：只是提醒，不影响基本流程（ffprobe 缺失只降低校验强度，LX 缺失只是少一层解析）。

### 支持哪些平台？

Windows / Linux / macOS，Node.js ≥ 20。扫码登录需要图形界面；服务器环境用 `--cookie` 登录。定时任务三平台各有实现。

### 会不会上报我的数据？

工具只访问两类服务：网易云音乐接口，以及你配置的音源本身对应的解析服务。没有额外的数据统计或上报。cookie、日志、同步状态都只留在本机 `~/.cloud-music-porter/`。

### WebUI 能开放到公网吗？

不要。它默认只监听 `127.0.0.1`、拒绝非本机 Host 并校验 POST 请求头，但页面上能触发同步、改配置，暴露出去等于把账号操作权限交出去。WebUI 没有删除云盘条目的入口，删除只能用 CLI 的 `cmporter cloud --delete`。

### 定时任务没有按时跑？

1. `cmporter service status` 看最近一次运行记录与错误；安装时可以用 `cmporter service install --time 08:30` 指定触发时间。服务每天最多尝试运行 `serviceMaxAttempts`（默认 3）次，当天成功一次后后续触发会跳过（`--force` 可强制）；日志在 `data/logs/service-YYYY-MM-DD.log`；
2. Windows：确认计划任务存在、当前用户有权限、机器当时没有休眠/关机；被错过时计划任务一般会在开机后补跑；
3. Linux：systemd user timer 在用户退出登录后可能不触发，需要 `loginctl enable-linger <用户名>`；
4. macOS：确认 launchd plist 已加载；
5. 也可以先 `cmporter service run` 手动跑一次看是否正常。

### 怎么卸载干净？

```bash
cmporter service uninstall     # 先卸载定时任务
npm unlink -g cloud-music-porter  # 如果全局 link 过
```

然后删掉仓库目录即可。云盘里的歌不会自动删除，需要清理用 `cmporter cloud --delete`；想重置本地状态就删掉 `~/.cloud-music-porter/`（配置、cookie、状态都在里面）。

### 这个项目和网易云官方有关系吗？

没有。这是第三方工具，与网易云音乐、LX Music、MusicFree 均无关联，只调用它们的公开接口或读取本地文件。
