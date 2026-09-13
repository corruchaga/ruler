import type { Rule } from "../parsers/types.js";

export type RuleScore = {
  score: number;
  signals: string[];
};

type Detector = {
  id: string;
  delta: number;
  find: (original: string, lower: string) => string | null;
};

const BASE = 5;
const NO_CHECKABLE_DELTA = -3;
const CAP_WITHOUT_PLUS = 3;

function bound(pattern: string): string {
  return `(?<!\\p{L})(?:${pattern})(?!\\p{L})`;
}

function firstMatch(text: string, source: string): string | null {
  const match = new RegExp(source, "iu").exec(text);
  return match ? match[0] : null;
}

function firstPhrase(text: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) {
    if (text.includes(phrase)) {
      return phrase;
    }
  }
  return null;
}

function stripBold(text: string): string {
  return text.replace(/\*\*/g, "").replace(/__/g, "");
}

function findBacktick(original: string): string | null {
  const match = /`[^`]+`/.exec(original);
  return match ? match[0] : null;
}

function findPackageScript(lower: string): string | null {
  return firstMatch(lower, String.raw`\b(?:npm|yarn|pnpm|npx)\s+(?:run\s+)?[\w:-]+`);
}

function findFilePath(lower: string): string | null {
  return (
    firstMatch(
      lower,
      String.raw`\b(?:package\.json|agents\.md|claude.md|skill\.md|\.env|\.gitignore)\b`,
    ) ??
    firstMatch(
      lower,
      String.raw`\b(?:src|dist|test|tests|lib|app|components|store|services|utils)/[\w./-]+`,
    ) ??
    firstMatch(
      lower,
      String.raw`\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|html|yml|yaml)\b`,
    )
  );
}

function findThreshold(lower: string): string | null {
  const cleaned = lower.replace(/regla\s+\d+/giu, " ");
  const numberRe = new RegExp(
    bound(
      String.raw`\d+(?:[.,]\d+)?|ten|twenty|thirty|forty|fifty|hundred|diez|veinte|treinta|cuarenta|cincuenta|cien`,
    ),
    "giu",
  );
  const unitRe = new RegExp(
    bound(
      String.raw`px|ms|%|lines?|l[ií]neas?|paneles?|panes?|chars?|characters?|caracteres`,
    ) + String.raw`|\d+\s*s\b`,
    "iu",
  );
  const cmpRe = new RegExp(
    bound(
      String.raw`under|over|at most|at least|max(?:imum)?|min(?:imum)?|menos de|m[aá]s de|m[aá]ximo|m[ií]nimo`,
    ) + String.raw`|[<>]=?|≥|≤`,
    "iu",
  );

  let match: RegExpExecArray | null;
  while ((match = numberRe.exec(cleaned)) !== null) {
    const start = Math.max(0, match.index - 40);
    const end = Math.min(cleaned.length, match.index + match[0].length + 40);
    const window = cleaned.slice(start, end);
    if (unitRe.test(window) || cmpRe.test(window)) {
      return match[0];
    }
    unitRe.lastIndex = 0;
    cmpRe.lastIndex = 0;
  }
  return null;
}

function findFormat(lower: string): string | null {
  return (
    firstPhrase(lower, [
      "typescript strict",
      "kebab-case",
      "snake_case",
      "camel-case",
      "pascal-case",
      "utf-8",
      "sin ñ",
      "sin acentos",
    ]) ??
    firstMatch(lower, bound("camelcase|pascalcase|ascii|json"))
  );
}

function findCheckableToken(lower: string): string | null {
  return (
    firstPhrase(lower, ["api keys", "api key", "test suite", ".env"]) ??
    firstMatch(lower, bound("secrets?|credentials?|passwords?"))
  );
}

function findVerifiableAction(lower: string): string | null {
  return (
    firstPhrase(lower, [
      "npm run build",
      "write tests",
      "never skip the test",
      "compila sin errores",
    ]) ?? firstMatch(lower, bound("typecheck|tsc|eslint|prettier|vitest|lint|compila(?:r)?"))
  );
}

function findCssIdentifier(lower: string): string | null {
  return (
    firstPhrase(lower, ["position:absolute", "overflow:hidden"]) ??
    firstMatch(lower, bound("flex|grid|gap"))
  );
}

function findModal(lower: string): string | null {
  return firstMatch(
    lower,
    bound(
      String.raw`always|never|do not|don't|don’t|must not|prohibido|nunca|siempre|no debes`,
    ),
  );
}

