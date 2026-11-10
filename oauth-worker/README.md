# OAuth Worker

Cloudflare Worker behind the tracker's **Sign in with GitHub** button. It exchanges the one-time code from GitHub for an access token, using the OAuth App's client secret, which the static site cannot hold. It stores nothing.

Setup steps: [`docs/README.md` → Setting up “Sign in with GitHub”](../docs/README.md#setting-up-sign-in-with-github).

Endpoints:
- `GET /`: health check (`{"ok":true,"configured":true}`)
- `POST /exchange` with `{"code": "...", "redirect_uri": "..."}` returns `{"access_token": "...", "scope": "..."}`. Only accepted from origins listed in `ALLOWED_ORIGINS`.
