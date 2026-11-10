import { CONFIG } from "../config.js";
import { GitHubClient } from "./github.js";
import { DemoClient } from "./demo.js";
import { parseMeeting, meetingTemplate, toggleActionLine, dateFromName } from "./meetings.js";

// ---------------------------------------------------------------- storage
const TOKEN_KEY = "xrjoe.token";
const PROJECT_KEY = "xrjoe.projectId";
const store = {
  get(k) {
    try {
      return localStorage.getItem(k) ?? sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v, persist = true) {
    try {
      (persist ? localStorage : sessionStorage).setItem(k, v);
    } catch {
      /* storage unavailable: stays in memory only */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

// ---------------------------------------------------------------- state
const state = {
  client: null,
  user: null,
  meetings: null, // [{name, path, sha, htmlUrl}]
  meetingData: new Map(), // name -> { sha, text, parsed }
  projects: null,
  project: null,
  collaborators: null,
  dirty: false, // unsaved editor changes
};

const $app = document.getElementById("app");
const $modalRoot = document.getElementById("modal-root");
const isDemo = new URLSearchParams(location.search).has("demo");

// ---------------------------------------------------------------- helpers
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

if (window.DOMPurify) {
  window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}
function md(text) {
  const html = window.marked.parse(text || "", { gfm: true, breaks: false });
  return window.DOMPurify.sanitize(html);
}
function mdInline(text) {
  return window.DOMPurify.sanitize(window.marked.parseInline(text || ""));
}

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysUntil(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((t - today) / 86400000);
}
function prettyDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function relDays(n) {
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
function fileUrl(name) {
  return `https://github.com/${CONFIG.owner}/${CONFIG.repo}/blob/${CONFIG.branch}/${CONFIG.meetingsDir}/${encodeURIComponent(name)}`;
}
function avatar(person, size = 22) {
  if (!person) return "";
  const initials = esc((person.login || "?").slice(0, 2).toUpperCase());
  if (person.avatarUrl) {
    const src = person.avatarUrl + (person.avatarUrl.includes("?") ? "&" : "?") + `s=${size * 2}`;
    return `<img class="avatar" src="${esc(src)}" alt="${esc(person.login)}" title="${esc(person.login)}" width="${size}" height="${size}" />`;
  }
  return `<span class="avatar avatar-fallback" title="${esc(person.login)}" style="width:${size}px;height:${size}px">${initials}</span>`;
}
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

let toastTimer;
function toast(msg, kind = "ok") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast toast-${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === "error" ? 7000 : 3500);
}

function friendlyError(e) {
  if (!e) return "Something went wrong.";
  if (e.status === 401) return "GitHub rejected the token (it may have expired). Please sign in again.";
  if (e.status === 404)
    return `GitHub could not find ${CONFIG.owner}/${CONFIG.repo} with this token. Make sure you are a collaborator on the repository and the token has the “repo” scope.`;
  if (e.status === 409 || /does not match|sha/i.test(e.message || ""))
    return "Someone changed this file on GitHub after you opened it. Reload and try again.";
  if (/scope|INSUFFICIENT_SCOPES|resource not accessible/i.test(e.message || ""))
    return "This token is missing a permission. Create a classic token with the “repo” and “project” scopes.";
  return e.message || String(e);
}
function handleError(e, where = "") {
  console.error(where, e);
  if (e && e.status === 401 && !state.client?.demo) {
    signOut("Your GitHub token is no longer valid. Please sign in again.");
    return;
  }
  toast(friendlyError(e), "error");
}

function loading(label = "Loading…") {
  return `<div class="loading"><span class="spinner" aria-hidden="true"></span>${esc(label)}</div>`;
}

// ---------------------------------------------------------------- data
async function loadMeetings(force = false) {
  if (state.meetings && !force) return state.meetings;
  const list = await state.client.listMeetings();
  const queue = list.filter((f) => !(state.meetingData.get(f.name)?.sha === f.sha));
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const f = queue.shift();
      const file = await state.client.readFile(f.path);
      state.meetingData.set(f.name, { sha: file.sha, text: file.text, parsed: parseMeeting(f.name, file.text) });
    }
  });
  await Promise.all(workers);
  for (const name of [...state.meetingData.keys()]) if (!list.find((f) => f.name === name)) state.meetingData.delete(name);
  state.meetings = list;
  return list;
}
function allParsed() {
  return (state.meetings || []).map((f) => state.meetingData.get(f.name)?.parsed).filter(Boolean);
}

async function loadBoard(force = false) {
  if (state.project && !force) return state.project;
  if (!state.projects || force) state.projects = await state.client.listProjects();
  if (!state.projects.length) {
    const e = new Error(
      `No GitHub Projects board is linked to ${CONFIG.repo}. On GitHub, open the board → ⋯ → Settings → “Link a repository”, or set projectNumber in config.js.`
    );
    e.noBoard = true;
    throw e;
  }
  const saved = store.get(PROJECT_KEY);
  const chosen =
    state.projects.find((p) => p.id === saved) ||
    (CONFIG.projectNumber && state.projects.find((p) => p.number === CONFIG.projectNumber)) ||
    state.projects[0];
  state.project = await state.client.loadProject(chosen.id);
  return state.project;
}
async function loadCollaborators() {
  if (state.collaborators) return state.collaborators;
  try {
    state.collaborators = await state.client.collaborators();
  } catch {
    state.collaborators = [];
  }
  return state.collaborators;
}

// ---------------------------------------------------------------- auth
// `token` is a personal access token (string) or the OAuth token provider (function).
async function signIn(token, remember) {
  const client = new GitHubClient(token);
  const user = await client.me();
  // Probe the repository so a wrong token fails here rather than on every page.
  await client.rest(`/repos/${CONFIG.owner}/${CONFIG.repo}`);
  if (typeof token === "string") store.set(TOKEN_KEY, token, remember);
  state.client = client;
  state.user = user;
  const missing = ["repo", "project"].filter((s) => !user.scopes.includes(s));
  if (user.scopes.length === 0) {
    toast("This looks like a fine-grained token. The board needs a classic token with the “repo” and “project” scopes.", "warn");
  } else if (missing.length) {
    toast(`Your token is missing the “${missing.join("” and “")}” scope. Some sections will not work.`, "warn");
  }
}
function signOut(message) {
  store.del(TOKEN_KEY);
  store.del(OAUTH_KEY);
  oauthSession = null;
  Object.assign(state, { client: null, user: null, meetings: null, projects: null, project: null, collaborators: null });
  state.meetingData.clear();
  state.dirty = false;
  if (location.hash && location.hash !== "#/") history.replaceState(null, "", location.pathname + location.search);
  renderLogin(message);
}

function renderHeader() {
  const bar = document.getElementById("topbar");
  bar.hidden = false;
  const u = state.user;
  document.getElementById("who").innerHTML = `
    ${state.client.demo ? '<span class="pill pill-warn">Demo data</span>' : ""}
    ${avatar(u, 26)}
    <span class="who-name">${esc(u.name || u.login)}</span>
    <button class="btn btn-ghost btn-sm" data-action="signout">${state.client.demo ? "Exit demo" : "Sign out"}</button>`;
}

// ---------------------------------------------------------------- GitHub OAuth (via Cloudflare Worker)
const OAUTH_STATE_KEY = "xrjoe.oauthState";
const RETURN_HASH_KEY = "xrjoe.returnHash";
const oauthEnabled = () => !!(CONFIG.oauth && CONFIG.oauth.clientId && CONFIG.oauth.workerUrl);
const redirectUri = () => (CONFIG.oauth && CONFIG.oauth.redirectUri) || location.origin + location.pathname;
const workerEndpoint = () => CONFIG.oauth.workerUrl.replace(/\/$/, "") + "/exchange";

// Sign-in-with-GitHub session: { accessToken, refreshToken, expiresAt (ms epoch or null) }.
// GitHub user tokens from this app expire after a few hours; the refresh token renews them
// through the Worker, so people stay signed in without noticing.
const OAUTH_KEY = "xrjoe.oauth";
let oauthSession = null;
let refreshing = null;
function saveOAuth(sess) {
  oauthSession = sess;
  store.set(OAUTH_KEY, JSON.stringify(sess), true);
}
function sessionFrom(d) {
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token || null,
    expiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : null,
  };
}
async function callWorker(payload) {
  const res = await fetch(workerEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw Object.assign(new Error(data.message || "Could not finish signing in with GitHub. Please try again."), {
      status: payload.refresh_token ? 401 : 0,
    });
  }
  return data;
}
async function oauthToken(force = false) {
  const s = oauthSession;
  if (!s) throw Object.assign(new Error("Not signed in."), { status: 401 });
  const fresh = !s.expiresAt || s.expiresAt - Date.now() > 60_000;
  if ((!force && fresh) || !s.refreshToken) return s.accessToken;
  if (!refreshing) {
    refreshing = callWorker({ refresh_token: s.refreshToken })
      .then((d) => {
        saveOAuth(sessionFrom(d));
        return d.access_token;
      })
      .finally(() => (refreshing = null));
  }
  return refreshing;
}
const session = {
  get(k) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  del(k) {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

function startOAuth() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const stateParam = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  session.set(OAUTH_STATE_KEY, stateParam);
  session.set(RETURN_HASH_KEY, location.hash || "");
  const params = new URLSearchParams({
    client_id: CONFIG.oauth.clientId,
    redirect_uri: redirectUri(),
    scope: "repo project",
    state: stateParam,
    allow_signup: "false",
  });
  location.href = `https://github.com/login/oauth/authorize?${params}`;
}

// Returns the Worker's token response if this page load is GitHub redirecting back, null otherwise.
async function finishOAuthIfReturning() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return null;
  const expected = session.get(OAUTH_STATE_KEY);
  const back = session.get(RETURN_HASH_KEY) || "";
  session.del(OAUTH_STATE_KEY);
  session.del(RETURN_HASH_KEY);
  // Remove ?code=…&state=… from the address bar right away.
  history.replaceState(null, "", location.pathname + back);

  if (params.get("error")) {
    throw new Error(
      params.get("error") === "access_denied"
        ? "Sign-in was cancelled on GitHub."
        : params.get("error_description") || "GitHub sign-in failed."
    );
  }
  if (!expected || params.get("state") !== expected) {
    throw new Error("The sign-in link expired or did not come from this page. Please try again.");
  }
  return callWorker({ code: params.get("code"), redirect_uri: redirectUri() });
}

