# 贡献指南

感谢你愿意改进 cloud-music-porter。提交前请先读完本页。

## 项目边界（硬性规定）

**仓库不内置、不提供、不分发任何音源。**

- 不要提交 LX Music 自定义源脚本、MusicFree 插件文件、任何平台的解析脚本或镜像站地址。
- 不要提交第三方二进制（如 `media-get`、`ffprobe`、`yt-dlp` 等），需要时文档里说明「请自行安装」。
- 不要提交从任何平台下载的音频、歌曲列表导出、账号 cookie、UID、本机绝对路径。
- 不要提交 `data/`、`config.json`（两者的正常位置是 `~/.cloud-music-porter/`，不在仓库里）、个人报告或个人截图。

违反上述任一条的 PR 会被直接关闭。

## 开发环境

| 依赖 | 要求 |
| --- | --- |
| Node.js | ≥ 20 |
| npm | 随 Node 安装 |
| ffprobe（可选） | 用于更严格的音频校验；没有也能运行 |
| LX Music / MusicFree（可选） | 本地联调音源时需要 |

```bash
git clone https://github.com/publieople/cloud-music-porter.git
cd cloud-music-porter
npm install
npm test              # 运行单元测试（node --test）
node src/cli.js --help
```

```powershell
# Windows PowerShell 下命令相同
git clone https://github.com/publieople/cloud-music-porter.git
cd cloud-music-porter
npm install
npm test
node src/cli.js --help
```

可选：`npm link` 后可以在任意目录使用 `cmporter` 命令。

联调时建议把运行数据隔离到临时目录，避免污染你自己的账号状态与云盘记录：

```bash
export CMPORTER_HOME=/tmp/cmporter-dev
node src/cli.js doctor
```

```powershell
$env:CMPORTER_HOME = "$env:TEMP\cmporter-dev"
node src/cli.js doctor
```

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `src/*.js` | CLI 入口（`cli.js`）、同步编排（`sync.js`）、环境自检（`doctor.js`） |
| `src/core/` | 与音源无关的核心能力：登录、歌单/歌曲读取、VIP 判定、下载校验、云盘检查、上传导入、匹配、播放验证、状态记录 |
| `src/sources/` | 音源适配：LX Music 自定义源、MusicFree 插件、跨源搜索与解析回退 |
| `src/service/` | 跨平台定时任务（Windows 计划任务 / systemd / launchd） |
| `src/web/` | 本地 WebUI 服务端 |
| `web/` | WebUI 静态页面与资源 |
| `test/` | 单元测试（`node:test`） |
| `scripts/` | 辅助脚本 |
| `skills/` | Agent skill |
| `docs/` | 文档 |

## 测试

```bash
npm test        # 等于 node --test（自动发现 test/*.test.js）
```

目前测试为 6 个文件、36 条用例（配置、匹配、音频校验、同步编排、LX 源解析、CLI 冒烟）；CI（`.github/workflows/ci.yml`）在 Node 20 / 22 × Ubuntu / Windows / macOS 上跑 `npm ci && npm test`。

- 新增纯逻辑（例如歌名归一化、匹配打分、响应字段解析、分块上传计算）时，请同时补单测。
- 涉及网络与账号的操作不要写进单测；需要演示时在 PR 描述里贴手动验证步骤和脱敏后的输出。
- 提交前至少确认 `node --check` 能通过你改动的文件。

## 提交规范

提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 风格，一句话说清做了什么：

```text
<type>(<scope>): <subject>

<可选的正文：为什么这样改>

<可选的脚注>
```

常用 `type`：

| type | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修 bug |
| `docs` | 只改文档 |
| `refactor` | 重构，不改变行为 |
| `test` | 测试相关 |
| `chore` | 构建、依赖、脚本等杂项 |

示例：`fix(sync): 修正分块上传重试时的大小计算`

## 分支与 PR

1. 从 `main` 切分支：`feat/xxx`、`fix/xxx`、`docs/xxx`。
2. 一个 PR 只做一件事，把「改了什么、为什么、怎么验证」写进描述。
3. PR 检查清单：
   - [ ] 不含音源、二进制、cookie、个人数据
   - [ ] `npm test` 通过
   - [ ] 新增或变更的 CLI 参数 / 配置项已同步更新 `README.md` 与 `docs/`
   - [ ] Windows / Linux / macOS 中至少验证一个平台，并说明未验证的平台
   - [ ] 涉及用户可见行为变化时，在 `CHANGELOG.md` 的 `[未发布]` 中补一条

## 文档

- 文档以简体中文为主，`README.en.md` 为英文对应版；改动主 README 的结构时请同步英文版。
- 命令用 bash 风格，Windows 下需要不同的写法时补一段 PowerShell。
- 不写营销腔，不承诺代码做不到的能力。

## 许可证

提交的代码默认以 [MIT](LICENSE) 许可证发布。
