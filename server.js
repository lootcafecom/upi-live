import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

// Webhook route needs the RAW body to verify Razorpay's signature,
// so it's registered before express.json().
app.post('/webhook/:userId', express.raw({ type: 'application/json' }), handleWebhook);

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// userId -> list of connected WebSocket clients
const userSockets = new Map();

/**
 * User signs up -> we generate a random id and their unique webhook URL.
 */
app.post('/api/users', (req, res) => {
  const { name } = req.body;
  const id = crypto.randomBytes(8).toString('hex');

  db.prepare(`INSERT INTO users (id, name, webhook_secret) VALUES (?, ?, '')`).run(id, name || 'Unnamed');

  res.json({
    userId: id,
    webhookUrl: `${PUBLIC_BASE_URL}/webhook/${id}`,
    instructions: [
      '1. Go to your Razorpay Dashboard -> Settings -> Webhooks -> Add New Webhook',
      `2. Paste this URL: ${PUBLIC_BASE_URL}/webhook/${id}`,
      '3. Select the event: payment.captured',
      '4. Razorpay will show you a webhook secret -- copy it and paste it below',
    ],
  });
});

/**
 * User pastes in the webhook secret Razorpay gave them.
 */
app.post('/api/users/:userId/secret', (req, res) => {
  const { userId } = req.params;
  const { webhookSecret } = req.body;

  if (!webhookSecret) return res.status(400).json({ error: 'webhookSecret is required' });

  const result = db.prepare(`UPDATE users SET webhook_secret = ? WHERE id = ?`).run(webhookSecret, userId);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });

  res.json({ ok: true });
});

/**
 * Razorpay calls this the instant a payment is captured.
 */
function handleWebhook(req, res) {
  const { userId } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!user || !user.webhook_secret) {
    console.warn(`Webhook received for unknown/unconfigured user: ${userId}`);
    return res.status(404).send('Unknown user');
  }

  const signature = req.headers['x-razorpay-signature'];
  const expected = crypto
    .createHmac('sha256', user.webhook_secret)
    .update(req.body)
    .digest('hex');

  if (signature !== expected) {
    console.warn(`Signature mismatch for user ${userId}`);
    return res.status(400).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString());

  if (event.event !== 'payment.captured') {
    return res.status(200).send('Ignored event type');
  }

  const payment = event.payload.payment.entity;

  db.prepare(
    `INSERT OR IGNORE INTO transactions (user_id, razorpay_payment_id, amount_paise, payer_vpa, method)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, payment.id, payment.amount, payment.vpa || payment.email || 'unknown', payment.method);

  const total = db
    .prepare(`SELECT COALESCE(SUM(amount_paise),0) as total FROM transactions WHERE user_id = ?`)
    .get(userId).total;

  pushToUser(userId, {
    type: 'payment_received',
    amount: payment.amount / 100,
    payerVpa: payment.vpa || payment.email || 'unknown',
    method: payment.method,
    runningTotal: total / 100,
    time: new Date().toISOString(),
  });

  res.status(200).send('OK');
}

function pushToUser(userId, message) {
  const sockets = userSockets.get(userId) || [];
  const json = JSON.stringify(message);
  sockets.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(json);
  });
}

app.get('/api/users/:userId/total', (req, res) => {
  const total = db
    .prepare(`SELECT COALESCE(SUM(amount_paise),0) as total FROM transactions WHERE user_id = ?`)
    .get(req.params.userId).total;
  res.json({ total: total / 100 });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on ${PUBLIC_BASE_URL}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = url.searchParams.get('userId');
  if (!userId) {
    ws.close(1008, 'userId required');
    return;
  }

  const list = userSockets.get(userId) || [];
  list.push(ws);
  userSockets.set(userId, list);
  console.log(`User ${userId} connected via WebSocket`);

  ws.on('close', () => {
    const remaining = (userSockets.get(userId) || []).filter((s) => s !== ws);
    userSockets.set(userId, remaining);
  });
});
