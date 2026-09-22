import type { Integration } from './types';

class IntegrationRegistry {
  private readonly integrations = new Map<string, Integration>();

  register(integration: Integration): void {
    this.integrations.set(integration.id, integration);
  }

  list(): Integration[] {
    return [...this.integrations.values()];
  }

  get(id: string): Integration | undefined {
    return this.integrations.get(id);
  }

  clear(): void {
    this.integrations.clear();
  }
}

/** Empty in Phase 1 — future integrations register here. */
export const integrationRegistry = new IntegrationRegistry();
