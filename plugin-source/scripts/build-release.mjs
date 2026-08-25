#!/usr/bin/env node
/**
 * build-release.mjs — 组装自包含、可分发的一键安装 release 包。
 *
 * 输出：`release/dsh-collab-score/`（一个完整的 pnpm 可安装插件目录）。
 * 本脚本只写 score-collab 仓库内的 `release/` 目录：对主目录
 * （$DSH_HOME / profile / .agent-presets）零写入，不触碰任何运行中的实例。
 *
 * release 包形态：
 * - 去掉 `link:` 开发依赖（那是 checkout 专用路径）；运行时 `@deepseek-ai/*`
 *   由宿主 `healProfilesModuleFallback` 兜底解析（$DSH_HOME/profiles/node_modules
 *   符号链接闭包），与现有 3080 实例同一机制，因此可分发到任意装了 DSH 的机器。
 * - lib/ 去掉 sourcemap；engine-dist 去掉未被任何 JS 引用的备选声库
 *   FluidR3Mono_GM.sf3（唯一被引用的是 sound/MS%20Basic.sf3，见 distr/muapi.js
 *   DEFAULT_SOUNDFONT）。
 * - package.json 按可分发形态重写（files 白名单覆盖 engine-dist 大资产）。
 *
 * 用法：
 *   node scripts/build-release.mjs              # 默认产物 release/dsh-collab-score
 *   node scripts/build-release.mjs --out D:/x   # 指定输出目录
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argOut = process.argv.indexOf('--out')
const OUT = resolve(argOut > 0 ? process.argv[argOut + 1] : join(ROOT, 'release', 'dsh-collab-score'))
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** 统一为斜杠，便于跨平台后缀判断。 */
const norm = (p) => p.replaceAll('\\', '/')

/** 复制目录，带过滤：去 sourcemap、去未引用备选声库。 */
function copyDir(src, dst) {
  cpSync(src, dst, {
    recursive: true,
    filter: (from) => {
      const f = norm(from)
      if (f.endsWith('.map')) return false
      if (f.includes('/engine-dist/sound/FluidR3Mono_GM.sf3')) return false
      return true
    },
  })
}

/** 目录总字节数（递归）。 */
function dirBytes(dir) {
  let total = 0
  for (const entry of readdirRecursive(dir)) total += statSync(entry).size
  return total
}

function readdirRecursive(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) readdirRecursive(full, acc)
    else acc.push(full)
  }
  return acc
}

// ── 1. 清空并重建产物目录 ───────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// ── 2. 复制运行时目录 ───────────────────────────────────────────────────────
for (const dir of ['lib', 'assets', 'preset', 'engine-dist']) {
  copyDir(join(ROOT, dir), join(OUT, dir))
}

// ── 3. 复制元数据文件 ───────────────────────────────────────────────────────
for (const file of ['cordis.patch.yml', 'LICENSE', 'README.md']) {
  const src = join(ROOT, file)
  if (!existsSync(src)) {
    console.warn(`[build-release] 警告：缺少 ${file}，跳过`)
    continue
  }
  cpSync(src, join(OUT, file))
}

// ── 4. 写可分发 package.json ───────────────────────────────────────────────
const releasePkg = {
  name: PKG.name,
  version: PKG.version,
  description: PKG.description,
  type: 'module',
  main: 'lib/index.js',
  types: 'lib/index.d.ts',
  exports: PKG.exports,
  dsh: PKG.dsh,
  files: [
    'lib',
    'assets',
    'preset',
    'engine-dist',
    'cordis.patch.yml',
    'LICENSE',
    'README.md',
  ],
  license: PKG.license,
  engines: PKG.engines,
}
writeFileSync(join(OUT, 'package.json'), JSON.stringify(releasePkg, null, 2) + '\n')

// ── 5. 汇总 ─────────────────────────────────────────────────────────────────
const totalMb = (dirBytes(OUT) / 1024 / 1024).toFixed(1)
console.log(`[build-release] 产物就绪: ${OUT}`)
console.log(`[build-release] 大小: ${totalMb} MB`)
console.log(`[build-release] 安装: pnpm dsh plugin --profile web add file:${norm(OUT)}`)
