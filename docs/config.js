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

  // "Sign in with GitHub". Fill in both values to show the button; leave them empty
  // to use personal access tokens only. See README → "Sign in with GitHub".
  oauth: {
    // Client ID of the GitHub OAuth App (public, safe to commit). Never put the secret here.
    clientId: "Ov23liL4UI5rUJqNb2w0",
    // URL of the Cloudflare Worker, e.g. "https://xr-joe-auth.yourname.workers.dev"
    workerUrl: "https://xr-joe-auth.egracidasrey.workers.dev",
    // Must match (or be inside) the OAuth App's "Authorization callback URL".
    redirectUri: "https://euardogracidas.github.io/XR-JOE-Progress-Update-Reports/",
  },
};
