// Prebuilt MCP connectors — one-click presets for the agent Connections surface.
// URLs are the providers' hosted MCP endpoints. Most require an auth token
// (OAuth/PAT), added on the form and stored in the secure credential store.
// Clicking a preset prefills the manual form; nothing is hardcoded server-side.
export type ConnectorPreset = { key: string; name: string; url: string; blurb: string; needsAuth: boolean };

export const CONNECTOR_CATALOG: ConnectorPreset[] = [
  { key: "github", name: "GitHub", url: "https://api.githubcopilot.com/mcp/", blurb: "Repos, issues, and pull requests.", needsAuth: true },
  { key: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", blurb: "Issues, projects, and cycles.", needsAuth: true },
  { key: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", blurb: "Docs and databases.", needsAuth: true },
  { key: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", blurb: "Errors and performance issues.", needsAuth: true },
];