function renderLogin(message) {
  document.getElementById("topbar").hidden = true;
  const tokenUrl =
    "https://github.com/settings/tokens/new?scopes=repo,project&description=XR-JOE%20Tracker";
  const oauth = oauthEnabled();
  const tokenForm = `
      <form id="login-form" class="stack">
        <label class="field">
          <span>GitHub personal access token (classic)</span>
          <input class="input" type="password" name="token" autocomplete="off" spellcheck="false" placeholder="ghp_…" required />
        </label>
        <label class="check"><input type="checkbox" name="remember" checked /> Remember me on this device</label>
        <button class="btn ${oauth ? "" : "btn-primary"}" type="submit">Sign in with token</button>
      </form>
      <details class="help">
        <summary>How do I get a token?</summary>
        <ol>
          <li>Open <a href="${tokenUrl}" target="_blank" rel="noopener noreferrer">GitHub → New personal access token (classic)</a>. The link pre-selects the two scopes needed: <code>repo</code> and <code>project</code>.</li>
          <li>Pick an expiration (e.g. 90 days), then click <strong>Generate token</strong>.</li>
          <li>Copy the token (starts with <code>ghp_</code>) and paste it above.</li>
        </ol>
        <p>The token stays in this browser only; it is sent to nobody except GitHub.</p>
      </details>`;
  $app.innerHTML = `
  <section class="login">
    <div class="login-card">
      <div class="brand brand-lg"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">XR-JOE <span class="brand-sub">Tracker</span></span></div>
      <p class="lede">Meeting notes, decisions and the Kanban board of <strong>${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</strong>, in one place. Everything is read from and saved to GitHub.</p>
      ${message ? `<p class="notice notice-error">${esc(message)}</p>` : ""}
      ${
        oauth
          ? `<button class="btn btn-primary btn-github" data-action="oauth-start">
               <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
               Sign in with GitHub
             </button>
             <p class="muted small center">You need to be a collaborator on the repository and on the board.</p>
             <details class="help alt-login"><summary>Use a personal access token instead</summary>${tokenForm}</details>`
          : `${tokenForm}<p class="muted small">You need to be a collaborator on the repository and on the board.</p>`
      }
      <p class="muted small">Just looking? <a href="?demo">Explore with demo data</a>.</p>
    </div>
  </section>`;
  const form = document.getElementById("login-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button");
    const token = form.token.value.trim();
    btn.disabled = true;
    btn.textContent = "Checking…";
    try {
      await signIn(token, form.remember.checked);
      renderHeader();
      route();
    } catch (e) {
      console.error(e);
      renderLogin(
        e.status === 401 ? "GitHub did not accept that token. Check that you copied all of it." : friendlyError(e)
      );
    }
  });
}

