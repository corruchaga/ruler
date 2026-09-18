import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { flattenRules } from "../parsers/markdown-instructions.js";
import type { ParsedDocument, Rule } from "../parsers/types.js";

export type FreshnessKind = "ruta" | "script" | "dependencia";

export type FreshnessMention = {
  kind: FreshnessKind;
  value: string;
  line: number;
};

export type FreshnessFinding = FreshnessMention & {
  lookedIn: string;
};

export type FreshnessReport = {
  findings: FreshnessFinding[];
};

const PATH_EXTS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".md",
  ".mdx",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".vue",
  ".svelte",
  ".svg",
]);

const PATH_ANCHOR_RE =
  /^(?:\.{1,2}[\\/]|\/?(?:src|dist|test|tests|docs|lib|app|public|scripts|config|configs|packages|bin|build|coverage|\.github|\.opencode)[\\/]|[A-Za-z]:[\\/])/;

const PATH_SKIP_EXACT: ReadonlySet<string> = new Set([
  "y/o",
  "e/o",
  "and/or",
  "24/7",
  "flex/grid",
  "largo/corto",
  "claro/oscuro",
]);

const CONTEXT_RE =
  /(?:^|[^\p{L}])(?:en|in|archivo|file|fichero|carpeta|folder|directorio|directory|ruta|path)\s+$/iu;

const TOKEN_RE = /`([^`]+)`|([^\s`]+)/g;

const WRAP_START = /^[\(\)\[\]"'`]+/;
const WRAP_END = /[\(\)\[\]"'`,.;:]+$/;

const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i;

const RUN_RE = /\b(?:npm|yarn|pnpm)\s+run\s+([A-Za-z0-9:_-]+)/gi;
const NPM_LIFECYCLE_RE = /\bnpm\s+(test|start|stop|restart)\b/gi;
const BARE_PM_RE = /\b(?:yarn|pnpm)\s+(?!run\b)([A-Za-z0-9:_-]+)/gi;

const PM_SKIP: ReadonlySet<string> = new Set([
  "access",
  "add",
  "adduser",
  "audit",
  "bin",
  "bugs",
  "cache",
  "ci",
  "completion",
  "config",
  "constraints",
  "create",
  "dedupe",
  "deprecate",
  "diff",
  "dist-tag",
  "dlx",
  "docs",
  "doctor",
  "edit",
  "exec",
  "explain",
  "explore",
  "fetch",
  "find-dupes",
  "fund",
  "get",
  "global",
  "help",
  "hook",
  "i",
  "import",
  "info",
  "init",
  "install",
  "install-ci-test",
  "link",
  "ll",
  "login",
  "logout",
  "ls",
  "node",
  "npm",
  "org",
  "outdated",
  "owner",
  "pack",
  "patch",
  "ping",
  "pkg",
  "plugin",
  "prefix",
  "profile",
  "prune",
  "publish",
  "query",
  "rebuild",
  "remove",
  "repo",
  "rm",
  "root",
  "run",
  "run-script",
  "sbom",
  "search",
  "set",
  "setup",
  "shrinkwrap",
  "star",
  "stars",
  "team",
  "token",
  "uninstall",
  "unlink",
  "unplug",
  "unpublish",
  "unstar",
  "up",
  "update",
  "upgrade",
  "version",
  "view",
  "whoami",
  "why",
  "workspace",
  "workspaces",
]);

const FRAMEWORK_STOPLIST: ReadonlySet<string> = new Set([
  "angular",
  "babel",
  "bun",
  "bybit",
  "css",
  "cypress",
  "dart",
  "deno",
  "django",
  "electron",
  "esbuild",
  "eslint",
  "express",
  "finnhub",
  "flask",
  "flutter",
  "go",
  "golang",
  "graphql",
  "html",
  "ichimoku",
  "java",
  "javascript",
  "jest",
  "jotai",
  "jquery",
  "json",
  "kotlin",
  "laravel",
  "markdown",
  "mobx",
  "mocha",
  "next",
  "next.js",
  "nextjs",
  "node",
  "node.js",
  "nodejs",
  "npm",
  "nuxt",
  "php",
  "pinia",
  "playwright",
  "pnpm",
  "prettier",
  "python",
  "rails",
  "react",
  "react-dom",
  "reactdom",
  "recoil",
  "redux",
  "remix",
  "rollup",
  "ruby",
  "rust",
  "spring",
  "supabase",
  "svelte",
  "sveltekit",
  "swift",
  "tailwind",
  "tailwindcss",
  "tauri",
  "tradingview",
  "typescript",
  "vite",
  "vitest",
  "vue",
  "websocket",
  "webpack",
  "yaml",
  "yarn",
  "zustand",
]);

const DEP_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "concreta",
  "concretas",
  "concreto",
  "concretos",
  "directa",
  "directas",
  "directo",
  "directos",
  "el",
  "esta",
  "estas",
  "este",
  "estos",
  "extra",
  "extras",
  "la",
  "las",
  "los",
  "nueva",
  "nuevas",
  "nuevo",
  "nuevos",
  "otra",
  "otras",
  "otro",
  "otros",
  "propia",
  "propias",
  "propio",
  "propios",
  "the",
  "these",
  "this",
  "those",
  "un",
  "una",
  "unas",
  "unos",
]);

