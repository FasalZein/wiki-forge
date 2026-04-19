export const SLICE_VERTICAL_STEP_PLACEHOLDER = "(fill in during TDD)";
export const DEFAULT_SLICE_GREEN_CRITERIA = [
  "- [ ] All red tests pass",
  "- [ ] No regressions in existing test suite",
] as const;
export const DEFAULT_SLICE_REFACTOR_CHECKS = [
  "- [ ] confirm no regressions in adjacent code paths",
] as const;

export function hasSliceDocScaffoldPlaceholders(specKind: unknown, body: string): boolean {
  const normalizedKind = typeof specKind === "string" ? specKind.trim().toLowerCase() : "";
  if (normalizedKind === "plan") return planHasScaffoldPlaceholders(body);
  if (normalizedKind === "test-plan") return testPlanHasScaffoldPlaceholders(body);
  return false;
}

function planHasScaffoldPlaceholders(markdown: string) {
  const verticalSlice = extractSection(markdown, "Vertical Slice");
  const acceptanceCriteria = extractSection(markdown, "Acceptance Criteria");
  return verticalSlice.includes(SLICE_VERTICAL_STEP_PLACEHOLDER) || hasGenericImplementationPlaceholder(acceptanceCriteria);
}

function testPlanHasScaffoldPlaceholders(markdown: string) {
  const redTests = extractSection(markdown, "Red Tests");
  return hasGenericImplementationPlaceholder(redTests);
}

function hasGenericImplementationPlaceholder(markdown: string) {
  return /-\s*\[\s\]\s*implement requirements from\s+/iu.test(markdown);
}

function extractSection(markdown: string, heading: string) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const headingMatch = new RegExp(`^## ${escapeRegex(heading)}\\n`, "mu").exec(normalized);
  if (!headingMatch) return "";
  const remainder = normalized.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = /^##\s/m.exec(remainder);
  return remainder.slice(0, nextHeadingMatch?.index ?? remainder.length).trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
