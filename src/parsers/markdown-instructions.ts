import type {
  DocumentParser,
  ParsedDocument,
  ParsedSection,
  Rule,
} from "./types.js";

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK_CHECKBOX_RE = /^\[[ xX]\]\s+/;
const REGLA_RE = /^\s*REGLA(\s+\d+)?\s*[:.\-–—]\s*(.+)$/i;
const ATX_RE =
  /^( {0,3})(#{1,6})(?!#)(?:[ \t]+(.+?))?[ \t]*#*[ \t]*$/;
const HR_RE =
  /^\s{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BLOCKQUOTE_RE = /^\s{0,3}>/;
const TABLE_RE = /^\s*\|/;
const INDENTED_CODE_RE = /^(?: {4,}|\t)/;
const IMPERATIVE_RE =
  /^(?:Always|Never|Do not|Don't|Don’t|Must not|Avoid|Siempre|Nunca|No debes|Evita|Evitar|No\s+(?:debes|hagas|uses|escribas|incluyas|pongas|dejes|permitas|asumas|inventes|ejecutes|modifiques|borres|expongas|ignores|mezcles|reveles|compartas|instales))\b/i;

type CommentState = { inComment: boolean };

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function tryOpenFence(line: string): { char: string; len: number } | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) {
    return null;
  }
  const marker = match[2] ?? "";
  const info = match[3] ?? "";
  const char = marker[0] ?? "";
  if (char === "`" && info.includes("`")) {
    return null;
  }
  return { char, len: marker.length };
}

function isClosingFence(line: string, char: string, len: number): boolean {
  let i = 0;
  while (i < 3 && i < line.length && line[i] === " ") {
    i += 1;
  }
  let count = 0;
  while (i < line.length && line[i] === char) {
    count += 1;
    i += 1;
  }
  if (count < len) {
    return false;
  }
  while (i < line.length) {
    const next = line[i];
    if (next !== " " && next !== "\t") {
      return false;
    }
    i += 1;
  }
  return true;
}

function stripComments(line: string, state: CommentState): string | null {
  let rest = line;
  let out = "";
  if (state.inComment) {
    const end = rest.indexOf("-->");
    if (end === -1) {
      return null;
    }
    state.inComment = false;
    rest = rest.slice(end + 3);
  }
  while (true) {
    const start = rest.indexOf("<!--");
    if (start === -1) {
      out += rest;
      return out;
    }
    out += rest.slice(0, start);
    const end = rest.indexOf("-->", start + 4);
    if (end === -1) {
      state.inComment = true;
      return out;
    }
    rest = rest.slice(end + 3);
  }
}

function pushRule(section: ParsedSection, text: string, line: number): void {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return;
  }
  const rule: Rule = {
    text: normalized,
    line,
    ...(section.title ? { section: section.title } : {}),
  };
  section.rules.push(rule);
}

function isImperative(text: string): boolean {
  if (text.endsWith(":")) {
    return false;
  }
  const length = text.length;
  if (length < 20 || length > 140) {
    return false;
  }
  return IMPERATIVE_RE.test(text);
}

export function parseMarkdownInstructions(content: string): ParsedDocument {
  const lines = content.split(/\r?\n/);
  let title = "";
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  const comment: CommentState = { inComment: false };
  let pending: { text: string; line: number } | null = null;

  const flushPending = (): void => {
    if (!pending) {
      return;
    }
    const section = ensureSection();
    pushRule(section, pending.text, pending.line);
    pending = null;
  };

  const ensureSection = (): ParsedSection => {
    if (!current) {
      current = { title: "", level: 0, line: 1, rules: [] };
    }
    return current;
  };

  const startSection = (
    headingTitle: string,
    level: number,
    line: number,
  ): void => {
    flushPending();
    if (current) {
      sections.push(current);
    }
    current = { title: headingTitle, level, line, rules: [] };
  };

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i] ?? "";

    if (inFence) {
      if (isClosingFence(raw, fenceChar, fenceLen)) {
        inFence = false;
        fenceChar = "";
        fenceLen = 0;
      }
      continue;
    }

    const stripped = stripComments(raw, comment);
    if (stripped === null) {
      continue;
    }
    const line = stripped;

    const fence = tryOpenFence(line);
    if (fence) {
      flushPending();
      inFence = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      continue;
    }

    if (isBlank(line)) {
      flushPending();
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      const level = (atx[2] ?? "").length;
      const headingTitle = (atx[3] ?? "").trim();
      if (level === 1 && !title) {
        title = headingTitle;
      }
      startSection(headingTitle, level, lineNo);
      continue;
    }

    if (HR_RE.test(line)) {
      flushPending();
      continue;
    }

    const list = LIST_RE.exec(line);
    if (list) {
      flushPending();
      pending = {
        text: (list[3] ?? "").replace(TASK_CHECKBOX_RE, ""),
        line: lineNo,
      };
      continue;
    }

    if (pending && /^\s+/.test(line)) {
      pending.text += ` ${line.trim()}`;
      continue;
    }

    flushPending();

    if (BLOCKQUOTE_RE.test(line) || TABLE_RE.test(line)) {
      continue;
    }

    if (INDENTED_CODE_RE.test(line)) {
      continue;
    }

    const regla = REGLA_RE.exec(line);
    if (regla) {
      pushRule(ensureSection(), regla[2] ?? "", lineNo);
      continue;
    }

    const trimmed = line.trim();
    if (isImperative(trimmed)) {
      pushRule(ensureSection(), trimmed, lineNo);
    }
  }

  flushPending();
  if (current) {
    sections.push(current);
  }

  return { title, sections };
}

export function flattenRules(doc: ParsedDocument): Rule[] {
  return doc.sections.flatMap((section) => section.rules);
}

export const markdownInstructionsParser: DocumentParser = {
  kind: "markdown-instructions",
  parse: parseMarkdownInstructions,
};
