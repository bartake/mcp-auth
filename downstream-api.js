/**
 * Downstream API - validates JWT and returns data based on user roles.
 * Uses scoped access: reader can read, admin can read+write.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_AUDIENCE, PORTS } from './config.js';

const app = express();

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Sample data - in reality this would be from a DB
const DATA = {
  public: { message: 'Public data - no auth needed' },
  reader: { docs: ['Doc A', 'Doc B', 'Doc C'], message: 'Reader-only data' },
  admin: { users: ['alice', 'bob'], config: { feature: true }, message: 'Admin-only data' },
};

app.get('/public', (req, res) => {
  res.json(DATA.public);
});

app.get('/data', authMiddleware, (req, res) => {
  const { roles } = req.user;
  const canRead = roles?.includes('reader') || roles?.includes('admin');
  const canAdmin = roles?.includes('admin');

  if (!canRead) {
    return res.status(403).json({ error: 'Requires reader or admin role' });
  }

  const payload = {
    ...DATA.reader,
    ...(canAdmin ? DATA.admin : {}),
  };
  res.json(payload);
});

app.post('/data', authMiddleware, (req, res) => {
  const { roles } = req.user;
  if (!roles?.includes('admin')) {
    return res.status(403).json({ error: 'Requires admin role' });
  }
  res.json({ success: true, message: 'Data updated (admin)' });
});

app.listen(PORTS.DOWNSTREAM_API, '127.0.0.1', () => {
  console.log(`Downstream API: http://127.0.0.1:${PORTS.DOWNSTREAM_API}`);
  console.log('  GET /data (Bearer token, reader+)');
  console.log('  POST /data (Bearer token, admin)');
});
