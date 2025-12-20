/** Shared config: JWT secret, ports, users */
export const JWT_SECRET = process.env.JWT_SECRET || 'mcp-auth-demo-secret-change-in-production';
export const JWT_ISSUER = 'mcp-auth-example';
export const JWT_AUDIENCE = 'mcp-server';

export const PORTS = {
  AUTH: 4000,
  MCP: 4001,
  DOWNSTREAM_API: 4002,
};

export const MCP_URL = process.env.MCP_URL || `http://127.0.0.1:${PORTS.MCP}`;

/** Demo users: username -> { password, roles } */
export const USERS = {
  alice: { password: 'pass123', roles: ['admin', 'reader'] },
  bob: { password: 'pass123', roles: ['reader'] },
  charlie: { password: 'pass123', roles: [] },
};
