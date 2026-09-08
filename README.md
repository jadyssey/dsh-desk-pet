# dsh-desk-pet 🐳

[English](README.md) | [中文](README.zh.md)

A cross-platform desktop pet (Windows / macOS / Linux): a transparent, always-on-top, draggable whale that swims on your desktop and reflects your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) agent's state in real time.

> Product name **Desk Whale** (the whale character identity); plugin npm package **@jadyssey/dsh-desk-pet**.

## Features

- 🪟 Transparent, borderless, always-on-top, hidden from the taskbar
- 🖱️ Draggable anywhere; remembers its position; right-click menu (toggle always-on-top / reset position / quit)
- 🎞️ Rich state animations (swimming / thinking / glass-tapping / sleeping …), pure Canvas frame playback
- 🔗 Tracks DSH: swims while the agent works, thinks while reasoning silently, "taps the glass" when approval is needed
- 💬 Speech bubble: tool names, approval nudge, turn-done report
- 🔌 Zero intrusion: read-only on session events, never changes DSH behavior
- 🛑 Auto-exit: quits itself ~15s after DSH goes away, so stopping DSH also stops the pet

## Install

### Prerequisites

- The [DSH](https://github.com/deepseek-ai/deepseek-harness) CLI installed

### From npm

```sh
dsh plugin --profile <profile> add @jadyssey/dsh-desk-pet
```

It automatically pulls the pet binary package `@jadyssey/<platform>-<arch>` matching your OS + arch; DSH launches the whale on startup.

#### What is `<profile>`

`<profile>` is the name of the DSH profile you install into. Each profile is an independent plugin config under `~/.dsh/profiles/<name>/`. Common values:

| profile | description |
|---|---|
| `web` | Web UI mode (`dsh web` is an alias of `--profile web`), **most common** |
| `headless` | No UI; runs one task then exits |
| custom | Any profile you created with `dsh --profile <name>` |

If unsure, use `web`:

```sh
dsh plugin --profile web add @jadyssey/dsh-desk-pet
```

Replace `<profile>` with whatever profile name you want (e.g. `headless`).

### From source

```sh
git clone https://github.com/jadyssey/dsh-desk-pet
cd dsh-desk-pet
dsh plugin --profile <profile> add file:$PWD/packages/plugin
```

> Installing from source only gives you the plugin host (state machine + HTTP service). The pet binary must be provided separately — see below.

## Pet binary

The plugin resolves the pet binary (`desk-whale` / `desk-whale.exe`) in this priority order:

1. `bin/` of the npm platform package `@jadyssey/<platform>-<arch>`
2. the plugin package's own `desktop/`
3. the user directory `~/.dsh/desk-pet/desktop/`

An npm install sets up the platform package automatically. For source installs without a binary, build it yourself and drop it into `~/.dsh/desk-pet/desktop/`.

## Configuration

Override plugin settings via the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: desk-pet
      name: '@jadyssey/dsh-desk-pet'
      config:
        autostart: true          # auto-launch the pet on DSH startup (default true)
        sleepAfterMinutes: 10    # minutes idle before the whale sleeps (default 10)
        enabled: true            # set false to disable the plugin entirely
```

| field | default | description |
|---|---|---|
| `autostart` | `true` | auto-launch the pet on DSH startup |
| `sleepAfterMinutes` | `10` | minutes idle before the whale falls asleep |
| `enabled` | `true` | set `false` to disable the plugin (kill switch) |

## Platform support

| platform | status |
|---|---|
| Linux x64 | ✅ |
| Windows x64 | ✅ |
| macOS arm64 / x64 | ✅ |
| Linux arm64 | ⬜ placeholder (no CI runner yet) |

## Local development

```sh
# run plugin tests
npm test

# build the pet frontend
npm run build:desktop

# build the pet binary (Linux needs webkit2gtk-4.1 etc. first)
cd desktop && npm run build
```

After changing plugin code, reinstall and restart DSH for it to take effect:

```sh
dsh plugin --profile <profile> remove @jadyssey/dsh-desk-pet
dsh plugin --profile <profile> add file:$PWD/packages/plugin
```

## Repository layout

```
packages/plugin/       DSH plugin (state machine + HTTP service)
packages/<platform>-*/ per-platform binary npm packages (@jadyssey scope)
desktop/               Tauri v2 whale pet (native binary, product name Desk Whale)
.github/               CI (tag-triggered 3-platform build + npm publish)
```

## License

[MIT](LICENSE)