// ---------------------------------------------------------------- router
function setActiveTab(tab) {
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
}
let lastHash = location.hash;
async function route() {
  if (!state.client) return;
  closeModal();
  const parts = (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean).map(decodeURIComponent);
  const [section, arg, sub] = parts;
  lastHash = location.hash;
  try {
    if (!section) return await viewOverview();
    if (section === "board") return await viewBoard();
    if (section === "decisions") return await viewDecisions();
    if (section === "meetings") {
      if (arg === "new") return await viewEditor(null);
      if (arg && sub === "edit") return await viewEditor(arg);
      return await viewMeetings(arg);
    }
    location.hash = "#/";
  } catch (e) {
    handleError(e, "route");
    $app.innerHTML = `<div class="empty"><p>${esc(friendlyError(e))}</p><button class="btn" data-action="reload">Try again</button></div>`;
  }
}
window.addEventListener("hashchange", () => {
  if (state.dirty && !confirm("You have unsaved changes in the meeting notes. Leave anyway?")) {
    history.replaceState(null, "", lastHash || "#/");
    return;
  }
  state.dirty = false;
  route();
});
window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------------------------------------------------------------- overview
function actionItemRow(a, onBoardTitles) {
  const n = daysUntil(a.due);
  const overdue = !a.done && n !== null && n < 0;
  const onBoard = onBoardTitles && onBoardTitles.has(norm(a.task));
  return `
    <li class="action ${a.done ? "is-done" : ""}">
      <label class="action-check" title="${a.done ? "Mark as not done" : "Mark as done"}">
        <input type="checkbox" ${a.done ? "checked" : ""} data-action="toggle-ai" data-file="${esc(a.file)}" data-raw="${esc(a.raw)}" />
      </label>
      <div class="action-body">
        <div class="action-task">${mdInline(a.task)}</div>
        <div class="action-meta">
          ${a.owner ? `<span class="tag">${esc(a.owner)}</span>` : ""}
          ${a.due ? `<span class="due ${overdue ? "overdue" : ""}">Due ${esc(a.due)}${n !== null && !a.done ? ` · ${relDays(n)}` : ""}</span>` : ""}
          <a class="from" href="#/meetings/${esc(a.date)}">from ${esc(a.date)}</a>
        </div>
      </div>
      ${
        onBoardTitles === null
          ? ""
          : onBoard
            ? '<span class="pill pill-ok" title="A card with this title is on the board">On board</span>'
            : a.done
              ? ""
              : `<button class="btn btn-sm" data-action="ai-to-board" data-file="${esc(a.file)}" data-raw="${esc(a.raw)}">Add to board</button>`
      }
    </li>`;
}

