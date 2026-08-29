# @local/dsh-collab-score — DSH 乐谱协作插件 / Score Collaboration Plugin

会话级乐谱编辑/预览/播放面板（MuseScore 4.x WebAssembly 引擎）+ agent 乐谱工具（乐谱协作模式），集成在 DSH WebUI 内。MuseScore 文件格式兼容，不依赖本机桌面端。

A session-level score edit / preview / playback panel (MuseScore 4.x WebAssembly engine) plus agent score tools (the “score collaboration” mode), integrated into the DSH WebUI. MuseScore file-format compatible, no desktop MuseScore required.

> Demo / 演示版。功能与文档会随开发迭代变化；已知限制见文末。
> This is a demo build. Features and docs evolve; known limitations are listed at the end.

**适配ds-h-v0.1.2-alpha的版本已构建 同时0.1.1版本请查看release**

---

## 功能 / Features

- **会话内引擎浮层**：当前会话弹出可拖动 iframe 引擎（每会话一个独立实例，互不干扰）；Session-scoped draggable engine overlay, one isolated instance per session.
- **双写面协作**：agent 经 `score_edit` 写磁盘 `score.mscs` → 引擎自动刷新；用户引擎内编辑经「保存」回写工作区。Dual write surfaces: agent writes via `score_edit` → engine refreshes; user edits save back to the workdir.
- **agent 乐谱工具**：`score_sync / score_view / score_create / score_open / score_edit / score_commit` 六工具，只挂在 score-collab 预设。Six agent tools mounted only on the score-collab preset.
- **播放器**：自建 MuseAudio WASM（GPL audio_engine + LGPL FluidSynth）+ MS Basic 声库，面板内直接播放。In-panel playback via a self-built MuseAudio WASM engine.
- **预设自安装**：首次启动自动把「乐谱协作」预设安装到 `$DSH_HOME/.agent-presets/score-collab`（已有则不动，保护用户编辑）。Preset self-install on first boot; existing user presets are never overwritten.
- **技能（skills）**：预设自带 `skill-filesystem` + `tool-skill`，模型可看到并调用本机 skill 目录（含 `~/.claude/skills` 经宿主 provider 合并的条目）。The preset mounts skill discovery + loader, so the agent sees local skills.

---

## 目录结构 / Layout

```
score-collab/
├── package.json            # 包元数据 / package manifest
├── cordis.patch.yml        # bundle patch：server 行 + client 行（只 insert，零冲突）
├── src/                    # TypeScript 源码 / source
│   ├── server.ts           #   /score-collab/* 路由 + 预设自安装
│   ├── score-tools.ts      #   score_* 六工具
│   ├── bridge/             #   mscz↔mscs 编解码、mscx 投影/校验、状态机、notify
│   ├── client/             #   浏览器半身：入口、引擎浮层、文案
│   └── invariant.ts        #   运行时不变式 / runtime invariant
├── lib/                    # 构建产物（tsc + tsdown）/ build output
├── assets/                 # blank-template.mscx（score_create 空白模板）等
├── preset/score-collab/    # 乐谱模式预设（agent.cordis.yml + preset.yml）
├── engine-dist/            # 引擎 web 构建（panel/viewer/*.wasm/sound/*.sf3）
├── test/                   # bridge 单测（node:test）
├── scripts/
│   ├── build-release.mjs   # 组装可分发 release 包 / assemble distributable package
│   ├── test-server.mjs     # 隔离测试服务器编排 / isolated test-server orchestration
│   └── copy-engine.mjs     # 把 wasm 构建产物镜像进 engine-dist
└── release/dsh-collab-score/  # 构建产物：自包含可分发包 / distributable package
```

---

## 安装 / Installation

### 前置要求 / Prerequisites

- Node.js ≥ 22.19
- pnpm（`npm i -g pnpm`）
- 已安装并运行过 DSH（`dsh web` 能跑起来）
- 本插件不依赖桌面版 MuseScore。 / No desktop MuseScore needed.

### 方式 A：从源码构建 release 包再安装（推荐分发路径）/ Build-then-install (recommended for distribution)

```sh
# 1) 在插件仓库内组装自包含 release 包（只写仓库内 release/ 目录，不动主目录）
node scripts/build-release.mjs
# 产物：release/dsh-collab-score/（约 133 MB，含引擎 wasm 与声库）

# 2) 安装到 DSH web profile（file: = 复制安装，包可随目录移动）
pnpm dsh plugin --profile web add file:D:/path/to/release/dsh-collab-score
```

