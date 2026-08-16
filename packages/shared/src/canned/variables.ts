/**
 * Canned response variables.
 *
 * Bodies are stored verbatim with `{{token}}` placeholders; substitution happens
 * when a snippet is inserted into the composer, so an edited snippet always
 * renders with the current conversation's context.
 */

export const CANNED_VARIABLE_NAMES = [
  "visitor.name",
  "visitor.email",
  "operator.name",
  "workspace.name",
  "conversation.id",
] as const;

export type CannedVariableName = (typeof CANNED_VARIABLE_NAMES)[number];

/**
 * PRD §4.10 documents `{{agent.name}}`; the canonical token is
 * `{{operator.name}}` (the dashboard calls these members "operators"). The alias
 * resolves to the same value so older snippets keep working.
 */
export const CANNED_VARIABLE_ALIASES: Readonly<Record<string, CannedVariableName>> = {
  "agent.name": "operator.name",
};

export type CannedVariableContext = {
  visitorName?: string | null;
  visitorEmail?: string | null;
  operatorName?: string | null;
  workspaceName?: string | null;
  conversationId?: string | null;
};

export type CannedVariableDescriptor = {
  name: CannedVariableName;
  /** Token as typed into a body, e.g. `{{visitor.name}}`. */
  token: string;
  label: string;
  description: string;
};

const DESCRIPTORS: readonly CannedVariableDescriptor[] = [
  {
    name: "visitor.name",
    token: "{{visitor.name}}",
    label: "Visitor name",
    description: "Name on the conversation's contact record.",
  },
  {
    name: "visitor.email",
    token: "{{visitor.email}}",
    label: "Visitor email",
    description: "Email on the conversation's contact record.",
  },
  {
    name: "operator.name",
    token: "{{operator.name}}",
    label: "Your name",
    description: "Display label of the member inserting the snippet.",
  },
  {
    name: "workspace.name",
    token: "{{workspace.name}}",
    label: "Workspace name",
    description: "Name of the current workspace.",
  },
  {
    name: "conversation.id",
    token: "{{conversation.id}}",
    label: "Conversation id",
    description: "Identifier of the open conversation.",
  },
];

export function listCannedVariables(): readonly CannedVariableDescriptor[] {
  return DESCRIPTORS;
}

export function formatCannedVariableToken(name: string): string {
  return `{{${name}}}`;
}

export function resolveCannedVariableName(raw: string): CannedVariableName | null {
  const name = raw.trim().toLowerCase();
  if ((CANNED_VARIABLE_NAMES as readonly string[]).includes(name)) {
    return name as CannedVariableName;
  }
  return CANNED_VARIABLE_ALIASES[name] ?? null;
}

/** Matches `{{ token }}` with optional inner whitespace. */
const VARIABLE_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export type CannedVariableMatch = {
  raw: string;
  /** Token text as written, e.g. `agent.name`. */
  token: string;
  /** Canonical variable, or null for unknown tokens. */
  name: CannedVariableName | null;
  start: number;
  end: number;
};

export function extractCannedVariables(body: string): CannedVariableMatch[] {
  const matches: CannedVariableMatch[] = [];
  const re = new RegExp(VARIABLE_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const token = match[1] ?? "";
    matches.push({
      raw: match[0],
      token,
      name: resolveCannedVariableName(token),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}

function valueForVariable(name: CannedVariableName, context: CannedVariableContext): string | null {
  switch (name) {
    case "visitor.name":
      return context.visitorName ?? null;
    case "visitor.email":
      return context.visitorEmail ?? null;
    case "operator.name":
      return context.operatorName ?? null;
    case "workspace.name":
      return context.workspaceName ?? null;
    case "conversation.id":
      return context.conversationId ?? null;
    default: {
      const exhaustive: never = name;
      return exhaustive;
    }
  }
}

/**
 * Replace known `{{variable}}` tokens with context values.
 *
 * Unknown tokens are left untouched so a typo (or a future variable) survives
 * insertion and stays visible to the operator. A known token with no value
 * resolves to an empty string by default — sending literal template syntax to a
 * customer is worse than an empty slot the operator can see and fix before
 * pressing send. Pass `missing: "token"` to keep the placeholder instead.
 */
export function interpolateCannedBody(
  body: string,
  context: CannedVariableContext,
  options: { missing?: "empty" | "token" } = {},
): string {
  const keepMissing = options.missing === "token";
  return body.replace(VARIABLE_TOKEN_RE, (raw, rawToken: string) => {
    const name = resolveCannedVariableName(rawToken);
    if (!name) {
      return raw;
    }
    const value = valueForVariable(name, context);
    if (value === null || value === "") {
      return keepMissing ? raw : "";
    }
    return value;
  });
}

/** Known variables in `body` that resolve to nothing for the given context. */
export function missingCannedVariables(
  body: string,
  context: CannedVariableContext,
): CannedVariableName[] {
  const missing: CannedVariableName[] = [];
  const seen = new Set<CannedVariableName>();
  for (const match of extractCannedVariables(body)) {
    if (!match.name || seen.has(match.name)) {
      continue;
    }
    const value = valueForVariable(match.name, context);
    if (value === null || value === "") {
      seen.add(match.name);
      missing.push(match.name);
    }
  }
  return missing;
}

/** Unknown `{{token}}`s, for inline validation while editing a snippet. */
export function unknownCannedVariables(body: string): string[] {
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const match of extractCannedVariables(body)) {
    if (match.name || seen.has(match.token)) {
      continue;
    }
    seen.add(match.token);
    unknown.push(match.token);
  }
  return unknown;
}