const LIB_KW_RE =
  /\b(?:librer[ií]as?|library|libraries|dependencias?|dependenc(?:y|ies)|paquetes?|packages?)\b/gi;
const USA_RE = /\b(?:usa|uses|usando)\b/gi;
const LIB_WORD_RE = /^(librer[ií]a|library|dependencia|paquete|package)\b/i;
const ARTICLE_RE = /^(?:la|el|los|las|the|a|an|un|una|unos|unas)\s+/i;
const PKG_NAME_RE = /^(?:@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|[A-Za-z][A-Za-z0-9._-]*)/;
const KEBAB_VERSION_RE = /\b([A-Za-z0-9._-]*[A-Za-z0-9]-[A-Za-z0-9._-]*)\s+v\d+\b/gi;
const IMPORT_RE =
  /\b(?:import\s+(?:[^'"\n]+?\s+from\s+)?)['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gi;

function unwrapToken(raw: string): string {
  let token = raw.normalize("NFC").trim();
  let prev = "";
  while (token !== prev) {
    prev = token;
    token = token.replace(WRAP_START, "").replace(WRAP_END, "").trim();
  }
  return token;
}

function hasAllowedExt(token: string): boolean {
  const base = token.replace(/[\\/]+$/, "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }
  return PATH_EXTS.has(base.slice(dot).toLowerCase());
}

function isDirPath(token: string): boolean {
  return /[\\/]$/.test(token);
}

function hasContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  return CONTEXT_RE.test(before);
}

function isPathCandidate(token: string, text: string, index: number): boolean {
  if (!token.includes("/") && !token.includes("\\")) {
    return false;
  }
  if (PATH_SKIP_EXACT.has(token.toLowerCase())) {
    return false;
  }
  if (URL_RE.test(token) || token.includes("://")) {
    return false;
  }
  if (token.includes("*") || token.includes("?")) {
    return false;
  }
  if (!PATH_ANCHOR_RE.test(token)) {
    return false;
  }
  return hasAllowedExt(token) || isDirPath(token) || hasContext(text, index);
}

export function extractPaths(rule: Rule): string[] {
  const text = rule.text.replace(/\*\*/g, "").replace(/__/g, "").normalize("NFC");
  const seen = new Set<string>();
  const values: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    const token = unwrapToken(match[1] ?? match[2] ?? "");
    if (!isPathCandidate(token, text, match.index)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    values.push(token);
  }
  return values;
}

function collect(re: RegExp, text: string, skip?: ReadonlySet<string>): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = match[1];
    if (!value || skip?.has(value.toLowerCase())) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function extractScripts(rule: Rule): string[] {
  const text = rule.text.replace(/\*\*/g, "").replace(/__/g, "").normalize("NFC");
  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of [
    ...collect(RUN_RE, text),
    ...collect(NPM_LIFECYCLE_RE, text),
    ...collect(BARE_PM_RE, text, PM_SKIP),
  ]) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

function skipFiller(input: string): string {
  let rest = input.replace(/^[\s,.:;`"']+/, "");
  while (true) {
    const article = ARTICLE_RE.exec(rest);
    if (!article) {
      break;
    }
    rest = rest.slice(article[0].length);
    ARTICLE_RE.lastIndex = 0;
  }
  return rest;
}

function readPkgName(input: string): string | null {
  const rest = skipFiller(input).replace(/^[\`"']+/, "");
  const match = PKG_NAME_RE.exec(rest);
  if (!match) {
    return null;
  }
  return unwrapToken(match[0]);
}

function isStoppedDep(name: string): boolean {
  const key = name.toLowerCase();
  return FRAMEWORK_STOPLIST.has(key) || DEP_STOPWORDS.has(key);
}

function isNpmLike(name: string): boolean {
  return name.includes("-") || name.includes("/");
}

function pushDep(seen: Set<string>, values: string[], name: string | null): void {
  if (!name || isStoppedDep(name) || name.includes(":")) {
    return;
  }
  const key = name.toLowerCase();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  values.push(name);
}

export function extractDependencies(rule: Rule): string[] {
  const text = rule.text.replace(/\*\*/g, "").replace(/__/g, "").normalize("NFC");
  const seen = new Set<string>();
  const values: string[] = [];

  LIB_KW_RE.lastIndex = 0;
  for (const match of text.matchAll(LIB_KW_RE)) {
    const rest = text.slice((match.index ?? 0) + match[0].length);
    pushDep(seen, values, readPkgName(rest));
  }

  USA_RE.lastIndex = 0;
  for (const match of text.matchAll(USA_RE)) {
    let rest = skipFiller(text.slice((match.index ?? 0) + match[0].length));
    let libraryContext = false;
    const lib = LIB_WORD_RE.exec(rest);
    if (lib) {
      libraryContext = true;
      rest = skipFiller(rest.slice(lib[0].length));
    }
    LIB_WORD_RE.lastIndex = 0;
    const name = readPkgName(rest);
    if (!name) {
      continue;
    }
    if (!libraryContext && !isNpmLike(name)) {
      continue;
    }
    pushDep(seen, values, name);
  }

  KEBAB_VERSION_RE.lastIndex = 0;
  for (const match of text.matchAll(KEBAB_VERSION_RE)) {
    pushDep(seen, values, match[1] ?? null);
  }

  IMPORT_RE.lastIndex = 0;
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? "";
    if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) {
      continue;
    }
    pushDep(seen, values, unwrapToken(spec));
  }

  return values;
}

type PkgInfo = {
  scripts: Set<string>;
  deps: Set<string>;
};

function objectKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.keys(value);
}

function readPkg(targetDir: string): PkgInfo | null {
  const file = join(targetDir, "package.json");
  if (!existsSync(file)) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof raw !== "object" || raw === null) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    return {
      scripts: new Set(objectKeys(record.scripts)),
      deps: new Set(
        [...objectKeys(record.dependencies), ...objectKeys(record.devDependencies)].map((name) =>
          name.toLowerCase(),
        ),
      ),
    };
  } catch {
    return null;
  }
}

export function resolveTargetDir(userPath: string): string {
  const abs = resolve(userPath);
  return statSync(abs).isDirectory() ? abs : dirname(abs);
}

function resolvePathMention(targetDir: string, mention: string): string {
  if (/^[A-Za-z]:[\\/]/.test(mention) || isAbsolute(mention)) {
    return mention;
  }
  const relative = mention.replace(/^[\\/]+/, "");
  return resolve(targetDir, relative);
}

export function checkFreshness(doc: ParsedDocument, targetDir: string): FreshnessReport {
  const absDir = resolve(targetDir);
  const pkg = readPkg(absDir);
  const findings: FreshnessFinding[] = [];

  for (const rule of flattenRules(doc)) {
    for (const value of extractPaths(rule)) {
      const lookedIn = resolvePathMention(absDir, value);
      if (!existsSync(lookedIn)) {
        findings.push({ kind: "ruta", value, line: rule.line, lookedIn });
      }
    }
    if (!pkg) {
      continue;
    }
    for (const value of extractScripts(rule)) {
      if (!pkg.scripts.has(value)) {
        findings.push({
          kind: "script",
          value,
          line: rule.line,
          lookedIn: "package.json scripts",
        });
      }
    }
    for (const value of extractDependencies(rule)) {
      if (!pkg.deps.has(value.toLowerCase())) {
        findings.push({
          kind: "dependencia",
          value,
          line: rule.line,
          lookedIn: "package.json dependencies/devDependencies",
        });
      }
    }
  }

  return { findings };
}

export function formatFreshness(findings: readonly FreshnessFinding[]): string[] {
  if (findings.length === 0) {
    return ["freshness: OK"];
  }
  return findings.map(
    (item) =>
      `line ${item.line} [FRESHNESS]: ${item.kind} - ${item.value} not found (${item.lookedIn})`,
  );
}
