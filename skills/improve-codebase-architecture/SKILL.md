---
name: improve-codebase-architecture
description: >
  Explore a codebase to surface architectural friction, find deepening
  opportunities, and turn the strongest candidates into trackable refactor work.
  Use when the user wants to improve architecture, find refactoring
  opportunities, consolidate tightly-coupled modules, or make a codebase more
  testable and AI-navigable. Findings are filed into the wiki vault and accepted
  refactors become features/PRDs/slices through `/forge` instead of ad-hoc edits.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This repo version keeps Matt Pocock's architecture language while enforcing wiki-forge workflow discipline: architecture reviews are filed into the wiki, and accepted refactors become tracked `/forge` work instead of hidden code changes.

## Architecture language

Use the vocabulary in [LANGUAGE.md](LANGUAGE.md) exactly. Consistent language is the point — don't drift into "component," "service," "API," or "boundary."

Core terms:

- **Module** — anything with an interface and an implementation.
- **Interface** — everything a caller must know to use the module: types, invariants, ordering, error modes, config, and performance characteristics.
- **Implementation** — the code inside the module.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place.
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge, and verification concentrated in one place.

Principles:

- **The deletion test**: if deleting the module makes complexity vanish, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam.
- **One adapter = hypothetical seam. Two adapters = real seam.** Don't introduce a seam unless something actually varies across it.
- **Replace tests, don't layer them.** Old tests on shallow modules should disappear once boundary tests exist at the deepened module's interface.

See [DEEPENING.md](DEEPENING.md) for dependency categories and testing strategy. See [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md) for the parallel design pattern. See [REFERENCE.md](REFERENCE.md) for wiki-forge-specific review templates and external issue pointers.

## When to run

- **Cadence**: run at least once a week, or after a surge of development (finishing a PRD, shipping a batch of slices, closing a feature).
- **Position in the forge chain**: architecture improvement runs at cadence boundaries. It is not part of arbitrary mid-slice implementation.
- **Do not run mid-slice.** Architecture review is a separate work item from slice implementation. If you find something worth doing, `/forge` it.

## Prerequisites

- Project is onboarded into the wiki: `wiki scaffold-project <project>` has run, `_summary.md` has `repo:` set, and modules/features/PRDs/slices exist in the usual layout.
- `/research`, `/domain-model`, `/write-a-prd`, `/prd-to-slices`, `/tdd`, `/wiki`, and `/forge` are available — we chain them for accepted refactors.
- For wiki-forge-managed projects, prefer wiki-native domain language (`projects/<project>/architecture/domain-language.md` and `projects/<project>/decisions.md`) over repo-root `CONTEXT.md` / `docs/adr/`. If a non-wiki project has `CONTEXT.md` or ADRs, read them too.

## Process

### 1. Orient

Read the project summary and recent activity so the exploration is grounded in actual work, not cold static analysis.

```bash
wiki resume <project> --repo <path> --base <rev>
wiki feature-status <project>
wiki discover <project> --repo <path> --tree
```

Also read, when present:

- `projects/<project>/architecture/domain-language.md`
- `projects/<project>/decisions.md`
- related module specs under `projects/<project>/modules/`
- related PRDs/slices under `projects/<project>/specs/`
- `CONTEXT.md` / `CONTEXT-MAP.md` and `docs/adr/` for non-wiki or hybrid projects

Note:

- The current active slice and backlog shape, so you don't propose refactors that conflict with in-flight work.
- Modules that recently changed (`wiki refresh-from-git <project> --repo <path> --base <rev>`). High-churn modules are prime deepening candidates.
- Modules flagged as placeholder-heavy, stale, unbound, or repeatedly touched.

### 2. Explore the codebase

Use an Explore/scout subagent when available, or explore directly if the task is small. Do **not** follow rigid heuristics. Explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how callers wire them together?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow. Would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

Keep notes keyed by file path — the Step-7 wiki artifact needs them.

### 3. Present candidates

Present a numbered list of deepening opportunities. For each candidate, show:

- **Cluster**: the concrete modules / files involved (full repo-relative paths)
- **Problem**: why the current architecture is causing friction
- **Why they're coupled**: shared types, call patterns, co-ownership of a concept
- **Dependency category**: see [DEEPENING.md](DEEPENING.md)
- **Test impact**: what existing tests would be replaced by interface tests
- **Wiki binding impact**: existing `modules/<name>/spec.md`, `source_paths`, PRDs, slices, or architecture notes that would need updates
- **Benefits**: expressed in terms of locality and leverage

Use wiki-native domain language plus [LANGUAGE.md](LANGUAGE.md) vocabulary. If the domain calls something a "Slice hub," say "the Slice hub module" — not "the task service."

