# score-collab 源码分支内容 / Source Branch Contents

本目录是 **@local/dsh-collab-score**（DSH 乐谱协作插件）的 GPL-3.0 源码分发内容，供开独立分支提交使用。
This directory holds the GPL-3.0 source distribution for the score-collab plugin, for a dedicated source branch.

```
source-branch/
├── README.md                 # 本文件：清单与合规说明
├── plugin-source/            # 插件本体源码（可直接 pnpm build）
└── engine-patches/           # 引擎源码修改（相对 MuseScore 4.7.4 官方源码树的补丁文件）
```

---

## 一、插件本体源码 / Plugin source (`plugin-source/`)

这是插件的完整 TypeScript 源码与构建配置，`pnpm install && pnpm build` 即可产出 `lib/`。
This is the plugin's full TypeScript source and build config.

| 路径 | 说明 |
|---|---|
| `src/server.ts` | `/score-collab/*` 路由 + 预设自安装（health/api/state/score 读写/pendingLoad 桥 + mscs↔mscz 动态转换） |
| `src/score-tools.ts` | `score_sync / score_view / score_create / score_open / score_edit / score_commit` 六工具 |
| `src/bridge/` | 容器（mscz↔mscs 编解码）+ mscx（良构/烟雾/投影+diff）+ 状态机 + notify |
| `src/client/` | 浏览器半身：入口（按预设门控）+ 引擎浮层 + 文案 |
| `src/invariant.ts` | 运行时不变式 |
| `preset/score-collab/` | 「乐谱协作」预设（agent.cordis.yml 334 行，含 skill 挂载行） |
| `assets/` | blank-template.mscx（score_create 空白模板） |
| `scripts/` | build-release.mjs（打包脚本）/ test-server.mjs（隔离测试）/ copy-engine.mjs / build-wasm.sh |
| `test/` | bridge 单测（node:test） |
| 根级 | package.json / cordis.patch.yml / tsconfig*.json / tsdown.config.ts / LICENSE |

> 运行时 `@deepseek-ai/*` 依赖由 DSH 宿主 `healProfilesModuleFallback` 兜底解析，无需 npm registry。

---

## 二、引擎源码修改 / Engine patches (`engine-patches/`)

`engine-patches/` 内含 **MuseScore 4.7.4 官方源码树中被本插件修改的全部文件**（按相对路径保留目录结构，共 67 个文件）。引擎本身是独立 GPL 组件，官方源码在此获取：

- 官方仓库：<https://github.com/musescore/MuseScore>
- 本插件基于版本：**MuseScore 4.7.4**（tag `v4.7.4`）

**合规要点**：引擎 wasm 产物（`engine-dist/`）是上述官方源码经本目录 patch 修改后编译所得；GPL 要求修改版源码可获取，本目录即满足。构建产物内已随附官方 `LICENSE` 与源码可得性说明。

### patch 总览（按子系统）

#### 1. Web app shell（`src/web/appshell/`）
- **IStartupScenario 签名冲突**（错误链 G）：桌面版与 web 版 `runOnSplashScreen()` 虚函数签名不一致 → wasm call_indirect 崩溃。web 版改为 `void` 空实现（splash 在 HTML 层，Qt 侧无需）。
- **QML import 缺失**：`src/playback/qml/.../internal/` 下 16 个文件补 `import MuseScore.Playback 1.0`（SoundFlagPopup/MuseSoundsParams 等加载失败）。
- **菜单 stub**：web appshell 菜单模型补全（`appmenumodel.cpp`、`AppMenuBar.qml`）。
- **notationpagemodel**：web 页面模型补全（`notationpagemodel.cpp/.h`）。

#### 2. GuiApp 启动（`src/app/`）
- **窗口透明**（错误链 H）：wasm 分支 `setOpacity(0.01)` → `setOpacity(1.0)`（自建 web 构建无 HTML splash，0.01 导致白屏）。
- **`[QMLDBG]` 打点**：setupNewContext 六步打点（component.create/runOnSplashScreen/window cast/setOpacity/setVisible/runAfterSplashScreen），demo 版保留。
- **导出函数**：`exported_functions.cmake` / `webapi_export.cpp` 声明 `_main/_malloc/_free/_load/_startAudioProcessing/_addSoundFont`。
- **qmlstaticplugins**：静态 QML 插件注册表调整。
- **appfactory / main.cpp**：web 启动路径适配。

