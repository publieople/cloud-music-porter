# 自备音源指南

cloud-music-porter 本身**不包含任何音源**。它能取到音频，是因为读取了你本机已经安装好的两类音源：

- **LX Music 自定义源**：提供播放地址解析
- **MusicFree 插件**：提供搜索，同时也能解析

这篇文档讲清楚两者分别是什么、怎么装、工具从哪读、怎么配置，以及出问题时怎么排查。

## 两类音源的分工

| | LX Music 自定义源 | MusicFree 插件 |
| --- | --- | --- |
| 规范 | LX Music 的「自定义源」脚本规范 | MusicFree 的 CommonJS 插件接口 |
| 能做什么 | **只能解析**：给定平台和歌曲 id，返回播放地址 | **搜索 + 解析**：`search` 找歌，`getMediaSource` 取地址 |
| 工具怎么用 | 解析优先 | 搜索默认层 + 解析兜底 |
| 是否满足全部需求 | 否，缺搜索 | 视插件质量而定 |

因为 LX 自定义源规范**没有搜索能力**，工具在任何 `sourceMode` 下都用 MusicFree 插件做聚合搜索；`sourceMode` 只决定解析用谁：默认 `auto` 先试 LX 自定义源，解析不了（平台映射不上、源不支持该平台、解析失败）再回退 MusicFree 插件。两者配合才能既搜得到、又尽量拿到好音质。**所以至少要装一个能用的 MusicFree 插件，否则搜不到任何候选。**

## 方式一：LX Music 自定义源

### 原理

LX Music 的自定义源以脚本形式存放在它的数据目录里，文件一般为 `user_api.json`。为了压缩体积，脚本内容不是明文，而是 `gz_` 前缀 + base64 编码的 zlib 压缩数据：

```text
user_api.json（示意）
{
  "…": [
    {
      "name": "<音源名称>",
      "script": "gz_<base64(zlib(<源脚本明文>))>"
    }
  ]
}
```

cloud-music-porter 读取这个文件后，把 `gz_` 后面的内容 base64 解码、zlib 解压，得到脚本明文，再放进 `node:vm` 沙箱里执行，用来解析播放地址。沙箱里按 LX 自定义源规范提供 `lx` 全局对象（`lx.on('request')`、`lx.send('inited')`、`lx.request`），外加 `fetch`、`console` 和 `lx.utils`（`crypto`、`zlib`、`buffer`），`lx.version` 固定报 `2.12.6` 以兼容按版本分支的脚本。工具**不会修改**这个文件。

> 说明：`node:vm` 只能隔离全局变量，**不是安全边界**。你安装的源脚本来自第三方，请只使用你信任的来源。

### 目录位置

| 平台 | 常见位置 |
| --- | --- |
| Windows | `%APPDATA%\lx-music-desktop\LxDatas\user_api.json` |
| Linux | `~/.config/lx-music-desktop/LxDatas/user_api.json`（也会找 `~/.local/share/lx-music-desktop/LxDatas`） |
| macOS | `~/Library/Application Support/lx-music-desktop/LxDatas/user_api.json` |

注意 LX 的数据目录是 `lx-music-desktop` 下面的 **`LxDatas` 子目录**，不是 `lx-music-desktop` 本身。便携版、自定义数据目录或换了安装方式的 LX Music 位置会不同。**以 `cmporter sources` 打印的探测结果为准**；如果没探测到，把配置文件 `~/.cloud-music-porter/config.json` 里的 `lxDataDir` 指向这个 `LxDatas` 目录，或用环境变量 `CMPORTER_LX_DATA`（兼容 `LX_DATA_DIR`）临时指定。探测顺序是 `lxDataDir` → `CMPORTER_LX_DATA` → `LX_DATA_DIR` → 上表候选。

### 安装自定义源

1. 打开 LX Music 桌面端，进入「设置 → 自定义源」（不同版本菜单名可能略有差异）；
2. 导入或粘贴自定义源脚本，确认保存；
3. 关闭并重新打开 LX Music，确保 `user_api.json` 已经写入磁盘；
4. 运行 `cmporter sources`，确认能看到该源。

工具只用到自定义源的**解析能力**（按平台 + 歌曲 id 取播放地址），不涉及 LX 的搜索、歌词、封面等功能。

### 工具如何使用

- `sourceMode` 为 `auto`（默认）时，先试 LX 自定义源，失败再回退 MusicFree 插件；
- `sourceMode` 为 `lx` 时只用 LX 解析：候选映射不到 LX 平台、或没有 LX 源支持该平台时会直接报错「sourceMode=lx 时只允许用 LX 源解析，但这个候选无法映射到 LX 平台」，不会回退；
- `sourceMode` 为 `musicfree` 时完全不用 LX，解析交给 MusicFree 插件；
- 解析返回的地址可能是直链、也可能是带鉴权参数的临时地址，源脚本负责处理，工具只负责下载。

## 方式二：MusicFree 插件

### 插件接口

