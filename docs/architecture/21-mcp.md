# 21 · MCP Integration

> Scope: Model Context Protocol server lifecycle, transports and reconnection, tool exposure to the agent,
> Elicitation round-trips, and storage. Last verified against `src/main/mcp/*` and `src/shared/mcp.ts` at
> v0.2.4.

## 1. Module and lifecycle

`createMcpModule({ db, getWindows, remoteDebuggingPort })` builds an `McpService` over an `McpClient`.
`McpModule.initialize()` (`mcp/module.ts:176-180`) runs `service.syncFromStore()` →
`client.syncServers(mergedServers())`, then subscribes to connection-state changes and broadcasts them to all
windows via `MCP_CHANNELS.connectionStatesChanged`. It is fired async after the UI is up (see
[03 Process Model](./03-process-model.md)).

`syncServers` (`mcp/client.ts:197-246`) reconciles the desired server list against live connections:
disconnected servers are removed; disabled servers are disconnected but keep a `disconnected` state; unchanged
connected servers are left alone; new or changed servers are connected. All per-server operations are serialized
through `#withServerOperation` (a per-name chained promise queue).

**Connect** (`client.ts:496-593`): state → `connecting`; build the transport; call `createMCPClient({ transport,
clientName, version, capabilities: { elicitation: {} }, onUncaughtError })` inside a 120 s timeout; register the
elicitation handler; on success store the connection and set state → `connected` (and refresh the tool count);
on failure set state → `error` and schedule a reconnect if enabled.

**Disconnect** (`client.ts:617-643`): `connection.client.close()`, then either remove the state or preserve it
as `disconnected` (keeping `serverInfo` / `instructions`).

## 2. Transports (`mcp/transport.ts`)

`createMcpTransport(config)` supports:

- **stdio**: expands env vars (`mcp/env.ts`), strips sensitive keys via `safeChildEnv`, and on Windows resolves
  `.bat` / `.cmd` to `cmd.exe /d /c <script>` while blocking args containing CMD metacharacters. Creates an
  `Experimental_StdioMCPTransport` from `@ai-sdk/mcp/mcp-stdio` with `stderr: 'inherit'` and the resolved cwd.
- **http / sse**: expands env, validates the URL protocol is `http(s)`, and returns
  `{ type, url, headers, redirect }` (default `redirect: 'error'`) passed to `createMCPClient`. For outbound
  network fields (url, headers), only non-sensitive env vars are expanded.

## 3. Reconnection (`mcp/client.ts:645-693`)

- **Only remote transports** (`http` / `sse`) auto-reconnect; stdio is **not** auto-reconnected.
- Exponential backoff `delay = min(1000 × 2^(attempt-1), 30000)`, up to `MAX_RECONNECT_ATTEMPTS = 5`; after
  exhaustion the state becomes `error` ("Reconnect attempts exhausted").
- Manual `reconnectServer(name)` resets the counter and reconnects with `throwOnFailure: true`.

## 4. Tool exposure

`toolsForServer(serverName)` (`client.ts:325-331`): ensures the server is connected (on demand), lists all its
tools with a cursor-paginated loop (guarded against runaway pagination), and wraps the definitions into the
Vercel AI SDK `ToolSet` format via `connection.client.toolsFromDefinitions(...)`. The MCP layer does not merge
across servers — the agent's tool registry does that, namespacing keys as `mcp__<server>__<tool>` and deriving
each tool's approval `kind` from its `readOnlyHint` / `destructiveHint` annotations. See [12 Tools](./12-tools.md).

## 5. Elicitation round-trips

When a server needs input from the user, it sends an elicitation request. The flow (`mcp/module.ts:131-164`):

1. The SDK client's `onElicitationRequest` handler fires with `{ serverName, message, requestedSchema }`.
2. The module generates a UUID `requestId`, stores a promise resolver in `pendingElicitations`, and sends
   `MCP_CHANNELS.elicitationRequested` to the primary window. If no window exists, it resolves immediately with
   `{ action: 'cancel' }`.
3. A timeout (`DEFAULT_ELICITATION_TIMEOUT_MS = 5 × 60_000`) resolves `{ action: 'cancel' }` on expiry.
4. The renderer replies over `MCP_CHANNELS.resolveElicitation` with `(requestId, result)`; the IPC handler
   validates the id and `result` and calls `resolveElicitation`, which clears the timer and resolves the
   promise. The MCP SDK receives `{ action: 'accept' | 'decline' | 'cancel', content? }`.

The renderer host is `McpElicitationHost` (see [30 Renderer](./30-renderer.md)).

## 6. Storage and server merge

MCP servers are stored in the `mcp_servers` SQLite table (`mcp/store.ts`), with columns for `id`, `name`
(UNIQUE), `transport` (`stdio | sse | http`), `command`, `args_json`, `cwd`, `url`, `headers_json`, `redirect`,
`env_json`, and `enabled`. Array/object fields are JSON blobs, re-parsed with `z.safeParse`.
`sanitizeServerForTransport` strips columns irrelevant to the transport (e.g. no `command` for http/sse).
Validation requires a name, a `command` for stdio, and a `url` for http/sse (duplicate names raise
`MCP_SERVER_NAME_DUPLICATE`). See [22 Persistence](./22-persistence.md).

Server merge priority (`mcp/service.ts`): user-defined DB servers win all name collisions, then plugin servers
(`setPluginServers`), then built-in servers (`setBuiltinServers`).

**Built-in browser server** (`mcp/module.ts`): when `remoteDebuggingPort > 0`, a `chrome-devtools` stdio server
is registered that runs `npx chrome-devtools-mcp@latest --browser-url http://127.0.0.1:<port>
--experimentalIncludeAllPages --blockedUrlPattern file://**`. The `--blockedUrlPattern file://**` prevents the
agent from navigating into or injecting into the Electron app's own `file://` renderers — a prompt-injection
boundary. See [03 Process Model](./03-process-model.md) and [50 Cross-Cutting](./50-cross-cutting.md).

Next → [22 Persistence](./22-persistence.md)
