# dsh-desk-pet 🐳

[English](README.md) | [中文](README.zh.md)

跨平台桌面宠物（Windows / macOS / Linux）：一只透明、置顶、可拖拽的鲸鱼，实时联动 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 Agent 状态。

> 产品名 **Desk Whale**（鲸鱼角色身份）；插件 npm 包名 **@jadyssey/dsh-desk-pet**。

## 特性

- 🪟 透明无边框、始终置顶、跳过任务栏
- 🖱️ 可拖拽到任意位置，位置自动记忆；右键菜单（置顶切换 / 回默认位 / 退出）
- 🎞️ 丰富的状态动画（游泳 / 思考 / 敲玻璃 / 睡觉…），纯 Canvas 逐帧播放
- 🔗 联动 DSH：Agent 干活时鲸鱼游泳、沉默推理时思考、请求审批时"敲玻璃"提醒
- 💬 气泡提示：工具调用名、审批提醒（"需要你确认～"）、对话完成报告（"搞定！X 秒，Y 个工具 🎉"）
- 🔌 零侵入：只读 session 事件，不改 DSH 任何行为
- 🛑 自动退出：DSH 停止约 15 秒后桌宠自动关闭，停 DSH 即停桌宠

## 安装

### 前置条件

- 已安装 [DSH](https://github.com/deepseek-ai/deepseek-harness) 命令行工具

### 从 npm 安装

```sh
dsh plugin --profile <profile> add @jadyssey/dsh-desk-pet
```

安装时会按你的操作系统 + 架构自动拉取对应的桌宠二进制包 `@jadyssey/<platform>-<arch>`，DSH 启动即自动拉起鲸鱼。

#### `<profile>` 是什么

`<profile>` 是你要安装到的 DSH profile 名，每个 profile 对应 `~/.dsh/profiles/<name>/` 下的一套独立插件配置。常见取值：

| profile | 说明 |
|---|---|
| `web` | Web 界面模式（`dsh web` 等价于 `--profile web`），**最常用** |
| `headless` | 无界面，一次性跑完任务即退出 |
| 自定义名 | 你通过 `dsh --profile <名字>` 自建的任意 profile |

没特别指定过的话，一般填 `web`：

```sh
dsh plugin --profile web add @jadyssey/dsh-desk-pet
```

想装到哪个 profile，就把 `<profile>` 换成对应的名字（例如 `headless`）。

### 从源码安装

```sh
git clone https://github.com/jadyssey/dsh-desk-pet
cd dsh-desk-pet
dsh plugin --profile <profile> add file:$PWD/packages/plugin
```

> 从源码安装只装插件本体（状态机 + HTTP 服务）。桌宠二进制需另外提供，见下。

## 桌宠二进制

插件按以下优先级解析桌宠二进制（`desk-whale` / `desk-whale.exe`）：

1. npm 平台包 `@jadyssey/<platform>-<arch>` 的 `bin/`
2. 插件包内 `desktop/`
3. 用户目录 `~/.dsh/desk-pet/desktop/`

npm 安装会自动装好平台包，无需手动操作。源码安装时若没有二进制，可自行编译后放入 `~/.dsh/desk-pet/desktop/`。

## 配置

通过 profile 的 `cordis.patch.yml` 覆盖插件配置：

```yaml
- insert:
    - id: desk-pet
      name: '@jadyssey/dsh-desk-pet'
      config:
        autostart: true          # DSH 启动时自动拉起桌宠（默认 true）
        sleepAfterMinutes: 10     # 空闲多少分钟后鲸鱼睡觉（默认 10）
        enabled: true             # 设为 false 可整体关闭插件
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `autostart` | `true` | DSH 启动时自动拉起桌宠 |
| `sleepAfterMinutes` | `10` | 空闲多少分钟后鲸鱼进入睡眠 |
| `enabled` | `true` | 设为 `false` 整体关闭插件（kill switch） |

## 平台支持

| 平台 | 状态 |
|---|---|
| Linux x64 | ✅ |
| Windows x64 | ✅ |
| macOS arm64 / x64 | ✅ |
| Linux arm64 | ⬜ 占位（暂无 CI runner） |

## 本地开发

```sh
# 跑插件测试
npm test

# 构建桌宠前端
npm run build:desktop

# 构建桌宠二进制（Linux 需先装 webkit2gtk-4.1 等系统依赖）
cd desktop && npm run build
```

改动插件代码后，需重新安装并重启 DSH 才生效：

```sh
dsh plugin --profile <profile> remove @jadyssey/dsh-desk-pet
dsh plugin --profile <profile> add file:$PWD/packages/plugin
```

## 仓库结构

```
packages/plugin/       DSH 插件（状态机 + HTTP 服务）
packages/<platform>-*/ 平台二进制 npm 包（@jadyssey scope）
desktop/               Tauri v2 鲸鱼桌宠（原生二进制，产品名 Desk Whale）
.github/               CI（tag 触发三平台构建 + npm 发布）
```

## License

[MIT](LICENSE)