async function viewOverview() {
  setActiveTab("overview");
  $app.innerHTML = loading("Loading overview…");
  const [mRes, bRes] = await Promise.allSettled([loadMeetings(), loadBoard()]);
  if (mRes.status === "rejected") throw mRes.reason;
  const meetings = allParsed();
  const board = bRes.status === "fulfilled" ? bRes.value : null;
  const latest = meetings[0];

  const next = latest?.next || { date: "", topics: "" };
  const nDays = daysUntil(next.date);
  const openItems = meetings
    .flatMap((m) => m.actionItems)
    .filter((a) => !a.done)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const recentDecisions = meetings.flatMap((m) => m.decisions).slice(0, 5);
  const titles = board ? new Set(board.items.map((i) => norm(i.title))) : null;

  let boardHtml;
  if (board) {
    const opts = board.statusField.options;
    const total = board.items.length || 1;
    const counts = opts.map((o) => ({ o, n: board.items.filter((i) => i.statusId === o.id).length }));
    const prog = opts.find((o) => norm(o.name) === "in progress");
    const inProg = prog ? board.items.filter((i) => i.statusId === prog.id) : [];
    const unassigned = inProg.filter((i) => !i.assignees.length);
    boardHtml = `
      <div class="bar">${counts.map(({ o, n }) => (n ? `<span class="seg c-${esc(o.color || "GRAY")}" style="flex:${n / total}" title="${esc(o.name)}: ${n}"></span>` : "")).join("")}</div>
      <ul class="legend">${counts.map(({ o, n }) => `<li><span class="dot c-${esc(o.color || "GRAY")}"></span>${esc(o.name)} <strong>${n}</strong></li>`).join("")}</ul>
      ${
        inProg.length
          ? `<h4 class="mini-h">In progress</h4><ul class="plain">${inProg
              .map((i) => `<li><a href="#/board" data-open-card="${esc(i.id)}">${esc(i.title)}</a> ${i.assignees.map((p) => avatar(p, 18)).join("")}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${unassigned.length ? `<p class="notice notice-warn small">${unassigned.length} card${unassigned.length > 1 ? "s" : ""} in progress without an assignee.</p>` : ""}`;
  } else {
    const err = bRes.reason;
    boardHtml = `<p class="muted">${esc(err?.noBoard ? err.message : friendlyError(err))}</p>`;
  }

  $app.innerHTML = `
  <div class="page-head">
    <div>
      <h1>Hi, ${esc((state.user.name || state.user.login).split(" ")[0])}</h1>
      <p class="muted">Bi-weekly progress for XR-JOE · ${meetings.length} meeting${meetings.length === 1 ? "" : "s"} recorded</p>
    </div>
    <div class="actions">
      <a class="btn btn-primary" href="#/meetings/new">New meeting notes</a>
    </div>
  </div>
  <div class="grid">
    <section class="card card-accent">
      <h3>Next meeting</h3>
      ${
        next.date
          ? `<p class="big">${esc(prettyDate(next.date))}</p><p class="muted">${esc(relDays(nDays))}</p>`
          : `<p class="muted">Not set yet. Add it under “Next meeting” in the latest notes.</p>`
      }
      ${next.topics ? `<h4 class="mini-h">Topics to bring</h4><p>${mdInline(next.topics)}</p>` : ""}
      ${latest ? `<p class="small"><a href="#/meetings/${esc(latest.date)}">Last meeting: ${esc(latest.date)} →</a></p>` : ""}
    </section>
    <section class="card">
      <h3>Board ${board ? `<a class="small head-link" href="#/board">Open board →</a>` : ""}</h3>
      ${boardHtml}
    </section>
    <section class="card span-2">
      <h3>Open action items <span class="count">${openItems.length}</span></h3>
      ${
        openItems.length
          ? `<ul class="actions-list">${openItems.map((a) => actionItemRow(a, titles)).join("")}</ul>`
          : `<p class="muted">Nothing pending. Action items come from the “Action items” section of each meeting’s notes.</p>`
      }
    </section>
    <section class="card span-2">
      <h3>Recent decisions <a class="small head-link" href="#/decisions">All decisions →</a></h3>
      ${
        recentDecisions.length
          ? `<ul class="decisions">${recentDecisions.map((d) => `<li><span class="d-date">${esc(d.date)}</span><span>${mdInline(d.text)}</span></li>`).join("")}</ul>`
          : `<p class="muted">No decisions recorded yet.</p>`
      }
    </section>
  </div>`;
}

async function toggleActionItem(file, raw, done, checkbox) {
  checkbox.disabled = true;
  try {
    const path = `${CONFIG.meetingsDir}/${file}`;
    const fresh = await state.client.readFile(path);
    const parsed = parseMeeting(file, fresh.text);
    const item = parsed.actionItems.find((a) => a.raw === raw);
    if (!item) throw new Error("That action item changed on GitHub. Reload and try again.");
    const text = toggleActionLine(fresh.text, item.line, done);
    const res = await state.client.writeFile(
      path,
      text,
      `${done ? "Complete" : "Reopen"} action item from ${dateFromName(file)} meeting: ${item.task}`.slice(0, 120),
      fresh.sha
    );
    state.meetingData.set(file, { sha: res.sha, text, parsed: parseMeeting(file, text) });
    const listed = state.meetings?.find((f) => f.name === file);
    if (listed) listed.sha = res.sha;
    toast(done ? "Marked as done — saved to GitHub." : "Reopened — saved to GitHub.");
    route();
  } catch (e) {
    checkbox.checked = !done;
    checkbox.disabled = false;
    handleError(e, "toggle");
  }
}

async function actionItemToBoard(file, raw, btn) {
  btn.disabled = true;
  btn.textContent = "Adding…";
  try {
    const board = await loadBoard();
    const item = state.meetingData.get(file)?.parsed.actionItems.find((a) => a.raw === raw);
    if (!item) throw new Error("Action item not found. Reload and try again.");
    const body = [
      `Action item from the [${item.date} meeting notes](${fileUrl(file)}).`,
      item.owner ? `\n**Responsible:** ${item.owner}` : "",
      item.due ? `\n**Due:** ${item.due}` : "",
    ].join("");
    const itemId = await state.client.addDraft(board.id, item.task, body, []);
    const col = board.statusField.options.find((o) => norm(o.name) === norm(CONFIG.defaultColumn)) || board.statusField.options[0];
    if (col) await state.client.setStatus(board.id, itemId, board.statusField.id, col.id);
    await loadBoard(true);
    toast(`Added to “${col ? col.name : "the board"}”.`);
    route();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Add to board";
    handleError(e, "to-board");
  }
}

// ---------------------------------------------------------------- board
const boardUI = { q: "", who: "" };

async function viewBoard(force = false) {
  setActiveTab("board");
  if (!state.project || force) $app.innerHTML = loading("Loading board…");
  let board;
  try {
    board = await loadBoard(force);
  } catch (e) {
    if (e.noBoard) {
      $app.innerHTML = `<div class="empty"><h2>No board found</h2><p>${esc(e.message)}</p></div>`;
      return;
    }
    throw e;
  }
  loadCollaborators();
  const opts = board.statusField.options;
  const people = new Map();
  board.items.forEach((i) => i.assignees.forEach((p) => people.set(p.login, p)));

  const matches = (i) => {
    if (boardUI.who === "__none" && i.assignees.length) return false;
    if (boardUI.who && boardUI.who !== "__none" && !i.assignees.some((p) => p.login === boardUI.who)) return false;
    if (boardUI.q && !norm(i.title + " " + i.body).includes(norm(boardUI.q))) return false;
    return true;
  };
  const cols = opts.map((o) => ({ id: o.id, name: o.name, color: o.color, description: o.description, items: board.items.filter((i) => i.statusId === o.id) }));
  const noStatus = board.items.filter((i) => !i.statusId || !opts.find((o) => o.id === i.statusId));
  if (noStatus.length) cols.unshift({ id: "", name: "No status", color: "GRAY", description: "", items: noStatus });

  $app.innerHTML = `
  <div class="page-head">
    <div>
      <h1>${esc(board.title)}</h1>
      <p class="muted">Drag cards between columns, or click a card to edit it. Changes are saved to GitHub Projects.</p>
    </div>
    <div class="actions">
      ${
        state.projects.length > 1
          ? `<select class="input input-sm" data-action="pick-project" aria-label="Board">${state.projects
              .map((p) => `<option value="${esc(p.id)}" ${p.id === board.id ? "selected" : ""}>${esc(p.title)}</option>`)
              .join("")}</select>`
          : ""
      }
      <button class="btn" data-action="board-refresh" title="Reload from GitHub">Refresh</button>
      ${board.url && board.url !== "#" ? `<a class="btn" href="${esc(board.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ""}
      <button class="btn btn-primary" data-action="new-card">New card</button>
    </div>
  </div>
  <div class="filters">
    <input class="input" type="search" placeholder="Filter cards…" value="${esc(boardUI.q)}" data-action="board-q" aria-label="Filter cards" />
    <select class="input" data-action="board-who" aria-label="Filter by assignee">
      <option value="">Everyone</option>
      ${[...people.values()].map((p) => `<option value="${esc(p.login)}" ${boardUI.who === p.login ? "selected" : ""}>${esc(p.login)}</option>`).join("")}
      <option value="__none" ${boardUI.who === "__none" ? "selected" : ""}>Unassigned</option>
    </select>
  </div>
  <div class="board" style="--cols:${cols.length}">
    ${cols
      .map((c) => {
        const visible = c.items.filter(matches);
        return `
      <section class="column" data-col="${esc(c.id)}" aria-label="${esc(c.name)}">
        <header class="col-head">
          <span class="dot c-${esc(c.color || "GRAY")}"></span>
          <h2>${esc(c.name)}</h2>
          <span class="count">${visible.length}</span>
        </header>
        ${c.description ? `<p class="col-desc">${esc(c.description)}</p>` : ""}
        <div class="col-body" data-drop="${esc(c.id)}">
          ${visible.map(cardHtml).join("") || '<p class="col-empty">No cards</p>'}
        </div>
        ${c.id ? `<button class="add-inline" data-action="new-card" data-col="${esc(c.id)}">+ Add card</button>` : ""}
      </section>`;
      })
      .join("")}
  </div>`;
  wireDragAndDrop();
}

function cardHtml(i) {
  const kind =
    i.type === "Issue"
      ? `<span class="kind kind-issue">Issue #${esc(i.number)}</span>`
      : i.type === "PullRequest"
        ? `<span class="kind kind-pr">PR #${esc(i.number)}</span>`
        : `<span class="kind">Draft</span>`;
  return `
    <article class="kcard" draggable="true" tabindex="0" data-item="${esc(i.id)}" aria-label="${esc(i.title)}">
      <div class="kcard-top">${kind}${i.state === "CLOSED" || i.state === "MERGED" ? `<span class="kind">${esc(i.state.toLowerCase())}</span>` : ""}</div>
      <h3 class="kcard-title">${esc(i.title)}</h3>
      ${i.labels.length ? `<div class="labels">${i.labels.map((l) => `<span class="label" style="--lc:#${esc(l.color)}">${esc(l.name)}</span>`).join("")}</div>` : ""}
      <div class="kcard-foot">${i.assignees.map((p) => avatar(p, 20)).join("")}${i.body ? '<span class="has-body" title="Has a description">≡</span>' : ""}</div>
    </article>`;
}

let dragId = null;
function wireDragAndDrop() {
  $app.querySelectorAll(".kcard").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      dragId = el.dataset.item;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId);
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      $app.querySelectorAll(".col-body.over").forEach((c) => c.classList.remove("over"));
    });
  });
  $app.querySelectorAll(".col-body").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      if (!dragId || !zone.dataset.drop) return;
      e.preventDefault();
      zone.classList.add("over");
    });
    zone.addEventListener("dragleave", (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove("over");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("over");
      const id = dragId || e.dataTransfer.getData("text/plain");
      dragId = null;
      if (id && zone.dataset.drop) moveCard(id, zone.dataset.drop);
    });
  });
}