function findVagueAdverb(lower: string): string | null {
  return (
    firstPhrase(lower, [
      "cuando sea necesario",
      "cuando haga falta",
      "siempre que se pueda",
      "siempre que sea posible",
      "en la medida de lo posible",
      "de forma adecuada",
      "de manera apropiada",
      "lo antes posible",
      "si es posible",
      "si se puede",
      "según convenga",
      "segun convenga",
      "as soon as possible",
      "as much as possible",
      "whenever possible",
      "where possible",
      "as appropriate",
      "as necessary",
      "as possible",
      "as needed",
      "when necessary",
      "when needed",
      "if needed",
      "if possible",
    ]) ??
    firstMatch(
      lower,
      bound(
        String.raw`quickly|rapidly|properly|appropriately|reasonably|carefully|seamlessly|r[aá]pido|r[aá]pidamente|adecuadamente|apropiadamente`,
      ),
    )
  );
}

function findVagueVerb(lower: string): string | null {
  return firstMatch(
    lower,
    bound(
      String.raw`optimiz(?:e|es|ing|a|ar)|improv(?:e|es|ing)|enhanc(?:e|es|ing)|clean[- ]?up|polish(?:es|ing)?|simplif(?:y|ies|ing)|streamlin(?:e|es|ing)|mejor[ae]r?|limpi[ae]r?|pul(?:e|ir|ida)|perfeccion(?:ar|a)?|agiliz(?:ar|a)?`,
    ),
  );
}

function findSubjective(lower: string): string | null {
  return firstMatch(
    lower,
    bound(
      String.raw`clean|elegant|robust|readable|maintainable|idiomatic|professional|limpio|elegante|robusto|adecuado|apropiado|fluido|fluida|sutil|profesional|mantenible`,
    ),
  );
}

function findHedge(lower: string): string | null {
  return (
    firstPhrase(lower, ["try to", "feel free", "en general"]) ??
    firstMatch(lower, bound("consider|generally|usually|intenta|procura|considera|normalmente"))
  );
}

const PLUS_DETECTORS: readonly Detector[] = [
  { id: "backtick", delta: 3, find: (original) => findBacktick(original) },
  { id: "package_script", delta: 3, find: (_o, lower) => findPackageScript(lower) },
  { id: "file_path", delta: 2, find: (_o, lower) => findFilePath(lower) },
  {
    id: "concrete_threshold",
    delta: 2,
    find: (_o, lower) => findThreshold(lower),
  },
  { id: "format_or_charset", delta: 3, find: (_o, lower) => findFormat(lower) },
  {
    id: "checkable_token",
    delta: 2,
    find: (_o, lower) => findCheckableToken(lower),
  },
  {
    id: "verifiable_action",
    delta: 2,
    find: (_o, lower) => findVerifiableAction(lower),
  },
  {
    id: "css_identifier",
    delta: 2,
    find: (_o, lower) => findCssIdentifier(lower),
  },
];

const MINUS_DETECTORS: readonly Detector[] = [
  { id: "vague_adverb", delta: -2, find: (_o, lower) => findVagueAdverb(lower) },
  { id: "vague_verb", delta: -2, find: (_o, lower) => findVagueVerb(lower) },
  {
    id: "subjective_quality",
    delta: -2,
    find: (_o, lower) => findSubjective(lower),
  },
  { id: "hedge", delta: -1, find: (_o, lower) => findHedge(lower) },
];

function signal(id: string, delta: number, snippet?: string): string {
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  return snippet === undefined ? `${id}:${signed}` : `${id}:${signed}:${snippet}`;
}

export function scoreRule(rule: Rule): RuleScore {
  const original = rule.text;
  const lower = stripBold(original.normalize("NFC").toLowerCase());
  const signals: string[] = [];
  let raw = BASE;
  let plusCount = 0;

  for (const detector of PLUS_DETECTORS) {
    const snippet = detector.find(original, lower);
    if (snippet !== null) {
      signals.push(signal(detector.id, detector.delta, snippet));
      raw += detector.delta;
      plusCount += 1;
    }
  }

  if (plusCount > 0) {
    const modal = findModal(lower);
    if (modal !== null) {
      signals.push(signal("modal_on_checkable", 1, modal));
      raw += 1;
    }
  }

  for (const detector of MINUS_DETECTORS) {
    const snippet = detector.find(original, lower);
    if (snippet !== null) {
      signals.push(signal(detector.id, detector.delta, snippet));
      raw += detector.delta;
    }
  }

  if (plusCount === 0) {
    signals.push(signal("no_checkable", NO_CHECKABLE_DELTA));
    raw += NO_CHECKABLE_DELTA;
    raw = Math.min(raw, CAP_WITHOUT_PLUS);
  }

  const score = Math.max(0, Math.min(10, raw));
  return { score, signals };
}

export function averageScore(scores: readonly number[]): number {
  if (scores.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const value of scores) {
    sum += value;
  }
  return sum / scores.length;
}
