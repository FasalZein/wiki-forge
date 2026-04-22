export function firstMeaningfulLine(markdown: string, prefix?: RegExp): string | null {
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("> [!")) continue;
    if (prefix) {
      if (!prefix.test(line)) continue;
      return line.replace(prefix, "").trim();
    }
    if (/^[-*]\s+/u.test(line)) return line.replace(/^[-*]\s+/u, "").trim();
    if (/^\d+\.\s+/u.test(line)) return line.replace(/^\d+\.\s+/u, "").trim();
    if (!line.startsWith("#")) return line;
  }
  return null;
}

export function firstSectionLine(markdown: string, headings: string[]): string | null {
  for (const heading of headings) {
    const lines = markdown.split("\n");
    let inSection = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!inSection) {
        if (line.toLowerCase() === `## ${heading}`.toLowerCase()) inSection = true;
        continue;
      }
      if (/^##\s+/u.test(line)) break;
      if (!line || line.startsWith("> [!")) continue;
      if (/^[-*]\s+/u.test(line)) return line.replace(/^[-*]\s+/u, "").trim();
      if (/^\d+\.\s+/u.test(line)) return line.replace(/^\d+\.\s+/u, "").trim();
      return line;
    }
  }
  return null;
}

export function summarizePlan(hubContent: string, planContent: string, sourcePaths: string[]): string {
  const title = firstMeaningfulLine(hubContent, /^#\s+/u) ?? firstMeaningfulLine(planContent, /^#\s+/u) ?? "Untitled slice";
  const scope = firstSectionLine(planContent, ["Scope", "Task", "Vertical Slice"]);
  const targetFromPlan = firstSectionLine(planContent, ["Target Structure", "Target", "Vertical Slice"]);
  let target: string | null;
  if (targetFromPlan) {
    target = targetFromPlan;
  } else if (sourcePaths.length) {
    target = sourcePaths.join(", ");
  } else {
    target = null;
  }
  const acceptance = firstSectionLine(planContent, ["Acceptance Criteria", "Green Criteria", "Verification Commands"]);
  return [title, scope ? `Scope: ${scope}` : null, target ? `Target: ${target}` : null, acceptance ? `Acceptance: ${acceptance}` : null]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
