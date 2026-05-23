# Proposal: MCP live toolset

**Status:** locked, ready to implement
**Motivated by:** the matrix-evaluation product tests `(interface × source × toolset)` cells. Today only `none` and `web` toolsets run. The next genuinely different developer path is MCP: the agent invokes tools from a configured MCP server at inference (e.g., Context7's `resolve-library-id`, `get-library-docs`). This is distinct from the parked "MCP resource as source" path (which prefetches MCP resources and injects them as controlled-mode source text).
**Decision needed:** how to recognize, allow, and provenance-check MCP-shaped toolsets without baking any specific server's name into pickled.

## What ships

A generic MCP toolset adapter. The user names the toolset whatever they want (`docs_mcp`, `context7`, `internal_docs`). Pickled has no hardcoded server-specific knowledge.

Schema is already in place:

- `ToolsetConfig.mcpServers: Record<string, McpServerConfig>` exists in `packages/config/src/types.ts`.
- `McpServerConfig` already supports `stdio`, `http`, `sse` transports.
- The matrix runner already forwards `toolsetConfig?.mcpServers` into the per-cell target config.
- The Claude Code target adapter already passes `mcpServers` to the Agent SDK.

The blocker is the runtime gate at `check.ts:567-572` that rejects non-web toolsets, and the web-specific provenance match that only recognizes `WebSearch` / `WebFetch` by exact name.

## Decisions

1. **Recognition.** A toolset is the MCP shape iff `mcpServers` is present and non-empty. A toolset is the web shape iff `webSearch === true` or `webFetch === true`. Both shapes together in one toolset is an error (declare two separate toolsets); the cell runner cannot honestly attribute provenance to a mixed shape.

2. **Allowed tools.** For an MCP cell, pickled sets the SDK's `tools: []` (built-ins disabled) AND `allowedTools: [mcp__<server1>__*, mcp__<server2>__*, ...]` (auto-permission for the configured server wildcards). The two-option dance is required because the SDK's `allowedTools` is an auto-permission list, not an availability restriction; without `tools: []` the agent can still call any built-in (Read/Bash/Glob), bypassing the configured MCP path. Web cells follow the same shape: `tools: ["WebSearch", "WebFetch"]` plus the matching `allowedTools`.

3. **Provenance.** A tool invocation counts toward provenance iff its name starts with `mcp__<server>__` for any configured server. Web stays exact-match (`WebSearch`, `WebFetch`). Provenance failure (no qualifying tool was invoked) is a hard veto with the same shape as trap firing: `answerable = NO`, `confidence = 0`, diagnostics retained in the reason. This rule was locked in cli-v0.17.2 for web cells; it generalizes here.

4. **Discovery prompt.** Source is not injected (same as web). The discovery hint still names the canonical source so the agent has a target to find. The prompt no longer enumerates tool names (`e.g., WebSearch, WebFetch`); the agent sees the available tools from the SDK and is told to use them. Naming a fixed example list would be wrong for MCP cells.

5. **Transport.** Pass-through. Whatever shape `McpServerConfig` already accepts (`stdio`, `http`, `sse`) flows to the SDK unchanged. Pickled does not validate transport beyond the schema.

6. **Interface restriction.** MCP cells run on `claude-code` provider only today, same as web cells. Other providers (Codex CLI, Anthropic API direct) cannot proxy MCP server access through the same SDK path; that lands per release with the relevant adapter.

7. **Multiple servers.** If a toolset declares multiple MCP servers, provenance accepts a tool from any of them. A stricter rule ("agent must call server X specifically") can be added later as a per-cell `requireMcpServer` field if vendors ask. YAGNI for v1.

8. **`requireMcpTools` / `expectedTools` field.** Deferred. The implicit "any configured tool counts" rule fits the axis semantic (did the agent use this MCP path?). A per-scenario explicit allowlist of tool names can land later if vendors need it for specific cells.

## Out of scope

- Tools-from-source MCP resource loader (parked in `plan.md`).
- Non-Claude-Code interfaces.
- Cost/sampling primitives for MCP-heavy matrices (parked).

## Dogfood

`pickled.yml` ships a Context7 toolset declaration:

```yaml
toolsets:
  none: {}
  web:
    webSearch: true
    webFetch: true
  context7_mcp:
    mcpServers:
      context7:
        type: http
        url: https://mcp.context7.com/mcp
        headers:
          CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}
```

and a matrix scenario that uses it. The scenario is opt-in (not in `matrix.target`) because Context7 requires an API key and hits an external service. Dispatch with `pickled check --target quick --interface quick --toolset context7_mcp`.

Context7 is the dogfood example, not the feature. The feature is the generic adapter.

## Notes for implementation

- `pickled audit . --fail-on error` must still pass; the MCP adapter does not touch the audit path.
- Cell-level error containment from cli-v0.17.1 covers MCP runtime failures (server unreachable, transport timeout) the same way it covers web failures.
- `maxTurns` bump to 15 for non-none cells already covers MCP roundtrips (typically `resolve` → `fetch` → reason → respond).
- Mark this proposal "shipped" in plan.md after the release.
