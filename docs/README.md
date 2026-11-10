# XR-JOE Tracker

A small website for following the XR-JOE project: meeting notes, the decision log and the Kanban board, in one place.

It has **no database of its own**. Everything is read from and saved to GitHub:

| Section | Where the data lives |
|---|---|
| **Overview** | Next meeting, board summary, open action items from all meetings, recent decisions |
| **Board** | The GitHub Projects board linked to this repository. Drag cards between columns, create, edit, assign and archive cards. |
| **Meetings** | The `meetings/YYYY-MM-DD.md` files of this repository. Read them, write new ones from the template, edit when necessary. Every save is a commit. |
| **Decisions** | Every bullet under `## Decisions` in the meeting notes, newest first, searchable |

Anything you change here shows up on GitHub, and anything changed on GitHub shows up here after a refresh.

The website code lives in this `docs/` folder. GitHub Pages publishes **only** this folder, so the meeting notes are never part of the public site: the page loads them from the private repository only after you sign in with your own GitHub token.

---

## Signing in

You must be a collaborator on the private repository *and* on the Projects board (see [Giving someone access](#giving-someone-access)). Then:

- **Sign in with GitHub** (recommended): click the button, approve the *XR-JOE Tracker* app on GitHub the first time, and you are in. Nothing to copy or paste. This button appears once the one-time setup in [Setting up “Sign in with GitHub”](#setting-up-sign-in-with-github) is done.
- **Personal access token** (fallback, under *Use a personal access token instead*):
  1. Open [this link](https://github.com/settings/tokens/new?scopes=repo,project&description=XR-JOE%20Tracker). It pre-selects the `repo` and `project` scopes.
  2. Choose an expiration and click **Generate token**.
  3. Paste the token (starts with `ghp_`) on the sign-in page.

  > **Why a classic token?** The board is owned by a personal account, and GitHub's fine-grained tokens cannot access Projects owned by personal accounts.

Either way, the access token is stored only in your browser and sent only to `api.github.com`. **Sign out** removes it from the browser. To revoke access completely, go to [GitHub → Settings → Applications → Authorized OAuth Apps](https://github.com/settings/applications) (for the button) or [Tokens](https://github.com/settings/tokens) (for a token).

To look around without signing in, add `?demo` to the address. The demo uses made-up data and saves nothing.

---

## Giving someone access

For Dr. Meruvia-Pastor, Dr. Henderson, or anyone new:

1. **Repository:** in `XR-JOE-Progress-Update-Reports` → **Settings → Collaborators → Add people**. They need to accept the email invitation.
2. **Board:** open the board → **⋯ (top right) → Settings → Manage access → Invite collaborators**, and give them the **Write** role.
3. They open the site and click **Sign in with GitHub**.

---

## Writing meeting notes

**Meetings → New** opens an editor with the template from the main repository's README, plus a live preview. Pick the meeting date and fill in the sections. **Save notes** creates `meetings/<date>.md` with a commit. <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> also saves.

The site understands these parts of the template:

- `## Decisions`: each bullet becomes an entry in the decision log.
- `## Action items`: each `- [ ] Task — Person — Due date` line becomes an action item. Ticking it on the Overview or the meeting page changes `[ ]` to `[x]` in the file with a commit. **Add to board** turns it into a card in the *Ready* column.
- `## Next meeting`: the `- Date: YYYY-MM-DD` line feeds the “Next meeting” card on the Overview.

Notes are the record of what was agreed, so only edit past meetings when strictly necessary.

---

## Publishing with GitHub Pages

1. In this repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. Branch `main`, folder **`/docs`** (not root, so the meeting notes are not published), then **Save**.
3. After about a minute the site is live at `https://euardogracidas.github.io/XR-JOE-Progress-Update-Reports/`.

> Pages on a **private** repository needs GitHub Pro, which is free for students through the [GitHub Student Developer Pack](https://education.github.com/pack). The published site itself is public, but it contains no project data.

The site is plain HTML, CSS and JavaScript, so there is no build step. Markdown is rendered with [marked](https://github.com/markedjs/marked) and sanitized with [DOMPurify](https://github.com/cure53/DOMPurify). Both are bundled in `vendor/` (MIT / Apache-2.0 licenses included).

### Setting up “Sign in with GitHub”

GitHub only hands out sign-in tokens to a server that knows the app's secret, and GitHub Pages cannot keep secrets. A tiny free [Cloudflare Worker](https://developers.cloudflare.com/workers/) (`oauth-worker/worker.js` in this repository) does that single step. It stores nothing. This is a one-time setup for the repository owner.

**1. Create the GitHub OAuth App**
1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Application name: `XR-JOE Tracker`.
3. Homepage URL **and** Authorization callback URL: `https://euardogracidas.github.io/XR-JOE-Progress-Update-Reports/`
4. **Register application**. Copy the **Client ID**, then click **Generate a new client secret** and copy the secret. Keep the secret private: it only goes into Cloudflare.

**2. Create the Cloudflare Worker** (free plan)
1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up), then go to **Workers & Pages → Create → Worker** (start from “Hello World”). Name it e.g. `xr-joe-auth` and deploy it.
2. **Edit code**, replace everything with the contents of [`oauth-worker/worker.js`](../oauth-worker/worker.js), and **Deploy**.
3. Worker → **Settings → Variables and Secrets**, add:
   | Name | Type | Value |
   |---|---|---|
   | `GITHUB_CLIENT_ID` | Text | the Client ID |
   | `GITHUB_CLIENT_SECRET` | **Secret** | the client secret |
   | `ALLOWED_ORIGINS` | Text | `https://euardogracidas.github.io` |
4. Open the Worker's URL (`https://xr-joe-auth.<your-subdomain>.workers.dev`). It should say `"configured": true`.

**3. Point the site at it**

In `docs/config.js`, fill in `oauth.clientId` (the Client ID, which is public) and `oauth.workerUrl` (the Worker URL), then commit. The **Sign in with GitHub** button appears on the next page load.

### Settings

`config.js` holds the repository name, branch, meetings folder, board number, status field name and default column. If the board is not linked to the repository, either link it (board → ⋯ → Settings → *Link a repository*) or set `projectNumber` to the number in the board's URL.

### Running locally

```sh
cd docs
python3 -m http.server 8000
# open http://localhost:8000/?demo   (or without ?demo to sign in)
```

---

## Files

```
index.html        page shell
styles.css        styles (light and dark mode)
config.js         repository / board settings
js/app.js         views, routing and interactions
js/github.js      GitHub REST (files) + GraphQL (Projects) client
js/meetings.js    meeting-notes template and parser
js/demo.js        in-memory data for ?demo
vendor/           marked + DOMPurify
```
