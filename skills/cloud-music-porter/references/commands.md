# cmporter 命令速查

## 全局

| 命令 | 作用 |
| --- | --- |
| `cmporter help` | 帮助 |
| `cmporter version` | 版本 |
| `cmporter doctor` | 环境体检（Node / 配置 / ffprobe / 登录 / 云盘 / MusicFree / LX 源） |
| `cmporter status` | 账号、云盘容量、本地同步记录 |
| `cmporter sources` | 列出 LX Music 自定义源与 MusicFree 插件 |
| `cmporter web [--port 8787] [--no-open]` | 本机 WebUI |

## 登录

| 命令 | 作用 |
| --- | --- |
| `cmporter login` | 扫码登录（二维码图片存 `data/login_qr.png`，并尝试打开） |
| `cmporter login --cookie "MUSIC_U=..."` | 直接粘贴 cookie |
| `cmporter login --timeout 300` | 自定义扫码超时秒数 |

## 扫描 / 同步

| 命令 | 作用 |
| --- | --- |
| `cmporter scan` | 默认扫描「我喜欢的音乐」 |
| `cmporter scan --liked --vip-only` | 只列 VIP（fee=1）与下架相关 |
| `cmporter scan --all --json rows.json` | 扫描全部歌单（去重）并缓存结果 |
| `cmporter scan --playlist <id\|url>` | 指定歌单 |
| `cmporter scan --song 210049,255020` | 指定歌曲 id |
| `cmporter scan --query 周杰伦` | 搜索一首歌 |
| `cmporter sync --liked --limit 20 --yes` | 批量同步（带 `--yes` 才非交互） |
| `cmporter sync --from rows.json --limit 100` | 复用 `scan --json` 的结果，跳过重复扫描 |
| `cmporter sync --dry-run` | 只打印计划 |
| `cmporter sync --quality 320k` | 目标音质（默认读 config 的 flac） |
| `cmporter sync --max-gb 2` | 本次最多写入 2 GB（默认云盘剩余 95%） |
| `cmporter sync --force` | 忽略本地已同步记录 |
| `cmporter match --liked` | 把云盘已有副本匹配回歌曲本体 |
| `cmporter match --from rows.json --dry-run` | 从扫描缓存里找可匹配的 |
| `cmporter import "D:\\Music\\我的下载"` | 导入本地音频文件（mp3/flac/m4a/ogg/wav） |

## 云盘

| 命令 | 作用 |
| --- | --- |
| `cmporter cloud --limit 50` | 列出云盘条目 |
| `cmporter cloud --delete 123,456` | 删除云盘条目（`cloudSongId`，需用户确认） |

## 服务

| 命令 | 作用 |
| --- | --- |
| `cmporter service status` | 查看计划任务 / 上次结果 / 最近日志 |
| `cmporter service install --time 08:30` | 安装每日自动同步 |
| `cmporter service run --dry-run` | 演练一次：不写云盘，也不记为当天成功 |
| `cmporter service run --force` | 强制立即真实跑一次（忽略当天成功/次数限制） |
| `cmporter service uninstall` | 卸载 |

## 常用选项

`--liked` 喜欢列表（默认）、`--all` 全部歌单、`--playlist`、`--song`、`--query`、
`--limit`、`--offset`、`--quality flac|320k`、`--source auto|lx|musicfree`、
`--max-gb`、`--vip-only`、`--all-rows`、`--include-unavailable`、`--json`、`--from`、
`--force`、`--dry-run`、`--yes`、`--delay <ms>`、`--port`、`--delete`。

## 典型组合

```bash
# 只看喜欢列表里哪些歌还受限
cmporter scan --liked --vip-only --all-rows

# 先缓存再分批（避免每次重新扫描 9000+ 首）
cmporter scan --all --json data/rows.json
cmporter sync --from data/rows.json --limit 200 --yes
cmporter sync --from data/rows.json --offset 200 --limit 200 --yes

# 云盘副本一次性补匹配
cmporter match --from data/rows.json --dry-run
cmporter match --from data/rows.json

# 本地下载的音频
cmporter import "D:\\Music\\我的下载" --dry-run
cmporter import "D:\\Music\\我的下载"
```
