import type { DomainEventInfrastructurePort } from './contracts.js'
import { InMemoryEventRepository } from './in-memory-repository.js'
import { DomainEventService, type DomainEventServiceDependencies } from './service.js'

export type DomainEventFactoryOptions = Omit<DomainEventServiceDependencies, 'repository'> & {
  repository?: DomainEventServiceDependencies['repository']
}

/** Independent implementation factory for B's `src/app.ts` assembly root. */
export function createDomainEventInfrastructure(
  options: DomainEventFactoryOptions,
): DomainEventInfrastructurePort {
  return new DomainEventService({
    ...options,
    repository: options.repository ?? new InMemoryEventRepository(),
  })
}
