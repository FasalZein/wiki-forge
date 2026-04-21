AX optimizer sidecar for wiki-forge

Purpose
- Optimize workflow-facing prompt surfaces such as resume, handover, and repair guidance.
- Optimize repo-owned skill text such as skills/wiki/SKILL.md and skills/forge/SKILL.md.
- Keep all optimization offline and sidecar-only. Nothing changes in the shipping CLI until you manually promote outputs.

Local proxy setup
- AX supports config.baseURL and config.headers.
- Set AX_BASE_URL to your OpenAI-compatible local proxy, for example:
  http://127.0.0.1:4000/v1
- If your proxy ignores auth, AX_API_KEY=local-proxy is sufficient.
- If your proxy needs custom headers, set AX_HEADERS_JSON to a JSON object.

Common commands
- bun run print-config
- bun run baseline:workflow
- bun run baseline:skill
- bun run optimize:workflow
- bun run optimize:skill

Promotion and reload rules
- Running experiments does not require reloads.
- If you apply optimized output into skills/*/SKILL.md, run:
  bun run sync:local
  bun run sync:local -- --audit
- Then restart the agent session so installed skill copies are reloaded.
