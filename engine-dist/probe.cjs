const M = require('./MuseScoreStudio.js')
console.log('factory type:', typeof M, 'keys:', Object.keys(M))
const factory = typeof M === 'function' ? M : M.default || M.MuseScoreStudio_entry
console.log('entry type:', typeof factory)
const instance = factory({
  print: (...a) => console.log('[print]', ...a),
  printErr: (...a) => console.error('[err]', ...a),
})
instance
  .then(() => console.log('=== INSTANTIATION OK ==='))
  .catch(e => {
    console.error('=== ERROR ===', e && e.message)
    if (e && e.stack) console.error(e.stack.split('\n').slice(0, 10).join('\n'))
  })
setTimeout(() => process.exit(0), 25000)