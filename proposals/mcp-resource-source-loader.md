# Proposal: MCP-resource-as-source loader (v1)

**Status:** draft, no implementation
**Motivated by:** issue #6 under the #5 source-loader-expansion tracker. The codebase loader (cli-v0.15.0) covered code-resident knowledge. MCP servers are the next surface vendors expose: Context7, Mintlify-style docs servers, custom enterprise MCP endpoints. Pickled cannot register that content today. `DocSourceType` at `packages/config/src/types.ts:144` declares `"mcp"` as a valid type; the loader at `packages/core/src/sources.ts:62` does not implement it.
**Decision needed:** scope (resources vs tools), schema shape, transport choice, fetch timing, caching, audit interaction, error handling.

## Problem

MCP (Model Context Protocol) is increasingly load-bearing context for agents. A vendor publishing a Context7 server that exposes their docs as MCP resources wants to know whether agents reading those resources can answer scenarios correctly. There is no first-class way to register MCP resource content as a `docs.sources` entry today; vendors have to copy-paste the resource content into a file or skip the test.

The MCP spec (https://modelcontextprotocol.io/specification/2025-03-26/basic/index) separates server features into three categories with different shapes and safety constraints. The codebase loader proved that mapping a new content shape onto `docs.sources` is straightforward; the design weight here is in picking *which* MCP shape pickled actually consumes, and *when* it consumes it.

## Decision 1: scope (resources only for v1)

**Recommendation:** v1 supports MCP **resources** only. Tools and prompts are out of scope.

MCP server features per the spec:

- **Resources** (https://modelcontextprotocol.io/specification/2025-03-26/server/resources) - context/data exposed for clients to read. Read-shaped. No side effects. Maps cleanly to "registered source content."
- **Prompts** - reusable prompt templates. Adjacent but not what `docs.sources` models. Out of scope.
- **Tools** (https://modelcontextprotocol.io/specification/2025-03-26/server/tools) - model-invoked actions. Side-effect-shaped, safety-sensitive. Letting the model freely call tools during a pickled `check` would break deterministic citation scoring (the agent could fetch arbitrary content, scoring becomes non-reproducible). Out of scope.

Resources map onto pickled's existing "registered source" mental model with no contract bending. Tools are a separate product question that should not block this v1.

## Decision 2: fetch timing (ahead of scenario run)

**Recommendation:** pickled fetches the declared MCP resources **before** the scenario starts, then injects their content as a registered source. The agent sees prose, not an MCP capability. The agent does NOT have live MCP access during scoring.

Why: pickled's strength is the controlled-context experiment. Live MCP access during scoring would let the agent fetch any resource (or call any tool the server exposes) mid-inference, which breaks the "we register exactly these sources" contract that makes scoring deterministic. Fetch-ahead-of-time preserves the contract: the resource content is captured once per run, injected as source text, and scored normally.

Cost: the resource content is a snapshot at scenario-run time. Vendors who care about live MCP behavior (the agent reasoning about a tool's response in real time) need a different mechanism. That mechanism is a future proposal (tool-result fixtures, possibly).

## Decision 3: schema shape

**Recommendation:** explicit object form with `type: mcp`. The entry declares the transport, the connection details, and a list of resource URIs to fetch.

```yaml
docs:
  sources:
    context7_docs:
      type: mcp
      transport: stdio                # or "sse" | "http" in v2
      command: context7                # required when transport: stdio
      args: ["--read-only"]            # optional, command args
      env:                             # optional, env vars for the subprocess
        CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}"
      resources:
        - "context7://docs/install"
        - "context7://docs/quickstart"
```

For v1, only `transport: stdio` is supported. SSE and HTTP transports are real spec-supported options and a follow-up.

Resource URIs are exact. No globbing, no auto-discovery (`list_resources`-and-pick). Vendors declare what they want tested. Auto-discovery would let the registered-source contract drift silently when the server changes its catalog.

## Decision 4: caching (no v1 cache, per-run fetch)

**Recommendation:** v1 fetches every declared resource on every `pickled check` run. No on-disk cache.

Why: simplicity. MCP servers running locally over stdio are typically fast. The cost is one extra subprocess spawn + N resource fetches per check run. Acceptable for v1; a TTL cache is a follow-up if vendors hit pain.

This matches the existing URL loader's behavior (fetched on every check). Same trade-off, same future-cache-needed signal.

## Decision 5: audit interaction (URL-class; skipped in audit v1)

**Recommendation:** MCP-fetched resources are SKIPPED by the audit's trap cross-reference rule in v1, matching the URL-source decision in `proposals/audit-trap-source-crossref.md`.

Why: audit must be local and deterministic. Fetching MCP resources during audit would require spawning the MCP server subprocess (or hitting a remote endpoint) on every PR. That adds latency, network/process dependencies, and flake risk to a workflow that today is fast and fully local.

Future: opt-in MCP audit (`audit.mcpScan: true` per source, with timeouts and cache) once the local rule has shipped and vendors ask for the coverage. Listed alongside the URL-scan follow-up under issue #5's notes.

## Decision 6: error handling

**Recommendation:** fail-loud on MCP errors during `check`. Fail-clean on MCP errors during `audit` (because audit skips MCP entirely; see Decision 5).

## Decision 7: env substitution rule

**Recommendation:** support **full-value substitution only**. `FOO: "${FOO}"` reads the env var verbatim into the spawned subprocess's environment. Inline interpolation like `token-${FOO}` is **not** supported in v1. Missing env vars fail loudly at config load with the source id and the missing variable name.

Why: full-value substitution covers the load-bearing case (API keys, tokens) without bringing in the surface area of a templating engine. Inline interpolation is harder to spec (escape rules, partial matches, recursive substitution) and the use cases are weak. If a vendor needs a composed value, they compose it in the shell before invoking pickled.

Behavior:
- Each value in the source's `env` block is parsed for an exact `"${VAR}"` pattern (whitespace allowed inside braces).
- If the pattern matches, the literal env var value is substituted. If the env var is missing, throw at load time with `pickled.yml: docs.sources["<id>"].env.<KEY> references missing env var "VAR"`.
- If the pattern does not match (the value is literal text, or contains an inline template), the value is passed through unchanged. This means a literal `"token-${FOO}"` reaches the subprocess as-is, with the `${FOO}` literal. Documented behavior, not a silent expansion.

## Decision 8: MIME type handling

**Recommendation:** accept **text resources only** in v1. Specifically: MCP resource responses whose `mimeType` field starts with `text/` (e.g., `text/plain`, `text/markdown`, `text/html`). Reject anything else with a clear source-load error.

```
MCP source [context7]: resource "context7://docs/install" returned mimeType "application/pdf"; v1 supports text/* resources only.
```

Why: pickled injects source content into the agent's prompt as text. Binary content cannot be meaningfully embedded in a text prompt, and lenient acceptance would silently corrupt scoring. The text/* allowlist is conservative; vendors who want binary support write a follow-up issue with the use case.

Fallback rule: if the MCP server returns no `mimeType` field at all, pickled treats it as `text/plain` and accepts.

## Decision 9: subprocess cwd

**Recommendation:** the MCP server subprocess runs with **`cwd` set to the project root** (the directory containing `pickled.yml`), not whatever shell directory invoked pickled.

Why: matches file and codebase source behavior (both resolve relative paths from the project root). Reproducible regardless of where the operator invokes the CLI from. Documented explicitly so vendors writing MCP servers that read relative paths know what to expect.

In check:
- MCP server fails to start: the scenario errors with the server stderr captured.
- Resource fetch returns an error: the scenario errors with the MCP error code and message.
- Server starts but returns malformed payload: the scenario errors with the parse failure.

Each error sets `ScenarioResult.error` so the existing error rendering applies. No silent degradation; if the registered MCP resource cannot be fetched, the scenario cannot run.

## What does NOT change

- The existing file, URL, and codebase loaders. MCP is a new branch in `fetchSource`, parallel to the others.
- Citation scoring. The MCP-fetched content is treated as plain source text; the agent cites by source id.
- Compare-surfaces. An MCP source can be in a `compareSurfaces` list just like any other source id.
- Audit's structural rules (broken refs, line budgets, pair classification).
- Run discipline (`bun run verify`, semantic-release).

## Examples

**Single Context7-style server, two resources:**

```yaml
docs:
  sources:
    context7:
      type: mcp
      transport: stdio
      command: context7
      args: ["--read-only"]
      resources:
        - "context7://docs/install"
        - "context7://docs/api"
```

**Compare README vs MCP resource:**

```yaml
scenarios:
  - name: "Install instructions"
    prompt: "How do I install the product?"
    requiredSources: [readme]
    compareSurfaces:
      - [readme]
      - [context7]
      - [readme, context7]
```

If the MCP server's install resource is fresh but README is stale, surfaces split and the matrix tells the vendor which surface to fix.

## JSON output

`ResolvedDocSource` for an MCP source gains an optional `fetchedResources: string[]` field listing the URIs that were successfully fetched. Similar shape to the codebase loader's `matchedFiles`.

```jsonc
{
  "id": "context7",
  "source": "context7://(2 resources)",
  "name": "2 resources from context7 (stdio)",
  "type": "mcp",
  "content": "...concatenated resource content with URI headers...",
  "fetchedResources": [
    "context7://docs/install",
    "context7://docs/api"
  ],
  "auditTraps": true
}
```

## Out of scope

- **MCP tools-as-source** (agent invokes tools during scoring). Different design; touches determinism contract.
- **Tool-result fixtures** (recorded tool responses replayed as registered source content). Real product idea, separate proposal.
- **Auto-discovery via `list_resources`.** Forces vendors to declare URIs explicitly; protects against catalog drift.
- **MCP prompts.** Different concept; not what `docs.sources` models.
- **SSE and HTTP transports.** v1 ships stdio only. Add as follow-ups; the schema's `transport` field reserves the slot.
- **On-disk caching with TTL.** Per-run fetch in v1; cache is a follow-up.
- **Audit cross-reference for MCP sources.** Skipped in audit v1, mirroring the URL-source decision.

## Implementation order

1. Schema: extend `DocSourceEntry` with `type: mcp` and the MCP-specific fields (`transport`, `command`, `args`, `env`, `resources`). Update loader validation: require `transport: stdio` in v1, require `command`, require non-empty `resources` list of strings.
2. SDK dependency: add `@modelcontextprotocol/sdk` to `packages/core/package.json` as a direct dependency.
3. Loader: new branch in `fetchSource` for `type: mcp`. Spawn the MCP server via stdio (cwd = project root per Decision 9, env substituted per Decision 7), read each declared URI directly via `resources/read` (no `list_resources` call - per Decision 3 there is no auto-discovery, so listing has no purpose; a missing resource fails loudly on the read), validate the mimeType per Decision 8, close the connection cleanly. Concatenate fetched content with URI headers.
4. Audit interaction: extend `scanSourceTraps` to skip MCP sources (mirror the URL skip at `source-traps.ts:54` for the same reasons).
5. Tests: stdio spawn happy path with mocked subprocess, resource fetch returns content, error on missing resource, error on server failure, content concatenation order is deterministic by URI list order.
6. Dogfood: optional. We do not run an MCP server in this repo today. Skip the pickled.yml dogfood addition; cover behavior in unit tests only.
7. Docs: extend `apps/cli/README.md` Sources section with the MCP shape and the resource-only-not-tools constraint. Update `llms.txt` Source contract sentence with `mcp` in the loader types list.

## Open questions

1. **MCP server subprocess lifecycle.** Spawn once per source, hold the connection across multiple resource fetches, then close? Or one spawn per fetch? Lean toward one spawn per source (fewer subprocess starts, lower latency for multi-resource sources). Decide during implementation; either choice is invisible to vendors as long as resource content arrives correctly.
2. ~~**Resource MIME types.**~~ Resolved in Decision 8: text/* only; missing mimeType treated as text/plain; non-text rejected with a clear source-load error.
3. ~~**`env` substitution.**~~ Resolved in Decision 7: full-value `"${VAR}"` substitution only, no inline interpolation, missing var fails at load.
4. ~~**`Cwd` for the spawned MCP server.**~~ Resolved in Decision 9: project root (directory containing pickled.yml).
