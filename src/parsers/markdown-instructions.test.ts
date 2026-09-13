import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  flattenRules,
  markdownInstructionsParser,
  parseMarkdownInstructions,
} from "./markdown-instructions.js";

function fixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}

describe("markdownInstructionsParser", () => {
  it("uses the markdown-instructions document kind", () => {
    expect(markdownInstructionsParser.kind).toBe("markdown-instructions");
  });

  it("extracts exactly 8 rules from agents-bueno.md", () => {
    const doc = parseMarkdownInstructions(fixture("agents-bueno.md"));
    const rules = flattenRules(doc);
    expect(doc.title).toBe("Project Agents");
    expect(rules).toHaveLength(8);
    expect(rules).toEqual([
      {
        text: "Always use TypeScript strict mode in new files",
        line: 5,
        section: "Coding",
      },
      {
        text: "Never commit secrets or API keys",
        line: 6,
        section: "Coding",
      },
      {
        text: "Prefer small pull requests over large ones",
        line: 7,
        section: "Coding",
      },
      {
        text: "Do not run destructive git commands",
        line: 11,
        section: "Safety",
      },
      {
        text: "Never skip the test suite",
        line: 12,
        section: "Safety",
      },
      {
        text: "Always write tests for new public APIs.",
        line: 14,
        section: "Safety",
      },
      {
        text: "Keep functions under fifty lines",
        line: 18,
        section: "Style",
      },
      {
        text: "Name files in kebab-case",
        line: 19,
        section: "Style",
      },
    ]);
  });

  it("extracts exactly 2 rules from agents-pobre.md", () => {
    const rules = flattenRules(
      parseMarkdownInstructions(fixture("agents-pobre.md")),
    );
    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.text)).toEqual(["stuff", "more stuff"]);
    expect(rules.map((rule) => rule.line)).toEqual([5, 6]);
  });

  it("extracts exactly 0 rules from agents-vacio.md", () => {
    const doc = parseMarkdownInstructions(fixture("agents-vacio.md"));
    expect(flattenRules(doc)).toHaveLength(0);
    expect(doc.title).toBe("");
    expect(doc.sections).toHaveLength(0);
  });

  it("extracts exactly 7 rules from agents-raro.md", () => {
    const doc = parseMarkdownInstructions(fixture("agents-raro.md"));
    const rules = flattenRules(doc);
    expect(rules).toHaveLength(7);
    expect(rules).toEqual([
      {
        text: "Always complete the task checkbox item this is a continuation of the task",
        line: 20,
        section: "Weird",
      },
      {
        text: "Nested child must also count as a rule",
        line: 22,
        section: "Weird",
      },
      {
        text: "Handle unlabeled regla lines",
        line: 24,
        section: "Weird",
      },
      {
        text: "Handle numbered regla lines",
        line: 25,
        section: "Weird",
      },
      {
        text: "case insensitive regla",
        line: 26,
        section: "Weird",
      },
      {
        text: "Always keep going after a fence closes here.",
        line: 28,
        section: "Weird",
      },
      {
        text: "No debes mezclar secretos con el codigo fuente.",
        line: 30,
        section: "Weird",
      },
    ]);
  });

  it("yields the same 8 rules for CRLF as for LF", () => {
    const lf = fixture("agents-bueno.md");
    const crlf = lf.split(/\r?\n/).join("\r\n");
    const lfRules = flattenRules(parseMarkdownInstructions(lf));
    const crlfRules = flattenRules(parseMarkdownInstructions(crlf));
    expect(crlfRules).toHaveLength(8);
    expect(crlfRules).toEqual(lfRules);
  });

  it("does not count fenced, commented, quoted, table, or hr lines", () => {
    const rules = flattenRules(
      parseMarkdownInstructions(`# Title

\`\`\`
- Always parse this fenced list item now
Always parse this fenced sentence too.
\`\`\`

<!--
- Always parse this commented list item
Always parse this commented sentence too.
-->

> Always follow quoted advice as if it were a rule

| Always | table |
| --- | --- |

---

- Real list rule that must be counted
`),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.text).toBe("Real list rule that must be counted");
  });

  it("ignores the rest of the document when a fence is unclosed", () => {
    const rules = flattenRules(
      parseMarkdownInstructions(`- Count this list rule only once

\`\`\`
- Never count this fenced list item
Always never count this fenced paragraph.
`),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.text).toBe("Count this list rule only once");
  });

  it("strips [ ] and [x] checkboxes from task list rule text", () => {
    const rules = flattenRules(
      parseMarkdownInstructions(
        "- [ ] Always complete the unchecked task item\n- [x] Always complete the checked task item\n- [X] Always complete the uppercase checked item\n",
      ),
    );
    expect(rules).toHaveLength(3);
    expect(rules.map((rule) => rule.text)).toEqual([
      "Always complete the unchecked task item",
      "Always complete the checked task item",
      "Always complete the uppercase checked item",
    ]);
  });

  it("counts a REGLA list item once as a list, not twice", () => {
    const rules = flattenRules(
      parseMarkdownInstructions("- REGLA 1: already a list item here\n"),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.text).toBe("REGLA 1: already a list item here");
  });

  it("rejects imperative lines that are too short, too long, or end with a colon", () => {
    const rules = flattenRules(
      parseMarkdownInstructions(
        [
          "Always do it.",
          "Always do the following:",
          `Always ${"x".repeat(140)}`,
          "Nothing here is a rule at all.",
          "Note that this line is not an instruction.",
        ].join("\n"),
      ),
    );
    expect(rules).toHaveLength(0);
  });

  it("accepts exactly one closed-verb No-imperative line", () => {
    const rules = flattenRules(
      parseMarkdownInstructions(
        "No uses APIs without a review in this file.\n",
      ),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.text).toBe("No uses APIs without a review in this file.");
  });

  it("does not treat a 4-space indented Always line as a rule", () => {
    const rules = flattenRules(
      parseMarkdownInstructions(
        "    Always treat this indented line as a code block.\n",
      ),
    );
    expect(rules).toHaveLength(0);
  });

  it("does not treat setext underlines as headings or rules", () => {
    const doc = parseMarkdownInstructions(
      "Setext title\n=============\n\nAlways write tests for new public APIs.\n",
    );
    expect(doc.title).toBe("");
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]?.level).toBe(0);
    const rules = flattenRules(doc);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.line).toBe(4);
  });
});
