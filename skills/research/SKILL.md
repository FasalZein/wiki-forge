---
name: research
description: "Autonomous deep research on any topic. Combines Exa semantic search, Firecrawl web scraping, and AlphaXiv paper analysis into a single research workflow. Use when: research this, find out about, what's the latest on, deep dive into, investigate, analyze the landscape of, compare approaches to, literature review, state of the art, how does X work. Produces a structured research report with citations."
---

# Autonomous Research

Deep research on any topic — fully autonomous. Delegates search and scraping to subagents so the main context stays clean for synthesis.

## When to Use

**Use this skill** when the user needs:
- Deep research on any topic (technical, business, academic, market)
- Literature reviews or state-of-the-art analysis
- Technology landscape comparisons
- Understanding how something works with authoritative sources
- Fact-checked answers backed by primary sources
- Investigation that requires reading multiple sources and synthesizing

**Do NOT use** for:
- Simple factual questions (just use exa answer)
- Scraping a single known URL (just use firecrawl)
- Looking up library docs (just use context7)

---

## Setup

### Dependencies

This skill requires two sibling skills for search and scraping. Install them first:
```bash
npx skills add edxeth/superlight-exa-skill
npx skills add edxeth/superlight-firecrawl-skill
```

### Environment Variables

Set these in your shell profile (`~/.bashrc`, `~/.zshrc`, or equivalent):
```bash
export EXA_API_KEY="your-key"              # Get at: https://dashboard.exa.ai/api-keys
export FIRECRAWL_API_KEY="your-key"        # Get at: https://firecrawl.dev/
# Both support comma-separated keys for rotation: "key1,key2,key3"
```

### Tool Paths

All script paths use shell variables so the skill works on **any machine** regardless of OS or install location.

**Resolve these paths at the start of every research session:**
```bash
# Auto-detect skill install directory (works on macOS, Linux, WSL)
RESEARCH_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)"
SKILLS_DIR="$(dirname "$RESEARCH_DIR")"
EXA="$SKILLS_DIR/exa/scripts/exa.sh"
FIRECRAWL="$SKILLS_DIR/firecrawl/scripts/firecrawl.sh"
ALPHAXIV="$RESEARCH_DIR/scripts/alphaxiv.sh"
```

If auto-detect fails, fall back to the standard install location:
```
~/.claude/skills/exa/scripts/exa.sh
~/.claude/skills/firecrawl/scripts/firecrawl.sh
~/.claude/skills/research/scripts/alphaxiv.sh
```

---

## Architecture: Subagent-Delegated Research

The main model is the **research director** — it scopes, refines, delegates, and synthesizes. It never runs search or scraping tools directly. All tool-heavy work runs in subagents, whose raw output stays in their own context and never enters the main model's window.

```
Main Model (director — refines query, delegates, synthesizes)
│
├─ Phase 1: Scope + refine (main model, no tools)
│   └─ Turn vague requests into precise, search-ready questions
│
├─ Preflight: Resolve tool paths + verify scripts exist (main model, once)
│
├─ Phase 2+3: Research subagents (parallel, tool-equipped)
│   └─ 1 agent per sub-question (or 1 agent total if question is focused)
│   (all raw tool output lives and dies in subagent contexts)
│
├─ Phase 4: Synthesize report (main model — compact findings only)
│
└─ Phase 5: Verify claims (main model)
```

### How many subagents?

Do NOT always split into 3. Match the question:

- **Focused question** ("How does Raft consensus work?") → **1 subagent** is enough. One agent, multiple search strategies, comprehensive findings.
- **Multi-angle question** ("What's the landscape of AI code review tools?") → **2-3 subagents**, one per independent angle (products, technical approaches, user reception).
- **Broad survey** ("State of the art in RAG optimization") → **3-5 subagents**, each covering a distinct subtopic.

The rule: **split only when sub-questions are truly independent** and would benefit from separate search strategies. If they'd all search the same thing, use one agent.

### Preflight: Resolve Paths + Verify Tools

Before spawning any subagent, the main model resolves tool paths **once** and verifies everything works. Pass the resolved absolute paths directly into subagent prompts — never make subagents discover paths themselves.

