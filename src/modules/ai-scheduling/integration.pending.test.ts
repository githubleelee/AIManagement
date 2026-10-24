import { describe, it } from 'vitest'

/** Deliberate TODOs: do not replace real ports, authorization or transactions with mocks to pass AC. */
describe('US12 final integration gates — blocked, not passed', () => {
  it.todo('G1/G2: generates from real #31 port and current #26/#27 data without altering formal plans')
  it.todo('G3: real PM-only actions cover generation/list/detail/decision/audit and 401/403/404')
  it.todo('G3: revocation takes effect before every request and idempotent retry')
  it.todo('G4: persists actual input scope, mode/model/version/requestId and generation time')
  it.todo('G4/G5: confirms the saved proposal without calling the model a second time')
  it.todo('G4/G5: two-task application and successful audit share one real DB transaction')
  it.todo('G4/G5: one invalid task rolls back all changes, separate safe failure evidence remains')
  it.todo('G4/G5: identical request is idempotent, different/concurrent disposition conflicts')
  it.todo('G2/G5: changed task/member/FS/milestone/workload/permission snapshot expires whole proposal')
  it.todo('G5: preserves existing task assignment/progress/acceptance rules after authorized extraction')
  it.todo('G6: browser generation → confirm → actual task/gantt/workload changes → audit')
  it.todo('G7: explicit real API mode and outflow evidence on invented data, never implicit stub fallback')
})
