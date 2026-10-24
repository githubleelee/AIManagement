// Run only an explicitly supplied verification command; stream UTF-8 logs and stop its own process tree.
import { spawn, execFile } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import path from 'node:path'
const [label, seconds, command, ...args] = process.argv.slice(2)
if (!label || !/^[-a-z0-9]+$/i.test(label) || !Number.isFinite(Number(seconds)) || Number(seconds) <= 0 || !command) {
  throw new Error('Usage: node run-bounded.mjs LABEL SECONDS COMMAND [ARGS...]')
}
const dir = path.resolve('docs/role-c/issue-35/evidence')
mkdirSync(dir, { recursive: true })
const log = createWriteStream(path.join(dir, `${label}.txt`), { encoding: 'utf8' })
const start = Date.now()
function emit(text) { process.stdout.write(text); log.write(text) }
emit(`START ${new Date().toISOString()} limit=${seconds}s\n`)
const child = spawn(command === 'node' ? process.execPath : command, args, {
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
child.stdout.on('data', value => emit(value.toString('utf8')))
child.stderr.on('data', value => emit(value.toString('utf8')))
let timedOut = false
const timer = setTimeout(() => {
  timedOut = true
  emit(`TIMEOUT after ${seconds}s; stopping owned process tree pid=${child.pid}\n`)
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
  else child.kill('SIGKILL')
}, Number(seconds) * 1000)
child.on('error', error => { emit(`SPAWN ERROR ${error.message}\n`); process.exitCode = 1 })
child.on('close', (code, signal) => {
  clearTimeout(timer)
  const exit = timedOut ? 124 : code ?? 1
  emit(`END exit=${exit} signal=${signal ?? 'none'} elapsed=${((Date.now() - start) / 1000).toFixed(2)}s\n`)
  log.end()
  process.exitCode = exit
})