#### 3. MuseAudio 播放引擎（`src/web/audioengine/` + `src/framework/audio/`）
- **CMakeLists.txt**：`include(GetPlatformInfo)`（OS_IS_WASM）+ Qt include 白名单（QtCore/QtGui，不能 GLOB 全部 Qt* 目录——Windows 命令行超长）+ 直链 `libQt6Core.a/libQt6BundledPcre2.a/libQt6BundledZLIB.a`（不能用 find_package，需 QT_HOST_PATH）。
- **soundfontrepository.h**：实现类多继承 `async::Asyncable`（`promise.onResolve` 需要 `const Asyncable*`）。
- **audiotypes.h**：`RESOURCE_TYPE_MAP` 裸用 QString → `#ifdef NO_QT_SUPPORT` 分支用 `String::fromAscii`。
- **webaudioengine.cpp**：`EngineController` 构造补 `modularity::globalCtx()`；**`process()` 每帧调 `async::processMessages()` 泵送 kors_async 队列**（AsyncByPromise 的 resolve 依赖队列泵送，单线程 worklet 无泵送则死锁）。
- **audioengine.cpp**：wasm 下 QuickOperation 去锁直接执行（单线程模型下 scoped_lock 与 execOperation 的 lock 同线程互等死锁）。
- **sequenceplayer.cpp**：wasm 下跳过 readyToPlay 等待。
- **webrpcchannel / webaudiochannel / webaudiodriver**：web 音频 RPC 通道适配。

#### 4. QML 类型注册（`src/app/qmlstaticplugins.cpp` + 全局 `*_qmltyperegistrations.cpp`）
- `QMetaType::fromType<Q_NAMESPACE>()` 对 namespace 报错 → 删除紧跟同名 qmlRegisterNamespaceAndRevisions 的 fromType 行；ui 模块注册文件补 `view/iconcodes.h`/`foreign.h` include（6.7 registrar 漏收）。

#### 5. 构建系统（`SetupConfigure.cmake` / `buildscripts/cmake/`）
- **GetPlatformInfo.cmake**：支持 em++.bat/.exe 匹配（Windows 下 emsdk）。
- **SetupQt6.cmake**：Qt 6.7.3 wasm_singlethread 适配（旁有 `.orig-qt68` 备份对照）。
- **SetupBuildEnvironment.cmake**：工具链环境适配。
- **SetupConfigure.cmake**：链接 flags 覆盖式导出（EXPORTED_FUNCTIONS/EXPORTED_RUNTIME_METHODS）、`DISABLE_EXCEPTION_CATCHING=1`、`ALLOW_MEMORY_GROWTH`、`ASYNCIFY_IMPORTS`、`STACK_SIZE=5MB`、`INITIAL_MEMORY=50MB`、`MAXIMUM_MEMORY=4GB`、移除 `-Wl,--no-gc-sections`（保住 QQmlModuleRegistration 但导致 call_indirect 命中 null 项）。

#### 6. 浏览器侧（`src/web/appjs/`）
- **viewer.html**：`[viewer]` onLoaded 打点 + `domReport`（onLoaded/after-create/t+2s/t+5s 输出 viewport/#screen/canvas）。
- **audiodriver.js**：把 `MuseAudio.js` + `audio_worklet_processor.js` 拼接为单 blob 作 AudioWorklet 模块加载。
- **muimpl.js**：web API 桥实现。

#### 7. engraving API（`src/engraving/api/v1/`）
- **qmlpluginapi.cpp / util.cpp/.h**：API 适配（补全 4.7.4 与 web 构建的编译面）。

---

## 三、构建指引 / Build guide

### 引擎 WASM（高级，需完整工具链）

工具链锁定：emsdk 3.1.50、Qt 6.7.3 `wasm_singlethread`、cmake 4.4.2 + ninja（Python312 Scripts）。

```bash
# 1) 获取官方源码（与 engine-patches/ 同版本）
git clone --branch v4.7.4 https://github.com/musescore/MuseScore.git
# 2) 把 engine-patches/ 内文件按相对路径覆盖到源码树对应位置
# 3) 配置与构建（摘要；完整命令见 STATUS.md 与 .test/run-wasm-build.mjs）
cmake -S . -B D:/b -G Ninja -DCMAKE_TOOLCHAIN_FILE=<emsdk>/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake ...
cmake --build D:/b -j 4
# 4) 产物镜像进插件：scripts/copy-engine.mjs
```

### 插件本体

```sh
pnpm install
pnpm build                 # tsc + tsdown
node scripts/build-release.mjs    # 组装可分发包
```

---

## 四、许可证 / License

- 插件本体：**GPL-3.0-only**（`plugin-source/LICENSE`）。
- 引擎：MuseScore 4.x 官方源码（GPL-3.0），本目录 `engine-patches/` 即修改版源码；声库 MS Basic（`engine-dist/sound/MS Basic_License.md`）为 FluidR3Mono 采样（MIT 条款）。
- 分发保留各资产随附许可文件，不暗示 MuseScore 官方出品。