```bash
# Resolve paths (run once in main model)
EXA="$(find ~/.claude/skills ~/.agents/skills -path "*/exa/scripts/exa.sh" 2>/dev/null | head -1)"
FIRECRAWL="$(find ~/.claude/skills ~/.agents/skills -path "*/firecrawl/scripts/firecrawl.sh" 2>/dev/null | head -1)"
ALPHAXIV="$(find ~/.claude/skills ~/.agents/skills -path "*/research/scripts/alphaxiv.sh" 2>/dev/null | head -1)"

# Verify scripts exist and are executable
test -x "$EXA" && echo "exa: OK" || echo "exa: MISSING"
test -x "$FIRECRAWL" && echo "firecrawl: OK" || echo "firecrawl: MISSING"
test -x "$ALPHAXIV" && echo "alphaxiv: OK" || echo "alphaxiv: MISSING"
```

If any script is missing, stop and tell the user what to install. Do NOT spawn subagents that will waste turns discovering broken paths.

### Spawning Subagents

Your harness determines the spawn method. Pass **resolved absolute paths** in the prompt:

**Claude Code:**
```
Agent(prompt="<research task with resolved paths>", model="sonnet")
```

**Pi Agent:**
```
subagent(name="research-1", task="<research task with resolved paths>", tools="read,bash")
```

**OpenCode:**
```
Task(prompt="<research task with resolved paths>")
```

**If your harness has no subagent tool:** Fall back to running tools directly in the main context. Use fewer searches (5 instead of 10 per strategy) and scrape only top 3-5 sources to manage context size.

---

## Protocol

### Phase 1: Scope and Refine the Research

The main model does this directly — no tools needed. This is the most important phase. A well-scoped question produces better research than more search queries ever will.

1. **Refine the user's request** — Users often ask broad or vague questions. Your job is to sharpen them into precise, search-ready queries BEFORE dispatching any subagent.
   - Vague: "Research WebTransport" → Refined: "What is WebTransport's browser compatibility, who's using it in production, and how does it compare to WebSocket for real-time apps as of 2026?"
   - Vague: "Look into RAG" → Refined: "What are the current best practices for chunking, embedding, and retrieval in RAG pipelines, and which approaches show the best recall/latency trade-offs?"
   - Focused enough already: "How does Raft consensus handle leader election?" → Use as-is, single subagent.

2. **Core question** — One sentence. What exactly are we trying to answer?

3. **Sub-questions** — Only if the topic naturally decomposes into independent angles. A focused question needs 0 sub-questions (one subagent handles it). A broad survey needs 3-5.

4. **Source types needed** — Which matter for this topic:
   - Academic papers (arxiv, research)
   - Technical docs / specs
   - Industry analysis / news
   - Code repositories / implementations
   - Expert blogs / practitioner knowledge
   - Company/product pages

5. **Depth** — Quick scan (3-5 sources) or deep dive (10-20+ sources)

6. **Decide agent count** — Based on how the question decomposes:
   - 1 subagent: focused question, single angle
   - 2-3 subagents: multi-angle question with independent sub-questions
   - 4-5 subagents: broad survey requiring parallel exploration

Do NOT skip scoping. Bad research starts with vague questions passed unrefined to subagents.

---

### Phase 2+3: Research via Subagents

The main model crafts a **specific, narrow prompt** for each subagent. The subagent should never have to interpret what the user meant — that's the main model's job. Each prompt includes:
- The exact question to answer (already refined by the main model)
- Pre-resolved absolute paths to all tools
- Which search strategies to use (not "pick from these 5" — tell it which 2-3 to run)
- The return format

Run subagents **in parallel** when there are multiple.

**Subagent prompt template:**

The main model fills in ALL bracketed fields before dispatching. Never pass variables like `$EXA` — always substitute the resolved absolute path.

```
Research this specific question and return compact findings.

QUESTION: [precise question crafted by main model — not the user's raw words]

SEARCH STRATEGY (run in this order):
1. [exact bash command with resolved path, e.g.: /home/user/.claude/skills/exa/scripts/exa.sh search "WebTransport browser support caniuse 2026" 5]
2. [exact bash command, e.g.: /home/user/.claude/skills/exa/scripts/exa.sh answer "Which browsers support WebTransport as of 2026?"]
3. [exact bash command, e.g.: /home/user/.claude/skills/firecrawl/scripts/firecrawl.sh search "WebTransport browser compatibility" 3]

DEEP READ: From search results, scrape the top 3 most relevant URLs:
  [resolved firecrawl path] scrape "<url>"
  For arxiv papers ONLY: [resolved alphaxiv path] overview "<paper-id>"

TRAIL: After your best source, run:
  [resolved exa path] similar "<best-url>" 5

RETURN FORMAT (compact — this is all the parent model will see):
## Findings: [question]
### Key Claims
- [claim] — source: [Title](URL)
### Contradictions
- [if any]
### Sources (ranked by authority)
1. [Title](URL) — [authority tag] — [one line why]
### Gaps
- [what's missing]
```

