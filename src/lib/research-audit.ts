
import { join, relative } from "node:path";
import { STALE_UNVERIFIED_DAYS, VAULT_ROOT } from "../constants";
import { safeMatter } from "../cli-shared";
import { exists, readText } from "./fs";
import { normalizePath, stripMarkdownExtension, walkMarkdown } from "./vault";
import { normalizeInfluencedBy, normalizeTopicPath, rawRoot, researchRoot, researchTopicDir } from "./research";

export type ResearchAuditResult = {
  topic?: string;
  root: string;
  counts: {
    pages: number;
    deadLinks: number;
    missingInfluence: number;
    invalidInfluence: number;
    missingSources: number;
    staleUnverified: number;
  };
  deadLinks: Array<{ page: string; url: string; status: number | null; message: string }>;
  missingInfluence: string[];
  invalidInfluence: Array<{ page: string; target: string }>;
  missingSources: string[];
  staleUnverified: string[];
};

export async function collectResearchAudit(topic?: string): Promise<ResearchAuditResult> {
  const normalizedTopic = topic ? normalizeTopicPath(topic) : undefined;
  const root = normalizedTopic ? researchTopicDir(normalizedTopic) : researchRoot();
  const pages = (await walkMarkdown(root)).filter((file) => !file.endsWith("/_overview.md")).sort();
  const deadLinks: Array<{ page: string; url: string; status: number | null; message: string }> = [];
  const missingInfluence: string[] = [];
  const invalidInfluence: Array<{ page: string; target: string }> = [];
  const missingSources: string[] = [];
  const staleUnverified: string[] = [];
  const checkedUrls = new Map<string, Promise<{ status: number | null; message: string }>>();

  for (const file of pages) {
    const page = normalizePath(relative(VAULT_ROOT, file));
    const raw = await readText(file);
    const parsed = safeMatter(page, raw, { silent: true });
    if (!parsed) continue;

    if (!Array.isArray(parsed.data.sources) || parsed.data.sources.length === 0) missingSources.push(page);
    if ((parsed.data.verification_level ?? "unverified") === "unverified" && isOlderThan(parsed.data.updated, STALE_UNVERIFIED_DAYS)) staleUnverified.push(page);

    const influencedBy = normalizeInfluencedBy(parsed.data.influenced_by);
    if (influencedBy.length === 0) missingInfluence.push(page);
    else {
      for (const target of influencedBy) {
        if (!await vaultTargetExists(target)) invalidInfluence.push({ page, target });
      }
    }

    const urls = await extractAuditUrls(parsed.data.sources);
    for (const url of urls) {
      if (!checkedUrls.has(url)) checkedUrls.set(url, checkUrl(url));
    }
    for (const url of urls) {
      const result = await checkedUrls.get(url)!;
      if (result.status !== null && result.status < 400) continue;
      if (result.status === null && result.message === "ok") continue;
      deadLinks.push({ page, url, ...result });
    }
  }

  return {
    topic: normalizedTopic,
    root: relative(VAULT_ROOT, root) || "research",
    counts: {
      pages: pages.length,
      deadLinks: deadLinks.length,
      missingInfluence: missingInfluence.length,
      invalidInfluence: invalidInfluence.length,
      missingSources: missingSources.length,
      staleUnverified: staleUnverified.length,
    },
    deadLinks,
    missingInfluence,
    invalidInfluence,
    missingSources,
    staleUnverified,
  };
}

async function extractAuditUrls(sources: unknown) {
  if (!Array.isArray(sources)) return [] as string[];
  const urls = new Set<string>();
  for (const entry of sources) {
    if (!entry || typeof entry !== "object") continue;
    const data = entry as Record<string, unknown>;
    if (typeof data.url === "string" && /^https?:\/\//iu.test(data.url)) urls.add(data.url);
    if (typeof data.raw === "string") {
      const rawPath = join(VAULT_ROOT, `${stripMarkdownExtension(data.raw)}.md`);
      if (!await exists(rawPath)) continue;
      const rawParsed = safeMatter(normalizePath(relative(VAULT_ROOT, rawPath)), await readText(rawPath), { silent: true });
      const sourceUrl = rawParsed?.data.source_url;
      if (typeof sourceUrl === "string" && /^https?:\/\//iu.test(sourceUrl)) urls.add(sourceUrl);
    }
  }
  return [...urls];
}

async function checkUrl(url: string) {
  const proc = Bun.spawn(["curl", "-L", "-I", "-sS", "--max-time", "2", "-o", "/dev/null", "-w", "%{http_code}", url], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode === 0) {
    const rawStatus = stdout.trim();
    const status = Number.parseInt(rawStatus || "0", 10);
    return { status: Number.isFinite(status) ? status : null, message: status >= 200 && status < 400 ? "ok" : `HTTP ${rawStatus || "000"}` };
  }
  const message = stderr.trim() || "request failed";
  return { status: null, message };
}

async function vaultTargetExists(target: string) {
  return exists(join(VAULT_ROOT, `${target}.md`));
}

function isOlderThan(value: unknown, days: number) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return Date.now() - parsed.getTime() > days * 24 * 60 * 60 * 1000;
}
