import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdownInstructions } from "../parsers/markdown-instructions.js";
import type { Rule } from "../parsers/types.js";
import {
  JUDGE_EXPLANATION_MAX,
  JUDGE_RETRY_NOTE,
  JUDGE_SYSTEM_PROMPT,
  buildJudgeMessages,
  judgeCapLine,
  judgeStatusLine,
  parseJudgeResponse,
  rulesFromRuleSections,
  selectRulesForJudge,
  toJudgeFindings,
  withRetryNote,
} from "./judge.js";

function rule(line: number, text: string): Rule {
  return { line, text };
}

describe("buildJudgeMessages", () => {
  it("includes the frozen system prompt and each rule with its line", () => {
    const messages = buildJudgeMessages([
      rule(5, "Always ask for confirmation before deleting anything"),
      rule(12, "Batch deletes run without any confirmation"),
    ]);
    expect(messages[0]).toEqual({ role: "system", content: JUDGE_SYSTEM_PROMPT });
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Rules (line number, then text):");
    expect(messages[1]?.content).toContain(
      "5: Always ask for confirmation before deleting anything",
    );
    expect(messages[1]?.content).toContain("12: Batch deletes run without any confirmation");
  });

  it("appends the frozen retry note without altering the original prompt", () => {
    const messages = buildJudgeMessages([rule(1, "Always keep secrets out of git")]);
    const retried = withRetryNote(messages);
    expect(retried.slice(0, 2)).toEqual(messages);
    expect(retried[2]).toEqual({ role: "user", content: JUDGE_RETRY_NOTE });
  });
});

describe("parseJudgeResponse", () => {
  const sent = new Set([5, 12, 20]);

  it("parses a valid array", () => {
    const result = parseJudgeResponse(
      '[{"lineA":5,"lineB":12,"explanation":"one requires confirmation, the other skips it"}]',
      sent,
    );
    expect(result).toEqual({
      ok: true,
      pairs: [
        {
          lineA: 5,
          lineB: 12,
          explanation: "one requires confirmation, the other skips it",
        },
      ],
    });
  });

  it("parses an empty array", () => {
    expect(parseJudgeResponse("[]", sent)).toEqual({ ok: true, pairs: [] });
  });

  it("unwraps markdown fences", () => {
    const raw = "```json\n[{\"lineA\":5,\"lineB\":12,\"explanation\":\"conflict\"}]\n```";
    const result = parseJudgeResponse(raw, sent);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pairs).toHaveLength(1);
      expect(result.pairs[0]?.explanation).toBe("conflict");
    }
  });

  it("fails on non-JSON and on a non-array root", () => {
    expect(parseJudgeResponse("not json", sent)).toEqual({ ok: false });
    expect(parseJudgeResponse("{}", sent)).toEqual({ ok: false });
  });

  it("discards pairs whose lines were not sent", () => {
    const result = parseJudgeResponse(
      JSON.stringify([
        { lineA: 5, lineB: 12, explanation: "real" },
        { lineA: 5, lineB: 99, explanation: "hallucinated" },
      ]),
      sent,
    );
    expect(result).toEqual({
      ok: true,
      pairs: [{ lineA: 5, lineB: 12, explanation: "real" }],
    });
  });

  it("discards a pair with lineA === lineB", () => {
    const result = parseJudgeResponse(
      JSON.stringify([{ lineA: 5, lineB: 5, explanation: "self" }]),
      sent,
    );
    expect(result).toEqual({ ok: true, pairs: [] });
  });

  it("swaps reversed lines and dedupes the pair", () => {
    const result = parseJudgeResponse(
      JSON.stringify([
        { lineA: 12, lineB: 5, explanation: "first" },
        { lineA: 5, lineB: 12, explanation: "second" },
      ]),
      sent,
    );
    expect(result).toEqual({
      ok: true,
      pairs: [{ lineA: 5, lineB: 12, explanation: "first" }],
    });
  });

  it("drops malformed pairs and keeps the rest", () => {
    const result = parseJudgeResponse(
      JSON.stringify([
        { lineA: "5", lineB: 12, explanation: "string line" },
        { lineA: 5, lineB: 12.5, explanation: "not int" },
        { lineA: 5, lineB: 12 },
        { lineA: 5, lineB: 20, explanation: "kept" },
      ]),
      sent,
    );
    expect(result).toEqual({
      ok: true,
      pairs: [{ lineA: 5, lineB: 20, explanation: "kept" }],
    });
  });
});

describe("selectRulesForJudge", () => {
  it("keeps a prefix under the token budget and reports N of M", () => {
    const rules = [
      rule(1, "aaaa"),
      rule(2, "bbbb"),
      rule(3, "cccc"),
      rule(4, "dddd"),
    ];
    const { selected, total } = selectRulesForJudge(rules, 3);
    expect(total).toBe(4);
    expect(selected.map((item) => item.line)).toEqual([1, 2, 3]);
  });

  it("still sends the first rule when it alone exceeds the budget", () => {
    const huge = "x".repeat(9000);
    const { selected, total } = selectRulesForJudge(
      [rule(1, huge), rule(2, "aaaa")],
      2000,
    );
    expect(total).toBe(2);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.line).toBe(1);
  });
});

describe("rulesFromRuleSections", () => {
  it("omits rules that live in documentation sections", () => {
    const content = readFileSync(resolve("test/fixtures/agents-ruido-mixto.md"), "utf8");
    const doc = parseMarkdownInstructions(content);
    const rules = rulesFromRuleSections(doc);
    expect(rules.map((item) => item.text)).toEqual([
      "Always use TypeScript strict mode in new files",
    ]);
    expect(rules.some((item) => item.text.includes("npm run build"))).toBe(false);
  });
});

describe("toJudgeFindings", () => {
  it("builds warning findings without a snippet", () => {
    const findings = toJudgeFindings([
      { lineA: 5, lineB: 12, explanation: "one requires confirmation, the other skips it" },
    ]);
    expect(findings).toEqual([
      {
        line: 5,
        severity: "warning",
        category: "judge",
        message: "contradiction with line 12: one requires confirmation, the other skips it",
      },
    ]);
    expect(findings[0]).not.toHaveProperty("snippet");
  });

  it("caps only the explanation at JUDGE_EXPLANATION_MAX", () => {
    const explanation = `${"x".repeat(JUDGE_EXPLANATION_MAX + 40)}end`;
    const [finding] = toJudgeFindings([{ lineA: 2, lineB: 3, explanation }]);
    const prefix = "contradiction with line 3: ";
    expect(finding?.message.startsWith(prefix)).toBe(true);
    expect(finding?.message.slice(prefix.length).length).toBe(JUDGE_EXPLANATION_MAX);
    expect(finding?.message).not.toContain("end");
  });
});

describe("status lines", () => {
  it("uses frozen wording", () => {
    expect(judgeStatusLine(0)).toBe("judge  no contradictions found");
    expect(judgeStatusLine(1)).toBe("judge  1 contradiction found");
    expect(judgeStatusLine(3)).toBe("judge  3 contradictions found");
    expect(judgeCapLine(40, 129)).toBe("judge  analyzed first 40 of 129 rules");
  });
});
