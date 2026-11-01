# 排错

## 登录

**「还没有登录」「登录失效」**
- 先 `cmporter status` 确认 cookie 是否可用；
- 重新扫码：`cmporter login`；Windows 上每日服务会自动从网易云客户端刷新 cookie（DPAPI），客户端保持登录即可；
- 仍失败时检查系统时间是否准确（cookie 有有效期）。

## 音源

**每首歌都「没有搜到候选」**
- `cmporter doctor` 看 MusicFree 插件是否可用；`cmporter sources` 看具体插件列表；
- 插件目录默认 `%APPDATA%\\MusicFree\\musicfree-plugins`（Linux/macOS 见 README），也可在 `config.json` 用 `musicFreePluginsDir` 指定；
- 本项目不提供音源，需要用户自备。

**LX Music 源显示不出来**
- `config.json` 的 `lxDataDir` 指向 `LxDatas` 目录（里面应有 `user_api.json`）；
- 默认位置：Windows `%APPDATA%\\lx-music-desktop\\LxDatas`，Linux `~/.config/lx-music-desktop/LxDatas`，macOS `~/Library/Application Support/lx-music-desktop/LxDatas`。

**「音源文件损坏 / ffprobe 无法解析」**
- 音源返回的是坏文件或加密格式（例如 .mgg）；换一个音源/插件，不要反复重试同一首；
- ffprobe 缺失时只是跳过深度校验，不会阻止导入，但坏文件可能被云盘拒绝（409 音频解析失败）。

## 导入 / 上传

**check 之后 upload=2（需要真上传）**
- 正常现象：文件 md5 不在云盘资源池里，会走 NOS 分块上传；
- 上传后 `/api/cloud/pub/v2` 可能先返回 400，工具会每 3 秒重试最多 90 秒（转码需要时间）。

**info/v2 报 409「上传文件的音频解析失败」**
- 文件损坏或不是真正的音频；先 `ffprobe <文件>` 自查。

**导入后歌单里还是 30 秒试听**
- 云盘条目没匹配回歌曲本体：`cmporter match --liked`；
- 少量歌曲网易云不允许匹配（返回「当前歌曲不支持匹配」），不影响云盘内播放。

**「容量不足」**
- 默认预算 = 云盘剩余空间的 95%；用 `--max-gb` 显式指定，或先清理云盘。

## 服务

**任务装了但没跑 / 结果 0x1（Windows）**
- `cmporter service status` 看上次结果与日志；
- 常见原因：Node 路径变化、仓库被移动、没有登录；重装 `cmporter service install --time 08:30`；
- 任务名 `CloudMusicPorterDaily`，登录时也会触发补跑；当天已成功则后续触发直接跳过。

**Linux 没有 systemd**
- 自动回退到 `crontab`；`crontab -l` 可检查条目。

## 找日志

- 每日服务：`~/.cloud-music-porter/data/logs/service-YYYY-MM-DD.log`
- 每轮同步报告：`~/.cloud-music-porter/data/runs/run-*.json`
- 状态：`~/.cloud-music-porter/data/state.json`、`service-state.json`
- 临时下载：`~/.cloud-music-porter/data/tmp/`（服务运行时会自动清理旧文件）
- 调试模式：`CMPORTER_DEBUG=1 cmporter ...` 会打印堆栈
