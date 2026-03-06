# MCP Auth Example — Technical Documentation

This document explains how the MCP (Model Context Protocol) authentication flow works end-to-end, from user login through JWT verification, context propagation, and downstream API calls.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Authentication Flow](#authentication-flow)
4. [Components Deep Dive](#components-deep-dive)
5. [Context Propagation](#context-propagation)
6. [API Reference](#api-reference)
7. [Security Considerations](#security-considerations)
8. [Extending the Example](#extending-the-example)

---

## Overview

The example demonstrates a complete auth flow for MCP servers:

```
User login → OAuth (JWT issued)
       ↓
Agent receives JWT
       ↓
JWT passed to MCP server (Authorization: Bearer <token>)
       ↓
MCP verifies JWT + extracts roles
       ↓
Context attached to tool calls (AsyncLocalStorage)
       ↓
Downstream APIs use scoped tokens (same JWT forwarded)
```

**Key design decisions:**

- **Stateless JWT** — No server-side sessions; the token carries identity and roles
- **Same token, multiple services** — Auth service issues the JWT; MCP and downstream API both validate it
- **AsyncLocalStorage** — Propagates user context from HTTP middleware into async tool handlers
- **Role-based access** — Downstream API enforces permissions based on `roles` in the JWT

---

## Architecture

### System Diagram

```
┌─────────────────┐     POST /login      ┌──────────────────┐
│  User / Agent   │ ──────────────────► │  Auth Service    │
│  (browser/CLI)  │  {user, password}    │  :4000           │
└────────┬────────┘                      └────────┬─────────┘
         │                                        │
         │ JWT (sub, roles, scope)                 │
         │                                        │
         ▼                                        │
┌─────────────────┐     POST /mcp                 │
│  Agent / UI     │ ──────────────────────────►  │
│  (MCP Client)   │  Authorization: Bearer <jwt>  │
└────────┬────────┘                               │
         │                                        ▼
         │                              ┌──────────────────┐
         │                              │  MCP Server       │
         │                              │  :4001            │
         │                              │                   │
         │                              │  1. JWT middleware│
         │                              │  2. Verify + parse │
         │                              │  3. runWithUser() │
         │                              │  4. Tool handlers │
         │                              └────────┬─────────┘
         │                                       │
         │                                       │ Bearer <jwt>
         │                                       ▼
         │                              ┌──────────────────┐
         │                              │  Downstream API   │
         │                              │  :4002           │
         │                              │  Role-based auth │
         └─────────────────────────────┴──────────────────┘
```

### Port Assignments

| Port | Service | Role |
|------|---------|------|
| 4000 | Auth Service | Issues JWTs; mock OAuth |
| 4001 | MCP Server | Verifies JWT, exposes tools, forwards to downstream |
| 4002 | Downstream API | Validates JWT, enforces RBAC |
| 4003 | UI Server | Serves visualization; proxies API calls |

---

## Authentication Flow

### Step 1: User Login (OAuth)

The user (or agent) authenticates via `POST /login`:

```http
POST /login HTTP/1.1
Content-Type: application/json

{"username": "alice", "password": "pass123"}
```

**Response:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

The auth service looks up the user in `config.js`, derives `roles` and `scope`, and signs a JWT with HS256.

### Step 2: Agent Stores JWT

The agent (or UI) keeps the `access_token` for subsequent requests. No session cookie or server-side state.

### Step 3: JWT Passed to MCP

Every MCP request includes the JWT in the `Authorization` header:

```http
POST /mcp HTTP/1.1
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

### Step 4: MCP Verifies and Extracts Roles

The MCP server's `jwtAuth` middleware:

1. Reads `Authorization: Bearer <token>`
2. Verifies signature with `JWT_SECRET`
3. Checks `audience` equals `mcp-server`
4. Parses `sub`, `roles`, `scope` into `req.user`
5. Stores the raw token for forwarding (`req._rawToken`)

If verification fails → `401 Unauthorized` with JSON-RPC error.

### Step 5: Context Attached to Tool Calls

Before handling the request, the MCP handler wraps execution in:

```js
await runWithUser(
  { ...req.user, _token: req._rawToken },
  async () => { /* handle MCP request */ }
);
```

This sets the user context in `AsyncLocalStorage`. Any code running inside this callback (including tool handlers) can call `getUserContext()` to access the user.

### Step 6: Downstream APIs Use Scoped Tokens

When a tool (e.g., `fetch_downstream_data`) calls the downstream API, it passes the same JWT:

```http
GET /data HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

The downstream API validates the token again and checks `roles` for access control (e.g., `reader` can read, `admin` can read+write).

---

## Components Deep Dive

### Auth Service (`auth-service.js`)

**Purpose:** Mock OAuth provider that issues JWTs.

**Flow:**

1. Receives `{ username, password }` on `POST /login`
2. Validates against `config.js` USERS map
3. Derives `scope` from roles (admin → `data:read data:write admin`, reader → `data:read`)
4. Signs JWT with `jsonwebtoken`:
   - Payload: `sub`, `roles`, `scope`
   - Options: `issuer`, `audience`, `expiresIn: 1h`
5. Returns OAuth-style response: `{ access_token, token_type, expires_in }`

**Config:** `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` in `config.js`.

### MCP Server (`mcp-server.js`)

**Purpose:** MCP JSON-RPC server that requires JWT and propagates user context to tools.

**Request flow:**

1. `jwtAuth` middleware runs first → sets `req.user`, `req._rawToken`
2. Handler calls `runWithUser(userCtx, async () => { ... })`
3. Inside the callback: parse JSON-RPC, route by `method`
4. For `tools/call`: invoke `handleToolsCall(name, args)` inside the same async context
5. Tool handlers call `getUserContext()` to get `sub`, `roles`, `_token`

**Supported MCP methods:**

- `initialize` — Returns server info, session ID
- `notifications/initialized` — Ack (202)
- `tools/list` — Returns tool definitions
- `tools/call` — Executes tool; handlers use `getUserContext()`

**Tools:**

| Tool | Purpose | Uses Context |
|------|---------|--------------|
| `get_user_info` | Returns `sub`, `roles`, `scope` | `getUserContext()` |
| `fetch_downstream_data` | Calls downstream API with JWT | `getUserContext()._token` |

### User Context (`user-context.js`)

**Purpose:** Propagate user info from HTTP request into async tool execution.

**Mechanism:** Node.js `AsyncLocalStorage` — storage that is isolated per async execution context.

```js
// Set context (in request handler)
runWithUser({ sub: 'alice', roles: ['admin'], _token: '...' }, async () => {
  // Any code here, including deep async calls, can read:
  const user = getUserContext();  // { sub, roles, scope, _token }
});

// Read context (in tool handler)
function handleToolsCall(name, args) {
  const ctx = getUserContext();  // Same object set above
  // Use ctx._token to call downstream API
}
```

**Why AsyncLocalStorage?**

- Tool handlers are invoked inside `runWithUser`'s callback
- The MCP server doesn't pass context as function arguments
- AsyncLocalStorage propagates through the entire async call chain (including `await`)

### Downstream API (`downstream-api.js`)

**Purpose:** Example resource server that validates JWT and enforces RBAC.

**Endpoints:**

| Endpoint | Auth | Roles | Description |
|----------|------|-------|-------------|
| `GET /public` | None | — | Public data |
| `GET /data` | Bearer | reader, admin | Reader+ data; admin sees extra |
| `POST /data` | Bearer | admin | Write (admin only) |

**Auth middleware:** Verifies JWT with same `JWT_SECRET` and `audience`; attaches `req.user` with `sub`, `roles`.

### Config (`config.js`)

Central configuration:

```js
JWT_SECRET     // Shared by auth, MCP, downstream (sign/verify)
JWT_ISSUER     // Claim in JWT
JWT_AUDIENCE   // Must match for MCP and downstream
PORTS          // 4000, 4001, 4002
USERS          // { alice: { password, roles }, ... }
```

---

## Context Propagation

### Flow Through AsyncLocalStorage

```
HTTP Request
    │
    ▼
jwtAuth middleware
    │  req.user = { sub, roles, scope }
    │  req._rawToken = "eyJ..."
    │
    ▼
runWithUser({ ...user, _token }, async () => {
    │
    │  AsyncLocalStorage.run(userCtx, callback)
    │  → All code in callback sees this context
    │
    ▼
Parse JSON-RPC body
    │
    ▼
Route to tools/call
    │
    ▼
handleToolsCall('fetch_downstream_data', args)
    │
    │  ctx = getUserContext()  ← reads from AsyncLocalStorage
    │  ctx._token → forward to downstream API
    │
    ▼
fetch('http://127.0.0.1:4002/data', {
  headers: { Authorization: `Bearer ${ctx._token}` }
})
```

### Storing the Raw Token

The MCP server stores `_token` (the raw JWT string) in context so tools can forward it to downstream APIs. The decoded payload (`sub`, `roles`) is used for logging and tool logic; the raw token is used for outbound `Authorization` headers.

---

## API Reference

### Auth Service

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| POST | `/login` | `{ username, password }` | `{ access_token, token_type, expires_in }` |
| GET | `/.well-known/openid-configuration` | — | OIDC discovery (optional) |

### MCP Server

| Method | Endpoint | Headers | Body | Response |
|--------|----------|---------|------|----------|
| POST | `/mcp` | `Authorization: Bearer <jwt>` | JSON-RPC | JSON-RPC result |
| POST | `/mcp` | `Mcp-Session-Id` (after init) | JSON-RPC | JSON-RPC result |

**JSON-RPC methods:**

- `initialize` — `params: { protocolVersion, capabilities, clientInfo }`
- `tools/list` — No params
- `tools/call` — `params: { name, arguments }`

### Downstream API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/public` | No | Public data |
| GET | `/data` | Bearer (reader+) | Role-scoped data |
| POST | `/data` | Bearer (admin) | Write (admin only) |

---

## Security Considerations

### For Production

1. **JWT Secret** — Use a strong, random secret; store in env (e.g., `JWT_SECRET`), never commit
2. **HTTPS** — All services should use TLS in production
3. **Token expiration** — JWTs expire (1h in example); implement refresh if needed
4. **Audience** — Validate `aud` so tokens for one service can't be used at another
5. **CORS** — UI server proxies to avoid CORS; restrict origins if exposing APIs to browser

### What This Example Does Not Cover

- Refresh tokens
- Revocation / token blacklist
- Rate limiting
- OAuth 2.0 authorization code flow (login is simplified)
- PKCE for public clients

---

## Extending the Example

### Adding a New Tool

1. Add tool definition to `TOOLS` array in `mcp-server.js`
2. Add handler in `handleToolsCall`:
   ```js
   if (name === 'my_tool') {
     const ctx = getUserContext();
     // Use ctx.sub, ctx.roles, ctx._token
     return { content: [{ type: 'text', text: '...' }] };
   }
   ```

### Adding Roles

1. Update `USERS` in `config.js` with new roles
2. Update auth service logic for `scope` if needed
3. Update downstream API to enforce new role permissions

### Replacing Auth Service

Replace `auth-service.js` with a real OAuth/OIDC provider. Ensure issued JWTs include:

- `sub` (user id)
- `aud` = `mcp-server` (or configure MCP to accept your audience)
- `roles` or equivalent (or use `scope` and map in MCP)

---

## Quick Reference: curl Examples

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://127.0.0.1:4000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"pass123"}' | jq -r '.access_token')

# 2. MCP Initialize
curl -s -X POST http://127.0.0.1:4001/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"1.0.0"}}}'

# 3. MCP tools/call
curl -s -X POST http://127.0.0.1:4001/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: <SESSION_ID_FROM_INIT>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_user_info","arguments":{}}}'

# 4. Direct downstream API
curl -s -X GET http://127.0.0.1:4002/data -H "Authorization: Bearer $TOKEN"
```

---

## See Also

- [README.md](./README.md) — Quick start and usage
- [FLOW.md](./FLOW.md) — Flow diagram
- [modelcontextprotocol.io](https://modelcontextprotocol.io) — MCP specification
