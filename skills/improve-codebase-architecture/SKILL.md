---
name: improve-codebase-architecture
description: >
  Explore a codebase to surface architectural friction, find deepening
  opportunities, and turn the strongest candidates into trackable refactor work.
  Use when the user wants to improve architecture, find refactoring
  opportunities, consolidate tightly-coupled modules, or make a codebase more
  AI-navigable. Findings are filed into the wiki vault and accepted refactors
  become features/PRDs/slices through `/forge` instead of ad-hoc issues.
---

# Improve Codebase Architecture

Explore a codebase like an AI would, surface architectural friction, discover
opportunities for improving testability, and propose module-deepening refactors.
File the review into the wiki vault so decisions are durable, then turn any
accepted refactor into a tracked feature + PRD + slices through `/forge`.

A **deep module** (John Ousterhout, *A Philosophy of Software Design*) has a
small interface hiding a large implementation. Deep modules are more testable,
more AI-navigable, and let you test at the boundary instead of inside.

## When to run

- **Cadence**: run at least once a week, or after a surge of development
  (finishing a PRD, shipping a batch of slices, closing a feature).
- **Position in the forge chain**: Architecture improvement runs at cadence boundaries (end of PRD or batch). Predecessor: `wiki forge close`. Successor: `/desloppify`. See forge SKILL.md for the full pipeline.
- **Do not run mid-slice.** Architecture review is a separate work item from
  slice implementation — if you find something worth doing, `/forge` it.

## Prerequisites

- Project is onboarded into the wiki: `wiki scaffold-project <project>` has
  run, `_summary.md` has `repo:` set, and modules/features/PRDs/slices exist
  in the usual layout.
- `/research`, `/grill-me`, `/write-a-prd`, `/prd-to-slices`, `/tdd`, `/wiki`
  are available — we chain them for accepted refactors.

## Process

### 1. Orient

Read the project summary and recent activity so the exploration is grounded in
actual work, not cold static analysis.

```bash
wiki resume <project> --repo <path> --base <rev>
wiki feature-status <project>
wiki discover <project> --repo <path> --tree
```

Note:
- The current active slice and backlog shape (so you don't propose refactors
  that conflict with in-flight work)
- Modules that recently changed (`wiki refresh-from-git <project> --repo <path>
  --base <rev>` — high-churn modules are prime deepening candidates)
- Modules flagged as placeholder-heavy or unbound (a quality signal on their
  own)

### 2. Explore the codebase

Use the **Explore** subagent (`subagent_type: "Explore"`) to navigate the
codebase naturally. **Do NOT follow rigid heuristics.** Explore organically and
note where you experience friction:

- Where does understanding one concept require bouncing between many small files?
- Where are modules so shallow that the interface is nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called?
- Where do tightly-coupled modules create integration risk in the seams between them?
- Which parts of the codebase are untested, or hard to test?

**The friction you encounter IS the signal.** If three short files have to be
read together to answer one question, that's a shallow-module cluster. If a
unit test couldn't catch a real bug because the bug lives in how callers wire
modules together, that's a boundary problem.

Keep notes keyed by file path — the Step-7 wiki artifact needs them.

### 3. Present candidates

Present a numbered list of deepening opportunities. For each candidate, show:

- **Cluster**: the concrete modules / files involved (full repo-relative paths)
- **Why they're coupled**: shared types, call patterns, co-ownership of a concept
- **Dependency category**: see `REFERENCE.md`
- **Test impact**: what existing tests would be replaced by boundary tests
- **Overlap with wiki bindings**: if the cluster maps to an existing
  `modules/<name>/spec.md` or a set of `source_paths`, say so — the refactor
  should update those bindings.

Do NOT propose interfaces yet. Ask the user: **"Which of these would you like
to explore?"**

If the user picks **none**, still file the review note in Step 7 — recording
rejected candidates is valuable signal for next time.

### 4. Frame the problem space

Before spawning parallel design agents, write a user-facing explanation of the
problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would need to rely on (classify per `REFERENCE.md`)
- A rough illustrative code sketch to make the constraints concrete — this is
  not a proposal, just a way to ground the constraints
- The existing wiki pages that cover this cluster (so the user can see what
  docs need to move)

Show this to the user, then immediately proceed to Step 5. The user reads and
thinks about the problem while the sub-agents work in parallel.

### 5. Design multiple interfaces (parallel)

Spawn 3+ sub-agents in parallel using the Agent tool (`subagent_type:
"general-purpose"`, `model: "sonnet"`). Each must produce a **radically different** interface for
the deepened module. Always pass `model: "sonnet"` — sub-agents do not inherit the parent model.