`file:` 会把整个包目录复制进 profile（引擎资产 133MB 也一并复制）。包本身自包含：`@deepseek-ai/*` 运行时依赖由 DSH 宿主的 `healProfilesModuleFallback` 兜底解析（`$DSH_HOME/profiles/node_modules` 符号链接闭包），不要求目标机器能访问 npm registry 拉取这些包。

### 方式 B：link 开发模式（改代码即时生效，用于开发）/ Link mode (for development)

```sh
pnpm dsh plugin --profile web add link:D:/dsh-musescore-plugin/score-collab
```

`link:` 建立符号链接，源码改动重新 `pnpm build` 后刷新页面即生效；适合边改边测。注意 `link:` 路径写入的是你的本机绝对路径，不适合分发给别人。

### 卸载 / Uninstall

```sh
pnpm dsh plugin --profile web remove @local/dsh-collab-score
```

### 验证 / Verify

1. **重启 DSH 实例**（运行中的实例不会自动加载新 bundle）——Restart the DSH instance (running instances do not hot-load bundles):
   ```sh
   pnpm dsh web --port 3080
   ```
2. 浏览器打开 `http://127.0.0.1:3080/score-collab/health`，应返回：
   ```json
   {"ok":true,"name":"@local/dsh-collab-score","version":"0.1.0","workdirRoot":"C:\\Users\\<you>\\.dsh\\collab-score"}
   ```
3. 新建会话时在预设选择里应出现「乐谱协作」；进入后会话内应出现「乐谱」入口（引擎浮层）、agent 具备 `score_*` 工具与 `skill` 工具。

> 首次启动会自动自安装预设到 `$DSH_HOME/.agent-presets/score-collab/`；此后该副本归你所有，可自行编辑（见下文「自定义」）。若想关闭自安装：在 profile 的 `cordis.patch.yml` 给 server 行加 `config: { installPreset: false }`。

---

## 使用 / Usage

1. 新建（或空白）会话，选择预设 **乐谱协作**（score-collab）。
2. 点会话内的「乐谱」按钮弹出引擎浮层（可拖动，✕ 关闭）。
3. 让 agent 建谱：它用 `score_create` 初始化空白谱（钢琴 4/4 单小节）→ `score_edit` 写音符/节奏/奏法 → 引擎自动刷新显示；也可以自己上传 mscz/mscx 到工作区后用 `score_open` 打开。
4. 引擎内直接编辑后点「保存」，改动回写工作区；agent 下一轮 `score_sync` 能看到（`lastUserEdit` 更新）。
5. 面板内可直接播放（MuseAudio WASM + MS Basic 声库）。

双写面覆盖警告：未保存的引擎内改动会被 agent 的 `score_edit` 覆盖。动手前先 `score_sync` 看 `lastUserEdit`；若很新，先提示用户保存。

---

## 自定义 / Customization

### 1. 修改乐谱模式预设（persona / 工具组合） / Edit the preset

预设文件位于（安装后）：`$DSH_HOME/.agent-presets/score-collab/agent.cordis.yml`。源码版本：`preset/score-collab/agent.cordis.yml`。

- **persona 提示词**：文件头部 `persona` 行（`@deepseek-ai/dsh-persona` 的 `config.text`）。全部操作手册、文件格式规范（tpc 五度循环表、Part/Staff 结构、特殊奏法、速度、时值）都在这里。改它 = 改 agent 的行为规范。
- **工具挂载**：文件底部的 `- id: tool-*` 行决定该模式给模型哪些工具。
  - ⚠️ **skill 行不能删**：`web-app` 组合在宿主平面禁用了 `skill-filesystem`/`tool-skill`（“presets own local discovery”），预设必须自己挂这两行（`skill-filesystem` + `tool-skill`）才有 skill 目录与 `skill` 工具。
- **预设元数据**：`preset.yml` 的 `name`/`description` 会显示在预设选择界面。
- 修改后**重启 DSH 实例**才对新会话生效（agent-presets 的 standing mount 按进程缓存）。

### 2. 修改 agent 工具行为 / Change tool behavior

工具实现：`src/score-tools.ts` + `src/bridge/*`（容器编解码、mscx 投影/校验、状态机）。

```sh
pnpm build            # tsc（node + client）+ tsdown 打 client bundle
node scripts/build-release.mjs   # 重新组装 release 包（如需分发）
```

### 3. 修改引擎资产 / Replace engine assets

引擎 web 构建位于 `engine-dist/`：`panel.html`（浮层外壳）、`viewer.html`、`MuseScoreStudio.js/.wasm`（主引擎）、`MuseAudio.js`（播放引擎）、`sound/MS Basic.sf3`（声库）、`distr/`（audio worklet 与 RPC 桥）。