Do **not** propose interfaces yet. Ask the user: **"Which of these would you like to explore?"**

If the user picks none, still file the review note in Step 7 — rejected candidates are useful signal for next time.

### 4. Frame the problem space

Before spawning parallel design agents, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would need to rely on, classified per [DEEPENING.md](DEEPENING.md)
- A rough illustrative code sketch to make the constraints concrete — this is not a proposal, just a way to ground the constraints
- The existing wiki pages that cover this cluster, so the user can see what docs need to move

Show this to the user, then immediately proceed to Step 5. The user reads and thinks about the problem while the sub-agents work in parallel.

### 5. Design multiple interfaces in parallel

Use the pattern in [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md). Spawn 3+ sub-agents in parallel when available. Each must produce a **radically different** interface for the deepened module.

Give each agent a separate technical brief (file paths, coupling details, dependency category, what's being hidden). This brief is independent of the user-facing explanation in Step 4.

- **Agent 1**: "Minimize the interface — aim for 1–3 entry points max. Maximise leverage per entry point."
- **Agent 2**: "Maximise flexibility — support many use cases and extension."
- **Agent 3**: "Optimise for the most common caller — make the default case trivial."
- **Agent 4** (if deps are remote-owned or external): "Design around ports & adapters for cross-seam dependencies."

Each sub-agent outputs:

1. Interface signature (types, methods, params, invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What complexity it hides internally
4. Dependency strategy and adapters
5. Trade-offs

Present designs sequentially, then compare them in prose. Give **your own recommendation** — which design is strongest and why. If elements from different designs would combine well, propose a hybrid.

### 6. User picks an interface (or accepts recommendation)

Capture the decision and the rejected alternatives. The decision must be durable enough that future architecture reviews do not re-litigate the same cluster.

### 7. File the review into the wiki

File the architecture review as durable wiki project knowledge under:

```bash
projects/<project>/architecture/reviews/architecture-review-<YYYY-MM-DD>.md
```

Fill the template in [REFERENCE.md](REFERENCE.md). Set frontmatter:

```yaml
type: architecture
project: <project>
spec_kind: architecture
source_paths:
  - <every repo-relative path in the chosen cluster>
```

Link it from impacted wiki pages via the module's `spec.md`, related PRDs, and the `architecture/` zone. Use Obsidian wikilinks.

### 8. Turn accepted refactors into forge work

Any candidate the user accepts becomes a **first-class refactor feature** through `/forge` — not a hidden rewrite. This preserves the "no unmaintainable code as the cost of speed" gate.

```bash
wiki forge plan <project> "deepen <cluster> module" --prd-name "<chosen interface> refactor"
# Then /prd-to-slices to split the migration into tracer-bullet slices.
```

The architecture review filed in Step 7 becomes a cross-linked supporting note for the feature and PRD. If the refactor also depends on raw research or source evidence, file that separately under `research/<topic>/...`.

If the project also uses external issue tracking, create a companion issue **after** the feature+PRD exist, and link back to the wiki feature/PRD pages. Do not dual-author the RFC in both places — the wiki note is the source of truth; the issue is a pointer.

### 9. Close the loop

After the refactor slices ship and the feature is `computed_status = complete`, the next run of this skill should observe that the cluster is no longer shallow. That's the feedback signal — architectural friction in a module should drop after a successful deepening pass.

## Hard rules

1. **Do not propose interfaces in Step 3.** Present candidates first, get a pick, then design. Designing too early collapses the option space.
2. **Always design 3+ interfaces in parallel** when interface design begins. One interface is a suggestion, three is a comparison, and comparisons produce better decisions.
3. **Replace tests, don't layer them.** Old unit tests on shallow modules are waste once interface tests exist. Delete them as part of the refactor slice.
4. **File the review in the wiki before (or instead of) creating an external issue.** The wiki is the second brain; external trackers are pointers.
5. **Do not silently merge architectural changes into an unrelated slice.** Accepted refactors get their own feature+PRD+slices through `/forge`.
6. **Match existing style** even when you'd design differently. The goal is deeper modules, not uniform taste.
7. **No direct code changes from this skill.** Code changes happen in the resulting slices via `/tdd`.

## Outputs

- A numbered list of deepening candidates, even if none are accepted.
- For each accepted candidate: a filed architecture review under `projects/<project>/architecture/reviews/architecture-review-<YYYY-MM-DD>.md`.
- For each accepted candidate: a new `FEAT-<nnn>` + `PRD-<nnn>` and slices via `/prd-to-slices`.
- Optional external issue pointer only after the wiki feature/PRD exists.

## Local skill maintenance

After editing `skills/*/SKILL.md`, run `bun run sync:local`.
Optionally run `bun run sync:local -- --audit`.
Then restart the agent session.
