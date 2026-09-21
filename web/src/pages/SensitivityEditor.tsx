import { useState } from 'react'
import { apiFetch } from '../api'

type Member = { id: string; displayName: string }
type Sensitivity = { isSensitive: boolean; visibleMemberIds: string[] }

/** 嵌入故事或任务详情页；调用方只在 PM 视图挂载，并提供当前成员列表。 */
export function SensitivityEditor(props: {
  kind: 'story' | 'task'
  objectId: string
  members: Member[]
  initial: Sensitivity
}) {
  const [sensitive, setSensitive] = useState(props.initial.isSensitive)
  const [selected, setSelected] = useState(props.initial.visibleMemberIds)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function save() {
    setSaving(true)
    setMessage('')
    const kind = props.kind === 'story' ? 'stories' : 'tasks'
    try {
      const result = await apiFetch<Sensitivity>(`/${kind}/${encodeURIComponent(props.objectId)}/sensitivity`, {
        method: 'PUT',
        body: JSON.stringify({ isSensitive: sensitive, visibleMemberIds: selected }),
      })
      setSelected(result.visibleMemberIds)
      setSensitive(result.isSensitive)
      setMessage('已保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="敏感资料可见范围">
      <label>
        <input type="checkbox" checked={sensitive} onChange={event => setSensitive(event.target.checked)} />
        敏感资料
      </label>
      {sensitive && (
        <fieldset>
          <legend>指定可见成员（项目经理始终可见）</legend>
          {props.members.map(member => (
            <label key={member.id} style={{ display: 'block' }}>
              <input type="checkbox" checked={selected.includes(member.id)} onChange={event => {
                setSelected(current => event.target.checked
                  ? [...new Set([...current, member.id])]
                  : current.filter(id => id !== member.id))
              }} />
              {member.displayName}
            </label>
          ))}
        </fieldset>
      )}
      <button type="button" disabled={saving} onClick={() => void save()}>
        {saving ? '保存中…' : '保存可见范围'}
      </button>
      <span role="status">{message}</span>
    </section>
  )
}
