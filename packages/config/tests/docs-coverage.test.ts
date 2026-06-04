import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards a cross-file invariant the code cannot enforce structurally: every
// field in the published JSON Schema (packages/config/schema/pickled.schema.json)
// must stay documented in the hand-written reference (apps/docs/content/docs/
// pickled-yml.mdx), and the page must not drift back to v1 vocabulary. The
// schema owns shape; the page owns explanation; we do not generate one from the
// other, so this is the drift guard between them.
const SCHEMA_PATH = join(import.meta.dir, "../schema/pickled.schema.json");
const DOCS_PATH = join(
  import.meta.dir,
  "../../../apps/docs/content/docs/pickled-yml.mdx",
);
const SCHEMA_URL = "https://pickled.dev/schema/pickled.schema.json";
const SURFACE_PATHS = [
  "../../../README.md",
  "../../../apps/cli/README.md",
  "../../../apps/docs/content/docs/index.mdx",
  "../../../apps/docs/content/docs/getting-started.mdx",
  "../../../apps/docs/content/docs/github-actions.mdx",
  "../../../apps/docs/content/docs/pickled-yml.mdx",
  "../../../apps/web/content/blog/agent-evals-in-ci.mdx",
  "../../../apps/web/content/blog/deterministic-agent-evals.mdx",
  "../../../apps/web/content/blog/no-tool-web-mcp-agent-answers.mdx",
  "../../../apps/web/content/blog/testing-agent-builds-with-docs.mdx",
  "../../../apps/web/content/blog/testing-agents-md-claude-md.mdx",
  "../../../apps/web/content/blog/testing-llms-txt.mdx",
  "../../../apps/web/content/blog/testing-public-product-context.mdx",
  "../../../apps/web/og-card.html",
  "../../../apps/web/src/components/Hero.tsx",
  "../../../apps/web/src/components/Example.tsx",
  "../../../llms.txt",
  "../../../apps/web/public/llms.txt",
  "../../../pickled.yml",
  "../../../AGENTS.md",
  "../../../brand.md",
  "../../../comment-policy.md",
  "../../../.github/workflows/agent-dogfood.yml",
] as const;

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as Record<
  string,
  unknown
>;
const docs = readFileSync(DOCS_PATH, "utf8");
const surfaces = SURFACE_PATHS.map((relativePath) => ({
  relativePath,
  content: readFileSync(join(import.meta.dir, relativePath), "utf8"),
}));

// A user-written field is a key under any `properties` object. Map-valued
// sections (sources/agents/contexts/facts/...) carry their field names inside
// the $def they reference, so a full recursive walk is what reaches them.
function collectFieldNames(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFieldNames(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const props = obj.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    for (const key of Object.keys(props)) out.add(key);
  }
  for (const value of Object.values(obj)) collectFieldNames(value, out);
}

const fieldNames = new Set<string>();
collectFieldNames(schema, fieldNames);

const topLevelKeys = Object.keys(
  (schema.properties ?? {}) as Record<string, unknown>,
);

// v1 vocabulary that must never reappear in the v2 reference. Each is a term
// the v2 schema replaced; their presence means the page drifted back.
const V1_TERMS = [
  "mustMention",
  "mustNotMention",
  "mustMentionOneOf",
  "answerable",
  "## Sources",
  "access path",
  "tools:",
];

const STALE_SURFACE_PATTERNS = [
  /mustMention/,
  /mustNotMention/,
  /mustMentionOneOf/,
  /answerable/,
  /## Sources/,
  /access paths?/,
  /toolset/,
  /confidence/,
  /\bGrounded\b/,
  /Scenario verdict/,
  /getScenarioStatus/,
  /provenanceFailed/,
  /cited:/,
  /\([0-9]+%\)/,
  /missing: \[/,
  /mode none/,
  /questions score fact coverage and misstatement rejection across trials/,
  /question trials/,
  /question cell is `YES` only when every scored trial/,
  /Use `k\/n` for both question/,
  /Set a `threshold` in `pickled\.yml`/,
] as const;

describe("pickled.yml docs coverage", () => {
  test("the field walk finds the public fields", () => {
    expect(fieldNames.size).toBeGreaterThan(15);
  });

  test("the docs page links the published schema", () => {
    expect(docs).toContain(SCHEMA_URL);
  });

  test("every top-level key has a section heading", () => {
    const missing = topLevelKeys.filter(
      (key) => !new RegExp(`^#{2,4} .*\\b${key}\\b`, "m").test(docs),
    );
    expect(missing).toEqual([]);
  });

  // Plain substring matching would let generic names (id, name, source, pass,
  // fail) pass via an unrelated word, so require each field to appear where it
  // documents a field: inline code `field` or a YAML key `field:`.
  test("every public schema field is documented as code or a YAML key", () => {
    const documented = (field: string) =>
      docs.includes(`\`${field}\``) ||
      new RegExp(`(^|[^\\w])${field}:`, "m").test(docs);
    const missing = [...fieldNames].filter((field) => !documented(field));
    expect(missing).toEqual([]);
  });

  test("the page does not drift back to v1 vocabulary", () => {
    const present = V1_TERMS.filter((term) => docs.includes(term));
    expect(present).toEqual([]);
  });

  test("public and agent-facing surfaces do not drift back to v1 vocabulary", () => {
    const failures = surfaces.flatMap(({ relativePath, content }) =>
      STALE_SURFACE_PATTERNS.filter((pattern) => pattern.test(content)).map(
        (pattern) => `${relativePath}: ${pattern.source}`,
      ),
    );
    expect(failures).toEqual([]);
  });
});
