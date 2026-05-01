import { updateSliceHub } from "./slice-repository";

export async function updateSliceFrontmatter(
  project: string,
  sliceId: string,
  updates: Record<string, unknown>,
  removals: readonly string[],
  vaultRoot: string,
): Promise<void> {
  await updateSliceHub(vaultRoot, project, sliceId, updates, removals);
}
