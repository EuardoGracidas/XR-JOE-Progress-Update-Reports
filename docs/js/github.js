// Thin GitHub client: REST for repository files, GraphQL for Projects (v2).
import { CONFIG } from "../config.js";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// ---------- UTF-8 safe base64 ----------
export function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const ITEM_FIELDS = `
  id isArchived updatedAt
  fieldValueByName(name: $status) {
    ... on ProjectV2ItemFieldSingleSelectValue { optionId name }
  }
  content {
    __typename
    ... on DraftIssue { id title body assignees(first: 10) { nodes { id login avatarUrl } } }
    ... on Issue { id number title body url issueState: state repository { nameWithOwner }
      assignees(first: 10) { nodes { id login avatarUrl } }
      labels(first: 10) { nodes { name color } } }
    ... on PullRequest { id number title body url prState: state repository { nameWithOwner }
      assignees(first: 10) { nodes { id login avatarUrl } } }
  }`;

export class GitHubClient {
  // `token` is either a string or an async function (force) => string that returns a
  // fresh token, renewing it when it is about to expire (Sign in with GitHub).
  constructor(token) {
    this.getToken = typeof token === "function" ? token : async () => token;
    this.renewable = typeof token === "function";
    this.demo = false;
  }

  // fetch() with the Authorization header; on 401 renews the token once and retries.
  async _fetch(url, init = {}) {
    const go = async (force) =>
      fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await this.getToken(force)}` }, cache: "no-store" });
    let res = await go(false);
    if (res.status === 401 && this.renewable) res = await go(true);
    return res;
  }

  async rest(path, { method = "GET", body } = {}) {
    const res = await this._fetch(API + path, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new GitHubError((data && data.message) || `GitHub returned ${res.status}`, res.status);
    }
    return data;
  }

  async graphql(query, variables = {}) {
    const res = await this._fetch(API + "/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError((data && data.message) || `GitHub returned ${res.status}`, res.status);
    if (data.errors && data.errors.length) {
      const msg = data.errors.map((e) => e.message).join("; ");
      throw new GitHubError(msg, res.status);
    }
    return data.data;
  }

  // ---------- Identity ----------
  async me() {
    const res = await this._fetch(API + "/user", { headers: { Accept: "application/vnd.github+json" } });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError((data && data.message) || "Invalid token", res.status);
    const scopes = (res.headers.get("x-oauth-scopes") || "").split(",").map((s) => s.trim()).filter(Boolean);
    return { login: data.login, name: data.name, avatarUrl: data.avatar_url, scopes };
  }

  async collaborators() {
    const { owner, repo } = CONFIG;
    const list = await this.rest(`/repos/${owner}/${repo}/collaborators?per_page=100`);
    return list.map((u) => ({ id: u.node_id, login: u.login, avatarUrl: u.avatar_url }));
  }

  // ---------- Meeting files ----------
  async listMeetings() {
    const { owner, repo, meetingsDir, branch } = CONFIG;
    let list;
    try {
      list = await this.rest(`/repos/${owner}/${repo}/contents/${meetingsDir}?ref=${branch}`);
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
    return list
      .filter((f) => f.type === "file" && /^\d{4}-\d{2}-\d{2}.*\.md$/i.test(f.name))
      .map((f) => ({ name: f.name, path: f.path, sha: f.sha, htmlUrl: f.html_url }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  async readFile(path) {
    const { owner, repo, branch } = CONFIG;
    const f = await this.rest(`/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${branch}`);
    return { path: f.path, sha: f.sha, text: b64decode(f.content), htmlUrl: f.html_url };
  }

  async fileExists(path) {
    try {
      await this.readFile(path);
      return true;
    } catch (e) {
      if (e.status === 404) return false;
      throw e;
    }
  }

  async writeFile(path, text, message, sha) {
    const { owner, repo, branch } = CONFIG;
    const body = { message, content: b64encode(text), branch };
    if (sha) body.sha = sha;
    const res = await this.rest(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, { method: "PUT", body });
    return { sha: res.content.sha, path: res.content.path };
  }

  // ---------- Projects (v2) ----------
  async listProjects() {
    const { owner, repo } = CONFIG;
    const fields = "projectsV2(first: 20) { nodes { id number title url closed } }";
    const d = await this.graphql(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
      { owner, name: repo }
    );
    let owned = [];
    try {
      const u = await this.graphql(`query($owner: String!) { user(login: $owner) { ${fields} } }`, { owner });
      owned = u.user?.projectsV2?.nodes || [];
    } catch (_) {
      /* owner may be an organization, or the board may not be visible — linked boards are enough */
    }
    const seen = new Map();
    const all = [...(d.repository?.projectsV2?.nodes || []), ...owned];
    for (const p of all) if (p && !p.closed && !seen.has(p.id)) seen.set(p.id, p);
    return [...seen.values()];
  }

  async loadProject(projectId) {
    const q = `query($id: ID!, $cursor: String, $status: String!) {
      node(id: $id) { ... on ProjectV2 {
        id title url number
        fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name color description } } } }
        items(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${ITEM_FIELDS} } }
      } }
    }`;
    let cursor = null;
    let project = null;
    const items = [];
    do {
      const d = await this.graphql(q, { id: projectId, cursor, status: CONFIG.statusField });
      const p = d.node;
      if (!p) throw new GitHubError("Board not found or no access to it", 404);
      if (!project) project = p;
      items.push(...p.items.nodes);
      cursor = p.items.pageInfo.hasNextPage ? p.items.pageInfo.endCursor : null;
    } while (cursor);

    const statusField = (project.fields.nodes || []).find(
      (f) => f && f.name && f.name.toLowerCase() === CONFIG.statusField.toLowerCase() && f.options
    );
    if (!statusField) throw new GitHubError(`The board has no single-select field called "${CONFIG.statusField}"`, 400);
    return {
      id: project.id,
      title: project.title,
      url: project.url,
      number: project.number,
      statusField,
      items: items.filter((i) => !i.isArchived && i.content).map(normalizeItem),
    };
  }

  async setStatus(projectId, itemId, fieldId, optionId) {
    const q = `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
      updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) {
        projectV2Item { id }
      }
    }`;
    await this.graphql(q, { p: projectId, i: itemId, f: fieldId, o: optionId });
  }

  async addDraft(projectId, title, body, assigneeIds = []) {
    const q = `mutation($p: ID!, $t: String!, $b: String, $a: [ID!]) {
      addProjectV2DraftIssue(input: { projectId: $p, title: $t, body: $b, assigneeIds: $a }) {
        projectItem { id }
      }
    }`;
    const d = await this.graphql(q, { p: projectId, t: title, b: body, a: assigneeIds });
    return d.addProjectV2DraftIssue.projectItem.id;
  }

  async updateDraft(draftId, title, body, assigneeIds) {
    const q = `mutation($d: ID!, $t: String, $b: String, $a: [ID!]) {
      updateProjectV2DraftIssue(input: { draftIssueId: $d, title: $t, body: $b, assigneeIds: $a }) { draftIssue { id } }
    }`;
    await this.graphql(q, { d: draftId, t: title, b: body, a: assigneeIds });
  }

  async updateIssue(repoFullName, number, { title, body, assignees }) {
    await this.rest(`/repos/${repoFullName}/issues/${number}`, {
      method: "PATCH",
      body: { title, body, assignees },
    });
  }

  async archiveItem(projectId, itemId) {
    const q = `mutation($p: ID!, $i: ID!) {
      archiveProjectV2Item(input: { projectId: $p, itemId: $i }) { item { id } }
    }`;
    await this.graphql(q, { p: projectId, i: itemId });
  }
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normalizeItem(i) {
  const c = i.content;
  return {
    id: i.id,
    updatedAt: i.updatedAt,
    statusId: i.fieldValueByName ? i.fieldValueByName.optionId : null,
    type: c.__typename, // DraftIssue | Issue | PullRequest
    contentId: c.id,
    title: c.title || "(untitled)",
    body: c.body || "",
    url: c.url || null,
    number: c.number || null,
    state: c.issueState || c.prState || null,
    repo: c.repository ? c.repository.nameWithOwner : null,
    assignees: (c.assignees?.nodes || []).filter(Boolean),
    labels: (c.labels?.nodes || []).filter(Boolean),
  };
}
