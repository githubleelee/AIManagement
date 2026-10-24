# #35 / AC4：TaskSection 最小锚点补丁申请（未应用）

## 范围与归属

- 基线：main `aa692880a80159af619c7a319c0310c853220949`。
- 按 #24 comment-6262477410 第 7 项，`web/src/pages/task/TaskSection.tsx` 由 B 单写。本文件只是精确 diff 提案，C 未修改该文件。
- URL：`/projects/:projectId/requirements/:storyId#task-<encodeURIComponent(taskId)>`。
- 不新增任务详情路由、查询参数或 API；storyId/taskId 必须来自服务端已鉴权的关联响应，不能由用户提供任意跳转 URL。
- 仅当已加载的可见任务数组确有该 id 时才定位；未知 hash 不请求任务详情、不提示“隐藏任务存在”。

## 精确候选 diff

```diff
--- a/web/src/pages/task/TaskSection.tsx
+++ b/web/src/pages/task/TaskSection.tsx
@@
 import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
+import { useLocation } from 'react-router-dom'
@@
 export default function TaskSection({ storyId, projectId, isPm, onCountChange }: Props) {
+  const { hash } = useLocation()
@@
   useEffect(() => {
     void reload()
   }, [reload])
+
+  // US-15: wait for visible rows; hash is navigation only, never an authorization hint.
+  useEffect(() => {
+    if (!hash.startsWith('#task-')) return
+    let taskId: string
+    try { taskId = decodeURIComponent(hash.slice(6)) } catch { return }
+    if (!tasks?.some(task => task.id === taskId)) return
+    const row = document.getElementById(`task-${taskId}`)
+    row?.scrollIntoView({ block: 'center' })
+    row?.focus({ preventScroll: true })
+  }, [tasks, hash])
@@
-              <tr key={t.id}>
+              <tr key={t.id} id={`task-${t.id}`} tabIndex={-1}>
```

## 影响与验证

1. 不修改任务 CRUD、状态表单、敏感编辑器、附件组件挂载点或 D 的 Props；不增加/删除表格单元。
2. 只增 React Router hook、定位 effect、行 id 与可聚焦属性。实际位置可能随 B/D 新提交移动，B 应在单写窗口核对最新 diff。
3. 验证异步加载后定位、同页切换 hash、刷新深链、浏览器前进/后退、无/非法 hash、不可见 taskId 不定位也不额外请求。
4. 通过浏览器点击真实 UML 关联后精确抵达目标行，才计入 AC4；当前独立编辑器不代替此项。
5. 请 B 回复是否采用、单写窗口及挂载就绪 SHA；若不采用，请给出等价精确定位方式，C 不直接代改。
