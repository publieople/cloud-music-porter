# 架构说明

本文说明 `cmporter` 的内部结构、关键流程，以及网易云接口链路。它面向想读代码、改代码或做二次开发的人；只想用的话看 [README](../README.md) 即可。

## 设计边界

- **只做搬运**：音源不内置、不下载、不分发；工具只读用户本机已安装的 MusicFree 插件与 LX Music 自定义源。
- **单向写入**：只向云盘新增条目和做匹配，不修改歌单、不删除云盘（除非用户显式执行 `cloud --delete`）。
- **本地优先**：cookie、配置、日志、状态全部在用户目录 `~/.cloud-music-porter/`（可用环境变量 `CMPORTER_HOME` 换根目录），WebUI 只监听 `127.0.0.1`。
- **仓库干净**：仓库根只有代码和文档；运行时数据在用户目录，不进 git。

## 目录结构

```text
cloud-music-porter/
├── src/
│   ├── cli.js              # 命令解析与分发（cmporter 入口）
│   ├── sync.js             # 同步编排：扫描 → 解析 → 下载 → 上传 → 匹配；含 import 的本地导入
│   ├── doctor.js           # 环境自检（doctor 命令）
│   ├── core/
│   │   ├── config.js       # 配置加载、默认值、~/.cloud-music-porter 路径解析
│   │   ├── login.js        # 扫码登录、cookie 读写、校验
│   │   ├── netease.js      # 网易云接口封装（歌单、播放地址、云盘上传/匹配）
│   │   ├── audio.js        # 音频下载、格式与大小校验（可选 ffprobe）
│   │   └── matcher.js      # 搜索候选打分、选出最佳音源结果
│   ├── sources/
│   │   ├── index.js        # 音源发现与聚合，按 sourceMode 决定解析路由
│   │   ├── lx.js           # LX Music 自定义源读取、解码、沙箱执行
│   │   └── musicfree.js    # MusicFree 插件加载、搜索与解析调用
│   ├── service/            # 定时任务（Windows 计划任务 / systemd / launchd）
│   └── web/                # 本地 WebUI（127.0.0.1）
├── web/                    # WebUI 静态页面（index.html / app.js / style.css）
├── scripts/                # 安装计划任务的 PowerShell 辅助脚本
├── docs/                   # 本文档目录
├── skills/cloud-music-porter/  # 供 Agent 使用的 skill
├── test/                   # 测试
└── .github/workflows/      # CI（Node 20/22 × Ubuntu / Windows / macOS）
```

运行时的 `config.json`、`data/` 不在仓库里，见下一节。

## 配置与数据目录

默认根目录是 `~/.cloud-music-porter/`，Windows 为 `%USERPROFILE%\.cloud-music-porter\`；用环境变量 `CMPORTER_HOME` 可以整体换到别处（多套配置、迁移机器时用）。仓库没有 `--config` 参数。

| 路径 | 内容 |
| --- | --- |
| `~/.cloud-music-porter/config.json` | 用户配置；首次运行自动生成默认值 |
| `~/.cloud-music-porter/data/cookie.json` | 网易云登录 cookie（明文，权限应收紧） |
| `~/.cloud-music-porter/data/state.json` | 已处理歌曲记录：歌曲 id → 云盘条目 id、质量、时间 |
| `~/.cloud-music-porter/data/runs/` | 每次 `scan` / `sync` 的运行记录（含 `--json` 输出） |
| `~/.cloud-music-porter/data/logs/` | 运行日志，排查问题时优先看这里 |
| `~/.cloud-music-porter/data/tmp/` | 下载与校验过程中的临时音频文件 |

`src/core/config.js` 里的 `HOME_DIR` 决定根目录：`process.env.CMPORTER_HOME || path.join(os.homedir(), '.cloud-music-porter')`。仓库的 `.gitignore` 仍保留 `data/` 与 `config.json`，防止有人把本地数据误放进仓库。

环境变量的优先级：配置字段 < 环境变量（用于音源目录与 ffprobe）；`CMPORTER_HOME` 直接换掉整个根目录。

| 环境变量 | 作用 | 优先级 |
| --- | --- | --- |
| `CMPORTER_HOME` | 配置与数据根目录 | 高于默认 home |
| `CMPORTER_LX_DATA` / `LX_DATA_DIR` | LX Music 的 `LxDatas` 目录 | 高于 `config.lxDataDir` 与自动探测 |
| `CMPORTER_MF_PLUGINS` | MusicFree 插件目录 | 高于 `config.musicFreePluginsDir` 与自动探测 |
| `CMPORTER_FFPROBE` | 默认 ffprobe 路径 | 低于 `config.ffprobePath`，高于 `ffprobe` |
| `CMPORTER_DEBUG` | 打印完整堆栈 | — |

## 主流水线

```text
登录 cookie
   │
   ▼
