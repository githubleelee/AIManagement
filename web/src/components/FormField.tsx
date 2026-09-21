import type { ReactNode } from 'react'

/** 表单字段：统一 label + 控件的排版。 */
export default function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

