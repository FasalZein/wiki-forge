import { describe, expect, it } from "bun:test";
import {
  parseWikiMarkdown,
  extractWikilinks,
  extractWikilinkTargets,
  extractShellBlocks,
  extractH2Sections,
  hasHeading,
} from "../src/lib/markdown-ast";

describe("parseWikiMarkdown", () => {
  it("extracts H2 headings", () => {
    const body = "# Title\n\n## Section One\n\nContent\n\n## Section Two\n\nMore content\n\n### Subsection\n";
    const result = parseWikiMarkdown(body);
    expect(result.headings).toEqual([
      { depth: 1, text: "Title" },
      { depth: 2, text: "Section One" },
      { depth: 2, text: "Section Two" },
      { depth: 3, text: "Subsection" },
    ]);
  });

  it("extracts GFM task list items with bold IDs", () => {
    const body = `## In Progress

- [ ] **PROJ-001** First task with details | p0
- [ ] **PROJ-002** Second task

## Done

- [ ] **PROJ-003** Completed task
`;
    const result = parseWikiMarkdown(body);
    expect(result.tasks).toEqual([
      { id: "PROJ-001", title: "First task with details | p0", checked: false },
      { id: "PROJ-002", title: "Second task", checked: false },
      { id: "PROJ-003", title: "Completed task", checked: false },
    ]);
  });

  it("extracts wikilinks with aliases and anchors", () => {
    const body = "See [[some-page]] and [[other#heading|Display Name]] for details. Also [[plain]].\n";
    const result = parseWikiMarkdown(body);
    expect(result.wikilinks).toEqual([
      { target: "some-page", anchor: null, alias: null },
      { target: "other", anchor: "heading", alias: "Display Name" },
      { target: "plain", anchor: null, alias: null },
    ]);
  });

  it("extracts fenced code blocks with language tags", () => {
    const body = "Some text\n\n```bash\necho hello\nls -la\n```\n\n```typescript\nconst x = 1;\n```\n\nMore text\n";
    const result = parseWikiMarkdown(body);
    expect(result.codeBlocks).toEqual([
      { lang: "bash", value: "echo hello\nls -la" },
      { lang: "typescript", value: "const x = 1;" },
    ]);
  });

  it("counts TODO occurrences in body", () => {
    const body = "## Section\n\nSome TODO here\n\n```js\n// TODO: fix this\n```\n\nAnother TODO item\n";
    const result = parseWikiMarkdown(body);
    expect(result.todoCount).toBe(3);
  });

  it("computes bodyLength excluding frontmatter", () => {
    const body = "## Section\n\nShort content\n";
    const result = parseWikiMarkdown(body);
    expect(result.bodyLength).toBe(body.length);
  });

  it("handles empty content gracefully", () => {
    const result = parseWikiMarkdown("");
    expect(result.headings).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.wikilinks).toEqual([]);
    expect(result.codeBlocks).toEqual([]);
    expect(result.todoCount).toBe(0);
    expect(result.bodyLength).toBe(0);
  });

  it("handles content with only whitespace", () => {
    const result = parseWikiMarkdown("   \n\n  \n");
    expect(result.headings).toEqual([]);
    expect(result.tasks).toEqual([]);
  });

  it("ignores regular list items without bold IDs", () => {
    const body = "- [ ] Just a plain checkbox\n- [ ] Another one\n- Not a checkbox\n";
    const result = parseWikiMarkdown(body);
    expect(result.tasks).toEqual([]);
  });

  it("handles code blocks without language", () => {
    const body = "```\nplain code\n```\n";
    const result = parseWikiMarkdown(body);
    expect(result.codeBlocks).toEqual([{ lang: null, value: "plain code" }]);
  });

  it("extracts tasks with metadata after title", () => {
    const body = "- [ ] **WIKI-042** prefer qmd binary over internal node cli | p1 | #qmd | status=done\n";
    const result = parseWikiMarkdown(body);
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0].id).toBe("WIKI-042");
    expect(result.tasks[0].title).toContain("prefer qmd binary");
  });
});

describe("extractWikilinks", () => {
  it("extracts targets from mixed content", () => {
    const body = "Link to [[page-a]] and [[folder/page-b#section|alias]]\n";
    const links = extractWikilinks(body);
    expect(links).toEqual([
      { target: "page-a", anchor: null, alias: null },
      { target: "folder/page-b", anchor: "section", alias: "alias" },
    ]);
  });

  it("returns empty for content without wikilinks", () => {
    expect(extractWikilinks("No links here")).toEqual([]);
  });

  it("ignores wikilinks inside inline code spans", () => {
    const body = "See `[[wikilinks]]` and [[real-page]] for details.\n";
    const links = extractWikilinks(body);
    expect(links).toEqual([
      { target: "real-page", anchor: null, alias: null },
    ]);
  });

  it("ignores wikilinks inside fenced code blocks", () => {
    const body = "Text [[real]]\n\n```markdown\n[[inside-code-block]]\n```\n\nMore [[also-real]]\n";
    const links = extractWikilinks(body);
    expect(links).toEqual([
      { target: "real", anchor: null, alias: null },
      { target: "also-real", anchor: null, alias: null },
    ]);
  });
});

describe("extractWikilinkTargets", () => {
  it("returns only target strings", () => {
    const targets = extractWikilinkTargets("See [[a]] and [[b#c|d]]");
    expect(targets).toEqual(["a", "b"]);
  });
});

describe("extractShellBlocks", () => {
  it("extracts bash and sh blocks", () => {
    const body = "```bash\necho test\n```\n\n```sh\nls\n```\n\n```python\nprint(1)\n```\n";
    const blocks = extractShellBlocks(body);
    expect(blocks).toEqual(["echo test", "ls"]);
  });

  it("extracts shell blocks", () => {
    const body = "```shell\nwhoami\n```\n";
    const blocks = extractShellBlocks(body);
    expect(blocks).toEqual(["whoami"]);
  });

  it("returns empty when no shell blocks", () => {
    expect(extractShellBlocks("```js\ncode\n```\n")).toEqual([]);
  });
});

describe("extractH2Sections", () => {
  it("returns only H2 heading text", () => {
    const body = "# Title\n## A\n### B\n## C\n";
    expect(extractH2Sections(body)).toEqual(["A", "C"]);
  });
});

describe("hasHeading", () => {
  it("returns true for existing heading", () => {
    expect(hasHeading("## Key Files\n\nContent", "Key Files")).toBe(true);
  });

  it("returns false for missing heading", () => {
    expect(hasHeading("## Other\n\nContent", "Key Files")).toBe(false);
  });

  it("does not false-positive on heading text in body", () => {
    expect(hasHeading("Some text mentioning Key Files in a paragraph", "Key Files")).toBe(false);
  });
});
