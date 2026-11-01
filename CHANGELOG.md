# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的格式，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.1.0] - 2026-11-01

第一个公开版本。

### 新增

- 登录：`cmporter login` 支持扫码登录（`--timeout` 控制二维码等待秒数，默认 180），也支持用 `--cookie` 直接粘贴 `MUSIC_U` cookie。
- 环境自检：`cmporter doctor` 一次检查 7 项——运行环境（Node ≥ 20、平台与版本）、配置、ffprobe 可用性、登录状态与账号信息、音乐云盘用量、MusicFree 插件、LX Music 自定义源；每项给 ✔ / ! / ✘ 与修复提示，出现 ✘ 时退出码为 2（全绿时提示可以开始 `scan` / `sync`）。
- 账号与云盘状态：`cmporter status` 显示账号信息、歌单数量、云盘条目数与容量、最近同步记录。
- 音源检测：`cmporter sources` 列出检测到的 LX Music 自定义源与 MusicFree 插件，并标注是否可用于搜索与解析。
- 扫描：`cmporter scan` 支持 `--liked`、`--playlist`、`--all`、`--song`、`--query` 选择范围，`--vip-only` 只看 VIP 受限歌曲，`--all-rows` 打印完整列表；结果按「需要补 / 云盘已匹配 / 云盘有副本 / 可正常播放 / 下架或无版权」标注，可用 `--json` 导出给后续同步复用。
- 同步：`cmporter sync` 完成「搜索 → 解析 → 下载 → 校验 → 云盘导入 → 匹配 → 播放验证」全流程，支持 `--dry-run`、`--yes`、`--quality`、`--source`、`--delay`、`--include-unavailable`、`--limit`、`--offset`、`--max-gb`（本次最多写入云盘多少 GB，按文件大小累计，秒传导入与真正上传都计入；`0` 表示按云盘剩余空间的 95%，超出即停止）、`--from`、`--force`。
- 匹配：`cmporter match` 把云盘中已有副本匹配回歌曲本体，修复「云盘里有歌，歌单里仍显示试听」的情况。
- 本地导入：`cmporter import <目录>`（或 `cmporter import --dir <目录>`）把本地已有音频按「歌名 - 歌手.ext」命名递归扫描，走搜索/秒传/上传/匹配，支持 `--dry-run`、`--limit`、`--offset`、`--max-gb`、`--delay`。
- 云盘管理：`cmporter cloud` 默认列出最近 30 条（`--limit` 调整条数），`cmporter cloud --delete <id,...>` 删除。
- 本地 WebUI：`cmporter web [--port 8787]`（默认 8787）、`--no-open` 不自动开浏览器；只监听 `127.0.0.1` 并校验 Host 与 POST 请求头，页面含账号/扫码登录、概览卡（账号、云盘用量、音源、每日自动同步）、扫描/同步表单、每日自动同步开关、配置编辑与 SSE 实时日志；API 覆盖 overview、sources、config、login、run、cloud/list 等。没有删除云盘条目的入口，删除仍走 CLI。
- 跨平台定时任务：`cmporter service install|status|uninstall|run`，`install --time HH:MM` 指定触发时间。Windows 计划任务 `CloudMusicPorterDaily`（每天指定时间触发，登录时补跑），Linux 用 systemd `--user` 的 `cloud-music-porter.service` + `.timer`（`OnCalendar`、`Persistent=true`，无 systemd 回退 crontab），macOS 用 `~/Library/LaunchAgents/com.publieople.cloud-music-porter.plist`。每天最多尝试运行 `serviceMaxAttempts`（默认 3）次，当天成功一次后后续触发自动跳过（`service run --force` 可强制）；每次运行先清理 `data/tmp` 与 30 天前的日志，再刷新 cookie（Windows 从网易云客户端 DPAPI 刷新，客户端保持登录时无需扫码），然后同步「我喜欢的音乐」；日志 `data/logs/service-YYYY-MM-DD.log`，状态 `data/service-state.json`。
- 音源适配：
  - LX Music 自定义源：读取其 `user_api.json`（脚本以 `gz_` + base64(zlib) 存储），解码后在 `node:vm` 沙箱中执行，用于解析播放地址。
  - MusicFree 插件：读取插件目录下的 CommonJS 插件，调用 `search` 与 `getMediaSource` 完成搜索与解析。
  - 因为 LX Music 自定义源规范只提供解析、不提供搜索，任何模式下搜索层都使用 MusicFree 插件聚合搜索。`sourceMode` 只决定解析：`auto`（默认）先 LX、失败回退 MusicFree；`musicfree` 只用插件；`lx` 只用 LX，候选映射不到 LX 平台时直接报错。
- 音频校验：按文件头（magic bytes）判断真实格式，检查文件大小下限，系统有 ffprobe 时进一步校验时长与编码。
- 云盘导入：调用 `/api/cloud/upload/check/v2` 判断秒传、真上传或已存在（返回的 `songId` 在代码里当 `cloudId` 用）；秒传直接导入，真上传分块上传到 NOS 后 `/api/upload/cloud/info/v2` + `/api/cloud/pub/v2` 落库。
- 导入后自动匹配并做播放验证。
- 配置：首次运行在用户目录生成 `~/.cloud-music-porter/config.json`（Windows 为 `%USERPROFILE%\.cloud-music-porter\config.json`），可用环境变量 `CMPORTER_HOME` 换根目录，用 `CMPORTER_LX_DATA` / `LX_DATA_DIR`、`CMPORTER_MF_PLUGINS`、`CMPORTER_FFPROBE` 覆盖音源目录与 ffprobe，`CMPORTER_DEBUG` 打印错误堆栈；字段含 `quality`、`sourceMode`、`lxDataDir`、`musicFreePluginsDir`、`delayMs`、`maxGbPerRun`、`serviceHour`、`serviceMinute`、`serviceMaxAttempts`、`webPort`、`cloudWarnRatio`、`ffprobePath`、`searchTimeoutMs`、`resolveTimeoutMs`、`pluginConcurrency`、`minAudioBytes`。
- 数据目录：cookie、状态与日志统一放在 `~/.cloud-music-porter/data/`（`cookie.json`、`state.json`、`runs/`、`logs/`、`tmp/`），不在仓库里，也没有 `--config` 参数。
- Agent skill：仓库内提供 `skills/cloud-music-porter/SKILL.md`（附 `references/commands.md`、`references/troubleshooting.md`），详见 [docs/agent-skill.md](docs/agent-skill.md)。
- 开发与测试：`npm test`（即 `node --test`，自动发现 `test/*.test.js`）覆盖配置、匹配、音频校验、同步编排、LX 源解析与 CLI 冒烟，共 6 个测试文件、36 条用例；GitHub Actions 在 Node 20 / 22 × Ubuntu / Windows / macOS 上跑 `npm ci && npm test`。

### 说明

- 仓库**不内置、不提供、不分发任何音源**：没有音源脚本、插件包、第三方二进制或镜像站地址，音源由使用者自行在 LX Music / MusicFree 中安装。
- 已知限制见 [docs/faq.md](docs/faq.md)。
- 首次公开的 0.1.0 版本以功能可用为目标，接口与配置项后续可能调整。
