# Desk Whale 🐳

跨平台桌宠（Windows / macOS / Linux），透明置顶、可拖拽，实时联动 DeepSeek Harness 的 Agent 状态。

## 特性

- 🪟 **透明无边框窗口**，始终置顶、跳过任务栏
- 🖱️ **可拖拽**到任意位置，位置自动记忆
- 🎞️ **29 个状态动画**（游泳 / 思考 / 敲玻璃 / 睡觉…），纯 Canvas 逐帧播放
- 🔗 **联动 DSH**：每 500ms 轮询 `/whale/state`，Agent 干活时鲸鱼游泳、请求批准时敲玻璃
- 💬 工具调用时吐气泡提示、点击/双击互动、右键菜单（置顶切换 / 回默认位 / 退出）
- 🧩 零前端构建依赖（无 Vite/打包器，纯静态 HTML+JS+Canvas），自研 GIF 解码器

## 目录结构

```
src/                前端（HTML/CSS/JS + Canvas + GIF 解码器）
  assets/           精灵 GIF（当前为 whale-on-desk 占位素材）
  index.html
  main.js           状态机 + DSH 轮询 + 交互
  gif.js            自研 GIF 解码器
  styles.css
src-tauri/          Tauri 壳（Rust）
  src/lib.rs        窗口命令：存/读位置、置顶切换、退出
  tauri.conf.json   透明置顶窗口配置
  icons/            三平台图标
.github/workflows/  三平台自动打包（GitHub Actions）
```

## 本地开发

```sh
# 1. 安装 Rust + Tauri CLI（一次性）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install tauri-cli --locked

# 2. 安装前端依赖（仅 @tauri-apps/api）
npm install

# 3. 开发模式（热重载）
npm run dev

# 4. 打包（产当前平台安装包）
npm run build
```

> Linux 需先装：`libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev librsvg2-dev patchelf`

## 三平台打包

本地只能打出**当前平台**的包。跨平台产物用 GitHub Actions：

1. 把代码推到 GitHub 仓库；
2. 打一个 tag：`git tag v0.1.0 && git push --tags`；
3. `.github/workflows/build.yml` 会自动在 Windows/macOS/Linux 上构建并发布到 Release。

## 替换成你自己的桌宠素材

`src/assets/` 下的 GIF 是占位素材（whale-on-desk 的小鲸鱼）。替换步骤：

1. 准备一套状态 GIF（至少 `idle.gif`），放到 `src/assets/`；
2. 编辑 `main.js` 里的 `STATE_MAP`，把 DSH 状态映射到你的 GIF 文件名；
3. `FALLBACK` 设为你的 `idle` 状态名。

## 技术要点

- **透明置顶**：`tauri.conf.json` 里 `transparent: true` + `alwaysOnTop: true` + `decorations: false` + `skipTaskbar: true`
- **拖拽**：根元素加 `data-tauri-drag-region`，Tauri 走原生窗口拖拽；鲸鱼画布不设 drag region，保证点击不被拖拽吞掉
- **GIF 播放**：自研纯 JS GIF89a 解码器（LZW + 帧合成 + disposal），转成 `ImageData` 用 Canvas 逐帧播放，无第三方依赖
