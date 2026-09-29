import { useState } from 'react'
import { apiFetch } from '../api'

type Member = { id: string; displayName: string }
type Sensitivity = { isSensitive: boolean; visibleMemberIds: string[] }

/**
 * 嵌入任务详情页；调用方只在 PM 视图挂载，并提供当前成员列表与初始敏感标记。
 *
 * 契约 I-8 只提供写端点（`PUT /tasks/:taskId/sensitivity`），**没有读取名单的端点**，
 * 因此可见成员列表无法预加载：以空名单开始，保存时全量覆盖原名单。
 */
export function SensitivityEditor(props: {
  kind: 'story' | 'task'
  objectId: string
  members: Member[]
  initialIsSensitive: boolean
}) {
  const [current, setCurrent] = useState<Sensitivity>({
    isSensitive: props.initialIsSensitive,
    visibleMemberIds: [],
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const kind = props.kind === 'story' ? 'stories' : 'tasks'

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const result = await apiFetch<Sensitivity>(`/${kind}/${encodeURIComponent(props.objectId)}/sensitivity`, {
        method: 'PUT',
        body: JSON.stringify(current),
      })
      setCurrent(result)
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
        <input type="checkbox" checked={current.isSensitive} onChange={event => setCurrent({ ...current, isSensitive: event.target.checked })} />
        敏感资料
      </label>
      {current.isSensitive && (
        <fieldset>
          <legend>指定可见成员（项目经理始终可见）</legend>
          {props.members.map(member => (
            <label key={member.id} style={{ display: 'block' }}>
              <input type="checkbox" checked={current.visibleMemberIds.includes(member.id)} onChange={event => {
                setCurrent(previous => ({ ...previous, visibleMemberIds: event.target.checked
                  ? [...new Set([...previous.visibleMemberIds, member.id])]
                  : previous.visibleMemberIds.filter(id => id !== member.id) }))
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
