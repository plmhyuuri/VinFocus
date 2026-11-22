# VSC timetable relay (Cloudflare Worker)

A tiny, host-restricted relay for VinFocus timetable sync.

Vercel is blocked by Cloudflare when it calls
`lms-lti-timetables.vinschool.edu.vn` directly. This Worker forwards only that
host's LTI requests and returns the response to the Python backend. Canvas
requests stay direct, so the Canvas API token never passes through the Worker.

## What it forwards

- `GET` / `POST` / `HEAD` only
- Only `https://lms-lti-timetables.vinschool.edu.vn/...`
- Cookies, `Referer`, `Origin`, `Content-Type`, and `Authorization` are kept
- Redirects are returned to Python with `redirect: "manual"`, so the existing
  `requests` cookie jar and redirect handling still work
- Request bodies and response bodies are base64-encoded

The relay key is checked before anything is forwarded. Without `RELAY_KEY`,
the Worker refuses every request.

## Deploy with the Cloudflare dashboard

1. Open <https://dash.cloudflare.com/> → **Workers & Pages** → **Create** →
   **Worker**.
2. Name it, for example, `vsc-timetable-relay`.
3. Replace the starter code with `src/index.js` from this folder.
4. Deploy.
5. Open **Settings** → **Variables and Secrets** → add a secret named
   `RELAY_KEY` with a long random value.
6. Copy the Worker URL, for example:
   `https://vsc-timetable-relay.<your-subdomain>.workers.dev`.

## Deploy with Wrangler

```bash
cd worker
npx wrangler login
npx wrangler secret put RELAY_KEY
npx wrangler deploy
```

`wrangler deploy` prints the public `workers.dev` URL.

## Configure Vercel

Add these environment variables and redeploy:

```text
TIMETABLE_RELAY_URL=https://vsc-timetable-relay.<your-subdomain>.workers.dev
TIMETABLE_RELAY_KEY=<the same value you set as RELAY_KEY>
```

Remove `TIMETABLE_PROXY_URL` if it is still configured. The relay takes
precedence when both are present, but keeping only one avoids confusion.

## Test the Worker

```bash
curl -sS -X POST "https://vsc-timetable-relay.<your-subdomain>.workers.dev" \
  -H "Content-Type: application/json" \
  -H "X-Relay-Key: <your-relay-key>" \
  --data '{
    "url": "https://lms-lti-timetables.vinschool.edu.vn/login",
    "method": "GET",
    "headers": {"Accept": "text/html"}
  }'
```

A working relay returns JSON with `status`, `headers`, `setCookie`, and a
base64 `body`. If the target still returns the Cloudflare interstitial, the
relay JSON will contain `"status": 403` and the page body will be the
`Attention Required! | Cloudflare` page.

## Free plan

Cloudflare Workers Free is `$0/month` and does not require a credit card:

- 100,000 requests/day
- 10 ms CPU time per invocation
- 50 subrequests per invocation
- 128 MB memory
- 64 MiB Worker size

A timetable sync uses roughly 4–6 relay requests, so the daily request limit
is not a concern. The 10 ms limit is CPU time, not wall-clock time; waiting on
`fetch` does not count against it.

## Security notes

- The Worker is not a general-purpose proxy: the target host is hard-coded.
- The Canvas token is never sent to the Worker because Canvas requests are
  direct.
- The VSC tool's short-lived `ltik` token does pass through the Worker for the
  final timetable fetch. That token is not the Canvas API token.
- Treat `RELAY_KEY` like a password. Rotate it if it leaks.
