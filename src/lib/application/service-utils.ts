export interface ServiceDependencies {
  now: () => string;
  createId: () => string;
}

export const defaultServiceDependencies: ServiceDependencies = {
  now: () => new Date().toISOString(),
  createId: () => globalThis.crypto.randomUUID()
};

export function resolveDependencies(
  overrides: Partial<ServiceDependencies> = {}
): ServiceDependencies {
  return { ...defaultServiceDependencies, ...overrides };
}
