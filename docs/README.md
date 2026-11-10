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

You need two things:

1. **Access on GitHub.** You must be a collaborator on the private repository *and* on the Projects board (see [Giving someone access](#giving-someone-access)).
2. **A personal access token (classic)** with the `repo` and `project` scopes:
   1. Open [this link](https://github.com/settings/tokens/new?scopes=repo,project&description=XR-JOE%20Tracker). It pre-selects the two scopes.
   2. Choose an expiration (90 days is a good balance) and click **Generate token**.
   3. Copy the token (it starts with `ghp_`) and paste it on the site's sign-in page.

> **Why a classic token?** The board is owned by a personal account. GitHub's fine-grained tokens cannot access Projects owned by personal accounts, only those owned by organizations.

The token is stored only in your browser: in `localStorage` with “Remember me” checked, or for the current tab only with it unchecked. It is sent to `api.github.com` and nowhere else. **Sign out** removes it. To revoke it completely, delete it in [GitHub → Settings → Tokens](https://github.com/settings/tokens).

To look around without signing in, add `?demo` to the address. The demo uses made-up data and saves nothing.

---

## Giving someone access

For Dr. Meruvia-Pastor, Dr. Henderson, or anyone new:

1. **Repository:** in `XR-JOE-Progress-Update-Reports` → **Settings → Collaborators → Add people**. They need to accept the email invitation.
2. **Board:** open the board → **⋯ (top right) → Settings → Manage access → Invite collaborators**, and give them the **Write** role.
3. They create their own token (steps above) and sign in.

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
