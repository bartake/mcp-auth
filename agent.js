/**
 * Agent: MCP client that passes JWT to the server.
 * 1. Login to get JWT
 * 2. Connect to MCP with Authorization: Bearer <jwt>
 * 3. Call tools - MCP verifies JWT and attaches context
 * 4. Tools call downstream API with scoped token
 */
import { PORTS, MCP_URL } from './config.js';

const AUTH_URL = `http://127.0.0.1:${PORTS.AUTH}`;
const MCP_ENDPOINT = `${MCP_URL}/mcp`;

async function login(username = 'alice', password = 'pass123') {
  const res = await fetch(`${AUTH_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function mcpRequest(token, method, params = {}, sessionId = null) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!res.ok) {
    throw new Error(`MCP request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message ?? JSON.stringify(data.error));
  }
  const result = data.result;
  const sid = res.headers.get('mcp-session-id') ?? res.headers.get('Mcp-Session-Id');
  return { result, sessionId: sid };
}

async function main() {
  const username = process.argv[2] || 'alice';
  const password = process.argv[3] || 'pass123';

  console.log('=== MCP Auth Demo ===\n');
  console.log('1. User login → OAuth');
  const token = await login(username, password);
  console.log(`   Logged in as ${username}, got JWT\n`);

  console.log('2. Agent receives JWT & passes to MCP');
  console.log('   Connecting to MCP with Authorization: Bearer <jwt>\n');

  try {
    console.log('3. MCP verifies JWT + extracts roles');
    console.log('4. Context attached to tool calls\n');

    const { result: initResult, sessionId } = await mcpRequest(token, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'demo-agent', version: '1.0.0' },
    });
    const sid = sessionId ?? initResult?.serverInfo?.sessionId;

    const { result: toolsResult } = await mcpRequest(token, 'tools/list', {}, sid);
    console.log('   Available tools:', toolsResult?.tools?.map((t) => t.name).join(', ') || 'none');

    console.log('\n   Calling get_user_info (shows context from JWT):');
    const { result: callUser } = await mcpRequest(token, 'tools/call', {
      name: 'get_user_info',
      arguments: {},
    }, sid);
    const userText = callUser?.content?.[0]?.text ?? JSON.stringify(callUser);
    console.log('   ', userText.replace(/\n/g, '\n    '));

    console.log('\n   Calling fetch_downstream_data (uses scoped token):');
    const { result: callData } = await mcpRequest(token, 'tools/call', {
      name: 'fetch_downstream_data',
      arguments: { endpoint: 'data' },
    }, sid);
    const dataText = callData?.content?.[0]?.text ?? JSON.stringify(callData);
    console.log('   ', dataText.replace(/\n/g, '\n    '));

    console.log('\n5. Downstream APIs used scoped tokens ✓');
  } catch (e) {
    console.error('Error:', e.message);
    if (e.message.includes('401') || e.message.includes('Authorization')) {
      console.log('\nMake sure MCP server is running: npm run mcp');
    }
  }
}

main();