async function moveCard(itemId, optionId) {
  const board = state.project;
  const item = board.items.find((i) => i.id === itemId);
  if (!item || item.statusId === optionId) return;
  const prev = item.statusId;
  item.statusId = optionId; // optimistic
  if (location.hash.startsWith("#/board")) viewBoard();
  try {
    await state.client.setStatus(board.id, itemId, board.statusField.id, optionId);
    const name = board.statusField.options.find((o) => o.id === optionId)?.name;
    toast(`Moved to “${name}”.`);
  } catch (e) {
    item.statusId = prev;
    if (location.hash.startsWith("#/board")) viewBoard();
    handleError(e, "move");
  }
}

// ---------------------------------------------------------------- card modal
function closeModal() {
  $modalRoot.innerHTML = "";
  document.body.classList.remove("modal-open");
}
function openModal(html) {
  $modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.classList.add("modal-open");
  const first = $modalRoot.querySelector("input, textarea, select, button");
  if (first) first.focus();
}

async function openCard(itemId) {
  const board = state.project;
  const item = board?.items.find((i) => i.id === itemId);
  if (!item) return;
  const collabs = await loadCollaborators();
  const editable = item.type !== "PullRequest";
  const people = mergePeople(collabs, item.assignees);
  openModal(`
    <form id="card-form" class="stack">
      <header class="modal-head">
        <span class="kind ${item.type === "Issue" ? "kind-issue" : item.type === "PullRequest" ? "kind-pr" : ""}">${
          item.type === "DraftIssue" ? "Draft" : item.type === "Issue" ? `Issue #${esc(item.number)}` : `PR #${esc(item.number)}`
        }</span>
        <button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">×</button>
      </header>
      <label class="field"><span>Title</span><input class="input" name="title" value="${esc(item.title)}" ${editable ? "" : "readonly"} required /></label>
      <label class="field"><span>Status</span>
        <select class="input" name="status">
          ${item.statusId ? "" : '<option value="">No status</option>'}
          ${board.statusField.options.map((o) => `<option value="${esc(o.id)}" ${o.id === item.statusId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}
        </select>
      </label>
      <fieldset class="field"><legend>Assignees</legend>
        <div class="people">${
          people.length
            ? people
                .map(
                  (p) => `<label class="person"><input type="checkbox" name="assignee" value="${esc(p.id)}" data-login="${esc(p.login)}" ${
                    item.assignees.some((a) => a.login === p.login) ? "checked" : ""
                  } ${editable ? "" : "disabled"} />${avatar(p, 20)} ${esc(p.login)}</label>`
                )
                .join("")
            : '<span class="muted small">No collaborators visible with this token.</span>'
        }</div>
      </fieldset>
      <label class="field"><span>Description <span class="muted">(Markdown)</span></span>
        <textarea class="input" name="body" rows="7" ${editable ? "" : "readonly"}>${esc(item.body)}</textarea>
      </label>
      <footer class="modal-foot">
        <div>
          <button type="button" class="btn btn-danger-ghost" data-action="archive-card" data-item="${esc(item.id)}">Archive</button>
          ${item.url ? `<a class="btn btn-ghost" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ""}
        </div>
        <div>
          <button type="button" class="btn" data-action="close-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </footer>
    </form>`);
  document.getElementById("card-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const title = f.title.value.trim();
      const body = f.body.value;
      const checked = [...f.querySelectorAll('input[name="assignee"]:checked')];
      const changedContent =
        editable &&
        (title !== item.title ||
          body !== item.body ||
          checked.map((c) => c.dataset.login).sort().join() !== item.assignees.map((a) => a.login).sort().join());
      if (changedContent) {
        if (item.type === "DraftIssue") {
          await state.client.updateDraft(item.contentId, title, body, checked.map((c) => c.value));
        } else if (item.type === "Issue") {
          await state.client.updateIssue(item.repo, item.number, { title, body, assignees: checked.map((c) => c.dataset.login) });
        }
      }
      if (f.status.value && f.status.value !== item.statusId) {
        await state.client.setStatus(board.id, item.id, board.statusField.id, f.status.value);
      }
      closeModal();
      await loadBoard(true);
      toast("Card saved to GitHub.");
      route();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Save";
      handleError(e, "save-card");
    }
  });
}

function mergePeople(collabs, extra) {
  const m = new Map();
  [...(collabs || []), ...(extra || [])].forEach((p) => p && !m.has(p.login) && m.set(p.login, p));
  return [...m.values()];
}

async function openNewCard(colId) {
  const board = await loadBoard();
  const collabs = await loadCollaborators();
  const def = colId || board.statusField.options.find((o) => norm(o.name) === norm(CONFIG.defaultColumn))?.id || board.statusField.options[0]?.id;
  openModal(`
    <form id="new-card-form" class="stack">
      <header class="modal-head"><h2>New card</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close">×</button></header>
      <label class="field"><span>Title</span><input class="input" name="title" required placeholder="e.g. Set up Unity project for XR prototype" /></label>
      <label class="field"><span>Column</span>
        <select class="input" name="status">${board.statusField.options.map((o) => `<option value="${esc(o.id)}" ${o.id === def ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>
      </label>
      <fieldset class="field"><legend>Assignees</legend>
        <div class="people">${
          collabs.length
            ? collabs.map((p) => `<label class="person"><input type="checkbox" name="assignee" value="${esc(p.id)}" />${avatar(p, 20)} ${esc(p.login)}</label>`).join("")
            : '<span class="muted small">No collaborators visible with this token.</span>'
        }</div>
      </fieldset>
      <label class="field"><span>Description <span class="muted">(Markdown, optional)</span></span><textarea class="input" name="body" rows="5" placeholder="What needs to be done, useful links…"></textarea></label>
      <p class="muted small">The card is created as a draft. Use “Convert to issue” on GitHub if it needs its own discussion page.</p>
      <footer class="modal-foot"><span></span><div>
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">Create card</button>
      </div></footer>
    </form>`);
  document.getElementById("new-card-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Creating…";
    try {
      const ids = [...f.querySelectorAll('input[name="assignee"]:checked')].map((c) => c.value);
      const itemId = await state.client.addDraft(board.id, f.title.value.trim(), f.body.value, ids);
      if (f.status.value) await state.client.setStatus(board.id, itemId, board.statusField.id, f.status.value);
      closeModal();
      await loadBoard(true);
      toast("Card created.");
      route();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Create card";
      handleError(e, "new-card");
    }
  });
}

// ---------------------------------------------------------------- meetings
async function viewMeetings(date) {
  setActiveTab("meetings");
  if (!state.meetings) $app.innerHTML = loading("Loading meetings…");
  await loadMeetings();
  const list = allParsed();
  if (!list.length) {
    $app.innerHTML = `<div class="empty"><h2>No meeting notes yet</h2><p>Notes live in the <code>${esc(CONFIG.meetingsDir)}/</code> folder of the repository, one file per meeting.</p><a class="btn btn-primary" href="#/meetings/new">Write the first notes</a></div>`;
    return;
  }
  const current = list.find((m) => m.date === date) || list[0];
  const data = state.meetingData.get(current.name);
  const open = current.actionItems.filter((a) => !a.done).length;

  $app.innerHTML = `
  <div class="meetings">
    <aside class="m-list">
      <div class="m-list-head">
        <h2>Meetings</h2>
        <a class="btn btn-primary btn-sm" href="#/meetings/new">New</a>
      </div>
      <ul>${list
        .map((m) => {
          const pending = m.actionItems.filter((a) => !a.done).length;
          return `<li><a href="#/meetings/${esc(m.date)}" class="${m.name === current.name ? "active" : ""}">
            <span class="m-date">${esc(prettyDate(m.date))}</span>
            <span class="m-sub">${m.decisions.length} decision${m.decisions.length === 1 ? "" : "s"}${pending ? ` · ${pending} open item${pending === 1 ? "" : "s"}` : ""}</span>
          </a></li>`;
        })
        .join("")}</ul>
    </aside>
    <article class="m-view">
      <div class="m-view-head">
        <div class="muted small">${esc(CONFIG.meetingsDir)}/${esc(current.name)}</div>
        <div class="actions">
          <a class="btn btn-sm" href="${fileUrl(current.name)}" target="_blank" rel="noopener noreferrer">View on GitHub</a>
          <a class="btn btn-sm" href="#/meetings/${esc(current.date)}/edit" title="Notes should only be edited when strictly necessary">Edit</a>
        </div>
      </div>
      ${
        current.actionItems.length
          ? `<section class="card card-tight"><h3>Action items <span class="count">${open} open</span></h3>
              <ul class="actions-list">${current.actionItems.map((a) => actionItemRow(a, state.project ? new Set(state.project.items.map((i) => norm(i.title))) : null)).join("")}</ul></section>`
          : ""
      }
      <div class="prose">${md(data.text)}</div>
    </article>
  </div>`;
}

async function viewEditor(date) {
  setActiveTab("meetings");
  const isNew = !date;
  let text, sha, name;
  if (isNew) {
    name = `${todayISO()}.md`;
    text = meetingTemplate(todayISO());
  } else {
    $app.innerHTML = loading("Opening notes…");
    await loadMeetings();
    const m = allParsed().find((x) => x.date === date);
    if (!m) throw Object.assign(new Error(`No notes found for ${date}.`), { status: 0 });
    name = m.name;
    const fresh = await state.client.readFile(`${CONFIG.meetingsDir}/${name}`);
    text = fresh.text;
    sha = fresh.sha;
  }
  $app.innerHTML = `
  <form id="editor" class="editor">
    <div class="page-head">
      <div>
        <h1>${isNew ? "New meeting notes" : `Edit notes · ${esc(date)}`}</h1>
        <p class="muted">${
          isNew
            ? "Fill in the template. Saving creates the file in the meetings folder with a commit."
            : "Notes are the record of what was agreed — only edit them when strictly necessary."
        }</p>
      </div>
      <div class="actions">
        <a class="btn" href="${isNew ? "#/meetings" : `#/meetings/${esc(date)}`}">Cancel</a>
        <button class="btn btn-primary" type="submit">${isNew ? "Save notes" : "Save changes"}</button>
      </div>
    </div>
    <div class="editor-meta">
      ${isNew ? `<label class="field field-inline"><span>Meeting date</span><input class="input" type="date" name="date" value="${todayISO()}" required /></label>` : ""}
      <label class="field field-inline grow"><span>Commit message</span><input class="input" name="message" value="${esc(isNew ? `Notes for ${todayISO()} meeting` : `Update notes for ${date} meeting`)}" required /></label>
    </div>
    <div class="split">
      <label class="pane"><span class="pane-label">Markdown</span>
        <textarea name="text" class="input mono" spellcheck="true">${esc(text)}</textarea>
      </label>
      <div class="pane"><span class="pane-label">Preview</span><div class="prose preview" id="preview">${md(text)}</div></div>
    </div>
  </form>`;
  const form = document.getElementById("editor");
  const preview = document.getElementById("preview");
  let t;
  form.text.addEventListener("input", () => {
    state.dirty = true;
    clearTimeout(t);
    t = setTimeout(() => (preview.innerHTML = md(form.text.value)), 120);
  });
  if (isNew) {
    form.date.addEventListener("change", () => {
      const d = form.date.value;
      if (!d) return;
      form.text.value = form.text.value.replace(/^# Meeting .*$/m, `# Meeting ${d}`);
      form.message.value = `Notes for ${d} meeting`;
      preview.innerHTML = md(form.text.value);
    });
  }
  form.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const fileName = isNew ? `${form.date.value}.md` : name;
      const path = `${CONFIG.meetingsDir}/${fileName}`;
      if (isNew && (await state.client.fileExists(path))) {
        throw Object.assign(new Error(`Notes for ${form.date.value} already exist. Open them from the list and use Edit instead.`), { status: 0 });
      }
      let body = form.text.value;
      if (!body.endsWith("\n")) body += "\n";
      const res = await state.client.writeFile(path, body, form.message.value.trim(), sha);
      state.meetingData.set(fileName, { sha: res.sha, text: body, parsed: parseMeeting(fileName, body) });
      state.dirty = false;
      await loadMeetings(true);
      toast("Notes saved to GitHub.");
      location.hash = `#/meetings/${dateFromName(fileName)}`;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = isNew ? "Save notes" : "Save changes";
      handleError(e, "save-notes");
    }
  });
}

