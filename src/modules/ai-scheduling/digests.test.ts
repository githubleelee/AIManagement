import { describe, expect, it } from 'vitest'
import { canonicalAiJson, canonicalAiJsonDigest } from '../../shared/ai.js'
import { sourceDigest } from './source.js'
import { orderedChanges } from './workflow.js'

/** Reproducible ordering evidence for B's soft-hyphen counterexample. */
describe('scheduling digest protocols and UTF-16 ordering', () => {
  const ids = ['a\u00adb', 'ab']
  it('distinguishes soft hyphen from absence even where locale collation equates them', () => {
    expect(sourceDigest({ id: ids[0] })).not.toBe(sourceDigest({ id: ids[1] }))
    expect(canonicalAiJsonDigest({ id: ids[0] })).not.toBe(canonicalAiJsonDigest({ id: ids[1] }))
  })
  it('normalizes source sets independently of query/array order', () => {
    const values = ids.map((id) => ({ id }))
    expect(sourceDigest({ tasks: values })).toBe(sourceDigest({ tasks: [...values].reverse() }))
  })
  it('sorts disposition date sets with exact UTF-16 comparison, not localeCompare', () => {
    const values = ids.map((taskId) => ({ taskId, planStart: '2026-10-25', planEnd: '2026-10-26' }))
    expect(orderedChanges(values).map((v) => v.taskId)).toEqual(['ab', 'a\u00adb'])
    expect(canonicalAiJsonDigest(orderedChanges(values))).toBe(canonicalAiJsonDigest(orderedChanges([...values].reverse())))
  })
  it('keeps the shared algorithm array-ordered and object keys UTF-16 ordered', () => {
    expect(canonicalAiJson({ ['a\u00adb']: 1, ab: 2 })).toBe('{"ab":2,"a\u00adb":1}')
    expect(canonicalAiJsonDigest(ids)).not.toBe(canonicalAiJsonDigest([...ids].reverse()))
  })
})
