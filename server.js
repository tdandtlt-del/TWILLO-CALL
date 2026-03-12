'use strict';

require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const twilio = require('twilio');

// ─── Validate Required Environment Variables ─────────────────────────────────
const REQUIRED_ENV = [
  'TWILIO_SID',
  'TWILIO_TOKEN',
  'TWILIO_PHONE',
  'USER_PHONE',
  'FIREBASE_DATABASE_URL',
  'FIREBASE_SERVICE_ACCOUNT',
  'PUBLIC_URL', // e.g. https://your-service.up.railway.app
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`❌  Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DB_PATH = 'devices/esp32-001/gas';
const CALL_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
const LEVEL1_THRESHOLD = 500;
const LEVEL2_THRESHOLD = 900;

// ─── Twilio Client ────────────────────────────────────────────────────────────
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

// ─── Firebase Initialization ──────────────────────────────────────────────────
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (err) {
  console.error('❌  Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

// ─── State ────────────────────────────────────────────────────────────────────
let lastCallTime = 0; // epoch ms of last call triggered

// ─── Helper: Send SMS ─────────────────────────────────────────────────────────
async function sendSMS(gasValue) {
  const body = `AegisAir Alert: Gas leak detected. Safety protocol activated. Please take necessary safety precautions immediately.`;

  try {
    const msg = await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE,
      to: process.env.USER_PHONE,
    });
    console.log(`📱 SMS sent [SID: ${msg.sid}] — gasValue: ${gasValue} ppm`);
  } catch (err) {
    console.error(`❌  SMS failed: ${err.message}`);
  }
}

// ─── Helper: Trigger Voice Call ───────────────────────────────────────────────
async function triggerCall(gasValue) {
  const now = Date.now();
  const elapsed = now - lastCallTime;

  if (elapsed < CALL_COOLDOWN_MS) {
    const remaining = Math.ceil((CALL_COOLDOWN_MS - elapsed) / 1000);
    console.log(`⏳ Call cooldown active — ${remaining}s remaining (gasValue: ${gasValue} ppm)`);
    return;
  }

  // Twilio fetches this URL when the call connects — far more reliable than inline TwiML
  const twimlUrl = `${process.env.PUBLIC_URL.replace(/\/$/, '')}/twiml`;

  try {
    const call = await twilioClient.calls.create({
      url: twimlUrl,
      from: process.env.TWILIO_PHONE,
      to: process.env.USER_PHONE,
    });
    lastCallTime = now;
    console.log(`📞 Voice call triggered [SID: ${call.sid}] — gasValue: ${gasValue} ppm | TwiML: ${twimlUrl}`);
  } catch (err) {
    console.error(`❌  Voice call failed: ${err.message}`);
  }
}

// ─── Alert Logic ─────────────────────────────────────────────────────────────
async function handleGasValue(gasValue) {
  console.log(`🌡️  Gas reading received: ${gasValue} ppm`);

  if (gasValue >= LEVEL2_THRESHOLD) {
    // LEVEL 2 – CRITICAL: SMS + Voice Call
    console.log(`🔴 LEVEL 2 CRITICAL — gasValue ${gasValue} ppm >= ${LEVEL2_THRESHOLD} ppm`);
    await sendSMS(gasValue);
    await triggerCall(gasValue);
  } else if (gasValue >= LEVEL1_THRESHOLD) {
    // LEVEL 1 – WARNING: SMS only
    console.log(`🟡 LEVEL 1 WARNING — gasValue ${gasValue} ppm >= ${LEVEL1_THRESHOLD} ppm`);
    await sendSMS(gasValue);
  } else {
    console.log(`✅ Gas level normal — ${gasValue} ppm (below ${LEVEL1_THRESHOLD} ppm threshold)`);
  }
}

// ─── Firebase Listener ────────────────────────────────────────────────────────
function startFirebaseListener() {
  const ref = db.ref(DB_PATH);

  console.log(`🔥 Listening to Firebase path: ${DB_PATH}`);

  ref.on(
    'value',
    async (snapshot) => {
      const raw = snapshot.val();

      if (raw === null || raw === undefined) {
        console.log(`⚠️  No data at ${DB_PATH} — waiting for sensor data...`);
        return;
      }

      // Gas node is an object: { value, spike, rateOfRise }
      // but also handle plain number for forward compatibility
      let gasValue;
      let spike = false;

      if (typeof raw === 'object') {
        gasValue = Number(raw.value);
        spike = raw.spike === true;
      } else {
        gasValue = Number(raw);
      }

      if (isNaN(gasValue)) {
        console.warn(`⚠️  Non-numeric gasValue received: "${JSON.stringify(raw)}" — skipping`);
        return;
      }

      console.log(`🌡️  Gas snapshot → value: ${gasValue} ppm | spike: ${spike}`);

      // If ESP32 flagged a spike, treat as critical regardless of threshold
      if (spike) {
        console.log(`⚡ Spike detected by ESP32 — forcing LEVEL 2 CRITICAL alert`);
        await sendSMS(gasValue);
        await triggerCall(gasValue);
        return;
      }

      await handleGasValue(gasValue);
    },
    (err) => {
      console.error('❌  Firebase listener error:', err.message);
    }
  );
}

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ─── TwiML Endpoint — Twilio fetches this when call connects ─────────────────
app.get('/twiml', (req, res) => {
  res.type('text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" loop="3">
    Attention. AegisAir emergency alert. Gas levels are dangerously high. Please evacuate and follow safety procedures.
  </Say>
  <Pause length="1"/>
</Response>`);
});

// Health check — Railway uses this to know the service is alive
app.get('/', (req, res) => {
  const cooldownRemaining = Math.max(0, CALL_COOLDOWN_MS - (Date.now() - lastCallTime));
  res.json({
    status: 'running',
    service: 'Aegis Air Calling — Gas Alert Service',
    listening: DB_PATH,
    thresholds: {
      warning: `>= ${LEVEL1_THRESHOLD} ppm → SMS`,
      critical: `>= ${LEVEL2_THRESHOLD} ppm → SMS + Voice Call`,
    },
    callCooldown: {
      totalMs: CALL_COOLDOWN_MS,
      remainingMs: cooldownRemaining,
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   🚨 Aegis Air — Gas Alert Service 🚨    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`🌐 HTTP server running on port ${PORT}`);
  console.log(`📡 Twilio FROM: ${process.env.TWILIO_PHONE}`);
  console.log(`📲 Alerting TO: ${process.env.USER_PHONE}`);
  console.log(`⏱️  Call cooldown: ${CALL_COOLDOWN_MS / 1000}s`);
  console.log('');

  startFirebaseListener();
});
