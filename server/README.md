# Lumen Server

A small web server for dashboards published from Lumen (**File > Publish > Add destination > Lumen Server**). It keeps
each dashboard in a folder, lists them on its home page, and can put a password on any dashboard. No database and no
dependencies: one Node.js process, or one Docker container.

## Run it with Docker

1. Create a token: `openssl rand -hex 24`.
2. In this folder, create `.env` with `LUMEN_SERVER_TOKEN=<the token>`.
3. Run `docker compose up -d --build`.
4. Open `http://<server>:8080`. The page says there are no dashboards yet.
5. In Lumen, add a **Lumen Server** destination with the server's address and the token, and publish.

Dashboards are stored in `./data` (mounted at `/data` in the container). Back up that folder to keep them.

Without Docker: `LUMEN_SERVER_TOKEN=<token> LUMEN_SERVER_DATA=./data node main.mjs` (Node.js 20 or later).

## Settings

| Variable | Default | Effect |
|---|---|---|
| `LUMEN_SERVER_TOKEN` | required | The token Lumen signs in with to publish, list and remove dashboards. At least 16 characters. |
| `PORT` | `8080` | Port to listen on. |
| `LUMEN_SERVER_DATA` | `/data` | Where dashboards and the cookie signing key are stored. |
| `LUMEN_SERVER_TITLE` | `Dashboards` | Heading of the home page. |
| `LUMEN_SERVER_LISTING` | `on` | `off` hides the home page list. Dashboards stay reachable at their own address. |
| `LUMEN_SERVER_MAX_MB` | `200` | Largest upload accepted, in MB. |
| `LUMEN_SERVER_TRUST_PROXY` | `auto` | Where the visitor's address comes from, for the wrong-password limit. `auto` reads `CF-Connecting-IP`, `X-Real-IP` or `X-Forwarded-For` when the request comes from a private address (a reverse proxy or tunnel on the same network); `on` always reads them; `off` never does. |
| `LUMEN_SERVER_UID` | `1000` | In Docker, the server starts as root, gives the data folder to this user and runs as it. |
| `LUMEN_SERVER_SECURE_COOKIES` | `false` | `true` marks password cookies Secure. Set it when the server is only reached over HTTPS. Behind a proxy that sends `X-Forwarded-Proto: https`, this happens on its own. |

## Addresses

| Address | What |
|---|---|
| `/` | The dashboards as a gallery with a preview of every page (Lumen renders them while publishing), search and filters. A password-protected dashboard shows its preview only to a browser signed in to it. |
| `/d/<name>/` | A dashboard. |
| `/api/health` | `{ "ok": true }` for monitoring. No sign-in. |
| `/api/dashboards` | List, upload (`PUT /api/dashboards/<name>` with the site as a zip) and remove (`DELETE`). Needs `Authorization: Bearer <token>`. |

## Access

Each dashboard is either open to anyone with its address, or protected by a password chosen when publishing. A
correct password keeps that browser signed in to the dashboard for 30 days. Changing the password signs everyone out.
After 10 wrong passwords from one address, that address waits 15 minutes. Behind a reverse proxy or a Cloudflare
Tunnel, the address is the visitor's, taken from the proxy's headers (see `LUMEN_SERVER_TRUST_PROXY`).

A password keeps casual visitors out. It is not per-person access control: anyone who has the password sees the whole
dashboard, data included. For sign-in with accounts, put the server behind a reverse proxy that does it (for example
Authelia, Authentik or Cloudflare Access).

## HTTPS

Run it behind a reverse proxy that terminates TLS: Caddy, nginx, Traefik, or a Cloudflare Tunnel. A Caddy example:

```
dashboards.example.com {
    reverse_proxy lumen-server:8080
}
```

Plain HTTP on a home network works too. The dashboards open from a plain-HTTP address as well.
