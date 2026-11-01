# 安全策略

## 支持范围

| 版本 | 是否接受安全报告 |
| --- | --- |
| 0.1.x | 是 |
| 更早版本 | 否 |

## 凭据是怎么保存的

- 登录后的 cookie 保存在本地 `~/.cloud-music-porter/data/cookie.json`（Windows 为 `%USERPROFILE%\.cloud-music-porter\data\cookie.json`），**明文 JSON**，不会上传到任何第三方服务器。
- 保存时工具会把文件权限收紧到仅本人可读（POSIX 上 `chmod 600`），但建议你自己再确认一次。
- 配置与数据默认都在 `~/.cloud-music-porter/`，不在仓库里；仓库的 `.gitignore` 仍保留 `data/`、`config.json`，防止有人把本地数据误放进工作区后提交。
- cookie 等同于账号的登录凭证，请把它当作密码对待：

  ```bash
  # Linux / macOS：把文件权限收紧到仅本人可读
  chmod 600 ~/.cloud-music-porter/data/cookie.json

  ```

  ```powershell
  # Windows（PowerShell）：移除其他用户的访问权限
  icacls "$env:USERPROFILE\.cloud-music-porter\data\cookie.json" /inheritance:r /grant:r "$env:USERNAME:(R,W)"
  ```

- 不要把 `~/.cloud-music-porter/` 目录放进 OneDrive、iCloud、坚果云等同步盘，也不要打包发给别人。
- 用 `CMPORTER_HOME` 把数据放到别的盘（如 `D:\cmporter`）时，同样要把该目录权限收紧到仅本人可访问。
- 怀疑 cookie 泄漏时，去网易云音乐「设置 → 账号 → 登录设备管理」退出所有设备，再运行 `cmporter login` 重新登录。

## 本地 WebUI 的边界

- `cmporter web` 只监听 `127.0.0.1`（默认端口 `8787`，`--no-open` 可阻止自动打开浏览器），不要做端口转发、内网穿透或反向代理暴露到公网。
- WebUI 能触发同步、改动配置、查看云盘列表，暴露出去等于把你的账号操作权限交出去；它没有删除云盘条目的入口，删除只能用 CLI 的 `cmporter cloud --delete`。

## 不要提交什么

- `data/`（cookie、状态、日志、临时音频；正常位置是 `~/.cloud-music-porter/data/`）
- `config.json`（含你的本机路径与音源目录；正常位置是 `~/.cloud-music-porter/config.json`）
- 任何音源脚本、插件包、第三方二进制
- 从任何平台下载的音频文件

## 报告安全漏洞

如果你发现安全问题，请**不要公开开 issue**，改用 GitHub 的私密报告渠道：

1. 打开 <https://github.com/publieople/cloud-music-porter>；
2. 进入 **Security → Report a vulnerability**（GitHub Security Advisories）；
3. 说明影响版本、复现步骤、影响范围，以及你希望的署名方式。

我们会尽量在 7 天内给出首次回复，并在修复后于 `CHANGELOG.md` 中致谢（除非你希望匿名）。

## 不在受理范围

- 与「如何获取音源 / 如何绕过会员限制」相关的问题：本项目不提供、不分发任何音源，也不讨论具体音源的获取方式。
- 由第三方音源脚本、MusicFree 插件本身引起的安全问题：请报告给对应的插件仓库或作者。
- 使用者自行修改代码、暴露 WebUI 到公网、把 cookie 提交进公共仓库造成的账号风险。
