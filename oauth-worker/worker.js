// Cloudflare Worker: exchanges a GitHub OAuth "code" for an access token.
//
// GitHub's token endpoint needs the OAuth App's client secret and does not allow
// browser (CORS) requests, so the static tracker page cannot do this step itself.
// This Worker keeps the secret and does only that one exchange. It stores nothing.
//
// Environment variables (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
//   GITHUB_CLIENT_ID      (text)    Client ID of the GitHub OAuth App
//   GITHUB_CLIENT_SECRET  (secret)  Client secret of the GitHub OAuth App
//   ALLOWED_ORIGINS       (text)    Comma-separated origins allowed to call this Worker,
//                                   e.g. "https://euardogracidas.github.io"

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const originOk = allowed.includes(origin);

    const cors = {
      "Access-Control-Allow-Origin": originOk ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });

    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "xr-joe-tracker-oauth", configured: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) });
    }
    if (request.method !== "POST" || url.pathname !== "/exchange") {
      return json({ error: "not_found" }, 404);
    }
    if (!originOk) {
      return json({ error: "origin_not_allowed", message: `Origin ${origin || "(none)"} is not in ALLOWED_ORIGINS.` }, 403);
    }
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return json({ error: "not_configured", message: "The Worker is missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET." }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad_request", message: "Expected a JSON body." }, 400);
    }
    const code = typeof body.code === "string" ? body.code : "";
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : undefined;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(code)) {
      return json({ error: "bad_request", message: "Missing or malformed code." }, 400);
    }

    const gh = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "xr-joe-tracker-oauth" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      }),
    });
    const data = await gh.json().catch(() => ({}));

    if (!gh.ok || data.error || !data.access_token) {
      return json(
        { error: data.error || "exchange_failed", message: data.error_description || "GitHub did not return a token." },
        400
      );
    }
    return json({ access_token: data.access_token, scope: data.scope || "", token_type: data.token_type || "bearer" });
  },
};
