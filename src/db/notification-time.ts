/**
 * #34 通知运行时 —— 时区与时间工具（Asia/Shanghai，UTC+8 无夏令时）。
 *
 * 依据 `DECISIONS.md` `notifications.public-integration-and-scheduling`：
 *   - `task.overdue`：planEnd 次日 00:00 Asia/Shanghai 仍非 CLOSED；
 *   - `milestone.due`：dueDate 当日 09:00 Asia/Shanghai；
 *   - 定时事件 `occurredAt` 必须为**条件成立时间**（不是扫描时刻）。
 *
 * 上海自 1991 年起不再使用夏令时，固定 +08:00，故用固定偏移量计算（无需 tz 数据库）。
 * 存储层仍是 ISO 8601 UTC（`toISOString()`）。
 */
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 某时刻对应的上海自然日 `'YYYY-MM-DD'`。 */
export function shanghaiDay(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

/** `'YYYY-MM-DD'` 加减自然日。 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** planEnd 的「次日 00:00 Asia/Shanghai」= 逾期条件成立时间。 */
export function shanghaiNextMidnight(dateStr: string): Date {
  return new Date(`${addDays(dateStr, 1)}T00:00:00+08:00`)
}

/** 某上海自然日的指定时刻（如 `'09:00'`）。 */
export function shanghaiTimeOnDay(dateStr: string, time: string): Date {
  return new Date(`${dateStr}T${time}:00+08:00`)
}
