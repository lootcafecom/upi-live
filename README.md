# Live UPI Payment Notifications

Everything is in ONE folder now — no more backend/frontend split. This
whole folder gets pushed to GitHub and deployed to Railway as-is.

## What it does

1. Visitor enters their name → gets a unique webhook URL
2. They paste that URL into their own Razorpay Dashboard (Settings →
   Webhooks), select the `payment.captured` event, and copy the secret
   Razorpay shows them
3. They paste that secret into your site
4. From then on, every payment they receive pushes live to their screen:
   running total, feed entry, and a spoken "Payment received" announcement
5. Closing the tab stops the live connection — nothing needed to "log out"

No Razorpay Partner approval needed. No OAuth. Each user just registers
a webhook the normal way, which any Razorpay account can do.

## Files

```
upi-final/
├── server.js          <- the whole backend
├── db.js               <- SQLite setup
├── package.json
├── .env.example
├── .gitignore
└── public/
    └── index.html       <- the whole frontend, served automatically
```

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open http://localhost:4000 — you should see the signup page.

## Deploy to Railway

1. Push this folder to a new GitHub repo (root of the repo = this folder,
   don't nest it inside another `backend/` folder — that was the earlier
   confusion, this version avoids it entirely):

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/upi-live.git
   git branch -M main
   git push -u origin main
   ```

2. On railway.app → New Project → Deploy from GitHub repo → select this repo.
   **Leave Root Directory blank** (this repo IS the app root now).

3. Railway auto-detects Node and runs `npm install` + `npm start`. No
   manual build/start command changes needed.

4. Go to your service → **Settings → Networking → Generate Domain** to get
   a public URL, e.g. `https://your-app.up.railway.app`.

5. Go to **Variables** tab and add:
   ```
   PUBLIC_BASE_URL=https://your-app.up.railway.app
   ```
   (use the exact URL Railway gave you in step 4)

6. Railway redeploys automatically after you save the variable. Visit your
   URL — you should see the signup page, not "Cannot GET /".

## Testing the webhook without a real payment

In Razorpay Dashboard → Webhooks, next to your registered webhook there's
a "Test Webhook" button — it sends a sample `payment.captured` event to
your URL so you can confirm the live feed works before real money moves.

## Note on the database

SQLite (`platform.db`) works for testing, but Railway's filesystem isn't
guaranteed to persist across redeploys — if you push new code, existing
users/webhook secrets could reset. Fine while you're testing; before real
users rely on this, switch to Railway's one-click Postgres add-on instead.