// ---------------------------------------------------------------- decisions
let decisionsQ = "";
async function viewDecisions() {
  setActiveTab("decisions");
  if (!state.meetings) $app.innerHTML = loading("Loading decisions…");
  await loadMeetings();
  const meetings = allParsed();
  const render = () => {
    const q = norm(decisionsQ);
    const groups = meetings
      .map((m) => ({ m, ds: m.decisions.filter((d) => !q || norm(d.text).includes(q)) }))
      .filter((g) => g.ds.length);
    const total = groups.reduce((n, g) => n + g.ds.length, 0);
    document.getElementById("dec-list").innerHTML = groups.length
      ? groups
          .map(
            (g) => `<section class="dec-group">
              <h3><a href="#/meetings/${esc(g.m.date)}">${esc(prettyDate(g.m.date))}</a></h3>
              <ol>${g.ds.map((d) => `<li>${mdInline(d.text)}</li>`).join("")}</ol>
            </section>`
          )
          .join("")
      : `<p class="muted">${q ? "No decisions match that search." : "No decisions recorded yet. They come from the “Decisions” section of each meeting’s notes."}</p>`;
    document.getElementById("dec-count").textContent = `${total} decision${total === 1 ? "" : "s"}`;
  };
  $app.innerHTML = `
  <div class="page-head">
    <div><h1>Decision log</h1><p class="muted">Everything agreed in meetings, newest first · <span id="dec-count"></span></p></div>
    <div class="actions"><input class="input" type="search" id="dec-q" placeholder="Search decisions…" value="${esc(decisionsQ)}" aria-label="Search decisions" /></div>
  </div>
  <div id="dec-list" class="card"></div>`;
  document.getElementById("dec-q").addEventListener("input", (e) => {
    decisionsQ = e.target.value;
    render();
  });
  render();
}