- 换声库：替换 `sound/MS Basic.sf3`（或其他名字），并在 `engine-dist/distr/muapi.js` 的 `DEFAULT_SOUNDFONT` 处改为对应路径（注意 URL 编码：空格 = `%20`）。
- 换引擎版本：跑 `scripts/copy-engine.mjs` 把新的 `build.artifacts` 镜像进来（注意该脚本内含本机绝对路径，换机器请改 `SRC`）。
- 改浮层外壳：直接编辑 `assets/panel.html` 后重新跑 `copy-engine.mjs` 或手动复制到 `engine-dist/panel.html`。
- 引擎资产从 `server.ts` 的 `engineDir` 配置读取（默认 `<pluginRoot>/engine-dist`）。

### 4. 修改空白模板 / Edit the blank template

`score_create` 用 `assets/blank-template.mscx` 作为空白谱（钢琴、4/4、单小节）。想改默认乐器/拍号/调号/小节数：编辑该文件（结构规范见 persona §2.2-2.5：Part 只声明乐器、Staff 顶级平铺、tpc 五度循环）。

### 5. 修改服务端路由与工作区 / Server routes & workdir

`src/server.ts`：
- `workdirRoot`：工作区根目录，默认 `<dshHome>/collab-score`（可通过 profile patch 的 server 行 `config.workdirRoot` 改）。
- `installPreset`：关闭预设自安装。
- `engineDir`：引擎资产目录。
- 路由表：`/score-collab/health`、`/api/state`、`/api/session/<sid>/score`（GET 转 mscz / POST 回写）、`/panel.html`、`/engine/*`。

### 6. 修改浏览器 UI / Browser UI

`src/client/*`：入口（按会话预设门控）、引擎浮层组件（`ScorePanelToggle.tsx`）、文案（`locales.ts`）。改动后 `pnpm build`，浏览器 Ctrl+F5 刷新。

---

## 开发与测试 / Development & Testing

```sh
pnpm install               # 首次安装依赖
pnpm build                 # tsc + tsdown 构建
pnpm test:bridge           # bridge 单测（node:test）
node scripts/test-server.mjs            # 隔离测试：构建 → 隔离 profile 安装 → 起 3180 → 验证 → 停止
node scripts/test-server.mjs --keep     # 保持服务，浏览器冒烟 http://127.0.0.1:3180
node scripts/test-server.mjs --port 3181
```

`test-server.mjs` 的一切都在**独立 DSH_HOME（`.test/home`）+ 独立 profile + 独立端口**上进行，从不读写真实 harness home，从不触碰运行中的正式实例（如 :3080）。验证项：composed 树含本 bundle 行、`/score-collab/health`、client bundle、预设自安装 + 真实 mount、回合状态机端到端、引擎保存回写、引擎静态路由。

### 引擎 WASM 构建（高级，需完整工具链）/ Rebuilding the engine WASM (advanced)

工具链已锁定：emsdk 3.1.50、Qt 6.7.3 `wasm_singlethread`、cmake 4.4.2 + ninja（Python312 Scripts）。构建脚本与链路记录在 `.test/` 与项目 STATUS.md。日常开发**不需要**重编引擎——直接用 `engine-dist/` 现成产物即可。

---

## 许可证 / License

插件整体 **GPL-3.0-only**（`LICENSE`）。引擎资产为独立 GPL 组件（MuseScore 4.x WebAssembly，随附源码可得性说明）；声库 MS Basic 为 MuseScore 官方发布（`engine-dist/sound/MS Basic_License.md` / `_Readme.md`，FluidR3Mono 采样，MIT 条款）。分发时保留各资产随附许可文件，不暗示 MuseScore 官方出品。

---

## 已知限制 / Known Limitations and Deferred Work

- **score_create 是固定空白模板**：钢琴 4/4 单小节；乐器/拍号/调号参数化未做（可在引擎内编辑，或改模板）。
- **引擎与工作区非实时双向同步**：引擎内编辑仅经「保存」按钮回写；agent 的 `score_edit` 会覆盖未保存的引擎改动。
- **无跨会话并发写锁**：回合制下指纹软锁足够；多端同时编辑需真正锁与冲突合并。
- **out-of-tree 包无 HMR**：bundle 在 checkout 之外，`dev:web` HMR 不覆盖；改代码需重新 build + 刷新（或重启测试实例）。
- **预设根被 launcher overlay 覆盖**：bundle 无法经 patch 增加预设根，只能经 `agentPresets.copy()` 自安装到 `$DSH_HOME/.agent-presets`；删除后下次启动会重新自安装（`installPreset: false` 可关）。
- **引擎资产体积**：release 包约 133 MB（含 82 MB `MuseScoreStudio.wasm` + 51 MB `MS Basic.sf3`），是演示版默认取舍。
