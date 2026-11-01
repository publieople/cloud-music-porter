---
name: cloud-music-porter
description: 用 cmporter CLI 把网易云音乐里只剩 30 秒试听的会员歌曲（VIP 受限歌）通过用户自备的音源（LX Music 自定义源或 MusicFree 插件）补进用户的音乐云盘，包括环境自检、扫描、试跑、同步、云盘匹配、本地音频导入、每日自动同步与 WebUI。当用户提到「网易云 VIP 歌下载/补进云盘/云盘秒传」「网盘歌曲匹配纠正」「LX Music 音源」「MusicFree 插件」「music-cloud 同步」时使用。不提供任何音源、不破解会员，只处理用户自己合法获得的音频。
---

# cloud-music-porter（cmporter）

把「用户在网易云音乐里受 VIP 限制、只能试听的歌」变成「云盘里能完整播放的副本」。
音频来自**用户自己准备**的音源：LX Music 自定义源（本地已安装）或 MusicFree 插件（本地目录）；
工具本身不下载、不内置、不分发任何音源或二进制。

核心原理：网易云云盘支持「秒传」——只要音频的 md5 恰好是云盘已有资源，
就只需登记（check → import），不需要上传字节；否则才走 NOS 真上传。

## 何时用

- 用户说「我喜欢的歌里哪些要 VIP」「帮我把 VIP 歌补进云盘」「云盘里的歌还是试听」；
- 用户要检查/修复「网盘歌曲信息匹配纠正」（匹配回歌曲本体，歌单里直接完整播放）；
- 用户要把本地已下载的音频导入云盘；
- 用户要看同步状态、失败原因、装每日定时同步、开 WebUI。

## 硬性规则（必须遵守）

1. **先体检**：动手前跑 `cmporter doctor`；音源缺失就告诉用户去 LX Music / MusicFree 里自己装，**不要代替用户下载或安装音源、插件、二进制**。
2. **先看后动**：默认先 `scan` 或 `sync --dry-run`，把「需要补的歌数 / 示例 / 预计容量」报给用户，确认后再真跑。
3. **限制规模**：真跑一律带 `--limit`；不要自作主张 `--all --force`。全量同步前必须用户明确同意。
4. **不碰隐私**：不打印、不上传 `~/.cloud-music-porter/data/cookie.json` 与任何 cookie；WebUI 只在本机 127.0.0.1。
5. **删除需授权**：`cloud --delete` 只能由用户明确要求后执行。
6. **失败先读日志**：`~/.cloud-music-porter/data/logs/` 与 `data/runs/`，不要盲目反复重试。

## 标准流程

```bash
cmporter doctor                      # 环境：Node / 登录 / 云盘 / ffprobe / 音源
cmporter sources                     # 列出检测到的 LX 源与 MusicFree 插件
cmporter scan --liked --vip-only     # 只列 VIP / 下架相关歌曲
cmporter sync --liked --dry-run      # 看计划与容量
cmporter sync --liked --limit 20 --yes   # 小批量真跑（用户确认后）
cmporter status                      # 账号 / 云盘用量 / 本地记录
```

大量歌单时先缓存扫描结果，再分批同步：

```bash
cmporter scan --all --json rows.json
cmporter sync --from rows.json --limit 100 --yes
cmporter match --from rows.json      # 云盘已有副本补匹配
```

## 输出怎么读

- 扫描汇总会区分：VIP 歌（fee=1）、云盘已匹配、云盘有副本但未匹配、云盘没有、下架/无版权；
- `sync` 每首歌输出一行结果：新增（秒传/上传）、跳过（已在云盘/已同步过/容量不足）、失败（原因）；
- 结束汇总「新增 N 首，失败 M 首，跳过 K 首」，报告写入 `data/runs/run-*.json`。

## 失败归类

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| 「没有登录」「登录失效」 | cookie 过期 | 让用户跑 `cmporter login` 扫码（Windows 会自动从网易云客户端刷新） |
| 每首都「没有搜到候选」 | 音源不可用 | 检查 MusicFree 插件是否可用；`cmporter doctor` 会标红 |
| 歌曲显示「下架/无版权」 | 音源侧也没有 | 默认跳过；只有用户要求才 `--include-unavailable` |
| 「音源文件损坏 / ffprobe 无法解析」 | 音源给的是坏文件或加密格式 | 换音源，别重试同一首 |
| 「容量不足」 | 超过 `--max-gb` 或云盘剩余 95% | 提升 `--max-gb` 或先清理云盘 |
| 导入后仍试听 | 没匹配回歌曲本体 | `cmporter match --liked` |

细节命令与排错见 `references/commands.md`、`references/troubleshooting.md`。

## 配置与数据

- 配置：`~/.cloud-music-porter/config.json`（Windows `%USERPROFILE%\.cloud-music-porter\config.json`）
- 数据：同目录 `data/`（cookie、state、runs、logs、tmp）
- 可用 `CMPORTER_HOME` 指向临时目录做隔离测试，不要动用户真实数据。

## 每日自动同步服务

```bash
cmporter service status
cmporter service install --time 08:30     # Windows 计划任务 / Linux systemd timer / macOS launchd
cmporter service run --dry-run --force    # 手动跑一次
cmporter service uninstall
```

Windows 上服务会先用 DPAPI 从网易云客户端刷新 cookie（客户端保持登录就永不需扫码）。
