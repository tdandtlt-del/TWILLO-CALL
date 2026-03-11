# 🚨 Aegis Air — Gas Alert Service

A production-ready Node.js backend that monitors Firebase Realtime Database for gas sensor readings and triggers **Twilio SMS and voice call alerts**.

---

## How It Works

| Gas Level | Action |
|---|---|
| `>= 500 ppm` | ⚠️ SMS alert sent immediately |
| `>= 1000 ppm` | ⚠️ SMS + 📞 Voice call (2-min cooldown on calls) |
| `< 500 ppm` | ✅ Normal, no alerts |

The service listens in real-time to `/alerts/gasValue` in Firebase. Every time the value changes, the alert logic runs automatically.

---

## Project Structure

```
aegis-air-calling/
├── server.js          ← Main service (Express + Firebase + Twilio)
├── package.json
├── railway.toml       ← Railway deployment config
├── .env.example       ← Template for environment variables
├── .gitignore
└── README.md
```

---

## Setup

### 1. Clone / Copy the Project

```bash
cd "aegis air calling"
npm install
```

### 2. Get Your Firebase Service Account Key

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Open your project → **Project Settings** → **Service Accounts**
3. Click **Generate New Private Key** → download the JSON file
4. Minify it to a single line (use [jsonminifier.com](https://jsonminifier.com))

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```env
TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TOKEN=your_auth_token
TWILIO_PHONE=+1xxxxxxxxxx        # Your Twilio number
USER_PHONE=+1xxxxxxxxxx          # Number to receive alerts

FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}  # Single-line JSON
```

### 4. Run Locally

```bash
npm start
# or for auto-reload during development:
npm run dev
```

Visit `http://localhost:3000` to see the health check.

---

## Deploy on Railway

### Option A: GitHub (Recommended)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your repo
4. In Railway dashboard → **Variables**, add all env vars from `.env.example`
5. Railway auto-deploys on every push ✅

### Option B: Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Then set environment variables in the Railway dashboard.

> ⚠️ **Never commit your `.env` file.** Only use Railway Variables for secrets in production.

---

## Environment Variables Reference

| Variable | Description |
|---|---|
| `TWILIO_SID` | Twilio Account SID (from Twilio console) |
| `TWILIO_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE` | Your Twilio phone number (E.164 format, e.g. `+14155552671`) |
| `USER_PHONE` | Recipient phone number (E.164 format) |
| `FIREBASE_DATABASE_URL` | Your Realtime Database URL |
| `FIREBASE_SERVICE_ACCOUNT` | Full service account JSON as a single-line string |
| `PORT` | HTTP port (Railway injects this automatically) |

---

## Console Logs

```
╔══════════════════════════════════════════╗
║   🚨 Aegis Air — Gas Alert Service 🚨    ║
╚══════════════════════════════════════════╝
🌐 HTTP server running on port 3000
📡 Twilio FROM: +14155552671
📲 Alerting TO: +919876543210
⏱️  Call cooldown: 120s

🔥 Listening to Firebase path: /alerts/gasValue
🌡️  Gas reading received: 650 ppm
🟡 LEVEL 1 WARNING — gasValue 650 ppm >= 500 ppm
📱 SMS sent [SID: SM...] — gasValue: 650 ppm

🌡️  Gas reading received: 1050 ppm
🔴 LEVEL 2 CRITICAL — gasValue 1050 ppm >= 1000 ppm
📱 SMS sent [SID: SM...]
📞 Voice call triggered [SID: CA...] — gasValue: 1050 ppm
```

---

## Health Check Endpoint

`GET /` returns service status:

```json
{
  "status": "running",
  "service": "Aegis Air Calling — Gas Alert Service",
  "listening": "/alerts/gasValue",
  "thresholds": {
    "warning": ">= 500 ppm → SMS",
    "critical": ">= 1000 ppm → SMS + Voice Call"
  },
  "callCooldown": {
    "totalMs": 120000,
    "remainingMs": 0
  },
  "timestamp": "2026-03-11T17:00:00.000Z"
}
```
