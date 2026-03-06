# Authentication Flow

```
┌─────────────┐     POST /login      ┌──────────────┐
│   User      │ ──────────────────► │ Auth Service │
│  (browser)  │  {user, password}   │   :4000      │
└─────────────┘                     └──────────────┘
       │                                    │
       │                                    │ JWT (sub, roles, scope)
       │                                    ▼
       │                             ┌──────────────┐
       │                             │    Agent     │
       │                             │ (MCP Client) │
       └─────────────────────────────┤              │
                                     └──────┬───────┘
                                            │
                          Authorization: Bearer <jwt>
                                            │
                                            ▼
                                     ┌──────────────┐
                                     │ MCP Server   │
                                     │   :4001      │
                                     │              │
                                     │ 1. Verify JWT│
                                     │ 2. Extract   │
                                     │    roles     │
                                     │ 3. Attach    │
                                     │    context   │
                                     └──────┬───────┘
                                            │
                         Tool execution with user context
                                            │
                                            ▼
                                     ┌──────────────┐
                                     │ Downstream   │
                                     │ API  :4002   │
                                     │              │
                                     │ Validates    │
                                     │ JWT, enforces│
                                     │ role-based   │
                                     │ access       │
                                     └──────────────┘
```

## Context Propagation

- **AsyncLocalStorage** carries user context from the HTTP request through tool execution
- Tools call `getUserContext()` to access `sub`, `roles`, `scope`
- The raw JWT (`_token`) is passed to tools so they can call downstream APIs with `Authorization: Bearer <jwt>`
