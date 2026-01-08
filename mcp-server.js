/**
 * MCP Server with JWT auth.
 * Implements minimal MCP JSON-RPC (initialize, tools/list, tools/call).
 * Flow: JWT → verify → extract roles → AsyncLocalStorage → tool context → downstream API.
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import { JWT_SECRET, JWT_AUDIENCE, PORTS } from './config.js';
import { getUserContext, runWithUser } from './user-context.js';

const TOOLS = [
  {
    name: 'get_user_info',
    description: 'Returns the current authenticated user (sub, roles) from the JWT context',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'fetch_downstream_data',
    description: "Calls the downstream API with the user's JWT. Access depends on roles (reader/admin).",
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', enum: ['public', 'data'], description: 'API endpoint to call' },
      },
      required: ['endpoint'],
    },
  },
];

function jwtAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Authorization required. Use Authorization: Bearer <token>' },
      id: null,
    });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    req.user = {
      sub: payload.sub,
      roles: payload.roles ?? [],
      scope: payload.scope ?? '',
    };
    req._rawToken = token;
    next();
  } catch (err) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Invalid or expired token' },
      id: null,
    });
  }
}

async function handleToolsCall(name, args) {
  if (name === 'get_user_info') {
    const user = getUserContext();
    const text = user
      ? JSON.stringify({ sub: user.sub, roles: user.roles, scope: user.scope }, null, 2)
      : 'No user context (unauthenticated)';
    return { content: [{ type: 'text', text }] };
  }
  if (name === 'fetch_downstream_data') {
    const ctx = getUserContext();
    if (!ctx) return { content: [{ type: 'text', text: 'Error: No user context' }] };
    const token = ctx._token;
    const endpoint = args?.endpoint ?? 'data';
    const url = `http://127.0.0.1:${PORTS.DOWNSTREAM_API}/${endpoint}`;
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: res.status, data }, null, 2) }],
      };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
    }
  }
  throw new Error(`Unknown tool: ${name}`);
}

const app = express();
app.use(express.json());

const sessions = new Map();

app.post('/mcp', jwtAuth, async (req, res) => {
  const body = req.body;
  const id = body?.id ?? null;
  const method = body?.method;
  const params = body?.params ?? {};
  const sessionId = req.headers['mcp-session-id'] ?? req.headers['Mcp-Session-Id'];

  let responseSessionId = sessionId;

  const send = (result, error = null) => {
    res.setHeader('Content-Type', 'application/json');
    if (responseSessionId) res.setHeader('Mcp-Session-Id', responseSessionId);
    res.json({
      jsonrpc: '2.0',
      id,
      ...(error ? { error } : { result }),
    });
  };

  await runWithUser(
    { ...req.user, _token: req._rawToken },
    async () => {
      if (method === 'initialize') {
        responseSessionId = randomUUID();
        sessions.set(responseSessionId, true);
        return send({
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'mcp-auth-example', version: '1.0.0' },
          capabilities: { tools: {} },
        });
      }

      if (method === 'notifications/initialized') {
        return res.status(202).send();
      }

      if (method === 'tools/list') {
        return send({ tools: TOOLS });
      }

      if (method === 'tools/call') {
        try {
          const result = await handleToolsCall(params.name, params.arguments);
          return send(result);
        } catch (e) {
          return send(null, { code: -32603, message: e.message });
        }
      }

      return send(null, { code: -32601, message: `Method not found: ${method}` });
    }
  );
});

app.listen(PORTS.MCP, '127.0.0.1', () => {
  console.log(`MCP Server: http://127.0.0.1:${PORTS.MCP}/mcp`);
  console.log('  Requires: Authorization: Bearer <jwt>');
});