Give each agent a separate technical brief (file paths, coupling details,
dependency category, what's being hidden). This brief is independent of the
user-facing explanation in Step 4.

- **Agent 1**: "Minimize the interface — aim for 1–3 entry points max."
- **Agent 2**: "Maximize flexibility — support many use cases and extension."
- **Agent 3**: "Optimize for the most common caller — make the default case trivial."
- **Agent 4** (if deps are remote-owned or external): "Design around the
  ports & adapters pattern for cross-boundary dependencies."

Each sub-agent outputs:

1. Interface signature (types, methods, params)
2. Usage example showing how callers use it
3. What complexity it hides internally
4. Dependency strategy (how deps are handled — see `REFERENCE.md`)
5. Trade-offs

**Always use `model: "sonnet"` for these agents unless the user has overridden
the default.** Present designs sequentially, then compare them in prose.

After comparing, give **your own recommendation** — which design is strongest
and why. If elements from different designs would combine well, propose a
hybrid. Be opinionated — the user wants a strong read, not just a menu.

### 6. User picks an interface (or accepts recommendation)

### 7. File the review into the wiki

Instead of immediately creating a GitHub issue, file the architecture review
as a durable wiki research note. This keeps decisions traceable alongside
the rest of the project's second-brain state.

```bash
wiki research file <project> "architecture review <YYYY-MM-DD>"
```

Then edit the generated file (at `research/projects/<project>/architecture-review-<YYYY-MM-DD>.md`)
to fill the template in `REFERENCE.md`. Set frontmatter:

```yaml
type: research
topic: projects/<project>
source_paths:
  - <every repo-relative path in the chosen cluster>
```

Link it from impacted wiki pages: `wiki bind <project> <research-page> <source-path>`
is not used (research has its own path shape), but you can cross-link via the
module's `spec.md` and the `architecture/` zone. Use Obsidian wikilinks.

### 8. Turn accepted refactors into forge work

Any candidate the user accepts becomes a **first-class refactor feature**
through `/forge` — not a hidden rewrite. This preserves the "no unmaintainable
code as the cost of speed" gate.

```bash
wiki forge plan <project> "deepen <cluster> module" --prd-name "<chosen interface> refactor"
# Then /prd-to-slices to split the migration into tracer-bullet slices.
```

The research note filed in Step 7 becomes the feature's `Prior Research` link.

If the project also uses external issue tracking (e.g., the repo pushes
refactors to GitHub Issues), create a companion issue **after** the feature+PRD
exist, and link back to the wiki feature/PRD pages:

```bash
gh issue create --title "Refactor: deepen <cluster>" --body "$(cat <<'EOF'
Tracks wiki FEAT-<nnn> / PRD-<nnn>.

See architecture review: research/projects/<project>/architecture-review-<YYYY-MM-DD>.md
EOF
)"
```

Do not dual-author the RFC in both places — the wiki note is the source of
truth; the issue is a pointer.

### 9. Close the loop

After the refactor slices ship and the feature is `computed_status = complete`,
the next run of this skill will observe the cluster is no longer shallow.
That's the feedback signal — architectural friction in a module should drop
after a successful deepening pass.

## Hard rules

1. **Do not propose interfaces in Step 3.** Present candidates first, get a
   pick, then design. Designing too early collapses the option space.
2. **Always design 3+ interfaces in parallel.** One interface is a suggestion,
   three is a comparison, and comparisons produce better decisions.
3. **Replace tests, don't layer them.** Old unit tests on shallow modules are
   waste once boundary tests exist. Delete them as part of the refactor slice.
4. **File the review in the wiki before (or instead of) creating a GH issue.**
   The wiki is the second brain; external trackers are pointers.
5. **Do not silently merge architectural changes into an unrelated slice.**
   Accepted refactors get their own feature+PRD+slices through `/forge`.
6. **Match existing style** even when you'd design differently. The goal is
   deeper modules, not uniform taste.

## Outputs

- A numbered list of deepening candidates (even if none are accepted).
- For each accepted candidate: a filed research note under
  `research/projects/<project>/architecture-review-<YYYY-MM-DD>.md`.
- For each accepted candidate: a new `FEAT-<nnn>` + `PRD-<nnn>` (and, if the
  user wants external tracking, a linked GitHub issue).
- No direct code changes from this skill. Code changes happen in the resulting
  slices via `/tdd`.

See `REFERENCE.md` for dependency-category definitions, the testing strategy,
and the review-note template.
