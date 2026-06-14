#!/usr/bin/env node
// check-deploy — reconcile the deploy surface that hides behind a green Vercel build.
//
// Vercel deploys the web app; the `deploy-supabase` GitHub Action applies migrations AND
// edge functions. A green Vercel deploy says NOTHING about the database. This reports the
// `deploy-supabase` conclusion for a commit so "done" can mean *both* surfaces are green.
//
// Usage:  node scripts/check-deploy.mjs [sha]      (default: current HEAD)
// Auth:   GITHUB_TOKEN or GH_TOKEN with read access to the repo's Actions.
// Exit:   0 = green, 1 = not green / no run yet, 2 = misconfigured.

import { execSync } from "node:child_process";

const REPO = "matthewjsimonson/SingleStack";
const sha =
  process.argv[2] || execSync("git rev-parse HEAD").toString().trim();
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token) {
  console.error("check-deploy: set GITHUB_TOKEN (repo Actions read) to query GitHub.");
  process.exit(2);
}

const gh = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "singlestack-check-deploy",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${res.statusText}`);
  return res.json();
};

const { workflow_runs: runs = [] } = await gh(
  `/repos/${REPO}/actions/workflows/deploy-supabase.yml/runs?head_sha=${sha}&per_page=1`,
);
const run = runs[0];

if (!run) {
  console.log(`deploy-supabase @ ${sha.slice(0, 7)}: no run yet (not pushed, or still queued)`);
  process.exit(1);
}

const green = run.status === "completed" && run.conclusion === "success";
const mark = green ? "PASS" : run.status === "completed" ? "FAIL" : "…";
console.log(
  `deploy-supabase @ ${sha.slice(0, 7)}: ${mark}  (${run.status}/${run.conclusion ?? "running"})  ${run.html_url}`,
);
if (!green && run.status === "completed") {
  console.log("Reminder: Vercel green does NOT cover migrations or edge functions.");
}
process.exit(green ? 0 : 1);
