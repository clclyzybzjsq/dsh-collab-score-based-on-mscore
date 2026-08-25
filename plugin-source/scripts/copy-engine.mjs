// Copy the finished engine web build (build.artifacts) into the plugin's
// engine-dist directory, which the server half serves at /score-collab/engine/*.
// Run after the wasm link step; idempotent (mirror copy).
import { cpSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'D:/dsh-musescore-plugin/mscz_source_code/MuseScore-4.7.4/MuseScore-4.7.4/build.artifacts'
const DST = 'D:/dsh-musescore-plugin/score-collab/engine-dist'
const PANEL = 'D:/dsh-musescore-plugin/score-collab/assets/panel.html'

const entry = join(SRC, 'MuseScoreStudio.js')
if (!existsSync(entry)) {
  console.error(`engine build missing: ${entry}; run the wasm link first`)
  process.exit(1)
}

mkdirSync(DST, { recursive: true })
// Mirror everything so relative asset paths (distr/, *.wasm, *.data) resolve.
cpSync(SRC, DST, { recursive: true })
console.log(`engine build mirrored: ${SRC} -> ${DST}`)

// The panel shell lives beside the engine assets (server serves it from engineDir).
copyFileSync(PANEL, join(DST, 'panel.html'))
console.log(`panel shell copied: ${PANEL} -> ${join(DST, 'panel.html')}`)