读歌单（默认「我喜欢的音乐」）
   │
   ▼
逐首判 VIP ── /api/song/enhance/player/url ──► freeTrialInfo / 404
   │
   ▼
搜索候选（MusicFree 插件聚合）── 标题+艺人+时长打分
   │
   ▼
解析播放地址（优先 LX，失败回退 MusicFree）
   │
   ▼
下载音频 → 校验（magic / size / ffprobe）
   │
   ▼
云盘上传检查 /api/cloud/upload/check/v2
   ├── upload=1  秒传导入 /api/cloud/user/song/import
   ├── upload=2  真上传 NOS → /api/upload/cloud/info/v2 → /api/cloud/pub/v2
   └── upload=0  已在云盘，跳过
   │
   ▼
匹配 /api/cloud/user/song/match（云盘条目 → 歌曲本体）
   │
   ▼
播放验证（再查一次播放地址，确认不再是试听）
```

## 本地音频导入（import）

`cmporter import <目录>`（或 `--dir <目录>`）是 `sync` 之外的另一条入口，适合处理你已经拥有的本地音频：

1. 递归扫描目录，按扩展名过滤音频文件（mp3 / flac / m4a / wav 等）；
2. 文件名按 `歌名 - 歌手.ext` 解析，解析不出时退回用整段文件名当关键词；
3. 用网易云曲库搜索（`searchSongs`，取第一条）找到歌曲 id；
4. 计算本地文件的 md5、大小并做同样的音频校验；
5. 走与 `sync` 相同的 `importOrUpload`：`check/v2` → 秒传导入或真上传 → `match`。

预算与 `sync` 一致：`--max-gb` 按**写入云盘的文件大小**累计，秒传导入与真正上传都计入；默认按云盘剩余空间的 95%，超出即停止本次导入。`--limit`、`--delay` 同样生效。

## 网易云接口链路

| 阶段 | 接口 | 用途 |
| --- | --- | --- |
| 登录 | 二维码登录接口族 | 获取 `MUSIC_U` 等 cookie，落盘 |
| 歌单 | `/api/v6/playlist/detail` 等 | 读取「我喜欢的音乐」或指定歌单的歌曲列表 |
| VIP 判定 | `/api/song/enhance/player/url` | 返回 `url` / `freeTrialInfo` / `code`，判定是否需要补 |
| 上传检查 | `/api/cloud/upload/check/v2` | 判断秒传、真上传还是已在云盘，返回 `songId`（代码里当 `cloudId` 用） |
| 秒传导入 | `/api/cloud/user/song/import` | 已有相同文件时直接挂到账号 |
| 真上传 | NOS 上传凭证 + 分块上传 → `/api/upload/cloud/info/v2` → `/api/cloud/pub/v2` | 传二进制、登记元信息、发布 |
| 匹配 | `/api/cloud/user/song/match` | 把云盘条目关联到歌曲本体 |
| 验证 | `/api/song/enhance/player/url` | 确认该歌已有完整播放地址 |

### VIP 判定

调用播放地址接口时传 `ids` 与音质参数，逐首判断：

- 返回了可播放 `url` 且没有 `freeTrialInfo` → 本来就能完整播放，跳过；
- 有 `freeTrialInfo`（典型为 30 秒试听）→ 属于会员歌曲，需要补；
- 返回 `code: 404` 或空 `url` → 下架 / 无版权 / 地区限制，音源层也补不了，标记跳过。

`fee = 1` 可以作为「会员歌曲」的粗筛，但最终是否受限以播放接口为准，两者会有一致性差异。

### 秒传与真上传

上传前先把音频的元信息（大小、md5、时长、文件名等）交给 `check/v2`：

| 返回 | 含义 | 后续动作 |
| --- | --- | --- |
| `upload = 1` | 服务端已有相同文件 | 调 `import` 直接导入，零字节上传 |
| `upload = 2` | 需要真上传 | 申请 NOS 凭证 → 4MB 分块上传 → `info/v2` 登记 → `pub/v2` 发布 |
| `upload = 0` | 这首歌已在云盘 | 跳过（可用 `--force` 强制重来） |

实现上有两个坑：

1. `info/v2` 的 `songid` 必须用 `check/v2` 返回的 `songId`（代码里命名为 `cloudId`）；用错字段会得到 409「音频解析失败」。
2. 分块上传不完整或元信息异常同样会 409；重跑通常能换到新节点或新候选。

### 匹配

导入成功后云盘里只是「一个文件」，还需要 `match` 把它关联到歌曲本体：

```json
{
  "userId": "你的用户 id",
  "songId": "云盘条目 id（check/v2 的 songId，即 cloudId）",
  "adjustSongId": "歌曲本体 id（catalog id）"
}
```

部分歌返回 400「当前歌曲不支持匹配」，这是平台侧限制，无法绕过。此类歌在云盘里能完整播放，只是不会挂到歌单条目上。

## 音源层

音源层负责两件事：**搜索**（找到该歌可能的音频）和**解析**（拿到可下载的 URL）。两类音源能力不对称，这是整个设计的关键约束：**只有 MusicFree 插件能做搜索**，LX 自定义源只能解析。

### LX Music 自定义源

- 读取 LX 的 `LxDatas` 目录下的 `user_api.json`（默认位置：Windows `%APPDATA%\lx-music-desktop\LxDatas`、macOS `~/Library/Application Support/lx-music-desktop/LxDatas`、Linux `~/.config/lx-music-desktop/LxDatas`）；
- 其中脚本以 `gz_` + base64(zlib) 的形式存储，解码后得到脚本文本；
- 脚本在 `node:vm` 中执行；沙箱里提供 LX 规范要求的 `lx` 全局对象（`on('request')` / `send('inited')` / `request`）、`fetch` 与 `lx.utils`（`crypto` / `zlib` / `buffer`），`lx.version` 固定报 `2.12.6`；
- 解析时向源发起 `{ source: <平台>, action: 'musicUrl', info: { type, musicInfo } }`，按 `flac` → `flac24bit` → `320k` → `128k` 依次尝试，取第一个返回的地址；
- **规范里没有搜索接口** —— 所以 LX 只负责解析。

`node:vm` 只是隔离全局变量，不是安全沙箱；执行第三方脚本前请自己判断来源。

### MusicFree 插件

- 读取 MusicFree 插件目录下的 CommonJS 插件；
- 每个插件导出 `search(query, page, type)` 与 `getMediaSource(musicItem, quality)`；
- `quality` 取 `super` / `high` / `standard` / `low`；
- 搜索与解析都能做，但不同插件质量参差，部分插件搜索正常、解析失效。

### 路由规则

`config.sourceMode` 只决定**解析**用谁；搜索候选在任何模式下都来自 MusicFree 插件（`src/sources/index.js` 的 `search()` 只遍历 MusicFree 插件，用 `searchTimeoutMs` 超时与 `pluginConcurrency` 并发，去重后打分）。

| sourceMode | 搜索 | 解析 |
| --- | --- | --- |
| `auto`（默认） | MusicFree 插件聚合 | 优先 LX（候选能映射到 LX 平台且该平台被某个 LX 源支持时），失败回退 MusicFree |
| `musicfree` | MusicFree 插件聚合 | 只用 MusicFree 插件 |
| `lx` | 仍需要 MusicFree 插件 | 只用 LX 源解析；候选映射不到 LX 平台、或没有 LX 源支持该平台时直接报错，不回退 |

因此只装 LX 自定义源时，工具能解析但没有搜索能力，`sync` 会提示没有搜到候选。`lx` 模式的错误信息是「sourceMode=lx 时只允许用 LX 源解析，但这个候选无法映射到 LX 平台」。

## 匹配打分

网易云歌曲 → 搜索关键词（标题 + 第一艺人）→ 候选列表 → 打分：

- 标题相似度（归一化后比较，忽略括号内的版本信息）；
- 艺人是否命中；
- 时长差（超过阈值的直接判定为不同版本并排除）。

取分数最高且高于最低阈值（默认 40 分）的候选进入解析；没有候选或全部不合格则记为「未找到」。日志里会记录候选与命中结果，方便人工复核。

## 音频校验

下载完成后依次校验：

1. **magic**：确认是 mp3 / flac / m4a / wav 等可识别格式，不是 HTML 错误页或空文件；
2. **大小下限**：小于 `config.minAudioBytes`（默认 102400 字节）的文件直接丢弃，多半是错误响应；
3. **ffprobe**（如果 `config.ffprobePath` 可用，也可以用环境变量 `CMPORTER_FFPROBE` 指定）：读取时长、编码、码率，与期望比对；没有 ffprobe 时跳过这一步，不阻塞流程。

校验失败不会上传，会换下一个候选或把这歌记为失败。

## 状态与幂等

- `~/.cloud-music-porter/data/state.json` 记录每首歌的处理结果，重复执行 `sync` 默认跳过已成功的歌；
- `--force` 忽略记录重新处理；
- `--from <scan.json>` 直接读扫描结果，不从网络重新收集列表；
- 云盘侧：`upload=0/1` 天然避免重复上传；不同质量/版本仍是不同文件，会产生多个条目。

## 环境自检（doctor）

`cmporter doctor` 输出 7 项检查，每项打印 ✔ / ! / ✘ 并附修复提示：

1. **运行环境**：Node ≥ 20、平台、版本号；
2. **配置**：`~/.cloud-music-porter/config.json` 是否存在、`quality`、`sourceMode`；
3. **ffprobe**：能否执行（缺失只 warn，不阻止导入）；
4. **登录**：cookie 是否存在且有效，显示昵称 / uid / vipType；
5. **音乐云盘**：条数、已用 / 上限、占用百分比（超过 95% 给 warn）；
6. **MusicFree 插件**：可用插件数量与名称（没有可用插件 → fail，搜索拿不到候选）；
7. **LX Music 自定义源**：可用源数量与支持的平台（没有源只 warn，只有 `sourceMode=lx` 时才会成为阻塞）。

有 fail 时 `doctor` 退出码为 2；只有 ! 提醒时退出码仍为 0（会输出「结果：基本可用（有 N 条提醒）」）；全绿时输出「结果：全部正常，可以开始 cmporter scan / sync 了」。

## 定时任务

- 子命令：`install [--time HH:MM]` / `uninstall` / `status` / `run`；`--time` 会先把时间写回 `config.serviceHour / serviceMinute` 再注册任务；
- 平台注册：Windows 计划任务 `CloudMusicPorterDaily`（每天指定时间运行，登录时也会补跑，任务命令是 `node <cli.js 路径> service run`）；Linux systemd user 的 `cloud-music-porter.service` + `cloud-music-porter.timer`（`OnCalendar` 每天 HH:MM、`Persistent=true`），没有 systemd 时写 crontab；macOS 写 `~/Library/LaunchAgents/com.publieople.cloud-music-porter.plist`；
- 每次 `service run` 的逻辑（`src/service/run.js`）：
  1. 每天最多尝试运行 `serviceMaxAttempts` 次（默认 3）；当天已成功 → 后续触发直接跳过（`--force` 强制再跑）；
  2. 清理 `data/tmp/` 与 30 天前的 `service-*.log`；
  3. 刷新 cookie：Windows 尝试从本机网易云客户端的登录态（DPAPI 保护的本地数据）刷新，失败则回退到已保存的 cookie；
  4. 执行 `sync --liked`，摘要写入 `data/service-state.json`，日志追加到 `data/logs/service-YYYY-MM-DD.log`；
- `cmporter service run [--dry-run] [--force]` 可手动触发同样的流程（其余参数取自配置），便于排查。

## WebUI

`cmporter web [--port 8787] [--no-open]` 启动本地 WebUI，只监听 `127.0.0.1`，并在入口校验 Host 只能是 `127.0.0.1` / `localhost` / `::1`；POST 请求必须带 `x-cmporter: web` 头（防 CSRF）。

页面：顶部账号与扫码登录弹窗；概览卡（账号 / 云盘用量 meter / 音源 / 每日自动同步）；扫描与同步表单（范围、音质、只看 VIP、演练、本次预算 GB）；每日自动同步卡（时间输入、安装 / 卸载 / 立即运行 / 查看状态）；配置卡（`quality`、`sourceMode`、`lxDataDir`、`musicFreePluginsDir`、`delayMs`）；底部 SSE 实时日志抽屉。

接口（仅本机）：`GET /`、`GET /static/*`、`GET /api/overview`、`GET /api/sources`、`GET|POST /api/config`、`POST /api/login/start`、`GET /api/login/poll?key=`、`POST /api/run`、`GET /api/run/:id`、`GET /api/run/:id/stream`（SSE）、`GET /api/cloud/list?limit=`。WebUI 不提供删除云盘条目的接口，删除只能用 CLI 的 `cloud --delete` 显式指定 id。

## 失败处理

| 场景 | 处理 |
| --- | --- |
| 单首搜索无结果 / 解析失败 | 记录失败，继续下一首，不中断整轮 |
| 下载超时或校验失败 | 换候选重试；仍失败则记失败 |
| 上传 409 | 记录错误，重跑该首；连续失败说明候选文件有问题 |
| 匹配失败（400） | 不视为同步失败，云盘已可用 |
| cookie 失效 | 整轮中止，提示重新登录 |
| `sourceMode=lx` 映射不到 LX 平台 | 该首直接报错并记录；改用 `auto` 或 `musicfree` 可回退 |
| 网络抖动 | 按 `config.delayMs` 请求间隔与重试策略处理，避免高频触发风控 |

## 二次开发提示

- 新增音源形态：在 `src/sources/` 下实现「搜索 + 解析」两个能力，并在 `src/sources/index.js` 注册，不要改 core；
- 接口细节集中在 `src/core/netease.js`，版本变化时只需要改这一处；
- 任何新能力都应遵守边界：不下载、不分发音源，不注入第三方二进制。