// ---------------------------------------------------------------- global events
document.addEventListener("click", async (e) => {
  const openLink = e.target.closest("[data-open-card]");
  if (openLink) {
    e.preventDefault();
    const id = openLink.dataset.openCard;
    if (!location.hash.startsWith("#/board")) {
      location.hash = "#/board";
      setTimeout(() => openCard(id), 400);
    } else openCard(id);
    return;
  }
  const card = e.target.closest(".kcard");
  if (card) return openCard(card.dataset.item);

  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "close-modal") {
    if (el.classList.contains("modal-backdrop") && e.target !== el) return;
    closeModal();
  } else if (a === "signout") {
    if (state.dirty && !confirm("Discard unsaved changes and sign out?")) return;
    if (state.client?.demo) {
      location.href = location.pathname;
      return;
    }
    signOut();
  } else if (a === "oauth-start") {
    el.disabled = true;
    startOAuth();
  } else if (a === "reload") {
    route();
  } else if (a === "toggle-ai") {
    // handled on change
  } else if (a === "ai-to-board") {
    actionItemToBoard(el.dataset.file, el.dataset.raw, el);
  } else if (a === "new-card") {
    openNewCard(el.dataset.col).catch((err) => handleError(err, "new-card"));
  } else if (a === "board-refresh") {
    viewBoard(true).catch((err) => handleError(err, "refresh"));
  } else if (a === "archive-card") {
    if (el.dataset.armed !== "1") {
      el.dataset.armed = "1";
      el.textContent = "Click again to archive";
      return;
    }
    el.disabled = true;
    try {
      await state.client.archiveItem(state.project.id, el.dataset.item);
      closeModal();
      await loadBoard(true);
      toast("Card archived. You can restore it from the board’s archive on GitHub.");
      route();
    } catch (err) {
      el.disabled = false;
      handleError(err, "archive");
    }
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.action === "toggle-ai") toggleActionItem(el.dataset.file, el.dataset.raw, el.checked, el);
  if (el.dataset.action === "board-who") {
    boardUI.who = el.value;
    viewBoard();
  }
  if (el.dataset.action === "pick-project") {
    store.set(PROJECT_KEY, el.value);
    state.project = null;
    viewBoard(true).catch((err) => handleError(err, "pick-project"));
  }
});
let qTimer;
document.addEventListener("input", (e) => {
  if (e.target.dataset.action === "board-q") {
    boardUI.q = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(async () => {
      const pos = e.target.selectionStart;
      await viewBoard();
      const inp = $app.querySelector('[data-action="board-q"]');
      inp.focus();
      inp.setSelectionRange(pos, pos);
    }, 200);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $modalRoot.innerHTML) closeModal();
  if (e.key === "Enter" && e.target.classList?.contains("kcard")) openCard(e.target.dataset.item);
});

