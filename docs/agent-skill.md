# 在 Agent 里使用（Agent skill）

仓库自带一个 Agent skill：`skills/cloud-music-porter/SKILL.md`，让支持 skill 的编码 Agent（DeepSeek Harness、Claude Code 等）知道什么时候、怎么安全地调用 `cmporter`。

skill 本身**不包含**任何音源、插件或二进制，它只是 CLI 的使用说明与编排约定——真正的音源仍然要在你本机由你自行准备。

## skill 里有什么

| 文件 | 作用 |
| --- | --- |
| `SKILL.md` | skill 入口：能力说明、触发条件、命令用法、安全规则 |
| `references/commands.md` | 命令与参数速查（扫描范围、同步选项、云盘、WebUI、定时任务） |
| `references/troubleshooting.md` | 常见失败排查：cookie 失效、音源缺失、409、匹配失败等 |

在你的 Agent 里装好之后，你可以直接说「帮我把我喜欢的歌里需要补的导进云盘」，Agent 会按 skill 里的规则先自检、再扫描、经你确认后同步。

## 安装

### DeepSeek Harness

个人 skill 放在 `~/.dsh/skills/` 下：

```bash
mkdir -p ~/.dsh/skills
cp -r skills/cloud-music-porter ~/.dsh/skills/
```

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\skills" | Out-Null
Copy-Item -Recurse -Force "skills\cloud-music-porter" "$env:USERPROFILE\.dsh\skills\"
```

如果你就在仓库里开发，也可以做软链接，改 skill 后无需重新拷贝：

```powershell
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.dsh\skills\cloud-music-porter" -Target "$(Resolve-Path skills\cloud-music-porter)"
```

符号链接在 Windows 上可能需要开发者模式或管理员权限；不行就继续用拷贝。

### 其他支持 SKILL.md 的 Agent

把 `skills/cloud-music-porter/` 整个目录放到该 Agent 的 skill 目录（例如 Claude Code 的 `~/.claude/skills/`），或在会话里直接把 `SKILL.md` 的路径交给它读取。不同实现的目录约定不同，以各自文档为准。

### 验证

装好后问 Agent「列出你能用的 skill」，能看到 `cloud-music-porter` 即成功。

## 使用示例

下面是你可以直接对 Agent 说的话（括号里是它实际会执行的命令）：

- 「先检查一下环境能不能用云盘同步。」（`cmporter doctor`）
- 「扫描我喜欢的音乐，列出哪些需要补，先不要动。」（`cmporter scan --liked`）
- 「按刚才的扫描结果，把前 20 首导进云盘，用 FLAC。」（`cmporter sync --from scan.json --limit 20 --quality flac`，`scan.json` 是 `cmporter scan --liked --json scan.json` 的输出）
- 「只处理标题里有『周杰伦』的歌。」（`cmporter scan --query 周杰伦`）
- 「把我本地下载目录里的音频导进云盘，先别真传。」（`cmporter import "D:\Music\我的下载" --dry-run`）
- 「把云盘里已经有副本、但歌单还是试听的歌匹配一下。」（`cmporter match --liked`）
- 「看看云盘现在用了多少。」（`cmporter status`）
- 「昨天的定时任务跑了吗？失败原因是什么？」（`cmporter service status` + 读 `~/.cloud-music-porter/data/logs/`）
- 「打开 WebUI 我自己点点。」（`cmporter web`，然后本地打开 `http://127.0.0.1:8787`）

真实上传会消耗云盘容量与网络流量，建议先让 Agent 用 `--dry-run` 或 `scan` 出方案，你确认后再同步。

## skill 内的安全约定

设计上要求 Agent 遵守：

1. 执行前先 `doctor`，音源缺失时提示你去装，**不代替你安装音源**；
2. 默认先 `scan` / `--dry-run`，把结果交给你确认后再真跑；
3. 每轮限制数量（`--limit`），不主动 `--all --force`；
4. 不在公网启动 WebUI，不上传 cookie 或 `~/.cloud-music-porter/` 里的任何数据；
5. 删除云盘条目（`cloud --delete`）必须由你明确同意；
6. 失败先查 `~/.cloud-music-porter/data/logs/`，不反复盲目重试。

## 给 Agent 的自定义提示词

如果你想在别的 Agent 里用，可以直接粘这段作为初始提示：

```text
你在 ~/cloud-music-porter 目录下使用 CLI 工具 cmporter，把我在网易云音乐里
仅剩 30 秒试听的会员歌曲，用我自己音源解析到的音频补进音乐云盘。

规则：
1. 先运行 cmporter doctor 和 cmporter sources 报告环境；缺音源时告诉我怎么在
   LX Music / MusicFree 里自行安装，不要替我下载任何音源或二进制。
2. 先 cmporter scan --liked 出扫描结果，向我汇总数量与示例，等我确认。
3. 同步时一律带 --limit，并先 --dry-run 跑一次，确认后再真跑；不要用 --all --force。
4. 遇到上传失败/匹配失败，读 ~/.cloud-music-porter/data/logs/ 里的报错后再决定是否重试。
5. 不要输出 ~/.cloud-music-porter/data/cookie.json 的内容，不要把 WebUI 暴露到公网。
6. 结束时汇报：成功数、失败数、失败原因归类、云盘容量变化。
```

## 注意

- skill 依赖你已经把项目 clone 到本地并 `npm install`（见 README「安装」）；
- `cmporter doctor` 出现 ✘ 时退出码为 `2`，Agent 据此判断环境未就绪，应先按提示修好再继续（ffprobe、LX 源缺失只是 `!` 提醒，不阻塞）；
- 配置与数据默认在 `~/.cloud-music-porter/`，需要隔离测试环境时给 Agent 设 `CMPORTER_HOME` 指向临时目录；
- skill 与 CLI 是同一套行为，不存在「Agent 专用」的隐藏能力；
- 如果你自己写 skill，可以沿用同样的能力边界，但请勿打包或引导下载音源。
