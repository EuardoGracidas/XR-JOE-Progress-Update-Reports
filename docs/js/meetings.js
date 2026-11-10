// Parsing helpers for the meeting-notes Markdown format described in the repo README.
import { CONFIG } from "../config.js";

export function meetingTemplate(date) {
  return `# Meeting ${date}

**Attendees:** ${CONFIG.attendees}

## Agenda
- Topic 1
- Topic 2

## Discussion
- Summary of what was talked about for each topic.

## Decisions
- Each decision we agreed on, written as one clear sentence.

## Action items
- [ ] Task description — Person responsible — Due date

## Next meeting
- Date:
- Topics to bring:
`;
}

// Lines that are still the untouched template placeholders.
const PLACEHOLDERS = new Set([
  "topic 1",
  "topic 2",
  "summary of what was talked about for each topic.",
  "each decision we agreed on, written as one clear sentence.",
  "task description — person responsible — due date",
  "date:",
  "topics to bring:",
]);

export function isPlaceholder(text) {
  return PLACEHOLDERS.has(text.trim().toLowerCase());
}

export function dateFromName(name) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(name);
  return m ? m[1] : name.replace(/\.md$/i, "");
}

// Returns { title, sections: { [lowercased heading]: { heading, start, end } }, lines }
function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = {};
  let title = null;
  let current = null;
  lines.forEach((line, idx) => {
    const h1 = /^#\s+(.+)/.exec(line);
    const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1 && !title) title = h1[1].trim();
    if (h2) {
      if (current) current.end = idx;
      current = { heading: h2[1].trim(), start: idx + 1, end: lines.length };
      sections[current.heading.toLowerCase()] = current;
    }
  });
  return { title, sections, lines };
}

function bulletLines(parsed, key) {
  const s = parsed.sections[key];
  if (!s) return [];
  const out = [];
  for (let i = s.start; i < s.end; i++) {
    const m = /^\s*[-*+]\s+(.*)$/.exec(parsed.lines[i]);
    if (m && m[1].trim()) out.push({ line: i, text: m[1].trim() });
  }
  return out;
}

export function parseMeeting(name, text) {
  const parsed = splitSections(text);
  const date = dateFromName(name);

  const attendeesMatch = /\*\*Attendees:\*\*\s*(.+)/i.exec(text);

  const decisions = bulletLines(parsed, "decisions")
    .filter((b) => !/^\[[ xX]\]/.test(b.text) && !isPlaceholder(b.text))
    .map((b) => ({ text: b.text, date, file: name }));

  const actionItems = [];
  const ai = parsed.sections["action items"];
  if (ai) {
    for (let i = ai.start; i < ai.end; i++) {
      const m = /^(\s*[-*+]\s+)\[([ xX])\]\s+(.*)$/.exec(parsed.lines[i]);
      if (!m) continue;
      const raw = m[3].trim();
      if (!raw || isPlaceholder(raw)) continue;
      const parts = raw.split(/\s+[—–]\s+|\s+--\s+/);
      actionItems.push({
        line: i,
        raw,
        done: m[2].toLowerCase() === "x",
        task: parts[0],
        owner: parts[1] || "",
        due: parts[2] || "",
        date,
        file: name,
      });
    }
  }

  let nextDate = "";
  let nextTopics = "";
  for (const b of bulletLines(parsed, "next meeting")) {
    const d = /^date:\s*(.*)$/i.exec(b.text);
    const t = /^topics to bring:\s*(.*)$/i.exec(b.text);
    if (d) nextDate = d[1].trim();
    if (t) nextTopics = t[1].trim();
  }

  const agenda = bulletLines(parsed, "agenda")
    .map((b) => b.text)
    .filter((t) => !isPlaceholder(t));

  return {
    name,
    date,
    title: parsed.title || `Meeting ${date}`,
    attendees: attendeesMatch ? attendeesMatch[1].trim() : "",
    agenda,
    decisions,
    actionItems,
    next: { date: nextDate, topics: nextTopics },
  };
}

// Flip the checkbox on a given line of the file text.
export function toggleActionLine(text, lineIdx, done) {
  const lines = text.split(/\r?\n/);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (lineIdx < 0 || lineIdx >= lines.length) throw new Error("Line not found");
  const re = /^(\s*[-*+]\s+)\[([ xX])\]/;
  if (!re.test(lines[lineIdx])) throw new Error("That line is no longer an action item. Reload and try again.");
  lines[lineIdx] = lines[lineIdx].replace(re, `$1[${done ? "x" : " "}]`);
  return lines.join(eol);
}