// ---------------------------------------------------------------- boot
(async function boot() {
  if (isDemo) {
    state.client = new DemoClient();
    state.user = await state.client.me();
    renderHeader();
    return route();
  }
  if (oauthEnabled()) {
    try {
      const returned = await finishOAuthIfReturning();
      if (returned) {
        $app.innerHTML = loading("Signing in…");
        store.del(TOKEN_KEY);
        saveOAuth(sessionFrom(returned));
        await signIn(oauthToken, true);
        renderHeader();
        return route();
      }
      const saved = store.get(OAUTH_KEY);
      if (saved) {
        $app.innerHTML = loading("Signing in…");
        oauthSession = JSON.parse(saved);
        await signIn(oauthToken, true);
        renderHeader();
        return route();
      }
    } catch (e) {
      console.error(e);
      store.del(OAUTH_KEY);
      oauthSession = null;
      return renderLogin(e.status === 401 ? "Your GitHub session expired. Please sign in again." : friendlyError(e));
    }
  }
  const token = store.get(TOKEN_KEY);
  if (!token) return renderLogin();
  $app.innerHTML = loading("Signing in…");
  try {
    let remembered = false;
    try {
      remembered = !!localStorage.getItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    await signIn(token, remembered);
    renderHeader();
    route();
  } catch (e) {
    console.error(e);
    store.del(TOKEN_KEY);
    renderLogin(e.status === 401 ? "Your saved token has expired. Please sign in again." : friendlyError(e));
  }
})();
