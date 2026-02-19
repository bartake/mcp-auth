/**
 * UI Server - Serves the visualization UI and proxies API calls to backend services.
 * Run: node ui-server.js (after npm start)
 */
import express from 'express';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const UI_PORT = 4003;

const AUTH_URL = `http://127.0.0.1:${PORTS.AUTH}`;
const MCP_URL = `http://127.0.0.1:${PORTS.MCP}`;
const API_URL = `http://127.0.0.1:${PORTS.DOWNSTREAM_API}`;

app.use(express.json());

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  createReadStream(join(__dirname, 'ui', 'index.html')).pipe(res);
});

app.get('/docs', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  createReadStream(join(__dirname, 'ui', 'docs.html')).pipe(res);
});

app.post('/api/login', async (req, res) => {
  try {
    const r = await fetch(`${AUTH_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mcp', async (req, res) => {
  try {
    const { body, authorization, sessionId } = req.body || {};
    const headers = { 'Content-Type': 'application/json' };
    if (authorization) headers['Authorization'] = authorization;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const r = await fetch(`${MCP_URL}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await r.json();
    const sid = r.headers.get('mcp-session-id') ?? r.headers.get('Mcp-Session-Id');
    res.status(r.status).json({ ...data, _sessionId: sid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/data', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    const headers = {};
    if (auth) headers['Authorization'] = auth;
    const r = await fetch(`${API_URL}/data`, { headers });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(UI_PORT, '127.0.0.1', () => {
  console.log(`UI: http://127.0.0.1:${UI_PORT}`);
});
