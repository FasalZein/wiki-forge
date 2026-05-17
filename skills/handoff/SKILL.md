---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save it to a path produced by `mktemp -t handoff-XXXXXX.md` (read the file before you write to it).

Suggest the skills to be used, if any, by the next session.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## Wiki/Forge adapter

For wiki-forge projects, handoff is implemented by the existing Wiki handover system. Do not create an ad-hoc temporary markdown file unless the user is outside a configured wiki-forge project or explicitly asks for a scratch handoff.

Use `wiki handover` or `wiki agent-handover` to write the durable record under the configured Knowledge vault and print the copy/paste prompt for the next session. Resolve the vault through `KNOWLEDGE_VAULT_ROOT`, `wiki config --effective --repo <path>`, or `wiki init <project> --repo <path>`; do not write durable handoffs into the code repository unless the repository is explicitly the Knowledge vault.

A good handoff is a context decoder, not a transcript replacement. It should let a fresh agent continue operations without reloading the whole prior conversation. Include only:

- the current objective and next action;
- relevant PRD, slice, handover, commit, test, or source artifact paths;
- current Forge truth commands such as `wiki checkpoint <project> --repo <path> --base HEAD --json`, `wiki forge next <project> --repo <path> --json`, and targeted `wiki forge status <project> <slice> --repo <path> --json`;
- ordered runbook commands the next agent must run;
- skills the next session should load.

Do not reconstruct the prior conversation, perform broad wiki queries, or reload unrelated context. The next-session prompt should say to read only the handover record, current Forge/checkpoint truth, and explicitly referenced artifacts, then follow the operator intent only if it still matches current truth.

When a tracked Forge implementation session stops with unfinished work, context risk, or a closeout that still needs continuation, create the handoff before ending the session and return the generated copy/paste prompt to the user verbatim.
