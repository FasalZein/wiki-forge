---
managed_by: wiki-forge
protocol_version: 1
project: wiki-forge
scope: root
applies_to: .
---
<!-- wiki-forge:agent-protocol:start -->
# Agent Protocol

> Managed by wiki-forge. Keep local repo-specific notes below the managed block.

Scope: repo root

Use `/forge` for non-trivial implementation work.
Use `/wiki` for retrieval, refresh, drift, verification, and closeout.

## Wiki Protocol

Before starting slice work:
- `wiki start-slice wiki-forge <slice-id> --agent <name> --repo <path>`

During work:
- `wiki checkpoint wiki-forge --repo <path>`
- `wiki lint-repo wiki-forge --repo <path>`

Before completion:
- `wiki verify-slice wiki-forge <slice-id> --repo <path>`
- `wiki closeout wiki-forge --repo <path> --base <rev>`
- `wiki close-slice wiki-forge <slice-id> --repo <path> --base <rev>`

<!-- wiki-forge:agent-protocol:end -->
