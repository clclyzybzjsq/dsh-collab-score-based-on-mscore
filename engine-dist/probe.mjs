// Local node instantiation probe for the engine wasm (no browser needed to
// surface import-table/runtime errors from the MODULARIZE factory).
const M = require('./MuseScoreStudio.js')
console.log('factory type:', typeof M)
const factory = M({
  print: (...a) => console.log('[print]', ...a),
  printErr: (...a) => console.error('[err]', ...a),
})
factory
  .then(() => console.log('=== INSTANTIATION OK ==='))
  .catch(e => {
    console.error('=== ERROR ===', e && e.message)
    if (e && e.stack) console.error(e.stack.split('\n').slice(0, 10).join('\n'))
  })
setTimeout(() => process.exit(0), 20000)