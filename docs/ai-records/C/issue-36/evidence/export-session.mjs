/**
 * 从 pi 原始会话 JSONL 导出「可见内容」脱敏记录。
 *
 * 口径与 C-I35 既有 followup 导出一致：
 *  - 只保留 user / assistant / toolResult 的可见文本、工具调用名与参数、文本工具结果；
 *  - 排除 system/developer、thinking、custom（含自动审核 context）、context_edit、内部元数据；
 *  - 保持源顺序与源 entry id/timestamp，不重排、不补造；
 *  - 脱敏：本机用户名、演示口令、token/key 形态、代理地址。
 *
 * 用法：node export-session.mjs <输入 jsonl> <输出 jsonl>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, output] = process.argv
if (!input || !output) throw new Error('usage: export-session.mjs <input.jsonl> <output.jsonl>')

const LOCAL_USER = '陆禹畅'
const TOOL_ARG_LIMIT = 2000
const TOOL_RESULT_LIMIT = 3000

/** 保守脱敏：宁可多遮，不靠猜测还原。 */
function redact(text) {
  if (typeof text !== 'string') return text
  return text
    .split(LOCAL_USER).join('[LOCAL_USER]')
    // GitHub / 通用 token 形态
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
    // Authorization: Bearer <value>
    .replace(/(Bearer\s+)([A-Za-z0-9._\-]{12,})/gi, '$1[REDACTED_TOKEN]')
    // 演示口令（既有记录约定）
    .replace(/Test@12345/g, '[REDACTED_DEMO_PASSWORD]')
    // 明确的代理地址形态（含账号密码时）
    .replace(/https?:\/\/[^\s"'@]+:[^\s"'@]+@/g, 'http://[REDACTED_CREDENTIALS]@')
}

const clip = (text, limit) =>
  typeof text === 'string' && text.length > limit
    ? `${text.slice(0, limit)}\n…[导出时截断，原文 ${text.length} 字符]`
    : text

const lines = readFileSync(input, 'utf8').split('\n').filter(Boolean)
const out = []
const stats = { user: 0, assistant: 0, toolResult: 0, skippedCustom: 0, skippedThinking: 0, skippedEnvSnapshot: 0 }

/** 内部元数据：自动审核上下文里的环境快照（含环境变量名/本机路径），不属可见交互。 */
const hasEnvSnapshot = text =>
  typeof text === 'string' && (text.includes('redactedEnvironmentVariables') || text.includes('"environment":{'))

for (const line of lines) {
  let e
  try { e = JSON.parse(line) } catch { continue }
  if (e.type !== 'message') {
    if (e.type === 'custom') stats.skippedCustom += 1
    continue
  }
  const role = e.message?.role
  const content = e.message?.content
  if (!Array.isArray(content)) continue

  const parts = []
  for (const part of content) {
    if (part?.type === 'thinking' || part?.type === 'reasoning') { stats.skippedThinking += 1; continue }
    const raw = part?.type === 'toolCall' ? JSON.stringify(part.arguments ?? {}) : part?.text ?? part?.content
    if (typeof raw === 'string' && hasEnvSnapshot(raw)) { stats.skippedEnvSnapshot += 1; continue }
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      parts.push({ type: 'text', text: redact(part.text) })
    } else if (part?.type === 'toolCall') {
      parts.push({
        type: 'toolCall',
        name: part.name,
        arguments: clip(redact(JSON.stringify(part.arguments ?? {})), TOOL_ARG_LIMIT),
      })
    } else if (part?.type === 'toolResult' || role === 'toolResult') {
      const text = typeof part?.text === 'string' ? part.text
        : typeof part?.content === 'string' ? part.content
        : Array.isArray(part?.content)
          ? part.content.filter(c => c?.type === 'text').map(c => c.text).join('\n')
          : ''
      if (text.trim()) parts.push({ type: 'text', text: clip(redact(text), TOOL_RESULT_LIMIT) })
    }
  }
  if (!parts.length) continue
  if (role === 'user') stats.user += 1
  else if (role === 'assistant') stats.assistant += 1
  else if (role === 'toolResult') stats.toolResult += 1
  else continue

  out.push({
    id: e.id,
    timestamp: e.timestamp,
    role,
    toolName: e.message?.toolName ?? null,
    content: parts,
  })
}

writeFileSync(output, `${out.map(r => JSON.stringify(r)).join('\n')}\n`)
console.log(JSON.stringify({ input, output, exported: out.length, stats }, null, 2))
