import type { SkillCandidateTarget } from "./types";

type ParsedFrontmatter = {
  present: boolean;
  valid: boolean;
  keys: string[];
  body: string;
};

export type SkillCandidateValidationResult = {
  ok: boolean;
  errors: string[];
};

function normalizeText(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith("---\n")) {
    return { present: false, valid: true, keys: [], body: raw };
  }

  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/u);
  if (!match) {
    return { present: true, valid: false, keys: [], body: raw };
  }

  const keys = match[1]
    .split("\n")
    .map((line) => line.match(/^([A-Za-z0-9_-]+):/u)?.[1] ?? null)
    .filter((key): key is string => Boolean(key));

  return {
    present: true,
    valid: true,
    keys,
    body: raw.slice(match[0].length),
  };
}

function collectHeadings(raw: string) {
  return normalizeText(raw)
    .split("\n")
    .map((line) => line.match(/^(#{1,6})\s+(.+)$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ level: match[1].length, text: match[2].trim() }));
}

function countMeaningfulLines(raw: string) {
  return normalizeText(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

export function validateSkillCandidateRewrite(input: {
  currentSkill: string;
  revisedSkill: string;
  target?: SkillCandidateTarget;
}): SkillCandidateValidationResult {
  const errors: string[] = [];
  const currentSkill = normalizeText(input.currentSkill);
  const revisedSkill = normalizeText(input.revisedSkill);

  if (!revisedSkill.trim()) {
    return { ok: false, errors: ["revised skill is empty"] };
  }

  const currentFrontmatter = parseFrontmatter(currentSkill);
  const revisedFrontmatter = parseFrontmatter(revisedSkill);

  if (currentFrontmatter.present) {
    if (!revisedFrontmatter.present) {
      errors.push("missing YAML frontmatter block");
    } else if (!revisedFrontmatter.valid) {
      errors.push("malformed YAML frontmatter block");
    } else {
      const missingKeys = currentFrontmatter.keys.filter((key) => !revisedFrontmatter.keys.includes(key));
      if (missingKeys.length) {
        errors.push(`missing frontmatter keys: ${missingKeys.join(", ")}`);
      }
    }
  }

  const currentHeadings = collectHeadings(currentFrontmatter.body);
  const revisedHeadings = collectHeadings(revisedFrontmatter.body);
  const currentH1 = currentHeadings.find((heading) => heading.level === 1);
  if (currentH1 && !revisedHeadings.some((heading) => heading.level === 1 && heading.text === currentH1.text)) {
    errors.push(`missing primary heading: # ${currentH1.text}`);
  }

  const currentSectionCount = currentHeadings.filter((heading) => heading.level === 2).length;
  const revisedSectionCount = revisedHeadings.filter((heading) => heading.level === 2).length;
  if (currentSectionCount >= 2 && revisedSectionCount < 2) {
    errors.push("lost section structure");
  }

  const currentMeaningfulLines = countMeaningfulLines(currentFrontmatter.body);
  const revisedMeaningfulLines = countMeaningfulLines(revisedFrontmatter.body);
  const minimumLineCount = Math.max(8, Math.ceil(currentMeaningfulLines * 0.2));
  if (revisedMeaningfulLines < minimumLineCount) {
    errors.push(`collapsed below minimum line count (${revisedMeaningfulLines} < ${minimumLineCount})`);
  }

  if (input.target) {
    for (const phrase of input.target.mustInclude ?? []) {
      if (!revisedSkill.includes(phrase)) errors.push(`missing required phrase: ${phrase}`);
    }
    for (const phrase of input.target.mustAvoid ?? []) {
      if (revisedSkill.includes(phrase)) errors.push(`contains forbidden phrase: ${phrase}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function assertValidSkillCandidateRewrite(input: {
  currentSkill: string;
  revisedSkill: string;
  target?: SkillCandidateTarget;
}) {
  const result = validateSkillCandidateRewrite(input);
  if (!result.ok) {
    throw new Error(`invalid skill candidate rewrite: ${result.errors.join("; ")}`);
  }
}
