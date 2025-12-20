/**
 * Mock OAuth / Login service.
 * POST /login with { username, password } → returns JWT with sub, roles, scope.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE, PORTS, USERS } from './config.js';

const app = express();
app.use(express.json());

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const roles = user.roles || [];
  const scope = roles.includes('admin')
    ? 'data:read data:write admin'
    : roles.includes('reader')
      ? 'data:read'
      : '';

  const token = jwt.sign(
    {
      sub: username,
      roles,
      scope,
    },
    JWT_SECRET,
    {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: '1h',
    }
  );

  res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600 });
});

app.get('/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: `http://127.0.0.1:${PORTS.AUTH}`,
    authorization_endpoint: `http://127.0.0.1:${PORTS.AUTH}/authorize`,
    token_endpoint: `http://127.0.0.1:${PORTS.AUTH}/token`,
  });
});

app.listen(PORTS.AUTH, '127.0.0.1', () => {
  console.log(`Auth service: http://127.0.0.1:${PORTS.AUTH}`);
  console.log('  POST /login { username, password }');
});
