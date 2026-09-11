# Deploy notes — contact form → Postgres

The site is static (nginx, bind-mounted repo). It now also runs a tiny
**`api`** service (`api/server.js`, Node + Express + `pg`) that stores demo-form
submissions in a **Coolify-managed Postgres**.

Request flow:

```
browser ──POST /api/contact──▶ Traefik ──(PathPrefix /api, priority 100)──▶ app_api ──▶ Postgres
                              └─everything else──────────────────────────▶ app_www (nginx)
```

The old Google Apps Script endpoint has been removed from `index.html`.

---

## One-time setup (on the server / in Coolify)

1. **Provision Postgres** in Coolify (PostgreSQL resource). Attach it so it is
   reachable on the `coolify` network. Copy its **internal** connection string,
   e.g. `postgres://user:pass@<service>:5432/dbname`.

2. **Expose `DATABASE_URL` to this stack.** Either:
   - set `DATABASE_URL` as an environment variable on the app in Coolify, **or**
   - create a `.env` file **next to `docker-compose.yml`** (git-ignored):
     ```
     DATABASE_URL=postgres://user:pass@host:5432/dbname
     ```
   Do **not** put the connection string anywhere under the repo web root other
   than a git-ignored `.env` — nginx now blocks dotfiles, but keep it tidy.

3. **Create the table:**
   ```sh
   psql "$DATABASE_URL" -f api/schema.sql
   ```
   (or paste `api/schema.sql` into the Coolify DB console).

---

## Deploying

The `api` service is **built from source** (`build: ./api`), so the deploy step
must build. The static site still needs no rebuild.

```sh
git reset --hard origin/main        # existing CI/CD step
docker compose up -d --build        # <-- add --build to the pipeline
```

If your pipeline currently only does `git reset --hard` (relying on the nginx
bind mount), it must now also run the `docker compose up -d --build` line above,
or `app_api` will never start.

---

## Verify

```sh
curl -s https://stratagemengine.com/api/health           # {"status":"ok"}
docker compose logs -f api

# submit the form on the site, then:
psql "$DATABASE_URL" -c \
  "select created_at, audience, name, email, institution from contact_submissions order by created_at desc limit 5;"
```

`docker compose exec www nginx -t` should pass (custom `deploy/default.conf`).

---

## Rollback

```sh
git revert <sha>                    # do not force-push
docker compose up -d --build
```

Reverting restores the Google Apps Script endpoint in `index.html`. The
`contact_submissions` table is left untouched.

---

## Notes

- **Spam defense:** hidden honeypot field (`company_website`) + in-memory rate
  limit (5 posts / 10 min / IP). No CAPTCHA.
- **Rate-limit state is per-container** and resets on restart — fine at this
  scale.
- `api/package-lock.json` is not committed yet; run `npm install` in `api/`
  once and commit the lockfile for reproducible builds.
- Local dev: `cd api && DATABASE_URL=postgres://... npm start`.
