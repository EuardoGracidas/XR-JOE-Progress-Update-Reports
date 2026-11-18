// Read-only client for visitors who are not signed in. It reads data/snapshot.json, a copy of
// the board and the meeting notes that .github/workflows/publish-snapshot.yml refreshes every
// 15 minutes, so nobody needs a GitHub account to follow the project.
export class PublicClient {
  constructor(snapshot) {
    this.readOnly = true;
    this.isPublic = true;
    this.updatedAt = snapshot.updatedAt || null;
    this.snapshot = snapshot;
  }

  // Returns a client, or null when no snapshot has been published yet.
  static async load() {
    try {
      const res = await fetch(`data/snapshot.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.board && Array.isArray(data.meetings) ? new PublicClient(data) : null;
    } catch {
      return null;
    }
  }

  async me() {
    return { login: "", name: "", avatarUrl: "", scopes: [] };
  }
  async collaborators() {
    return [];
  }
  async listMeetings() {
    return this.snapshot.meetings.map(({ name, path, sha, htmlUrl }) => ({ name, path, sha, htmlUrl }));
  }
  async readFile(path) {
    const f = this.snapshot.meetings.find((m) => m.path === path);
    if (!f) throw Object.assign(new Error("Not Found"), { status: 404 });
    return { path: f.path, sha: f.sha, text: f.text, htmlUrl: f.htmlUrl };
  }
  async listProjects() {
    const b = this.snapshot.board;
    return [{ id: b.id, number: b.number, title: b.title, url: null }];
  }
  async loadProject() {
    // The board itself is private on GitHub, so do not link visitors to it.
    return { ...structuredClone(this.snapshot.board), url: null };
  }
}
