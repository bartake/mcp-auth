# MCP Server Authentication Example

End-to-end flow demonstrating JWT-based authentication for MCP servers.

**[→ Full technical documentation (DOCUMENTATION.md)](./DOCUMENTATION.md)**

```
User login → OAuth
       ↓
Agent receives JWT
       ↓
JWT passed to MCP server
       ↓
MCP verifies + extracts roles
       ↓
Context attached to tool calls
       ↓
Downstream APIs use scoped tokens
```

## Architecture

| Component | Port | Role |
|-----------|------|------|
| **auth-service** | 4000 | Mock OAuth; issues JWTs with `sub`, `roles`, `scope` |
| **mcp-server** | 4001 | Verifies JWT, extracts roles, attaches user context to tools |
| **downstream-api** | 4002 | Validates JWT, returns data based on user roles |
| **agent** | - | MCP client; connects with JWT, invokes tools |

## Quick Start

```bash
npm install
npm start          # Starts auth, MCP, and downstream API
npm run ui         # In another terminal: start UI on http://127.0.0.1:4003
npm run agent      # Or run agent CLI (default: alice)
```

For UI + all services: `npm run start:full`

Or run the full demo:

```bash
npm run demo
```

## Flow

1. **Login** – `POST /login` with `username`/`password` → returns JWT
2. **Agent** – Connects to MCP with `Authorization: Bearer <jwt>`
3. **MCP** – Middleware verifies JWT, extracts `sub`, `roles` → `req.user`
4. **Context** – `AsyncLocalStorage` propagates user + token into tool handlers
5. **Tools** – Call `getUserContext()`; forward JWT to downstream API
6. **Downstream API** – Validates JWT, enforces role-based access (reader/admin)

## JWT Claims

- `sub` – User ID
- `roles` – Array, e.g. `["admin", "reader"]`
- `scope` – Space-separated scopes, e.g. `"data:read data:write"`
- `aud` – Audience (MCP server URL)

## Demo Users

| User | Password | Roles | Downstream /data |
|------|----------|-------|------------------|
| alice | pass123 | admin, reader | Full data |
| bob | pass123 | reader | Reader data only |
| charlie | pass123 | (none) | 403 Forbidden |
