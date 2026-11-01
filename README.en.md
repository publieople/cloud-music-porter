# cloud-music-porter

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](#platform-support)

**Get your own legally obtained audio into NetEase Cloud Music cloud drive, so songs that used to play only a 30-second preview can play in full.**

The CLI is called `cmporter`. Node.js ≥ 20, Windows / Linux / macOS. **No audio sources are bundled with this repository.**

## Why this exists

Some songs on NetEase Cloud Music are members-only: without a subscription you get a 30-second preview. The cloud drive (音乐云盘) is a different path — audio you upload there plays in full, using your own file.

This tool automates the boring part of that work:

> find out which songs are restricted → search for the same track in an audio source you provide → download it → upload it to your cloud drive → match the cloud copy back to the original song

**Where the audio comes from is entirely up to you.** The tool only reads audio sources you have already installed locally (MusicFree plugins / LX Music custom sources). It does not find audio for you, and it does not redistribute anything.

## Core features

- **Finds restricted songs automatically** — reads your "Liked Songs" or any playlist and uses the playback API to detect VIP-restricted tracks (30-second previews). `--vip-only` lists just those.
- **Bring your own sources** — pulls audio from your local MusicFree plugins and LX Music custom sources. The repository contains no source scripts, plugin bundles, third-party binaries or mirror URLs.
- **End-to-end automation** — search & match → resolve & download → validate file → cloud instant-import or real upload → import → match back to the song → playback check.
- **Search and resolve are separate** — MusicFree plugins do the aggregated search (search is required); resolution prefers your LX custom source and falls back to MusicFree.
- **Instant import first** — if the exact file already exists in your cloud drive, the tool imports it without uploading again. Real uploads are chunked and verified after registration.
- **Local by default** — cookie, state, logs and temporary files all stay in `~/.cloud-music-porter/` on your machine; the WebUI listens on `127.0.0.1` only.
- **Dry-run, batch, resume** — preview with `--dry-run`, split work with `--limit` / `--offset`, reuse a scan with `--from`, retry failed items with the same command.
- **Cross-platform scheduling** — Windows Scheduled Tasks, Linux systemd user timer (cron fallback), macOS launchd. One command to install.
- **Three ways to use it** — CLI, local WebUI, and an Agent skill.

## Compliance notice

> **This project only handles audio files that you have legally obtained. It does not provide audio sources, does not provide any resolving service, and does not bypass any paywall.**
>
> The repository ships no source scripts, plugin bundles, third-party binaries or mirror endpoints. Audio sources must be installed by you in LX Music / MusicFree.
>
> The tool **does not crack membership, does not fake a VIP status and does not patch the NetEase client**: cloud-drive playback is a normal feature of your account; this project only puts your own audio there. Treat it as a tool that **fills your cloud drive with your own audio**, and follow the laws of your jurisdiction and the NetEase Cloud Music terms of service. You are responsible for any account or legal consequences of using it.

## Quick start (30 seconds)

You need Node.js ≥ 20 and a MusicFree installation with at least one plugin (**search is required**). If you also configured LX Music custom sources, resolution will try them first.

```bash
### 1) Clone and install
git clone https://github.com/publieople/cloud-music-porter.git
cd cloud-music-porter
npm install

### 2) Self-check, then sign in by QR code
node src/cli.js doctor
node src/cli.js login

### 3) Confirm your local audio sources are detected
node src/cli.js sources

### 4) Scan "Liked Songs", VIP-restricted tracks only
node src/cli.js scan --liked --vip-only

### 5) Rehearse, then actually sync
node src/cli.js sync --liked --dry-run
node src/cli.js sync --liked --yes
```

> After `npm link`, replace `node src/cli.js` with `cmporter` (the examples below use `cmporter`).

## How it works

```text
             ┌────────────────────────────────────────────┐
             │ NetEase account (QR sign-in)                │
             └───────────────────┬─────────────────────────┘
                                 │
              ┌──────────────────┴───────────────────────┐
              │ Read playlists / Liked Songs             │
              │ Playback API: full / 30s preview / gone  │
              └──────────────────┬───────────────────────┘
                                 │ songs that need help
              ┌──────────────────┴───────────────────────┐
              │ MusicFree plugins: aggregated search     │
              │ Scoring match (title + artist + duration)│
              └──────────────────┬───────────────────────┘
                                 │ candidate hit
              ┌──────────────────┴───────────────────────┐
              │ Resolve: LX custom source → MusicFree    │
              │ Download → validate (magic/size/probe)   │
              └──────────────────┬───────────────────────┘
                                 │ valid audio file
              ┌──────────────────┴───────────────────────┐
              │ Cloud drive upload/check/v2              │
              │ ├ upload=1  instant import               │
              │ ├ upload=2  chunked → info/v2 → pub/v2   │
              │ └ upload=0  already there, skip          │
              └──────────────────┬───────────────────────┘
                                 │ cloud entry
              ┌──────────────────┴───────────────────────┐
              │ Match back to the song                   │
              │ (cloud/user/song/match)                  │
              │ Verify playback: no preview info returned│
              └──────────────────────────────────────────┘
```

The cookie, configuration and data live in your home directory at `~/.cloud-music-porter/` (`%USERPROFILE%\.cloud-music-porter\` on Windows). Set the `CMPORTER_HOME` environment variable to use a different root.

Implementation details, API fields and edge cases are covered in [docs/architecture.md](docs/architecture.md).

## Installation

### Requirements

| Dependency | Requirement | Notes |
| --- | --- | --- |
| Node.js | ≥ 20 | Required |
| npm | Ships with Node.js | Required |
| MusicFree plugin | At least one working plugin | Required for search — see [docs/sources.md](docs/sources.md) |
| LX Music custom source | Optional | When present, resolution tries LX first |
| ffprobe | Optional | Enables stricter audio validation (duration, codec); not required |

### Install

```bash
git clone https://github.com/publieople/cloud-music-porter.git
cd cloud-music-porter
npm install

# Optional: register the cmporter command globally
npm link
```

Without linking, just use `node src/cli.js` instead of `cmporter`.

Run the self-check first:

```bash
cmporter doctor
```

It runs 7 checks and prints ✔ / ! / ✘ for each: runtime (Node version, platform), config, ffprobe, sign-in (nickname / uid / vipType), cloud drive (entries / used / quota), MusicFree plugins, and LX Music custom sources. The exit code is 2 when something blocks you (✘), so you can gate scripts on it; warnings (such as a missing ffprobe) still count as a pass with exit code 0. A clean run ends with "结果：全部正常…" and tells you to start scanning.

## First run

### 1. Sign in

```bash
cmporter login
```

A QR code appears in the terminal; scan it with the NetEase Cloud Music app and confirm on your phone. The credential is stored in `~/.cloud-music-porter/data/cookie.json`. The QR wait defaults to 180 seconds; use `--timeout 300` on a slow network.

If scanning is inconvenient (for example on a headless server), paste a cookie instead:

```bash
cmporter login --cookie "MUSIC_U=your-cookie-value"
```

A cookie is a login credential: never commit it, sync it, or share it. Re-run `cmporter login` when it expires.

### 2. Prepare your own audio sources

This step is yours to complete — **no sources ship with the repo**:

1. Install plugins in MusicFree (the tool reads its plugin directory) — **install at least one**; search depends on it;
2. Optional: install custom sources in LX Music (the tool reads its `user_api.json`); resolution tries them first.

Then run:

```bash
cmporter sources
```

You should see the detected MusicFree plugins and LX custom sources, with a note on whether each is available. If the directories are not detected automatically, set `lxDataDir` / `musicFreePluginsDir` explicitly in `~/.cloud-music-porter/config.json`; you can also override them with environment variables: `CMPORTER_LX_DATA` (or `LX_DATA_DIR`) for the LX `LxDatas` directory and `CMPORTER_MF_PLUGINS` for the MusicFree plugin directory.

> Note: the LX custom-source spec has **no search API**, so search always depends on MusicFree plugins. With LX sources only, `cmporter sync` reports that no candidates were found.

Directory locations, platform mapping rules and troubleshooting are in [docs/sources.md](docs/sources.md).

### 3. Scan: see what needs filling in

```bash
# VIP-restricted songs in Liked Songs only
cmporter scan --liked --vip-only

# A specific playlist (id or share URL)
cmporter scan --playlist 123456789 --vip-only

# Everything, exported for later use
cmporter scan --all --vip-only --json scan.json
```

| Option | Description |
| --- | --- |
| `--liked` | Scan "Liked Songs" (default) |
| `--playlist <id\|url>` | Scan a specific playlist |
| `--all` | Scan all playlists plus Liked Songs, de-duplicated |
| `--song <id,...>` | Scan specific song ids |
| `--query <keyword>` | Search by keyword, then scan the results |
| `--vip-only` | Only VIP-restricted (30-second preview) songs |
| `--all-rows` | Print every row, not just restricted songs |
| `--json <file>` | Export results as JSON for `sync --from` |

Each row reports a status: needs filling (for example "preview (VIP)"), already matched in the cloud drive (plays in full straight from a playlist), cloud copy present but unmatched (plays from the cloud drive), plays normally, delisted / no rights (skipped by default), and so on.

### 4. Sync: search, download, upload, import

```bash
# Rehearsal: print the plan, download and upload nothing
cmporter sync --liked --dry-run

# Real run, skipping per-item confirmation
cmporter sync --liked --yes

# 320k mp3 only, at most 20 songs and 1 GB written to the cloud drive this run
cmporter sync --liked --quality 320k --limit 20 --max-gb 1 --yes

# Reuse the scan from the previous step
cmporter sync --from scan.json --yes
```

| Option | Description |
| --- | --- |
| `--dry-run` | Rehearse; only report what would be processed |
| `--yes` | Do not ask for confirmation per song |
| `--quality flac\|320k` | Target quality, default `flac` |
| `--source auto\|lx\|musicfree` | Which source family to resolve with, default `auto` (LX first, then MusicFree); search always comes from MusicFree plugins |
| `--limit N` / `--offset N` | Process in batches |
| `--max-gb N` | How many GB this run may write to the cloud drive (**counts file sizes; both instant imports and real uploads**). `0` (default) means 95% of the free space; the run stops once the budget is exceeded |
| `--from <scan.json>` | Use the result of an earlier `scan --json` |
| `--include-unavailable` | Also try delisted / unlicensed songs (skipped by default) |
| `--delay <ms>` | Delay between songs; defaults to `delayMs` from the config |
| `--force` | Retry even if local state says the song was already handled |

Progress is printed per song, and failures are written to `~/.cloud-music-porter/data/logs/`. Fix the cause and re-run the same command.

### 5. Match: attach cloud copies back to their songs

"Matching" tells NetEase that a cloud-drive audio file **is** a particular catalog song. Only matched songs show as full playback in a playlist.

New imports are matched automatically after sync. For songs uploaded manually earlier, or where matching failed during import, run:

```bash
cmporter match --liked --dry-run   # preview
cmporter match --liked             # apply

# Or reuse a previous scan
cmporter match --from scan.json --dry-run
```

A few songs return "this song does not support matching". They still play from the cloud drive; they just are not attached to the playlist entry.

### 6. Optional: import audio you already have locally

If you already own audio files that you obtained legally (bought or recorded yourself), the tool can match them by filename and import them into your cloud drive:

```bash
cmporter import "D:\Music\Downloads" --dry-run   # preview the matching result
cmporter import "D:\Music\Downloads"             # run it
```

- Filenames should look like `Title - Artist.ext` (for example `Sunny Day - Jay Chou.flac`); the directory is scanned recursively;
- The tool searches the NetEase catalog for the song id, then reuses the same cloud-drive check, instant-import/upload and matching pipeline as `sync`;
- `--limit`, `--max-gb` and `--delay` are supported; `--dry-run` only prints the plan.

> Only files you legally own are processed. This command never downloads audio from anywhere.

### 7. Optional: schedule it

```bash
cmporter service install              # time comes from serviceHour / serviceMinute
cmporter service install --time 08:30 # run daily at 08:30
cmporter service status               # status and recent runs
cmporter service run                  # run once right now (what the scheduled job does)
cmporter service uninstall            # remove it
```

| Platform | Implementation |
| --- | --- |
| Windows | Scheduled Task `CloudMusicPorterDaily`; runs daily at the chosen time and catches up at sign-in. It actually runs `node <cli.js path> service run` |
| Linux | systemd user `cloud-music-porter.service` + `cloud-music-porter.timer` (`OnCalendar` daily HH:MM, `Persistent=true`); falls back to crontab without systemd |
| macOS | launchd `~/Library/LaunchAgents/com.publieople.cloud-music-porter.plist` |

Every trigger (`service run`) does the same four things:

1. Runs at most `serviceMaxAttempts` times per day (3 by default); once a run succeeds, later triggers that day are skipped (`--force` overrides);
2. Cleans `data/tmp/` and service logs older than 30 days;
3. Refreshes the cookie first: on Windows it reads the NetEase desktop client login (DPAPI-protected local data), so keeping the client signed in avoids re-scanning the QR code; otherwise it falls back to the saved cookie;
4. Runs `sync --liked` and records the result in `~/.cloud-music-porter/data/service-state.json`, with logs in `~/.cloud-music-porter/data/logs/service-YYYY-MM-DD.log`.

`service run --dry-run` is only a rehearsal: nothing is written to the cloud drive, it does not consume that day's attempt budget, and it is **not** recorded as a successful sync for the day, so the real scheduled run later that day still happens.

On Windows, installing a Scheduled Task may require the appropriate user permissions; read the output if it fails, or create the task manually in Task Scheduler.

### 8. Optional: local WebUI

```bash
cmporter web                 # port 8787 by default, opens your browser
cmporter web --port 8790     # another port
cmporter web --no-open       # do not open the browser
```

Then open <http://127.0.0.1:8787>. The UI offers:

- **Header** — account info and a QR sign-in dialog;
- **Overview cards** — account, cloud drive usage (entries / used / quota meter), sources, daily sync status;
- **Scan / Sync form** — scope (liked / all playlists / a playlist / songs / keyword), quality, VIP-only, rehearsal, per-run GB budget; buttons for scan, start sync, match cloud copies and environment check;
- **Daily sync card** — set the time, then install / uninstall / run now / view status;
- **Config card** — `quality`, `sourceMode`, `lxDataDir`, `musicFreePluginsDir`, `delayMs`; saving writes the config file;
- **Live log drawer** — task output streamed over SSE.

The WebUI binds to `127.0.0.1`, rejects requests whose Host is not local, and requires a custom header on POST (CSRF protection). **Local use only — never expose it through port forwarding or a reverse proxy.** It has no delete button: cloud entries can only be removed from the CLI with an explicit `cmporter cloud --delete <id,...>`.

## Command reference

| Command | Purpose |
| --- | --- |
| `cmporter login [--cookie "<cookie>"] [--timeout <seconds>]` | QR sign-in, or paste a cookie |
| `cmporter doctor` | 7-check environment self-check: runtime, config, ffprobe, sign-in, cloud drive, MusicFree plugins, LX sources; exit code 2 on blockers |
| `cmporter status` | Account, cloud drive entries and usage, local sync history |
| `cmporter sources [--json]` | List detected MusicFree plugins and LX custom sources with availability |
| `cmporter scan [scope] [--vip-only] [--all-rows] [--json <file>]` | Scan for songs that need filling in |
| `cmporter sync [scope] [--yes] [--dry-run] [--quality] [--source] [--delay] [--limit] [--offset] [--max-gb] [--from] [--include-unavailable] [--force]` | Search → download → upload → import |
| `cmporter match [--liked \| --from <scan.json>] [--dry-run]` | Match existing cloud copies back to songs |
| `cmporter import <directory> [--dir <directory>]` | Import local audio: match `Title - Artist` filenames against the catalog, then upload |
| `cmporter cloud [--limit <n> \| --delete <id,...>]` | List (latest 30 by default) or clean up cloud drive entries |
| `cmporter web [--port 8787] [--no-open]` | Start the local WebUI (binds `127.0.0.1`) |
| `cmporter service install [--time HH:MM]` (plus `status` / `uninstall` / `run`) | Install and manage the scheduled job |

Global options:

| Option | Description |
| --- | --- |
| `--help` | Show help |
| `--version` | Show version |

Selection options (`--vip-only` and friends) apply to both `scan` and `sync`, so the two commands always agree on scope.

Configuration and data live in `~/.cloud-music-porter/` (`%USERPROFILE%\.cloud-music-porter\` on Windows) by default — there is no `--config` flag. To migrate or run several profiles, set the `CMPORTER_HOME` environment variable.

## Configuration

The first run generates `~/.cloud-music-porter/config.json` (`%USERPROFILE%\.cloud-music-porter\config.json` on Windows). To use a different root:

```bash
# bash / zsh
CMPORTER_HOME=/path/to/cmporter-home cmporter sync --liked --yes
```

```powershell
# PowerShell
$env:CMPORTER_HOME = "D:\cmporter-home"
cmporter sync --liked --yes
```

Environment variables:

| Variable | Purpose |
| --- | --- |
| `CMPORTER_HOME` | Change the whole config/data root (default `~/.cloud-music-porter/`) |
| `CMPORTER_LX_DATA` (or `LX_DATA_DIR`) | Point at the LX Music `LxDatas` directory; wins over auto-detection and `lxDataDir` |
| `CMPORTER_MF_PLUGINS` | Point at the MusicFree plugin directory; wins over auto-detection and `musicFreePluginsDir` |
| `CMPORTER_FFPROBE` | Default ffprobe path; `ffprobePath` in the config takes precedence |
| `CMPORTER_DEBUG` | Print full stack traces on errors (useful in issues) |

Default configuration:

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

| Field | Default | Description |
| --- | --- | --- |
| `quality` | `flac` | Target quality: `flac` or `320k` |
| `sourceMode` | `auto` | Which source family to resolve with: `auto` (LX first, then MusicFree) / `lx` (LX only) / `musicfree` (MusicFree only). Search always comes from MusicFree plugins |
| `lxDataDir` | empty | LX Music `LxDatas` directory; empty means auto-detect, also overridable with `CMPORTER_LX_DATA` / `LX_DATA_DIR` |
| `musicFreePluginsDir` | empty | MusicFree plugin directory; empty means auto-detect, also overridable with `CMPORTER_MF_PLUGINS` |
| `delayMs` | `800` | Delay between requests (ms); raising it reduces the chance of rate limiting |
| `maxGbPerRun` | `0` | Total GB a run may write to the cloud drive (instant imports and uploads both count); `0` means 95% of the free space |
| `serviceHour` / `serviceMinute` | `8` / `30` | Time of day for the scheduled job |
| `serviceMaxAttempts` | `3` | Max sync runs per day for the scheduled job (no retry once the day succeeded; `--force` overrides) |
| `webPort` | `8787` | WebUI port |
| `cloudWarnRatio` | `0.9` | Stop syncing and warn when cloud drive usage exceeds this ratio |
| `ffprobePath` | `ffprobe` | Path to ffprobe |
| `searchTimeoutMs` | `12000` | Timeout for one search request (ms) |
| `resolveTimeoutMs` | `15000` | Timeout for one resolve request (ms) |
| `pluginConcurrency` | `4` | Number of MusicFree plugins searched concurrently |
| `minAudioBytes` | `102400` | Minimum audio size in bytes; anything smaller is treated as an error page |

The config file lives outside the repository; `.gitignore` still lists `data/` and `config.json` so nobody accidentally commits local data.

## Local data

All local state lives in `~/.cloud-music-porter/data/` (`%USERPROFILE%\.cloud-music-porter\data\` on Windows) by default:

| Path | Content |
| --- | --- |
| `~/.cloud-music-porter/data/cookie.json` | Login cookie (plain JSON; restrict its permissions) |
| `~/.cloud-music-porter/data/state.json` | Sync records (what was processed, with what result) |
| `~/.cloud-music-porter/data/runs/` | Per-run result details |
| `~/.cloud-music-porter/data/logs/` | Run logs — check here first when troubleshooting |
| `~/.cloud-music-porter/data/tmp/` | Temporary audio during processing, cleaned up afterwards |

Deleting the whole `~/.cloud-music-porter/` directory resets local state (you will need to sign in again); nothing in your cloud drive is touched. Use `CMPORTER_HOME` to keep the data somewhere else.

## Real-world numbers

These come from the author account and machine. **They vary with account, sources, quality and version** — treat them as orders of magnitude:

| Item | Number |
| --- | --- |
| Environment | Windows 11, Node.js 26.13.0 (CI covers Node 20 / 22) |
| "Liked Songs" | 714 songs, of which 220 are VIP-restricted (`fee=1`) |
| Result | Those songs went from 30-second previews to full playback after import + match |
| Source quality | With official-source FLAC, roughly 20–40 MB per song |
| Cloud drive (measured) | 880 entries / 16.0 GB used, 60 GB quota |
| Local sources | 17 MusicFree plugins + 2 usable LX sources; `doctor` all green |
| Daily job | Last Windows Scheduled Task result `0x0` |
| Tests | `npm test` — 7 test files, 44 cases, all passing |

Rough estimates: 320k mp3 is about 8–10 MB per song, so 60 GB holds roughly 5,000 songs; FLAC at 20–40 MB per song holds roughly 1,500–3,000. Start with a small batch before going full scale.

## Platform support

| Platform | Status |
| --- | --- |
| Windows 10 / 11 | Supported; scheduling via Task Scheduler |
| Linux (systemd) | Supported; systemd user timer, cron fallback |
| macOS | Supported; scheduling via launchd |
| Node.js | ≥ 20 |

Signing in via QR code needs a GUI; on a headless server use `login --cookie`.

## Known limitations

- **You must provide the sources** — nothing is bundled. At least one MusicFree plugin (for search) is required; LX custom sources are optional and only resolve.
- **LX custom sources cannot search** — in every mode search comes from MusicFree plugins; `sourceMode: "lx"` only restricts resolution, and it fails outright when a candidate cannot be mapped to an LX platform.
- **Plugin quality varies** — some MusicFree plugins can search but their `getMediaSource` no longer works.
- **Delisted / unlicensed songs cannot be filled** — the playback API returns 404 and no source has a playable URL.
- **Some songs refuse matching** — NetEase returns "this song does not support matching"; it plays from the cloud drive but stays unattached in playlists.
- **The cloud drive has a quota** — commonly around 60 GB, depending on your account; see `cmporter status`.
- **Cloud entries are never deleted automatically** — only an explicit `cmporter cloud --delete <id,...>` removes anything; run `cmporter cloud` first to see the ids.

Causes and troubleshooting are in [docs/faq.md](docs/faq.md).

## Documentation

| Document | Content |
| --- | --- |
| [docs/sources.md](docs/sources.md) | How to bring your own sources: LX Music custom sources / MusicFree plugins, directories, platform mapping |
| [docs/architecture.md](docs/architecture.md) | Module layout, VIP detection, instant-import vs real upload, the full pipeline |
| [docs/faq.md](docs/faq.md) | FAQ and troubleshooting |
| [docs/agent-skill.md](docs/agent-skill.md) | Install the bundled Agent skill |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev environment, tests, commit conventions |
| [SECURITY.md](SECURITY.md) | Cookie storage and vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Development and testing

```bash
npm test                          # node --test, auto-discovers test/*.test.js — 7 files, 44 cases
node --test test/matcher.test.js   # run a single test file
```

CI runs on GitHub Actions across Node 20 / 22 × Ubuntu / Windows / macOS, executing `npm ci && npm test` on every push and pull request. Dev environment, directory responsibilities and commit conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Issues and PRs are welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Note: **any PR that adds sources, plugins, binaries or audio files will be rejected.**

## Security

The cookie lives in `~/.cloud-music-porter/data/cookie.json`; the WebUI binds to loopback only. Report security issues privately via GitHub — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 publieople

## Disclaimer

This project is not affiliated with NetEase Cloud Music, LX Music or MusicFree; their names and trademarks belong to their respective owners. It is a tool for organising audio files you legally obtained, and it neither provides nor distributes any audio source, audio content or resolving service. You are responsible for how you use it.
