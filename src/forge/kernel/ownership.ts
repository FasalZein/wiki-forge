export type OwnershipGrant = {
  readonly agentId: string;
  readonly files: readonly string[];
  readonly slices: readonly string[];
};

export type OwnershipOverlap = {
  readonly kind: "file-overlap" | "slice-overlap";
  readonly resource: string;
  readonly agentIds: readonly string[];
};

export function detectOwnershipOverlap(grants: readonly OwnershipGrant[]): readonly OwnershipOverlap[] {
  return [
    ...detectDuplicateResources(grants, "files", "file-overlap"),
    ...detectDuplicateResources(grants, "slices", "slice-overlap"),
  ];
}

function detectDuplicateResources(
  grants: readonly OwnershipGrant[],
  key: "files" | "slices",
  kind: OwnershipOverlap["kind"],
): readonly OwnershipOverlap[] {
  const ownersByResource = new Map<string, string[]>();
  for (const grant of grants) {
    for (const resource of grant[key]) {
      const owners = ownersByResource.get(resource) ?? [];
      owners.push(grant.agentId);
      ownersByResource.set(resource, owners);
    }
  }

  return [...ownersByResource.entries()]
    .filter(([, agentIds]) => agentIds.length > 1)
    .map(([resource, agentIds]) => ({ kind, resource, agentIds }));
}
