# Lumen Server

A small web server for dashboards published from Lumen (**File > Publish > Add destination > Lumen Server**). It keeps
each dashboard in a folder and shows them as a gallery with page previews. With Google sign-in, dashboards are private
to approved accounts until you make one public, and an admin console edits how each one shows, who can open it and
which sites may embed it. No database and no dependencies: one Node.js process, or one Docker container.

## Run it with Docker

1. Create a token: `openssl rand -hex 24`.
2. In this folder, create `.env` with `LUMEN_SERVER_TOKEN=<the token>`.
3. Run `docker compose up -d --build`.
4. Open `http://<server>:8080`. The page says there are no dashboards yet.
5. In Lumen, add a **Lumen Server** destination with the server's address and the token, and publish.

Dashboards are stored in `./data` (mounted at `/data` in the container). Back up that folder to keep them.

Without Docker: `LUMEN_SERVER_TOKEN=<token> LUMEN_SERVER_DATA=./data node main.mjs` (Node.js 20 or later).

## Google sign-in

With Google sign-in, nobody pastes a token: Lumen's **Sign in with Google** opens the server in the browser, and after
you sign in and confirm, the server hands Lumen a key for publishing. New dashboards are private until you make them
public in the admin console (or choose so when publishing).

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project, then an OAuth consent screen
   (External; scopes `openid`, `email`, `profile`) and an OAuth client ID of type **Web application**.
2. Add the authorized redirect URI `https://<your server>/auth/callback`.
3. Add to `.env`:
   ```
   LUMEN_SERVER_GOOGLE_CLIENT_ID=<client id>
   LUMEN_SERVER_GOOGLE_CLIENT_SECRET=<client secret>
   LUMEN_SERVER_PUBLIC_URL=https://<your server>
   LUMEN_SERVER_ALLOWED_EMAILS=you@example.com
   ```
4. Restart the server. `LUMEN_SERVER_TOKEN` becomes optional (keep it for scripts, or remove it).

Only accounts in `LUMEN_SERVER_ALLOWED_EMAILS` can sign in. Taking an account off the list also stops the keys issued
to it. `/account` lists the computers connected with your account; disconnect one to revoke its key.

## Admin console

`/admin` (approved accounts) lists every dashboard with its visibility, and per dashboard sets:

- title, description and tags (republishing from Lumen keeps them)
- who can open it: **Private** (approved accounts), **Password**, or **Public**
- whether it shows on the home page, whether it is featured (shown first) and its order
- embedding: whether other sites may show it in an iframe, and which ones (public dashboards only), with the embed code
- delete

**Site settings** sets the home page title, tagline and accent colour, whether the home page lists dashboards, and what
new dashboards start as.

## Embedding and other sites

A public dashboard with embedding on can be shown in an iframe on the sites you allow:

```html
<iframe src="https://<your server>/d/<name>/?embed=1" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe>
```

`?embed=1` shows the report without the viewer's header. Other dashboards answer with
`Content-Security-Policy: frame-ancestors 'self'`, so no other site can frame them.

`GET /api/public/dashboards` returns the public, listed dashboards as JSON (title, description, tags, featured, address,
first preview image and embed address), with CORS open, for a portfolio page that builds its own list.

## Settings

| Variable | Default | Effect |
|---|---|---|
| `LUMEN_SERVER_TOKEN` | required without Google sign-in | A token Lumen (or a script) can publish, list and remove dashboards with. At least 16 characters. |
| `LUMEN_SERVER_GOOGLE_CLIENT_ID`, `LUMEN_SERVER_GOOGLE_CLIENT_SECRET` | | Google sign-in (see above). |
| `LUMEN_SERVER_PUBLIC_URL` | | The server's public address, e.g. `https://dashboards.example.com`. Needed for Google sign-in and used in `/api/public/dashboards`. |
| `LUMEN_SERVER_ALLOWED_EMAILS` | | Approved Google accounts, separated by commas. `@example.com` approves a whole domain. |
| `PORT` | `8080` | Port to listen on. |
| `LUMEN_SERVER_DATA` | `/data` | Where dashboards and the cookie signing key are stored. |
| `LUMEN_SERVER_TITLE` | `Dashboards` | Heading of the home page (the admin console's site settings override it). |
| `LUMEN_SERVER_LISTING` | `on` | `off` hides the home page list. Dashboards stay reachable at their own address. The admin console's site settings override it. |
| `LUMEN_SERVER_MAX_MB` | `200` | Largest upload accepted, in MB. |
| `LUMEN_SERVER_TRUST_PROXY` | `auto` | Where the visitor's address comes from, for the wrong-password limit. `auto` reads `CF-Connecting-IP`, `X-Real-IP` or `X-Forwarded-For` when the request comes from a private address (a reverse proxy or tunnel on the same network); `on` always reads them; `off` never does. |
| `LUMEN_SERVER_UID` | `1000` | In Docker, the server starts as root, gives the data folder to this user and runs as it. |
| `LUMEN_SERVER_SECURE_COOKIES` | `false` | `true` marks password cookies Secure. Set it when the server is only reached over HTTPS. Behind a proxy that sends `X-Forwarded-Proto: https`, this happens on its own. |

## Addresses

| Address | What |
|---|---|
| `/` | The dashboards as a gallery with a preview of every page (Lumen renders them while publishing), search and filters. A password-protected dashboard shows its preview only to a browser signed in to it. |
| `/d/<name>/` | A dashboard. |
| `/admin` | The admin console (approved accounts). |
| `/account` | Your account and connected computers. `/auth/login`, `/auth/logout` sign in and out. |
| `/api/health` | `{ "ok": true, "signIn": "google" or "token" }` for monitoring. No sign-in. |
| `/api/public/dashboards` | Public, listed dashboards as JSON, for other sites. No sign-in. |
| `/api/dashboards` | List, upload (`PUT /api/dashboards/<name>` with the site as a zip; `x-lumen-access: public`, `password` or `users`) and remove (`DELETE`). Needs `Authorization: Bearer <token or key>`. `/api/me` says whose key it is. |

## Access

Each dashboard is public (anyone with its address), private (approved Google accounts, after signing in), or protected
by a password. Signed-in approved accounts can open every dashboard, password or not. A
correct password keeps that browser signed in to the dashboard for 30 days. Changing the password signs everyone out.
After 10 wrong passwords from one address, that address waits 15 minutes. Behind a reverse proxy or a Cloudflare
Tunnel, the address is the visitor's, taken from the proxy's headers (see `LUMEN_SERVER_TRUST_PROXY`).

A password keeps casual visitors out. It is not per-person access control: anyone who has the password sees the whole
dashboard, data included. Use private dashboards with Google sign-in for access by account.

## HTTPS

Run it behind a reverse proxy that terminates TLS: Caddy, nginx, Traefik, or a Cloudflare Tunnel. A Caddy example:

```
dashboards.example.com {
    reverse_proxy lumen-server:8080
}
```

Plain HTTP on a home network works too. The dashboards open from a plain-HTTP address as well.
