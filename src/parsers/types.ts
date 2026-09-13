export type Rule = {
  text: string;
  line: number;
  section?: string;
};

export type ParsedSection = {
  title: string;
  level: number;
  line: number;
  rules: Rule[];
};

export type ParsedDocument = {
  title: string;
  sections: ParsedSection[];
};

export type DocumentParser = {
  kind: string;
  parse(content: string): ParsedDocument;
};
