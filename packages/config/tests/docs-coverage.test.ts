import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards a cross-file invariant the code cannot enforce structurally: every
// field in the published JSON Schema (packages/config/schema/pickled.schema.json)
// must stay documented in the hand-written reference (apps/docs/content/docs/
// pickled-yml.mdx). Adding a schema field without documenting it fails here.
// The schema owns shape; the page owns explanation. We do not generate the
// page from the schema, so this is the drift guard between them.
const SCHEMA_PATH = join(import.meta.dir, "../schema/pickled.schema.json");
const DOCS_PATH = join(
  import.meta.dir,
  "../../../apps/docs/content/docs/pickled-yml.mdx",
);
const SCHEMA_URL = "https://pickled.dev/schema/pickled.schema.json";

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as Record<
  string,
  unknown
>;
const docs = readFileSync(DOCS_PATH, "utf8");

// A user-written field is a key under any `properties` object. Map-valued
// sections (sources/agents/access) carry their field names inside the $def
// they reference, so a full recursive walk is what reaches them.
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
const checkKeys = Object.keys(
  (schema.$defs as Record<string, { properties?: Record<string, unknown> }>)
    .checks.properties ?? {},
);

describe("pickled.yml docs coverage", () => {
  // Without this, a walk that silently collects nothing would pass every
  // assertion below by checking an empty set.
  test("the field walk finds the public fields", () => {
    expect(fieldNames.size).toBeGreaterThan(15);
    expect(checkKeys.length).toBeGreaterThan(0);
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

  test("every check key appears as inline code", () => {
    const missing = checkKeys.filter((key) => !docs.includes(`\`${key}\``));
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
});