**The main model decides the search strategy per subagent.** Don't give subagents a menu of 10 tools — tell each one exactly which 2-3 commands to run based on the source types identified in Phase 1:

| Source type needed | Commands to include in subagent prompt |
|---|---|
| Academic papers | `[exa] search "<query>" 5 "research paper"` + `[alphaxiv] search "<query>" 5` |
| Code / implementations | `[exa] code "<query>"` + `[exa] search "<query>" 5 "github"` |
| Industry / market | `[firecrawl] search "<query>" 5` + `[exa] search "<query>" 5 "company"` |
| News / recent developments | `[exa] search "<query>" 5 "news"` + `[exa] answer "<question>"` |
| Docs / specs | `[firecrawl] map "<docs-url>" 50` + `[firecrawl] scrape "<url>"` |
| General / mixed | `[exa] search "<query>" 5` + `[firecrawl] search "<query>" 3` + `[exa] answer "<question>"` |

---

### Phase 4: Synthesize — Build the Report

The main model now has compact findings from each subagent — no raw search results, no full page scrapes. Synthesize them into the final report.

**Report structure:**

```markdown
# Research: [Core Question]

## TL;DR
[Executive summary answering the core question. MUST be under 100 words. Be direct and opinionated, not hedging.]

## Key Findings

### [Sub-question 1]
[Synthesized answer with inline citations like [1], [2]]

### [Sub-question 2]
[Synthesized answer]

### [Sub-question 3]
[Synthesized answer]

## Landscape / Comparison
[If applicable — table or structured comparison of approaches, tools, methods]

## Open Questions
[What remains unclear or contested across sources]

## Contradictions & Disputes
[MANDATORY section. Collate contradictions from all subagent findings. If all sources agree, state that explicitly and explain why consensus exists.]

## Sources
[1] [Title](URL) — [authority: official-docs|peer-reviewed|industry|blog|forum|code] — [one-line description]
[2] [Title](URL) — [authority: ...] — [one-line description]
...
```

---

### Phase 5: Verify — Cross-Check Claims

Before delivering, verify critical claims:

1. **Contradiction check** — Did any subagents report conflicting information? Note it explicitly.
2. **Recency check** — Are any sources outdated? Flag if the field moves fast.
3. **Authority check** — Are sources authoritative (official docs, peer-reviewed, established practitioners) or random blog posts? Weight accordingly.
4. **Gap check** — Did any subagent report gaps? Is there a sub-question with weak coverage? Say so explicitly rather than guessing.

If gaps are critical, spawn one more targeted subagent to fill them.

---

## Autonomy Rules

1. **Never stop to ask permission between searches.** The user wants research, not a play-by-play. Scope, dispatch subagents, synthesize, deliver.
2. **Follow the trail.** Subagents must run `$EXA similar` on their best source. This is mandatory, not optional.
3. **Diversify sources.** Each subagent should use multiple search strategies. Don't rely on one tool — use exa AND firecrawl.
4. **Prefer primary sources.** Official docs > blog summaries. Research papers > news articles about research papers. Code > descriptions of code.
5. **Note uncertainty.** If sources conflict or you can't verify a claim, say so. Never present uncertain information as fact.
6. **Stay focused.** Follow interesting tangents only if they serve the core question. Research is not browsing.
7. **No minimum source count theater.** Don't pad the report with weak sources just to hit a number. 5 excellent sources beat 15 mediocre ones.

---

## Error Handling

