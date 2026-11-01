# cloud-music-porter

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](#支持的平台)

**把你自己合法获取的音频送进网易云音乐云盘，让原本只能试听 30 秒的歌可以完整播放。**

命令行工具名为 `cmporter`，Node.js ≥ 20，支持 Windows / Linux / macOS。仓库**不内置任何音源**。

## 它解决什么问题

网易云音乐里有一批歌只有会员才能完整播放，非会员点开只能听 30 秒试听。但「音乐云盘」是另一条路：你上传到云盘的音频，会按你自己的文件完整播放。

于是就有了这个工具，把原本要手动做的重复劳动自动化：

> 找到哪些歌受限 → 在你自备的音源里搜同一首歌 → 下载 → 上传到云盘 → 把云盘里的副本匹配回这首歌

它做的事情就是把这条链路跑通、跑稳、可以批量跑。**音频从哪来，由你自己决定**——工具只读取你本机已经装好的音源（LX Music 自定义源 / MusicFree 插件），不替你找、也不替你分发。

## 核心特性

- **自动识别受限歌曲**：读取「我喜欢的音乐」或指定歌单，通过播放接口判断哪些歌属于 VIP 受限（30 秒试听），`--vip-only` 只列这些歌。
- **音源自备**：从你本地的 MusicFree 插件与 LX Music 自定义源取音频，仓库里没有任何音源脚本、插件包、第三方二进制或镜像站。
- **全流程自动**：搜索匹配 → 解析下载 → 文件校验 → 云盘秒传/上传 → 导入 → 匹配回歌曲本体 → 播放验证。
- **搜索与解析分开**：MusicFree 插件负责聚合搜索（搜索必需），解析优先走 LX Music 自定义源，失败自动回退到 MusicFree，两边能力互补。
- **秒传优先**：云盘已有相同文件时直接走秒传导入，不重复上传；真正上传时按分块上传并在落库后校验。
- **本地优先**：cookie、同步状态、日志、临时文件全部留在本机 `~/.cloud-music-porter/`，WebUI 只监听 `127.0.0.1`。
- **可预演、可中断、可续跑**：`--dry-run` 先看清单，`--limit` / `--offset` 分批跑，`--from` 复用扫描结果，失败可重跑。
- **跨平台定时**：Windows 计划任务、Linux systemd user timer（cron 兜底）、macOS launchd 三套实现，一条命令装好。
- **三种使用方式**：CLI、本地 WebUI、Agent skill，按习惯挑。

## 合规声明

> **本项目只处理你自己合法获取的音频文件，不提供音源、不提供解析服务、不绕过任何收费机制。**
>
> 仓库不含任何音源脚本、插件包、第三方二进制或镜像站地址；音源需要你在 LX Music / MusicFree 中自行安装。
>
> 工具**不破解会员、不伪造 VIP 状态、不修改网易云客户端**：云盘播放是该账号本来就有的功能，这里只是把「你自己的音频」放进去。请把它理解为「**用你自己的音频补全云盘**」的整理工具，并遵守你所在地区的法律与网易云音乐的服务条款。由此产生的账号与法律风险由使用者自行承担。

## 30 秒快速开始

需要先装好 Node.js ≥ 20，以及一个已经装好插件的 MusicFree（**搜索必需**）；如果同时配了 LX Music 自定义源，解析会优先用它。

```bash
### 1) 克隆并安装
git clone https://github.com/publieople/cloud-music-porter.git
cd cloud-music-porter
npm install

### 2) 环境自检 + 扫码登录
node src/cli.js doctor
node src/cli.js login

### 3) 确认本机音源被识别（没配音源会提示你先去配）
node src/cli.js sources

### 4) 扫描「我喜欢的音乐」，只看 VIP 受限的歌
node src/cli.js scan --liked --vip-only

### 5) 先预演，确认没问题再真正同步
node src/cli.js sync --liked --dry-run
node src/cli.js sync --liked --yes
```

> 执行过 `npm link` 之后，可以把上面命令里的 `node src/cli.js` 换成 `cmporter`（下文都以 `cmporter` 为例）。

Windows 下在 PowerShell 里执行同样的命令即可；只有设置环境变量等少数操作用法不同，文档中会单独标注。

## 工作原理

```text
             ┌──────────────────────────────────┐
             │  网易云账号（扫码登录）            │
             └───────────────────┬──────────────┘
                                 │
              ┌──────────────────┴───────────────────┐
              │  读取歌单 / 我喜欢的音乐              │
              │  播放接口判断：完整 / 30 秒试听 / 下架 │
              └──────────────────┬───────────────────┘
                                 │ 需要补的歌
              ┌──────────────────┴───────────────────┐
              │  MusicFree 插件：聚合搜索同名歌曲     │
              │  打分匹配（标题 + 艺人 + 时长）        │
              └──────────────────┬───────────────────┘
                                 │ 命中候选
              ┌──────────────────┴───────────────────┐
              │  解析：LX 自定义源优先 → MusicFree 回退│
              │  下载 → 校验（文件头 / 大小 / ffprobe）│
              └──────────────────┬───────────────────┘
                                 │ 合法音频文件
              ┌──────────────────┴───────────────────┐
              │  云盘 upload/check/v2                 │
              │  ├ upload=1 秒传导入                  │
              │  ├ upload=2 分块上传 → info/v2 → pub/v2│
              │  └ upload=0 已在云盘，跳过            │
              └──────────────────┬───────────────────┘
                                 │ 云盘条目
              ┌──────────────────┴───────────────────┐
              │  匹配回歌曲本体（cloud/user/song/match）│
              │  播放验证：不再返回试听信息            │
              └──────────────────────────────────────┘
```

cookie、配置与数据默认都保存在用户目录 `~/.cloud-music-porter/`（Windows 为 `%USERPROFILE%\.cloud-music-porter\`），可以用环境变量 `CMPORTER_HOME` 换一个根目录。

每一步的实现细节、接口字段和边界条件见 [docs/architecture.md](docs/architecture.md)。

## 安装

### 环境要求

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20 | 必须 |
| npm | 随 Node.js 安装 | 必须 |
| MusicFree 插件 | 至少一个可用 | 搜索必需，见 [docs/sources.md](docs/sources.md) |
| LX Music 自定义源 | 可选 | 装了则解析优先走 LX |
| ffprobe | 可选 | 有则做更严格的音频校验（时长、编码），没有也能运行 |

### 安装方式

```bash
git clone https://github.com/publieople/cloud-music-porter.git
cd cloud-music-porter
npm install

# 可选：全局注册 cmporter 命令
npm link
```

不 link 也能用，把 `cmporter` 换成 `node src/cli.js` 即可。

安装后先跑一次自检：

```bash
cmporter doctor
```

它会逐项检查 7 项并打印 ✔ / ! / ✘：运行环境（Node 版本、平台）、配置、ffprobe、登录（昵称 / uid / vipType）、音乐云盘（条数 / 已用 / 上限）、MusicFree 插件、LX Music 自定义源。有阻塞项（✘）时命令退出码为 2，可以写进脚本判断；只有 `!` 提醒（比如缺 ffprobe）时仍算通过、退出码 0；全绿会输出「结果：全部正常，可以开始 cmporter scan / sync 了」。

## 首次使用

### 1. 登录网易云账号

```bash
cmporter login
```

终端会显示登录二维码，用网易云音乐 App 扫码并在手机上确认即可；登录凭证保存在 `~/.cloud-music-porter/data/cookie.json`。扫码默认等待 180 秒，网络慢时可以加 `--timeout 300`。

没有图形界面或扫码不方便时，也可以直接粘贴 cookie：

```bash
cmporter login --cookie "MUSIC_U=你的cookie值"
```

cookie 等于账号登录凭证，请勿提交到仓库、同步盘或发给他人。cookie 失效时重新执行一次 `cmporter login`。

### 2. 准备音源

这一步需要你自己完成，**仓库不提供音源**：

1. 在 MusicFree 里安装插件（工具会读取它的插件目录）——**至少装一个**，搜索靠它；
2. 可选：在 LX Music 里安装「自定义源」（工具会读取它的 `user_api.json`），解析时会优先尝试。

安装完执行：

```bash
cmporter sources
```

能看到 MusicFree 插件和 LX 自定义源列表、以及每个是否可用，就说明准备完成。路径没被自动识别时，可以在 `~/.cloud-music-porter/config.json` 里显式指定 `lxDataDir` / `musicFreePluginsDir`；也可以用环境变量临时覆盖：`CMPORTER_LX_DATA`（兼容 `LX_DATA_DIR`）指向 LX 的 `LxDatas` 目录，`CMPORTER_MF_PLUGINS` 指向 MusicFree 插件目录。

> 注意：LX 自定义源规范**没有搜索接口**，所以搜索始终依赖 MusicFree 插件；只装 LX 源时 `cmporter sync` 会提示没有搜到候选。

详细的目录位置、平台映射规则和排查方法见 [docs/sources.md](docs/sources.md)。

### 3. 扫描：看看哪些歌需要补

```bash
# 只看「我喜欢的音乐」里的 VIP 受限歌曲
cmporter scan --liked --vip-only

# 某个歌单（支持歌单 id 或分享链接）
cmporter scan --playlist 123456789 --vip-only

# 全部歌单 + 喜欢列表，输出 JSON 备用
cmporter scan --all --vip-only --json scan.json
```

| 参数 | 说明 |
| --- | --- |
| `--liked` | 扫描「我喜欢的音乐」（默认） |
| `--playlist <id\|url>` | 扫描指定歌单 |
| `--all` | 扫描全部歌单 + 喜欢列表，去重 |
| `--song <id,...>` | 只扫描指定歌曲 id |
| `--query <关键词>` | 按关键词搜索后扫描命中的歌 |
| `--vip-only` | 只看 VIP 受限（30 秒试听）的歌 |
| `--all-rows` | 输出全部行，不只受限歌曲 |
| `--json <file>` | 把结果导出为 JSON，供 `sync --from` 使用 |

扫描结果会给每首歌标注状态：需要补（如「试听（VIP）」）、云盘已匹配（点开即可完整播放）、云盘有副本（未匹配，从云盘播放）、可正常播放、下架/无版权（默认跳过）等。

### 4. 同步：搜索、下载、上传、导入

```bash
# 预演：只打印计划，不下载不上传
cmporter sync --liked --dry-run

# 真正执行，--yes 跳过逐条确认
cmporter sync --liked --yes

# 只要 320k mp3，本次最多 20 首、最多写入云盘 1GB
cmporter sync --liked --quality 320k --limit 20 --max-gb 1 --yes

# 复用上一步的扫描结果
cmporter sync --from scan.json --yes
```

| 参数 | 说明 |
| --- | --- |
| `--dry-run` | 预演，只输出将要处理哪些歌 |
| `--yes` | 不再逐条询问 |
| `--quality flac\|320k` | 目标音质，默认 `flac` |
| `--source auto\|lx\|musicfree` | 优先用哪类音源解析，默认 `auto`（先 LX 再 MusicFree）；搜索始终来自 MusicFree 插件 |
| `--limit N` / `--offset N` | 分批处理，配合定时任务或试跑 |
| `--max-gb N` | 本次最多写入云盘多少 GB（**按文件大小累计，秒传导入与真正上传都计入**）；`0`（默认）表示按云盘剩余空间的 95% 计算，超出预算就停止本次同步 |
| `--from <scan.json>` | 使用之前 `scan --json` 的结果 |
| `--include-unavailable` | 也尝试下架 / 无版权的歌（默认跳过） |
| `--delay <ms>` | 每首之间的间隔（毫秒），默认读配置里的 `delayMs` |
| `--force` | 强制重试，忽略「已处理过」的本地记录 |

同步过程中会实时打印每首歌的进度和结果；失败会记录到 `~/.cloud-music-porter/data/logs/`，修好后用同样命令重跑即可。

### 5. 匹配：把云盘副本挂回歌曲

「匹配」是指告诉网易云：云盘里这个音频，就是歌单里那首歌。只有匹配过，歌单里点开才会变成完整播放。

新导入的歌会在同步后自动尝试匹配；如果是之前手动上传、或导入时匹配失败的歌，可以单独补：

```bash
cmporter match --liked --dry-run   # 先看会匹配哪些
cmporter match --liked             # 执行

# 也可以复用扫描结果
cmporter match --from scan.json --dry-run
```

少数歌会返回「当前歌曲不支持匹配」，这类歌不影响在云盘里播放，只是不会挂到歌单条目上。

### 6. 可选：导入本地已有的音频

如果你手上已经有合法获取的音频文件（自己买的、自己录的），可以按文件名匹配曲库后直接导入云盘：

```bash
cmporter import "D:\Music\我的下载" --dry-run   # 先看匹配结果
cmporter import "D:\Music\我的下载"             # 执行
```

- 文件名格式建议 `歌名 - 歌手.ext`（如 `晴天 - 周杰伦.flac`），工具会递归扫描目录；
- 工具用网易云曲库搜索匹配歌曲 id，再走与 `sync` 相同的云盘检查、秒传/上传与匹配流程；
- 支持 `--limit`、`--max-gb`、`--delay`，`--dry-run` 只打印计划。

> 只处理你自己合法拥有的文件。这个功能不会从任何地方下载音频。

### 7. 可选：装成定时任务

```bash
cmporter service install              # 时间取配置里的 serviceHour / serviceMinute
cmporter service install --time 08:30 # 直接指定每天 08:30 运行
cmporter service status               # 查看状态与最近运行记录
cmporter service run                  # 立刻手动跑一次（就是定时任务执行的动作）
cmporter service uninstall            # 卸载
```

| 平台 | 实现 |
| --- | --- |
| Windows | 计划任务 `CloudMusicPorterDaily`，每天指定时间运行，用户登录时也会补跑；任务实际执行的是 `node <cli.js 路径> service run` |
| Linux | systemd user 的 `cloud-music-porter.service` + `cloud-music-porter.timer`（`OnCalendar` 每天 HH:MM，`Persistent=true` 错过后补跑）；没有 systemd 时回退 crontab |
| macOS | launchd `~/Library/LaunchAgents/com.publieople.cloud-music-porter.plist` |

每次 `service run` 的固定动作：

1. 每天最多尝试运行 `serviceMaxAttempts` 次（默认 3）；当天已经成功同步过，后续触发就直接跳过（`--force` 强制再跑）；
2. 清理 `data/tmp/` 里的临时文件与 30 天前的服务日志；
3. 先尝试刷新 cookie：Windows 会从本机网易云客户端的登录态（DPAPI 保护的本地数据）刷新，客户端保持登录就不用重新扫码；刷新失败或其他平台退回已保存的 cookie；
4. 执行 `sync --liked`，结果写入 `~/.cloud-music-porter/data/service-state.json`，日志在 `~/.cloud-music-porter/data/logs/service-YYYY-MM-DD.log`。

`service run --dry-run` 只是演练：不写云盘，也不计入当天尝试次数、不会被记成「今天已成功同步」，所以当天晚些的真实定时同步仍会照常执行。

Windows 上安装计划任务可能需要当前用户具备相应权限；失败时看命令输出的提示，或用系统「任务计划程序」手动创建。

### 8. 可选：本地 WebUI

```bash
cmporter web                 # 默认 8787 端口，并自动打开浏览器
cmporter web --port 8790     # 换端口
cmporter web --no-open       # 不自动打开浏览器
```

然后打开 <http://127.0.0.1:8787>。页面包含：

- **顶部**：账号信息与扫码登录入口（弹窗扫码）；
- **概览卡**：账号、云盘用量（meter 条 / 已用 / 上限）、音源、每日自动同步状态；
- **「扫描 / 同步」表单**：范围（喜欢列表 / 全部歌单 / 指定歌单 / 指定歌曲 / 关键词）、音质、只看 VIP、演练、本次预算 GB；按钮有扫描、开始同步、匹配云盘副本、环境检查；
- **「每日自动同步」卡**：时间输入，以及安装 / 卸载 / 立即运行 / 查看状态；
- **配置卡**：`quality`、`sourceMode`、`lxDataDir`、`musicFreePluginsDir`、`delayMs`，保存即写入配置文件；
- **底部日志抽屉**：SSE 实时推送当前任务的输出。

WebUI 只监听 `127.0.0.1`，并拒绝非本机 Host 的请求，POST 还需要带自定义请求头（防 CSRF）。**仅限本机使用，不要端口转发或暴露到公网**。它不提供删除云盘条目的入口，删除只能用 CLI 的 `cmporter cloud --delete <id,...>` 显式指定 id。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `cmporter login [--cookie "<cookie>"] [--timeout <秒>]` | 扫码登录，或粘贴 cookie |
| `cmporter doctor` | 环境自检（7 项）：运行环境、配置、ffprobe、登录、云盘、MusicFree 插件、LX 源；有阻塞项退出码 2 |
| `cmporter status` | 账号、云盘条目数与容量、本地同步记录 |
| `cmporter sources [--json]` | 列出检测到的 MusicFree 插件与 LX 自定义源及可用性 |
| `cmporter scan [选择范围] [--vip-only] [--all-rows] [--json <file>]` | 扫描哪些歌需要补 |
| `cmporter sync [选择范围] [--yes] [--dry-run] [--quality] [--source] [--delay] [--limit] [--offset] [--max-gb] [--from] [--include-unavailable] [--force]` | 执行搜索→下载→上传→导入 |
| `cmporter match [--liked \| --from <scan.json>] [--dry-run]` | 把云盘已有副本匹配回歌曲本体 |
| `cmporter import <目录> [--dir <目录>]` | 导入本地音频：按「歌名 - 歌手」匹配曲库后送进云盘 |
| `cmporter cloud [--limit <n> \| --delete <id,...>]` | 查看（默认最近 30 条）或清理云盘条目 |
| `cmporter web [--port 8787] [--no-open]` | 启动本地 WebUI（仅 `127.0.0.1`） |
| `cmporter service install [--time HH:MM]`（另有 `status` / `uninstall` / `run`） | 安装/管理跨平台定时任务 |

全局选项：

| 选项 | 说明 |
| --- | --- |
| `--help` | 查看帮助 |
| `--version` | 查看版本 |

范围与筛选参数（`--vip-only` 等）对 `scan` 与 `sync` 通用，保证两条命令口径一致。

配置与数据默认放在用户目录 `~/.cloud-music-porter/`（Windows 为 `%USERPROFILE%\.cloud-music-porter\`），**不需要也不能用 `--config` 指定**；需要迁移、跑多套配置时，用环境变量 `CMPORTER_HOME` 换根目录。

## 配置

首次运行会在用户目录生成 `~/.cloud-music-porter/config.json`（Windows 为 `%USERPROFILE%\.cloud-music-porter\config.json`）。需要换一个根目录时：

```bash
# bash / zsh
CMPORTER_HOME=/path/to/cmporter-home cmporter sync --liked --yes
```

```powershell
# PowerShell
$env:CMPORTER_HOME = "D:\cmporter-home"
cmporter sync --liked --yes
```

常用环境变量：

| 环境变量 | 作用 |
| --- | --- |
| `CMPORTER_HOME` | 换整个配置与数据根目录（默认 `~/.cloud-music-porter/`） |
| `CMPORTER_LX_DATA`（兼容 `LX_DATA_DIR`） | 指定 LX Music 的 `LxDatas` 目录，优先于自动探测与 `lxDataDir` 配置 |
| `CMPORTER_MF_PLUGINS` | 指定 MusicFree 插件目录，优先于自动探测与 `musicFreePluginsDir` 配置 |
| `CMPORTER_FFPROBE` | 默认 ffprobe 路径；配置里的 `ffprobePath` 优先级更高 |
| `CMPORTER_DEBUG` | 出错时打印完整堆栈，便于提 issue |

默认配置：

```json
{
  "quality": "flac",
  "sourceMode": "auto",
  "lxDataDir": "",
  "musicFreePluginsDir": "",
  "delayMs": 800,
  "maxGbPerRun": 0,
  "serviceHour": 8,
  "serviceMinute": 30,
  "serviceMaxAttempts": 3,
  "webPort": 8787,
  "cloudWarnRatio": 0.9,
  "ffprobePath": "ffprobe",
  "searchTimeoutMs": 12000,
  "resolveTimeoutMs": 15000,
  "pluginConcurrency": 4,
  "minAudioBytes": 102400
}
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `quality` | `flac` | 目标音质：`flac` 或 `320k` |
| `sourceMode` | `auto` | 解析用哪类音源：`auto`（先 LX 再 MusicFree）/ `lx`（只用 LX）/ `musicfree`（只用 MusicFree）。搜索始终来自 MusicFree 插件 |
| `lxDataDir` | 空 | LX Music 的 `LxDatas` 目录；留空自动探测，也可用 `CMPORTER_LX_DATA` / `LX_DATA_DIR` 覆盖 |
| `musicFreePluginsDir` | 空 | MusicFree 插件目录；留空自动探测，也可用 `CMPORTER_MF_PLUGINS` 覆盖 |
| `delayMs` | `800` | 两次请求之间的间隔（毫秒），调大可降低触发风控的概率 |
| `maxGbPerRun` | `0` | 单次运行写入云盘的总量上限（GB，秒传与上传都计入），`0` 表示按云盘剩余空间的 95% |
| `serviceHour` / `serviceMinute` | `8` / `30` | 定时任务的运行时间 |
| `serviceMaxAttempts` | `3` | 定时任务每天最多尝试运行的次数（当天成功后不再重试，`--force` 可强制） |
| `webPort` | `8787` | WebUI 端口 |
| `cloudWarnRatio` | `0.9` | 云盘占用预警比例，超过后停止同步并提示先清理 |
| `ffprobePath` | `ffprobe` | ffprobe 可执行文件路径 |
| `searchTimeoutMs` | `12000` | 单个搜索请求超时（毫秒） |
| `resolveTimeoutMs` | `15000` | 单个解析请求超时（毫秒） |
| `pluginConcurrency` | `4` | 并发搜索的 MusicFree 插件数量 |
| `minAudioBytes` | `102400` | 下载音频的最小字节数，过小视为错误页丢弃 |

配置文件在仓库之外，仓库的 `.gitignore` 里仍保留 `data/`、`config.json`，防止有人把本地数据误放进仓库。

## 数据目录

所有本地状态默认都在 `~/.cloud-music-porter/data/`（Windows 为 `%USERPROFILE%\.cloud-music-porter\data\`）：

| 路径 | 内容 |
| --- | --- |
| `~/.cloud-music-porter/data/cookie.json` | 登录 cookie（明文 JSON，权限应收紧） |
| `~/.cloud-music-porter/data/state.json` | 同步记录（哪些歌处理过、结果如何） |
| `~/.cloud-music-porter/data/runs/` | 每次运行的明细结果 |
| `~/.cloud-music-porter/data/logs/` | 运行日志，排查问题时优先看这里 |
| `~/.cloud-music-porter/data/tmp/` | 下载中的临时音频，处理完会清理 |

删掉整个 `~/.cloud-music-porter/` 等于重置本地状态（需要重新登录），云盘里的歌不受影响；用 `CMPORTER_HOME` 可以把整套数据放到别的目录。

## 实测数据

以下数据来自作者自己的账号与环境，**随账号、音源、音质和版本变化**，仅作量级参考：

| 项目 | 数据 |
| --- | --- |
| 环境 | Windows 11，Node.js 26.13.0（CI 覆盖 Node 20 / 22） |
| 「我喜欢的音乐」 | 714 首，其中 `fee=1` 的 VIP 受限歌曲 220 首 |
| 效果 | 这些歌原本只能听 30 秒试听，导入云盘并匹配后可以完整播放 |
| 音源质量 | 官方音源有 FLAC 时，单曲约 20–40MB |
| 云盘实测 | 880 条 / 16.0GB，上限 60GB |
| 本机音源 | MusicFree 17 个插件 + LX 2 个可用源，`doctor` 全绿 |
| 每日服务 | Windows 计划任务上次运行结果 `0x0` |
| 测试 | `npm test` 7 个测试文件 44 条用例全部通过 |

按 320k mp3 估算，单曲约 8–10MB，60GB 大约能放 5000 首；按 FLAC 估算，约 20–40MB 一首，60GB 大约 1500–3000 首。建议先小批量试跑再全量。

## 支持的平台

| 平台 | 支持情况 |
| --- | --- |
| Windows 10 / 11 | 支持，定时任务用计划任务 |
| Linux（systemd 发行版） | 支持，定时任务用 systemd user timer，cron 兜底 |
| macOS | 支持，定时任务用 launchd |
| Node.js | ≥ 20 |

需要在有图形界面的环境下扫码登录；纯服务器环境可以用 `login --cookie`。

## 已知限制

- **必须自备音源**：工具不内置任何音源。至少装一个 MusicFree 插件（提供搜索）；LX 自定义源可选，只负责解析。
- **LX 自定义源没有搜索能力**：任何模式下搜索都来自 MusicFree 插件；`sourceMode: "lx"` 只限制解析环节，候选映射不到 LX 平台时会直接报错。
- **插件质量参差**：有的 MusicFree 插件只能搜索、`getMediaSource` 解析已经失效。
- **下架 / 无版权歌曲补不了**：播放接口直接返回 404，任何音源都没有可播的地址。
- **部分歌不支持匹配**：网易云会返回「当前歌曲不支持匹配」，云盘里能播，但歌单里仍显示原状态。
- **云盘有容量上限**：常见为 60GB 量级，实际以账号为准，见 `cmporter status`。
- **不会自动删除云盘条目**：只有显式执行 `cmporter cloud --delete <id,...>` 才会删除；先跑 `cmporter cloud` 看清 id 再删。

更细的原因和排查方法见 [docs/faq.md](docs/faq.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/sources.md](docs/sources.md) | 如何自备音源：LX Music 自定义源 / MusicFree 插件、目录位置、平台映射 |
| [docs/architecture.md](docs/architecture.md) | 模块结构、VIP 判定、秒传/真上传流程、完整流水线 |
| [docs/faq.md](docs/faq.md) | 常见问题与故障排查 |
| [docs/agent-skill.md](docs/agent-skill.md) | 把仓库里的 Agent skill 装进支持 skill 的 Agent |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发环境、测试、提交规范 |
| [SECURITY.md](SECURITY.md) | cookie 存放、漏洞报告方式 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |

## 开发与测试

```bash
npm test                          # node --test，自动发现 test/*.test.js，7 个文件 44 条用例
node --test test/matcher.test.js   # 单独跑某个测试文件
```

CI 在 GitHub Actions 上跑 Node 20 / 22 × Ubuntu / Windows / macOS 矩阵，每次 push 与 PR 都会执行 `npm ci && npm test`。开发环境、目录职责与提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 贡献

欢迎 issue 和 PR，请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。注意：**任何把音源、插件、二进制或音频文件带进仓库的 PR 都会被拒绝**。

## 安全

cookie 保存在本地 `~/.cloud-music-porter/data/cookie.json`，WebUI 只监听本地回环地址。安全问题请通过 GitHub 私密渠道报告，详见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE) © 2026 publieople

## 免责声明

本项目与网易云音乐、LX Music、MusicFree 均无关联，相关名称与商标归各自权利人所有。本项目仅用于整理个人合法获取的音频文件，不提供也不分发任何音源、音频内容或解析服务。使用本项目产生的一切后果由使用者自行承担。
