AX optimizer sidecar for wiki-forge

Purpose
- Optimize workflow-facing prompt surfaces such as resume, handover, and repair guidance.
- Optimize repo-owned skill text such as skills/wiki/SKILL.md and skills/forge/SKILL.md.
- Keep all optimization offline and sidecar-only. Nothing changes in the shipping CLI until you manually promote outputs.

Local proxy setup
- AX supports config.baseURL and config.headers.
- Set AX_BASE_URL to your OpenAI-compatible local proxy, for example:
  http://127.0.0.1:8317/v1
- The repo defaults target the current local proxy with:
  AX_API_KEY=dummy
  AX_MODEL=gpt-5.4-mini
  AX_TEACHER_MODEL=gpt-5.4
- If your proxy needs custom headers, set AX_HEADERS_JSON to a JSON object.

Common commands
- bun run print-config
- bun run baseline:workflow
- bun run baseline:skill
- bun run optimize:workflow
- bun run optimize:skill
- bun run evaluate:workflow
- bun run evaluate:skill
- bun run candidates:skill
- bun run promote:skill

Promotion and reload rules
- Running experiments does not require reloads.
- `promote:skill` generates patch files only; it does not modify `skills/*/SKILL.md`.
- If you apply optimized output into skills/*/SKILL.md, run:
  bun run sync:local
  bun run sync:local -- --audit
- Then restart the agent session so installed skill copies are reloaded.

Outputs
- optimized program artifacts live in outputs/*.optimized-program.json
- evaluation summaries live in outputs/*.evaluation.json
- candidate skill rewrites live in outputs/skill-candidates/*.candidate.json
- promotion patches live in outputs/skill-candidates/*.candidate.patch
