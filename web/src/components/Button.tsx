import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** 通用按钮。variant=ghost 为次要操作。 */
export default function Button({
  variant = 'primary',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
  children: ReactNode
}) {
  return (
    <button className={variant === 'ghost' ? 'ghost' : undefined} {...rest}>
      {children}
    </button>
  )
}
