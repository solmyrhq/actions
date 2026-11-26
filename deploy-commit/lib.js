"use strict";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const WORKFLOW = /^[A-Za-z0-9._-]+\.ya?ml$/;

const PAGE_SIZE = 100;

const MAX_HISTORY_PAGES = 5;

function commitSha(value) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new Error(`${JSON.stringify(value)} is not a full commit SHA. Give all 40 hexadecimal characters, in lower case.`);
  }
  return value;
}

function branchName(value) {
  if (typeof value !== "string" || !BRANCH.test(value) || value.includes("..") || value.endsWith(".lock")) {
    throw new Error(
      `${JSON.stringify(value)} is not a branch name that this action accepts. Use only ASCII letters, digits, ".", "_", "-" and "/".`,
    );
  }
  return value;
}

function workflowFile(value) {
  if (typeof value !== "string" || !WORKFLOW.test(value)) {
    throw new Error(
      `${JSON.stringify(value)} is not a workflow file name that this action accepts. Give only the file name, such as "ci.yml", with no directory. Use only ASCII letters, digits, ".", "_" and "-", and end the name in ".yml" or ".yaml".`,
    );
  }
  return value;
}

const notOnChain = (sha) =>
  `${sha} is not on the branch's first-parent chain. If a merge put it on the branch, give the SHA of the merge commit.`;

const passedIn = ({ jobName, workflow, branch }) =>
  `the "${jobName}" job in a run of ${workflow} that a push or a workflow_dispatch event started on ${branch}`;

async function hasPassingJob({ github, repository, runId, jobName }) {
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ filter: "all", per_page: String(PAGE_SIZE), page: String(page) });
    const { jobs } = await github.get(`/repos/${repository}/actions/runs/${runId}/jobs?${query}`);
    if (jobs.some((job) => job.name === jobName && job.conclusion === "success")) return true;
    if (jobs.length < PAGE_SIZE) return false;
  }
}

const BRANCH_EVENTS = new Set(["push", "workflow_dispatch"]);

// Returns whether a job named `jobName` passed for `sha` in a push or
// workflow_dispatch run of `workflow` on `branch`. It counts the jobs of every
// attempt, because a commit that passed and then failed a rerun can already be
// in production.
async function hasPassingRun({ github, repository, sha, branch, workflow, jobName }) {
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ branch, head_sha: sha, per_page: String(PAGE_SIZE), page: String(page) });
    const { workflow_runs: runs } = await github.get(`/repos/${repository}/actions/workflows/${workflow}/runs?${query}`);
    for (const run of runs) {
      const onBranch =
        BRANCH_EVENTS.has(run.event) &&
        run.path?.replace(/@.*$/, "") === `.github/workflows/${workflow}` &&
        run.head_sha === sha &&
        run.head_branch === branch &&
        run.head_repository?.full_name === repository;
      if (onBranch && (await hasPassingJob({ github, repository, runId: run.id, jobName }))) return true;
    }
    if (runs.length < PAGE_SIZE) return false;
  }
}

class HistoryLimitError extends Error {
  constructor() {
    super(`The first-parent chain continues past the newest ${MAX_HISTORY_PAGES * PAGE_SIZE} commits of the branch's history.`);
    this.commits = MAX_HISTORY_PAGES * PAGE_SIZE;
  }
}

// Yields the commits on the first-parent chain from `tip`, newest first, and
// stops at the root. Yields each commit before it looks up that commit's
// parents. Stopping at a commit then costs no request for them. Throws a
// HistoryLimitError when the chain continues past the first
// MAX_HISTORY_PAGES pages of the branch's history.
async function* firstParentChain({ github, repository, tip }) {
  const parents = new Map();
  let page = 0;
  let complete = false;
  let current = tip;
  while (current !== undefined) {
    yield current;
    while (!parents.has(current)) {
      if (complete) return;
      if (page === MAX_HISTORY_PAGES) throw new HistoryLimitError();
      page += 1;
      const query = new URLSearchParams({ sha: tip, per_page: String(PAGE_SIZE), page: String(page) });
      const commits = await github.get(`/repos/${repository}/commits?${query}`);
      for (const commit of commits) {
        parents.set(commit.sha, commit.parents.map((parent) => parent.sha));
      }
      complete = commits.length < PAGE_SIZE;
    }
    [current] = parents.get(current);
  }
}

// Returns the commits on the first-parent chain from `tip` (included) to `sha`
// (excluded), newest first. Throws if `sha` is not on that chain in the first
// MAX_HISTORY_PAGES pages of the branch's history.
async function firstParentsAfter({ github, repository, tip, sha }) {
  const chain = [];
  try {
    for await (const commit of firstParentChain({ github, repository, tip })) {
      if (commit === sha) return chain;
      chain.push(commit);
    }
  } catch (error) {
    if (!(error instanceof HistoryLimitError)) throw error;
    throw new Error(
      `${sha} is not on the first-parent chain in the newest ${error.commits} commits of the branch's history. Give a newer commit, or, if a merge put ${sha} on the branch, the SHA of the merge commit.`,
    );
  }
  throw new Error(notOnChain(sha));
}

// Returns the newest commit on the first-parent chain from `tip` that passed
// `jobName`. Throws if no commit on the chain within the first
// MAX_HISTORY_PAGES pages of the branch's history passed.
async function newestPassing({ github, repository, tip, branch, workflow, jobName }) {
  const none = `No commit on the branch's first-parent chain passed ${passedIn({ jobName, workflow, branch })}.`;
  try {
    for await (const commit of firstParentChain({ github, repository, tip })) {
      if (await hasPassingRun({ github, repository, sha: commit, branch, workflow, jobName })) return commit;
    }
  } catch (error) {
    if (!(error instanceof HistoryLimitError)) throw error;
    throw new Error(`${none} The action read only the newest ${error.commits} commits of the branch's history.`);
  }
  throw new Error(none);
}

// Returns the newest commit on `branch`'s first-parent chain, from the tip
// down to `sha`, that passed `jobName`. Throws unless `branch`, `workflow`
// and `sha` are well formed, `ref` is `refs/heads/<branch>`, `sha` is on the
// chain, and `sha` itself passed. With an empty `sha`, returns the newest
// commit on the chain that passed, and throws if none did.
async function chooseDeployCommit({ github, repository, ref, branch, workflow, sha, jobName }) {
  branchName(branch);
  workflowFile(workflow);
  if (ref !== `refs/heads/${branch}`) {
    throw new Error(`This run is for ${ref}. The action runs only for refs/heads/${branch}.`);
  }
  if (sha !== "") commitSha(sha);

  const { object } = await github.get(`/repos/${repository}/git/ref/heads/${branch}`);
  const tip = commitSha(object.sha);
  if (sha === "") return newestPassing({ github, repository, tip, branch, workflow, jobName });

  const newer = await firstParentsAfter({ github, repository, tip, sha });

  if (!(await hasPassingRun({ github, repository, sha, branch, workflow, jobName }))) {
    throw new Error(`${sha} has not passed ${passedIn({ jobName, workflow, branch })}.`);
  }
  for (const commit of newer) {
    if (await hasPassingRun({ github, repository, sha: commit, branch, workflow, jobName })) return commit;
  }
  return sha;
}

module.exports = {
  MAX_HISTORY_PAGES,
  PAGE_SIZE,
  commitSha,
  branchName,
  workflowFile,
  passedIn,
  hasPassingRun,
  firstParentsAfter,
  newestPassing,
  chooseDeployCommit,
};
