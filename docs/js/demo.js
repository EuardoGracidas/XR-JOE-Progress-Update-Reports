// In-memory stand-in for GitHubClient so the site can be explored without a token (?demo).
import { CONFIG } from "../config.js";

const people = [
  { id: "U_ed", login: "EuardoGracidas", avatarUrl: "" },
  { id: "U_os", login: "omeruvia", avatarUrl: "" },
  { id: "U_jh", login: "jhenderson", avatarUrl: "" },
];

const files = {
  "2026-10-22.md": `# Meeting 2026-10-22

**Attendees:** Oscar, Jay, Eduardo

## Agenda
- Project scope
- Hardware available in the lab

## Discussion
- Agreed to start with a small XR prototype before the full study.

## Decisions
- Use Unity with the OpenXR plugin for the prototype.
- Meet every two weeks on Thursdays.

## Action items
- [x] Set up the GitHub repository — Eduardo — 2026-10-29
- [ ] Book the lab headset for testing — Jay — 2026-11-05

## Next meeting
- Date: 2026-11-05
- Topics to bring: first prototype
`,
  "2026-11-05.md": `# Meeting 2026-11-05

**Attendees:** Oscar, Jay, Eduardo

## Agenda
- Prototype demo
- Literature review plan

## Discussion
- Eduardo showed the first scene running on the headset.
- Discussed which papers to read first.

## Decisions
- Literature review will focus on XR for collaborative work.

## Action items
- [ ] Write a one-page summary of 5 key papers — Eduardo — 2026-11-19
- [ ] Share lab calendar access — Oscar — 2026-11-12

## Next meeting
- Date: 2026-11-19
- Topics to bring: paper summary, prototype v2
`,
};
const shas = {};
let shaCounter = 1;
for (const k of Object.keys(files)) shas[k] = `sha${shaCounter++}`;

const options = [
  { id: "o_back", name: "Backlog", color: "GRAY", description: "" },
  { id: "o_ready", name: "Ready", color: "BLUE", description: "" },
  { id: "o_prog", name: "In Progress", color: "YELLOW", description: "" },
  { id: "o_done", name: "Done", color: "GREEN", description: "" },
];
let itemCounter = 1;
const items = [
  ["Set up Unity project for XR prototype", "o_done", [people[0]], "DraftIssue"],
  ["Book the lab headset for testing", "o_prog", [people[2]], "DraftIssue"],
  ["Literature review: XR collaboration", "o_ready", [people[0]], "Issue"],
  ["Hand tracking support", "o_back", [], "DraftIssue"],
  ["Prototype v2 with shared scene", "o_ready", [], "DraftIssue"],
].map(([title, statusId, assignees, type]) => ({
  id: `I_${itemCounter}`,
  contentId: `C_${itemCounter++}`,
  statusId,
  title,
  body: "",
  type,
  url: type === "Issue" ? "https://github.com" : null,
  number: type === "Issue" ? 3 : null,
  state: type === "Issue" ? "OPEN" : null,
  repo: type === "Issue" ? `${CONFIG.owner}/${CONFIG.repo}` : null,
  assignees,
  labels: [],
  updatedAt: new Date().toISOString(),
}));

const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

export class DemoClient {
  constructor() {
    this.demo = true;
  }
  async me() {
    return { login: "demo-user", name: "Demo user", avatarUrl: "", scopes: ["repo", "project"] };
  }
  async collaborators() {
    return people;
  }
  async listMeetings() {
    await wait();
    return Object.keys(files)
      .sort()
      .reverse()
      .map((name) => ({ name, path: `${CONFIG.meetingsDir}/${name}`, sha: shas[name], htmlUrl: "#" }));
  }
  async readFile(path) {
    await wait();
    const name = path.split("/").pop();
    if (!(name in files)) {
      const e = new Error("Not Found");
      e.status = 404;
      throw e;
    }
    return { path, sha: shas[name], text: files[name], htmlUrl: "#" };
  }
  async fileExists(path) {
    return path.split("/").pop() in files;
  }
  async writeFile(path, text, _message, sha) {
    await wait();
    const name = path.split("/").pop();
    if (name in files && shas[name] !== sha) {
      const e = new Error("File changed on GitHub since you opened it");
      e.status = 409;
      throw e;
    }
    files[name] = text;
    shas[name] = `sha${shaCounter++}`;
    return { sha: shas[name], path };
  }
  async listProjects() {
    return [{ id: "P_demo", number: 1, title: "XR-JOE board (demo)", url: "#" }];
  }
  async loadProject() {
    await wait();
    return {
      id: "P_demo",
      title: "XR-JOE board (demo)",
      url: "#",
      number: 1,
      statusField: { id: "F_status", name: "Status", options },
      items: items.map((i) => ({ ...i, assignees: [...i.assignees] })),
    };
  }
  async setStatus(_p, itemId, _f, optionId) {
    await wait();
    items.find((i) => i.id === itemId).statusId = optionId;
  }
  async addDraft(_p, title, body, assigneeIds = []) {
    await wait();
    const id = `I_${itemCounter}`;
    items.push({
      id,
      contentId: `C_${itemCounter++}`,
      statusId: null,
      title,
      body: body || "",
      type: "DraftIssue",
      url: null,
      number: null,
      state: null,
      repo: null,
      assignees: people.filter((p) => assigneeIds.includes(p.id)),
      labels: [],
      updatedAt: new Date().toISOString(),
    });
    return id;
  }
  async updateDraft(draftId, title, body, assigneeIds) {
    await wait();
    const it = items.find((i) => i.contentId === draftId);
    Object.assign(it, { title, body, assignees: people.filter((p) => assigneeIds.includes(p.id)) });
  }
  async updateIssue(_repo, number, { title, body, assignees }) {
    await wait();
    const it = items.find((i) => i.number === number);
    Object.assign(it, { title, body, assignees: people.filter((p) => assignees.includes(p.login)) });
  }
  async archiveItem(_p, itemId) {
    await wait();
    items.splice(items.findIndex((i) => i.id === itemId), 1);
  }
}
