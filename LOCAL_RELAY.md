# Local relay + Cloudflare Tunnel

Vercel cannot reach the VSC timetable tool directly because Cloudflare blocks
its egress IPs. A Cloudflare Worker relay is also blocked, because Cloudflare
blocks Cloudflare Worker egress too.

This setup uses your home IP instead:

```text
Vercel function
  → Cloudflare Tunnel URL
  → local_relay.py on your machine
  → lms-lti-timetables.vinschool.edu.vn
```

Canvas requests stay direct in the hosted app. The Canvas API token never
reaches the relay.

The tradeoff: your machine must be online whenever you use **Sync from VSC**.

## 1. Generate a relay key

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Keep this value. You will use it in two places:

- `RELAY_KEY` for the local relay process
- `TIMETABLE_RELAY_KEY` in Vercel

## 2. Run the local relay

From the repository root:

```bash
RELAY_KEY='<paste-the-key>' RELAY_PORT=8787 .venv/bin/python local_relay.py
```

It listens on `127.0.0.1:8787` by default. Only the tunnel needs to reach it,
so do not bind it to `0.0.0.0`.

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Expected:

```json
{"ok":true}
```

## 3. Start a Cloudflare Tunnel

Install `cloudflared` without root:

```bash
mkdir -p ~/bin
curl -L -o ~/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/bin/cloudflared
```

Start a quick tunnel:

```bash
~/bin/cloudflared tunnel --url http://127.0.0.1:8787
```

It prints a URL like:

```text
https://random-words-here.trycloudflare.com
```

Test the tunnel:

```bash
curl https://random-words-here.trycloudflare.com/health
```

Expected: `{"ok":true}`.

Keep both terminals running: the relay and `cloudflared`.

### Quick tunnel URLs change

The `trycloudflare.com` URL is new every time `cloudflared` restarts. When it
changes, update `TIMETABLE_RELAY_URL` in Vercel and redeploy.

If you have a domain on Cloudflare, use a named tunnel instead for a stable
hostname. The quick tunnel is enough for a personal experiment.

## 4. Configure Vercel

Set:

```text
TIMETABLE_RELAY_URL=https://random-words-here.trycloudflare.com/
TIMETABLE_RELAY_KEY=<the same key as RELAY_KEY>
```

Remove `TIMETABLE_PROXY_URL` if it is still configured.

Redeploy the app after changing environment variables.

## 5. Test

Trigger **Sync from VSC**. The logs should show:

```text
Timetable tool relay: random-words-here.trycloudflare.com
Timetable lti_preflight_get: status=...
Timetable lti_form1_post: status=...
Timetable lti_form2_post: status=...
Timetable vsc_timetable_fetch: status=...
```

If `lti_form1_post` still returns `403` with
`title='Attention Required! | Cloudflare'`, then the request is not actually
leaving through your home IP. Check that:

- `TIMETABLE_RELAY_URL` points at the current tunnel URL.
- The local relay and `cloudflared` are both running.
- Vercel was redeployed after changing the environment variables.

## Security

- `RELAY_KEY` is required; without it the relay refuses requests.
- Only `lms-lti-timetables.vinschool.edu.vn` can be reached.
- Only `GET`, `POST`, and `HEAD` are allowed.
- The relay binds to `127.0.0.1`; only the tunnel can reach it.
- The Canvas token never goes through the relay.
- The VSC tool's short-lived `ltik` token does pass through the relay for the
  final timetable fetch. That token is not the Canvas API token.

### Restrict sync to your Canvas account

If other people can reach the hosted app, set `ALLOWED_CANVAS_USER_ID` in the
hosted app's environment (for example in Vercel) to your numeric Canvas user ID
and redeploy. The sync endpoint then validates the token against Canvas
`/api/v1/users/self` and rejects other accounts **before** contacting the
relay. When the variable is unset, any valid Canvas token can use the relay.

Find your user ID with:

```bash
curl -sS -H "Authorization: Bearer <your-canvas-token>" \
  https://lms.vinschool.edu.vn/api/v1/users/self \
  | python -c "import sys, json; print(json.load(sys.stdin)['id'])"
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401 unauthorized` | `TIMETABLE_RELAY_KEY` does not match `RELAY_KEY` |
| `403 target_not_allowed` | The request tried a host other than the VSC tool |
| `502 upstream_fetch_failed` | Your machine could not reach VSC, or the request timed out |
| `403 Attention Required!` from VSC | The request is not using your home IP; verify the tunnel URL and redeploy |
| Tunnel works, sync still fails | Check that Vercel was redeployed after setting the env vars |
| Sync fails after setting `ALLOWED_CANVAS_USER_ID` | The value does not match your Canvas user ID; check `/api/v1/users/self` |

## Worker relay

The Cloudflare Worker in `worker/` is not used in this setup and its deployment
can be deleted. The local relay speaks the same protocol, so switching between
them only requires changing `TIMETABLE_RELAY_URL`.
