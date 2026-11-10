// Settings for the XR-JOE dashboard.
// Change these if the data repository or the board ever moves.
export const CONFIG = {
  // Private repository that holds the meeting notes (and is linked to the board).
  owner: "EuardoGracidas",
  repo: "XR-JOE-Progress-Update-Reports",
  branch: "main",

  // Folder inside the repository with one Markdown file per meeting (YYYY-MM-DD.md).
  meetingsDir: "meetings",

  // GitHub Projects board. Leave null to use the first board linked to the repo
  // (or owned by `owner`). Set a number (from the board URL .../projects/<number>)
  // to pin a specific board.
  projectNumber: null,

  // Name of the single-select field used as the Kanban columns.
  statusField: "Status",

  // Column that new cards (and action items sent to the board) go to.
  defaultColumn: "Ready",

  // Default attendees in the new-meeting template.
  attendees: "Oscar, Jay, Eduardo",
};