| Problem | Action |
|---------|--------|
| Preflight: script not found | Stop immediately. Tell user which skill to install (`npx skills add ...`). Do NOT spawn subagents. |
| Preflight: API key missing | Stop immediately. Tell user which env var to set. Do NOT spawn subagents. |
| Subagent: tool path fails | Subagent should report the error and return what it has. Do NOT spend turns probing paths — the preflight should have caught this. |
| Subagent tool not available | Fall back to running tools directly. Use fewer searches (5 not 10) to manage context. |
| Exa returns no results | Rephrase query. Try broader terms. Try without category filter. |
| Firecrawl scrape fails | Try one alternate URL format. If that fails, move on. Do NOT retry more than once. |
| AlphaXiv 404 | Try `/abs/` endpoint. If both fail, scrape the arxiv abstract page directly with firecrawl. |
| Rate limited (429) | Scripts auto-retry with key rotation. If all keys exhausted, wait and continue. |
| Topic too broad | Main model should have refined this in Phase 1. If subagent still gets broad results, narrow and re-query once. |
| Topic too niche | Broaden search terms. Try adjacent topics. Use `similar` to find related content from any relevant source you find. |
| Conflicting sources | Report the conflict explicitly. Note which sources are more authoritative and why. |
| Subagent returns thin results | Spawn ONE follow-up subagent with a rephrased question. Do not retry the same query. |

---

## Examples

### Example 1: Vague user request → refined research
**User:** "how do we optimize our data pipeline it's slow"
- **Main model refines:** "What are current best practices for optimizing data pipeline throughput and latency, including batch vs stream processing, partitioning strategies, and common bottlenecks?"
- **Decides:** 2 subagents (architecture patterns vs tooling comparison)
- **Subagent A prompt:** "What are the most effective architectural patterns for high-throughput data pipelines — batch vs micro-batch vs streaming, partitioning strategies, backpressure handling?" + commands: `[exa] search "data pipeline optimization throughput 2026" 5` + `[exa] search "batch vs streaming pipeline performance" 5 "research paper"`
- **Subagent B prompt:** "Compare current data pipeline tools (Kafka, Flink, Spark, Pulsar) on throughput, latency, and operational complexity" + commands: `[firecrawl] search "data pipeline benchmark Kafka Flink Spark 2026" 5` + `[exa] search "stream processing framework comparison" 5`
- Main model: Synthesize into actionable recommendations

### Example 2: Focused question → single subagent
**User:** "How does Raft consensus handle leader election?"
- **Main model:** Question is already precise. No refinement needed. Single angle.
- **Decides:** 1 subagent
- **Subagent prompt:** "How does the Raft consensus algorithm handle leader election, including election timeouts, term numbers, split vote resolution, and pre-vote protocol?" + commands: `[exa] search "Raft consensus leader election algorithm" 5` + `[alphaxiv] search "Raft consensus" 3` + `[exa] answer "How does Raft leader election work?"`
- Main model: Synthesize into technical explanation

### Example 3: Broad survey → multiple subagents
**User:** "what's the deal with AI code review tools"
- **Main model refines:** "What is the current landscape of AI-powered code review tools — which products exist, how do they technically work, and what do practitioners say about their effectiveness?"
- **Decides:** 3 subagents (products, technical approaches, practitioner reception)
- **Subagent A prompt:** "List the major AI code review tools available in 2026 with their pricing, key features, and supported languages" + commands: `[exa] search "AI code review tool" 5 "company"` + `[firecrawl] extract "<product-url>" "product name, pricing, features"`
- **Subagent B prompt:** "What technical approaches do AI code review tools use — LLM-based analysis, static analysis integration, fine-tuned models, or hybrid?" + commands: `[exa] search "AI code review technical architecture LLM" 5` + `[firecrawl] search "how AI code review works" 3`
- **Subagent C prompt:** "What do developers say about AI code review tools — adoption rates, accuracy, false positive rates, real user experiences?" + commands: `[exa] search "AI code review developer experience review" 5 "news"` + `[firecrawl] search "AI code review accuracy false positives" 3`
- Main model: Synthesize into comparison table + analysis

---

## The Test

A good research report:

1. **Answers the question** — The TL;DR directly addresses what was asked
2. **Cites every claim** — No unsourced assertions
3. **Uses primary sources** — Not just summaries of summaries
4. **Notes disagreements** — Sources that conflict are flagged, not hidden
5. **Admits gaps** — Unknown things are stated as unknown
6. **Is original synthesis** — Not copy-paste from any single source
7. **Was autonomous** — Did not stop to ask the user mid-research
8. **Kept context clean** — Used subagents so the main model had room to think

## Local skill maintenance

After editing `skills/*/SKILL.md`, run `bun run sync:local`.
Optionally run `bun run sync:local -- --audit`.
Then restart the agent session.
