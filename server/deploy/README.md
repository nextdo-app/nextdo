# Nextdo Production Deployment (`server/deploy`)

> **不想自己维护服务器？** 也可以使用全托管的免费云服务部署（Cloudflare Workers + Supabase/Neon + PowerSync Cloud），详见 [飞书部署图文指南](https://my.feishu.cn/wiki/FDWJwoCHsiBgltk0sW4cKs47nKb?from=from_copylink) 或 [零成本免费云同步部署指南](./FREE_CLOUD_DEPLOY.md)。

A single-host Docker Compose stack that runs the whole backend:

| Service      | Image / build                          | Listens (127.0.0.1) | Role                                              |
| ------------ | -------------------------------------- | ------------------- | ------------------------------------------------- |
| `postgres`   | `postgres:16-alpine` (`wal_level=logical`) | `5432`             | Source DB (what `/upload` writes) + PowerSync storage |
| `powersync`  | `journeyapps/powersync-service:1.26.1` | `8080`              | PowerSync sync endpoint (WebSocket + sync API)     |
| `api`        | built from `server/app/Dockerfile`     | `8787`              | Hono backend — `GET /credentials`, `POST /upload`  |

Every service binds **`127.0.0.1` only**. Nothing is exposed to the network
directly: a **same-host reverse proxy** (Caddy or nginx) is the single public
entrypoint and terminates TLS. The phone (Expo) and desktop (Tauri) clients
connect to the proxy, never to the containers.

```
phone / desktop  →  https://<your-domain>/
                        ├── /api/*  →  127.0.0.1:8787  (api)
                        └── /sync/* →  127.0.0.1:8080  (powersync)
```

The Postgres data lives in the named volume `pgdata` — back it up before
re-provisioning the host.

---

## Prerequisites

- Docker Engine + Docker Compose v2 (`docker compose version`).
- A domain (or subdomain) that points at this host, plus TLS for it — the
  reverse proxy handles the certificate.

---

## 1. Configure the secrets

```bash
cd server/deploy
cp .env.example .env
```

Fill in `.env` — all five values are required:

| Variable               | How to generate                                  | Used by                                  |
| ---------------------- | ------------------------------------------------ | ---------------------------------------- |
| `POSTGRES_PASSWORD`    | any strong string                                | `postgres`, `powersync`, `api`           |
| `NEXTDO_OWNER_TOKEN`   | **required** — `openssl rand -hex 32`            | `api` — the token clients enter in the Settings tab |
| `NEXTDO_SYNC_ENDPOINT` | **required** — your public sync URL              | `api` — handed to every device via `GET /credentials` |
| `JWT_SECRET`           | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='` | `api` + `powersync` — **one shared secret** |
| `PS_ADMIN_TOKEN`       | `openssl rand -hex 32`                           | `powersync` admin API (local ops only)   |

### The owner token — one way (deploy-owned)

Generate it once before starting the stack:

```bash
openssl rand -hex 32
```

and set it as `NEXTDO_OWNER_TOKEN` in `.env`. The server **refuses to
start** when the value is missing or empty (the boot error names the
command above). The token lives ONLY in that `.env` — there is no
persisted file, no log line, and no API echo. Every device (the first
one and all later ones) enters the same value in the Settings tab
(step 5).

> `JWT_SECRET` must be the **same value** in both `api` and `powersync` — the
> backend signs the `/credentials` JWT with it and the PowerSync service
> verifies it. A mismatch means clients connect but never sync.

### `NEXTDO_SYNC_ENDPOINT` — the sync URL, set once

This is the **public URL your reverse proxy serves the PowerSync service
under** — exactly the value you used to write the `/sync/*` route in step
3:

| Reverse-proxy layout | `NEXTDO_SYNC_ENDPOINT` |
| -------------------- | ---------------------- |
| Single domain, prefixes (the Caddy example) | `https://your.domain/sync` |
| Subdomains | `https://sync.your.domain` |

Do **not** put `http://127.0.0.1:8080` here — that address only exists
inside the container's network namespace and is unreachable from a phone.
The `api` service **refuses to start** when the value is missing, empty or
not an absolute `http(s)` URL.

You set it **once, here**. From then on the backend hands it to every
device through `GET /credentials`, so step 5 reduces to "type your server
address, paste the connection string" — nobody has to know or type the
sync path again. If you later change your proxy layout, update this one
variable and every device picks it up at its next credential refresh
(every ~15 min) — no re-entry per device.

> **Upgrading an existing deployment?** Set this **before** deploying the
> new build — see the Operations section below. This is the only breaking
> change in the 10-02 release.

`.env` is git-ignored. If it is ever committed or leaked, rotate every secret
above.

---

## 2. Start the stack

```bash
docker compose up -d --build     # builds the api image on first run
docker compose ps                # all three "running"/"healthy"
docker compose logs -f api       # expect: "listening on :8787"
```

The init SQL (`../powersync/init`, reused from the dev stack) runs **once**,
on first volume init, and creates the `nextdo_powersync` storage database plus
the app tables. Subsequent starts reuse the existing volume.

---

## 3. Reverse proxy (Caddy example)

Caddy issues TLS certificates automatically and upgrades WebSockets for you, so
it needs no `proxy_set_header` boilerplate. Put this in your Caddyfile,
replacing `your.domain`:

```caddy
your.domain {
    handle /api/* {
        uri strip_prefix /api
        reverse_proxy 127.0.0.1:8787
    }
    handle /sync/* {
        uri strip_prefix /sync
        reverse_proxy 127.0.0.1:8080
    }
}
```

- `/api/*` strips the `/api` prefix → the Hono backend sees `/credentials` and
  `/upload` at its root.
- `/sync/*` strips the `/sync` prefix → the PowerSync service sees its routes
  at its root. Caddy handles the `Upgrade` header automatically.

**nginx equivalent** (the manual WebSocket headers are why Caddy is simpler):

```nginx
server {
    listen 443 ssl http2;
    server_name your.domain;
    # ... ssl_certificate / ssl_certificate_key ...

    location /api/ {
        proxy_pass http://127.0.0.1:8787/;     # trailing slash strips /api
        proxy_set_header Host $host;
    }
    location /sync/ {
        proxy_pass http://127.0.0.1:8080/;     # trailing slash strips /sync
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

> The path layout (`/api`, `/sync`) is a **choice**, not a requirement.
> Whatever you choose, record it: the app backend URL is what a device
> types as its **server address** (it appends `/api` itself), and the
> PowerSync URL goes into `NEXTDO_SYNC_ENDPOINT` in `.env` (step 1) — the
> server hands it to every device, so it is never typed on a device. Use
> subdomains instead if you prefer (`api.your.domain` /
> `sync.your.domain`).

---

## 4. No client rebuild — the OSS default is local

The open-source client ships **no default server**: a fresh install is
pure-local (no sync, the local DB is the source of truth). The server
address is entered **per device, at runtime** in the **Settings tab**
(step 5) — there is no `env.ts` edit and no rebuild. This is by design: an
open-source build must not point at anyone's server.

---

## 5. Connect a device

Cloud sync is **optional** — the app works fully local without it. Each
device needs exactly **two** things: your **server address** and the
**connection string**.

1. **服务器地址 (server address)** — your base URL, e.g.
   `https://your.domain`. The app appends `/api` and `/sync` to it, so
   never type those suffixes. (Pasting a full `…/api` or `…/sync` URL
   also works — the app strips the suffix.)
2. **连接串 / owner token** — paste the connection string (below). A bare
   owner token also still works.

Then press **连接**. The app verifies the token with one `/credentials`
call, and the server's `NEXTDO_SYNC_ENDPOINT` (step 1) supplies the real
sync-stream URL — so if your proxy layout is non-standard, you do not have
to explain it on the device.

If you use subdomains instead of prefixes, enter the **API** host as the
server address (`https://api.your.domain`); the sync host still comes
from `NEXTDO_SYNC_ENDPOINT`, so it does not need to be typed at all.

### Generate a connection string

A configured server's public homepage shows only its address and setup status.
It never returns an existing owner token. Copy a connection string from a
connected device's Settings, or build it from your deployment secret below.
For an unclaimed server, the homepage's generate button displays the new
connection string once: save it before refreshing or closing the page.

A connection string carries both halves — the server address and the
owner token — so a device only ever pastes one value. Two forms, both
accepted by the same field in the Settings tab:

**Plaintext** (best for desktop / terminal copy-paste):

```
https://your.domain|<your NEXTDO_OWNER_TOKEN>
```

Build it from the running stack without ever echoing the token to a
log-scraping place — read it out of the container:

```bash
cd server/deploy
printf 'https://your.domain|%s\n' "$(docker compose exec -T api printenv NEXTDO_OWNER_TOKEN)"
# → https://your.domain|9f3c…  (paste this into 桌面端 / 设置 → 连接串)
```

**Deep link** (best for a phone — tap it, or render it as a QR code):

```
nextdo://sync?s=<url-encoded server address>&t=<url-encoded owner token>
```

Build it with the same two values:

```bash
cd server/deploy
TOKEN="$(docker compose exec -T api printenv NEXTDO_OWNER_TOKEN)"
printf 'nextdo://sync?s=%s&t=%s\n' \
  "$(printf 'https://your.domain' | jq -sRr @uri)" \
  "$(printf '%s' "$TOKEN" | jq -sRr @uri)"
# → nextdo://sync?s=https%3A%2F%2Fyour.domain&t=9f3c…
```

Opening that link on a phone runs the exact same connection flow as the
Settings tab and lands on Now; a failure is never silent — it returns to
Settings with the reason shown inline.

> **A connection string IS a secret.** It contains the owner token, which is
> shared by every device. Treat it exactly like the `.env` file: don't post
> it in a public channel, don't commit it, don't paste it into a shared
> ticket. Anyone holding it can read AND write your data.

### After connecting

On success the token **and** the resolved server config are stored
(Keychain / Keystore on mobile, encrypted stronghold file on desktop) and
the device syncs — you won't be asked again. **断开连接** in the same block
stops syncing and clears only the token (the addresses stay, so
reconnecting is just re-entering the token); local data is kept.

> **Upgrading from an older client build:** the stored addresses may look
> different (older builds stored the two full URLs), but the storage shape
> is unchanged — nothing is migrated and no data is lost. After installing
> this build, the Settings tab shows the single server address pre-filled;
> the two custom URL fields are still available under **高级设置** if your
> layout needs them.

---

## Verifying from the host

```bash
# api answers (401 without the token is correct):
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/credentials
# expect: 401

# the reverse proxy, from any machine:
curl -s -o /dev/null -w '%{http_code}\n' https://your.domain/api/credentials
# expect: 401 (proves TLS + routing + CORS are up)
```

A connected client should reach a synced state; check `docker compose logs -f
powersync` for the WebSocket stream.

---

## Operations

- **⚠️ Upgrading an existing deployment to the 10-02 build — add
  `NEXTDO_SYNC_ENDPOINT` FIRST.** This release makes the variable
  **required**: the `api` container refuses to start without it, so
  `docker compose up -d` will leave your backend down until you set it.
  Nothing else about your setup changes, and the value is the sync URL
  you already had typed into each device's Settings tab:

  ```bash
  cd server/deploy

  # 1. Pick the URL your reverse proxy serves PowerSync under (step 3):
  #      prefixes  → https://your.domain/sync
  #      subdomains → https://sync.your.domain
  #    Append it to .env (or add the line yourself):
  echo 'NEXTDO_SYNC_ENDPOINT=https://your.domain/sync' >> .env

  # 2. THEN deploy — the api service now boots:
  docker compose up -d --build
  docker compose ps          # api back to "running"

  # 3. Confirm it is being handed out (200 + endpoint):
  curl -s -H "Authorization: Bearer $(docker compose exec -T api printenv NEXTDO_OWNER_TOKEN)" \
    http://127.0.0.1:8787/credentials
  # expect: {"token":"eyJ…","endpoint":"https://your.domain/sync"}
  ```

  **Already-connected devices need no action.** They already store the two
  URLs and keep working; they simply start honoring the server's value at
  the next credential refresh (~15 min). If you also want clients to adopt
  a corrected value immediately, disconnect and reconnect once — or just
  wait.

- **Migrate an existing deployment to required-token boot:** the new
  build refuses to start without `NEXTDO_OWNER_TOKEN`, so write the token
  into `.env` BEFORE deploying it. The current token is either the old
  `.env`'s `NEXTDO_OWNER_TOKEN` (if non-empty) or the content of the old
  `./data/owner-token` file:

  ```bash
  cd server/deploy
  # find the current token (one of these two places):
  grep '^NEXTDO_OWNER_TOKEN=' .env        # explicit deploy
  cat ./data/owner-token                  # older deployments (first-boot auto-generation)
  # then write that value into .env and deploy the new build:
  docker compose up -d --build
  ```

  Already-connected devices are unaffected when the token value is
  unchanged (no re-entry needed); only a token CHANGE forces every device
  to re-enter it (Settings tab). The old `./data/owner-token` file is no
  longer read by the new code — you may delete it afterwards.
- **Change the sync URL later:** edit `NEXTDO_SYNC_ENDPOINT` in `.env` and
  run `docker compose up -d api`. Clients pick up the new value on their
  next credential refresh (~15 min) — no per-device re-entry. Note that
  the reverse proxy must serve the same new path.
- **Rotate the owner token:** set a new value for `NEXTDO_OWNER_TOKEN` in
  `.env` (`openssl rand -hex 32`) and `docker compose up -d api` — then
  re-enter it in every device (Settings tab). The old token stops working
  immediately. Existing connection strings become invalid at the same
  moment: hand out new ones.
- **Update the backend:** pull your changes, then `docker compose up -d --build`
  (only `api` rebuilds; `postgres`/`powersync` images are pinned and untouched).
- **Update the PowerSync schema:** a client schema change is one unit —
  `packages/db/src/schema.ts` + `server/powersync/sync-config.yaml` +
  `server/powersync/init`. The init SQL only runs on a **fresh** volume; on an
  existing deployment apply schema changes to the live DB directly.
- **Backup:** `docker compose exec postgres pg_dumpall -U "$POSTGRES_USER"` or
  snapshot the `pgdata` volume.
- **Roll back the deployment:** the stack is isolated under `server/deploy` —
  it never touches the dev `server/powersync` stack. Stop with
  `docker compose down` (add `-v` only if you also want to drop the data).
