// Writes a read-only copy of the board and the meeting notes into docs/data/,
// so the public site can show them to anyone without signing in.
// Run by .github/workflows/publish-snapshot.yml. Needs BOARD_TOKEN: a classic token
// with the `read:project` scope (GitHub's API cannot read Projects without a token).
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../docs/config.js";
import { GitHubClient } from "../docs/js/github.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "data");
const token = process.env.BOARD_TOKEN;

if (!token) {
  console.error("BOARD_TOKEN is not set. Add it under Settings → Secrets and variables → Actions (see docs/README.md).");
  process.exit(1);
}

// ---- Board
const client = new GitHubClient(token);
const projects = await client.listProjects();
const chosen = (CONFIG.projectNumber && projects.find((p) => p.number === CONFIG.projectNumber)) || projects[0];
if (!chosen) {
  console.error("No board found. Check that the token has the read:project scope and that the board is linked to the repository.");
  process.exit(1);
}
const board = await client.loadProject(chosen.id);
board.items.sort((a, b) => a.id.localeCompare(b.id));

// ---- Meetings (read from the checked-out repository, no API needed)
const dir = join(root, CONFIG.meetingsDir);
const names = (await readdir(dir)).filter((n) => /^\d{4}-\d{2}-\d{2}.*\.md$/i.test(n)).sort().reverse();
const meetings = [];
for (const name of names) {
  const text = await readFile(join(dir, name), "utf8");
  meetings.push({
    name,
    path: `${CONFIG.meetingsDir}/${name}`,
    sha: createHash("sha1").update(text).digest("hex"),
    htmlUrl: `https://github.com/${CONFIG.owner}/${CONFIG.repo}/blob/${CONFIG.branch}/${CONFIG.meetingsDir}/${name}`,
    text,
  });
}

// ---- Write only when something changed, so the schedule does not create empty commits.
await mkdir(outDir, { recursive: true });
const data = { project: { id: board.id, number: board.number, title: board.title }, board, meetings };
const path = join(outDir, "snapshot.json");
let previous = null;
try {
  previous = JSON.parse(await readFile(path, "utf8"));
} catch {
  /* first run */
}
const same = previous && JSON.stringify({ ...previous, updatedAt: undefined }) === JSON.stringify({ ...data, updatedAt: undefined });
if (same) {
  console.log("No changes.");
} else {
  await writeFile(path, JSON.stringify({ updatedAt: new Date().toISOString(), ...data }, null, 1) + "\n");
  console.log(`Wrote ${board.items.length} cards and ${meetings.length} meeting notes.`);
}
