# Wiki/Forge Artifact Routing

Use this when an agent is unsure where a piece of project knowledge belongs.

| Artifact | Canonical place | Command / skill | Notes |
| --- | --- | --- | --- |
| External evidence and source-backed notes | `projects/<project>/research/` | `/research`, then `wiki research file <topic> --project <project> <title>` | Use global `research/` only for reusable cross-project topics. |
| Grill-with-docs context / glossary | `projects/<project>/architecture/domain-language.md` | `/grill-with-docs`, then `wiki forge grill record <project> --context-file <path>` | Do not create repo-root `CONTEXT.md` unless the project explicitly keeps context in-repo. |
| ADR-style decisions | `projects/<project>/decisions.md` | `/grill-with-docs`, then `wiki forge grill record <project> --decision-title <title> --decision-file <path> --tag <PRD-or-slice-id>` | Entries should be numbered `ADR-0001`, `ADR-0002`, etc. Tags let Forge detect decisionRefs. |
| PRD/spec content | Forge PRD records under `projects/<project>/forge/prds/` | `/write-a-prd`, `wiki forge plan <project> <feature-name>` | Forge planning owns artifact creation. Do not hand-write generated Forge records unless instructed by the planning packet. |
| Slice plans and test plans | Forge slice records under `projects/<project>/forge/slices/` | `/prd-to-slices`, `wiki forge plan <project> <feature-name>` | Slices are tracer-bullet vertical cuts and must include verification strategy before `/tdd`. |
| TDD evidence | Forge evidence records | `/tdd`, `wiki forge tdd cycle ...` | Red and green must share at least one same `--test` path; separate red/green records must use the same command. |
| Targeted verification evidence | Forge evidence records | `wiki forge evidence <project> <slice> verify --command <cmd>` | Full-suite output alone is not the slice close gate. |
| Review evidence | Forge evidence records | `wiki forge review record ...` | Required unless Forge policy explicitly disables review. |
| Architecture reviews | `projects/<project>/architecture/reviews/architecture-review-<YYYY-MM-DD>.md` | `/improve-codebase-architecture` | Accepted refactors become new Forge feature/PRD/slices. |
| Handovers | `projects/<project>/forge/handovers/` | `wiki handover` / `wiki agent-handover` | Handovers are lifecycle boundaries, not scratch summaries. |
| Freeform project memory | `projects/<project>/memory/` | `wiki note`, `wiki log` | Use for durable notes that are not lifecycle gates. |
| External issues | External tracker | Optional after wiki/Forge artifacts exist | External issues should point to public/user-visible work, not duplicate internal wiki state. |

Rule of thumb: if it changes workflow truth, record it through `wiki forge ...`; if it is durable knowledge but not workflow truth, file it through `wiki ...`; if it is only temporary scratch, keep it out of the vault.