MusicFree 插件是 CommonJS 模块，工具主要用它导出的两个方法：

```js
module.exports = {
  platform: '<平台名>',
  version: '<插件版本>',

  // 搜索：query 关键词，page 页码，type 类型（如 'music'）
  async search(query, page, type) { /* 返回 { isEnd, data: [musicItem...] } */ },

  // 解析：quality 为 super / high / standard / low
  async getMediaSource(musicItem, quality) { /* 返回 { url, type, headers? } */ },
};
```

- `quality` 取值：`super`（超高/无损）、`high`（高）、`standard`（标准）、`low`（低）；插件不一定四个都支持。
- 插件还可能导出 `getLyric`、`getAlbumInfo` 等方法，本工具用不到。
- 插件里可能引用 `require('axios')`、`require('cheerio')`、`crypto-js` 等依赖；工具内置了受限的 `require` 兼容层，只放行 `axios`、`cheerio`、`crypto-js`、`dayjs`、`big-integer`、`he`、`qs` 和常用 Node 内置模块（`crypto`、`url`、`zlib`、`buffer`、`querystring`、`util`、`http`、`https`）。用了其他第三方模块的插件会加载失败，报「插件依赖了未提供的模块：…」。

### 目录位置

| 平台 | 常见位置 |
| --- | --- |
| Windows | `%APPDATA%\MusicFree\musicfree-plugins\`（旧版或部分版本为 `%APPDATA%\MusicFree\plugins\`） |
| Linux | `~/.config/MusicFree/musicfree-plugins/`（旧版或部分版本为 `~/.config/MusicFree/plugins/`） |
| macOS | `~/Library/Application Support/MusicFree/musicfree-plugins/`（旧版或部分版本为 `.../MusicFree/plugins/`） |

安装版、便携版、不同版本之间路径都可能不同。**以 `cmporter sources` 打印的探测结果为准**；探测顺序是 `config.musicFreePluginsDir` → 环境变量 `CMPORTER_MF_PLUGINS` → 上表各候选目录，取第一个存在的。没探测到时，把配置文件 `~/.cloud-music-porter/config.json` 里的 `musicFreePluginsDir` 指向实际插件目录，或用环境变量 `CMPORTER_MF_PLUGINS` 临时指定。

### 安装插件

有两种方式，任选一种：

1. **在 MusicFree 里装**：打开 MusicFree 桌面端 →「插件管理」→ 从链接订阅或本地安装，装好后插件会落到插件目录；
2. **手动放文件**：把插件的 `.js` 文件放进插件目录，重启 MusicFree 确认插件能加载。

插件从哪来？官方插件仓库：<https://github.com/maotoumao/MusicFreePlugins>。请自行评估插件来源的可信度。

### 工具如何使用

1. **搜索**：把可用的插件聚合起来搜索同一首歌，拿到候选结果——**任何 `sourceMode` 都走这一步**，LX 没有搜索能力；
2. **匹配打分**：按标题、艺人、时长对候选排序（归一化大小写、全半角、括号修饰等），挑最像的；
3. **解析**：`auto` 下优先 LX，失败用候选对应的 MusicFree 插件解析；`musicfree` 只用插件解析；`lx` 只用 LX，映射不到会报错；
4. **下载校验**：拿到地址后下载并校验，坏文件直接丢弃换下一个候选。

## 平台映射

LX 自定义源只接受「平台 + 该平台自己的歌曲 id」，网易云的歌曲 id 不能直接喂给它。工具能把一个候选交给 LX，前提是**这个候选本身带着目标平台的 id 字段**——也就是搜出它的 MusicFree 插件来自那个平台。识别规则（`src/sources/lx.js`）：

| 平台 | LX 需要的字段 | 从候选的哪里取 |
| --- | --- | --- |
| 酷我（`kw`） | `songmid` | 候选的 `id`（酷我插件的搜索结果） |
| 酷狗（`kg`） | `hash` | 候选的 `hash` / `sqhash`（取 flac 时优先 `sqhash`） |
| QQ 音乐（`tx`） | `songmid` | 候选的 `songmid` |
| 网易云（`wy`） | `id` | 候选的 `id` |
| 咪咕（`mg`） | `copyrightId` | 候选的 `copyrightId` |

判定顺序是：先看 MusicFree 插件声明的平台名能否识别（酷我 / kuwo、酷狗 / kugou、网易 / netease、QQ / 腾讯、咪咕 / migu 等），识别不出再看候选字段（有 `songmid` 判 `tx`，有 `hash` / `sqhash` 判 `kg`，有 `copyrightId` 判 `mg`，同时有 `albumId` + `artistId` + `id` 判 `kw`）。

映射到平台后，还要**装了支持该平台的 LX 自定义源**才能解析；`cmporter sources` 会列出每个源支持的平台，**源本身支持哪些平台，决定了解析的天花板**。

- 映射不到、或没有源支持该平台时：`auto` 下回退 MusicFree 插件解析；`lx` 下直接报错（「sourceMode=lx 时只允许用 LX 源解析，但这个候选无法映射到 LX 平台」或「LX 源不支持平台 X」）；
- 不存在「按歌名 + 艺人 + 时长去别的平台查同曲 id」这种跨库匹配，所以候选来自哪个插件，很大程度上决定了能不能用 LX。

## 配置文件位置

配置文件是 `~/.cloud-music-porter/config.json`（Windows 为 `%USERPROFILE%\.cloud-music-porter\config.json`），首次运行时自动生成；cookie、状态、日志等运行时数据在旁边的 `data/` 目录。仓库根目录下没有配置文件，也**没有 `--config` 参数**——要换根目录就设环境变量 `CMPORTER_HOME`：

```bash
export CMPORTER_HOME=/data/cmporter
```

```powershell
$env:CMPORTER_HOME = "D:\cmporter"
```

除了换根目录，音源目录和 ffprobe 也可以用环境变量覆盖：

| 环境变量 | 作用 |
| --- | --- |
| `CMPORTER_LX_DATA` / `LX_DATA_DIR` | LX Music 的 `LxDatas` 目录，优先于 `lxDataDir` 配置 |
| `CMPORTER_MF_PLUGINS` | MusicFree 插件目录，优先于 `musicFreePluginsDir` 配置 |
| `CMPORTER_FFPROBE` | ffprobe 路径；配置里的 `ffprobePath` 优先 |
| `CMPORTER_DEBUG` | 出错时打印完整堆栈 |

音源相关字段示例（完整字段见 README）：

```json
{
  "sourceMode": "auto",
  "lxDataDir": "C:\\Users\\you\\AppData\\Roaming\\lx-music-desktop\\LxDatas",
  "musicFreePluginsDir": "C:\\Users\\you\\AppData\\Roaming\\MusicFree\\musicfree-plugins"
}
```

只装 LX 时，`cmporter sources` 能看到 LX 源，但 `scan` / `sync` 会提示没有搜到候选——搜索必须靠 MusicFree 插件。

`sourceMode` 只决定**解析**用谁，三种取值：

| 取值 | 搜索 | 解析 |
| --- | --- | --- |
| `auto`（默认） | MusicFree 插件聚合 | 先 LX，失败回退 MusicFree |
| `lx` | 仍需 MusicFree 插件 | 只用 LX；映射不到 LX 平台时直接报错，不回退 |
| `musicfree` | MusicFree 插件聚合 | 只用 MusicFree 插件 |

## 音质与格式

- `config.quality` / `--quality` 支持 `flac` 和 `320k`；实际拿到什么取决于音源。
- 解析时按质量从高到低尝试：`flac`（无损）→ `flac24bit`（Hi-Res）→ `320k` → `128k`；对 MusicFree 插件则映射到 `super` / `high` / `standard` / `low`。
- 有的源在高音质解析失败时只能给出 128k mp3（例如酷我平台的兜底），工具会接受较低音质以保证「能完整播放」，并在结果里标注。
- 下载后会按文件头判断真实格式（mp3 / flac / m4a / ogg / wav）；小于 `config.minAudioBytes`（默认 102400 字节）或头部不合法的直接丢弃。
- 系统里有 ffprobe 时会进一步校验时长与编码；没有 ffprobe 也能用，只是校验弱一些（可用 `CMPORTER_FFPROBE` 或 `config.ffprobePath` 指定路径）。

## 排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `sources` 显示没有 LX 源 | 没装、LX 数据目录换了、指到了 `lx-music-desktop` 而不是 `LxDatas` 子目录、`user_api.json` 没写入 | 在 LX 里确认自定义源可用；用 `lxDataDir` 显式指定 `LxDatas` 目录 |
| `sources` 显示没有 MusicFree 插件 | 插件目录不对、插件不是 CommonJS 格式 | 用 `musicFreePluginsDir` 显式指定；确认插件能装在 MusicFree 里 |
| 能搜到但解析失败 | 插件 `getMediaSource` 失效 | 换一个插件或换一首歌试；在 MusicFree 里直接播看看 |
| `sync` 提示没有搜到候选 | 没有装 MusicFree 插件（只装了 LX 源） | 至少装一个 MusicFree 插件，用 `cmporter sources` 确认可用 |
| LX 解析全失败 | 源不支持该平台，或歌曲 id 映射不上 | 改用 `sourceMode: "auto"` 让工具回退 MusicFree；`lx` 模式不会回退，会直接报错 |
| 解析出来的音质偏低 | 源只给低音质 | 换源，或接受兜底音质 |

仍有问题，运行 `cmporter doctor` 并带上 `~/.cloud-music-porter/data/logs/` 里对应日志的报错行去开 issue（记得脱敏）。

## 合规提醒

- 音源由你自行安装，工具不提供、不推荐、不分发具体音源；
- 只用它处理你自己合法获取的音频，不要用来传播版权内容；
- 源脚本、插件都是第三方代码，是否可信、是否有恶意行为需要你自己判断。
