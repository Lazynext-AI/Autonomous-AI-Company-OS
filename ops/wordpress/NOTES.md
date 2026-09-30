# ops/wordpress — self-hosted WordPress on Cloudflare Containers

`blog.lazynext.com` → `wordpress-blog` worker → `WordpressBlog` DO → one CF
container running wordpress:php8.3-apache + sqlite dropin (no MySQL).

**Live**: WP 6.x installed, permalinks `/%postname%/`, REST API + application
passwords working. Connected to Postiz (`wordpress` channel `cmuools6w000109pcwvimwl3d`).

## Hard-won CF-container facts (wordpress edition)

Everything in `ops/postiz/CHANNELS.md`'s container notes applies, plus:

1. **`docker commit` drops VOLUME contents** — `wordpress:*` declares
   `VOLUME /var/www/html`. Anything baked/installed there is invisible at
   runtime (CF mounts the volume empty) AND lost on commit. WP was moved to
   `/var/www/wp` — inside apache's `<Directory /var/www/>` grant, outside the
   volume. **Never install/bake into a declared VOLUME path.**
2. **The container tunnel's `tcpPort.fetch` validates scheme AND follows
   redirects.** `@cloudflare/containers@0.3.7` `containerFetch` only rewrites
   the url *string* — the `Request` it passes as fetch-init still carries
   `https:` → newer runtime hosts reject: "Connecting to a container using
   HTTPS is not currently supported". Same when WP 302s to an absolute https
   URL and the runtime follows it. `src/index.ts` bypasses `containerFetch`
   entirely: `container.start()` + `getTcpPort(port).fetch(url,
   {redirect:"manual"})` with a plain RequestInit (no Request object as init).
3. **Apache in `exec` foreground shape dies on CF** — `/opt/start.sh` that
   `exec`s apache directly → instance exits ~20s in. Backgrounding it
   (`apache2-foreground & … wait`) keeps PID1 = sh and it survives. (Same
   reason Postiz wraps everything in supervisord, not exec'd direct.)
4. **Fresh `/var/run`** — `mkdir -p /var/run/apache2 /var/lock/apache2
   /var/log/apache2` before apache (same class of bug as postgres).
5. **WP application passwords are SSL-gated** — over the container's plain-http
   tunnel WP 401s them. `mu-plugins/app-passwords.php` forces
   `wp_is_application_passwords_available` true + `WP_ENVIRONMENT_TYPE=local`.
   App pw: created via `WP_Application_Passwords::create_new_application_password`
   inside a local `docker run`, then `docker commit` → pushed (baked into the
   sqlite db — survives because the db sits at `/var/www/wp`, a non-volume).
6. **`rest_route` vs pretty REST** — `/wp-json/*` needs `permalink_structure`
   set + `.htaccess` (with the `E=HTTP_AUTHORIZATION` rule). `?rest_route=`
   works regardless.
7. Build pipeline: `docker buildx build --platform linux/amd64
   --provenance=false --sbom=false --push` (manifest lists rejected; the
   managed registry ignores `latest`-tag repoints in API reads — always pin by
   digest).

## Boot telemetry

`/opt/start.sh` PUTs stage markers to `https://blog.lazynext.com/__beacon?s=N`
→ worker writes `wpboot:*` keys in `EPHEMERAL` (1h TTL). Read via the platform
worker's `/kv/get?key=wpboot:last`. If a boot hangs, the last key says which
stage died.

## Postiz wiring

- Channel `wordpress` (`domain`/`username`/`password`) → connected as
  `https://blog.lazynext.com` + `lazynext` + app password (`WP_APP_PASSWORD`
  in `.env`).
- Publish path: `POST /api/public/v1/posts` with
  `settings: {title, type:"post"}` (wordpress requires `title`, `type`, and
  `value[].image` array even if empty).
- **Persistence caveat**: runtime writes land in the container's sqlite —
  replaced on cold boot → any posts/settings made through the UI die with the
  instance. Baked-in state (install, app pw, permalinks) survives. This makes
  WP-on-containers a *publish surface*, not a durable CMS — durable blogging
  stays on Ghost (`ghost.lazynext.com`, Admin API connector).
