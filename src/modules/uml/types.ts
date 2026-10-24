/** C-owned UML public types; type-only references do not import server code in the web bundle. */
import type { getUmlDiagram, listUmlDiagrams } from './service.js'

export type { UmlContentInput, UmlCreateInput, UmlKind, UmlPatchInput } from './schemas.js'
export type UmlDiagramView = Awaited<ReturnType<typeof getUmlDiagram>>
export type UmlDiagramListResponse = Awaited<ReturnType<typeof listUmlDiagrams>>
export type UmlDiagramSummary = UmlDiagramListResponse['items'][number]
