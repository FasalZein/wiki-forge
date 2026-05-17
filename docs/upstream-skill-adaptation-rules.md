# Upstream Skill Adaptation Rules

This note records how wiki-forge should adapt Matt Pocock's upstream engineering skills without drifting into a separate workflow.

## Upstream sources

Local checkout: `/Users/tothemoon/Dev/AI/Skills/mattpocock-skills`

Priority upstream files:

- `skills/engineering/tdd/SKILL.md`
- `skills/engineering/tdd/tests.md`
- `skills/engineering/tdd/mocking.md`
- `skills/engineering/tdd/interface-design.md`
- `skills/engineering/tdd/deep-modules.md`
- `skills/engineering/tdd/refactoring.md`
- `skills/engineering/grill-with-docs/SKILL.md`
- `skills/engineering/grill-with-docs/CONTEXT-FORMAT.md`
- `skills/engineering/grill-with-docs/ADR-FORMAT.md`
- `skills/engineering/improve-codebase-architecture/SKILL.md`
- `skills/engineering/improve-codebase-architecture/LANGUAGE.md`
- `skills/engineering/improve-codebase-architecture/DEEPENING.md`
- `skills/engineering/improve-codebase-architecture/INTERFACE-DESIGN.md`
- `skills/engineering/to-prd/SKILL.md`
- `skills/engineering/to-issues/SKILL.md`

GitHub source checked: `https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd`.

## Preserve upstream method

Do not rewrite these skills into wiki-forge-specific process documents. Preserve upstream workflow first, then add a small adapter layer.

### TDD

Preserve:

- Core principle: tests verify behavior through public interfaces, not implementation details.
- Good tests are integration-style, exercise real code paths, and read like specifications.
- Bad tests mock internals, test private methods, assert call counts/order, or verify through external means instead of the interface.
- Anti-pattern: DO NOT write all tests first, then all implementation.
- Correct loop: vertical tracer bullets, one test → one implementation → repeat.
- Planning asks what public interface should look like and which behaviors matter most.
- Refactor only after green; never refactor while red.
- Mock only at system boundaries.
- Prefer deep modules: small interface, deep implementation.

Wiki/Forge adapter:

- Domain glossary lookup comes from Wiki memory.
- TDD evidence → wiki forge tdd cycle.
- Targeted verification → wiki forge evidence <project> <slice> verify.
- Close/review → wiki forge run and wiki forge review record.

### Grill with docs

Preserve:

- Interview relentlessly until shared understanding exists.
- Ask the questions one at a time and wait for feedback.
- If code can answer a question, explore code instead of asking.
- Challenge the plan against the glossary.
- Sharpen fuzzy language.
- Discuss concrete scenarios.
- Cross-reference with code and surface contradictions.
- Update context inline as terms resolve.
- Offer ADRs sparingly, only when hard to reverse, surprising without context, and a real trade-off.

Wiki/Forge adapter:

- CONTEXT.md → projects/<project>/architecture/domain-language.md.
- docs/adr/ → projects/<project>/adrs/ with `projects/<project>/decisions.md` maintained as the index.
- Prefer wiki forge grill record for durable context/ADR writes.
- Return resolved context into the Forge Plan packet; do not create PRD/slices outside Forge.

### Improve codebase architecture

Preserve:

- Use the architecture glossary exactly: Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality.
- Use the deletion test to identify shallow modules.
- The interface is the test surface.
- One adapter = hypothetical seam; two adapters = real seam.
- Explore organically and present candidates before proposing interfaces.
- Ask which candidate the user wants to explore.
- Use domain language from context and respect ADRs.

Wiki/Forge adapter:

- Domain language, ADR bodies, and the decisions index are read from Wiki memory.
- Findings are filed into the Wiki layer.
- Accepted candidates become Forge-tracked follow-up work through wiki forge plan, not broad ad-hoc cleanup.

### PRD and slices

Preserve:

- PRDs synthesize current context; do not run a second unnecessary interview when enough context exists.
- PRD includes problem statement, solution, user stories, implementation decisions, testing decisions, out of scope, and further notes.
- Slices are vertical tracer bullets, not horizontal layer work.
- Slices can be HITL or AFK.
- Publish in dependency order in upstream issue-tracker workflows.

Wiki/Forge adapter:

- issue tracker → wiki forge plan.
- PRD candidate → Forge PRD artifact.
- issue/slice candidate → Forge slice artifact.
- Accepted work should produce Feature/PRD/slice records under the configured Knowledge vault.

## Local skill update rule

For each local skill, keep the upstream section titles and critical phrases where practical. Add a clearly named Wiki/Forge adapter or phase packet section. Do not bury upstream rules inside local workflow prose.
