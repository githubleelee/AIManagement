import { spawn, execFile } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import path from 'node:path'
const [label, seconds, command, ...args] = process.argv.slice(2)
if (!/^[-a-z0-9]+$/i.test(label ?? '') || !(Number(seconds) > 0) || !command) throw new Error('Usage: LABEL SECONDS COMMAND [ARGS...]')
const dir = path.resolve('docs/role-c/issue-36/evidence')
mkdirSync(dir, { recursive: true })
const log = createWriteStream(path.join(dir, `${label}.txt`))
const started = Date.now()
const emit = value => { process.stdout.write(value); log.write(value) }
emit(`START ${new Date().toISOString()} limit=${seconds}s\n`)
const child = spawn(command === 'node' ? process.execPath : command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
child.stdout.on('data', emit); child.stderr.on('data', emit)
let timedOut = false
const timer = setTimeout(() => {
  timedOut = true; emit(`TIMEOUT after ${seconds}s; stopping owned tree pid=${child.pid}\n`)
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
  else child.kill('SIGKILL')
}, Number(seconds) * 1000)
child.on('error', error => { emit(`SPAWN ERROR ${error.message}\n`); process.exitCode = 1 })
child.on('close', (code, signal) => {
  clearTimeout(timer)
  const exit = timedOut ? 124 : code ?? 1
  emit(`END exit=${exit} signal=${signal ?? 'none'} elapsed=${((Date.now() - started) / 1000).toFixed(2)}s\n`)
  log.end(); process.exitCode = exit
})
