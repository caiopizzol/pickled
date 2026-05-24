export const appName = "pickled";
// docs.pickled.dev is itself a docs subdomain, so the /docs prefix
// would be redundant. Pages live at the subdomain root: /,
// /getting-started, /toolsets, /pickled-yml, etc. The legacy
// /docs/* paths 301 to the flat paths via apps/docs/public/_redirects
// so any in-flight links keep working.
export const docsRoute = "/";
export const docsImageRoute = "/og";
export const docsContentRoute = "/llms.mdx";

export const gitConfig = {
  user: "caiopizzol",
  repo: "pickled",
  branch: "main",
};
