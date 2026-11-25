"use strict";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

const GITHUB_ACTIONS_APP_ID = 15368;

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

const notOnChain = (sha) =>
  `${sha} is not on the branch's first-parent chain. If a merge put it on the branch, give the SHA of the merge commit.`;

// Returns the number of runs of `checkName` on `sha`, in any attempt, that
// GitHub Actions created and that passed. Every attempt counts: a commit that
// passed and then failed a rerun can already be in production.
async function passingRuns({ github, repository, sha, checkName }) {
  let passed = 0;
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({
      check_name: checkName,
      filter: "all",
      app_id: String(GITHUB_ACTIONS_APP_ID),
      per_page: String(PAGE_SIZE),
      page: String(page),
    });
    const { check_runs: runs } = await github.get(`/repos/${repository}/commits/${sha}/check-runs?${query}`);
    passed += runs.filter((run) => run.conclusion === "success" && run.app?.id === GITHUB_ACTIONS_APP_ID).length;
    if (runs.length < PAGE_SIZE) return passed;
  }
}

// Returns the commits on the first-parent chain from `tip` (included) to `sha`
// (excluded), newest first. Throws if `sha` is not on that chain in the first
// MAX_HISTORY_PAGES pages of the branch's history.
async function firstParentsAfter({ github, repository, tip, sha }) {
  const parents = new Map();
  let page = 0;
  let complete = false;
  const chain = [];
  let current = tip;
  while (current !== sha) {
    while (!parents.has(current)) {
      if (complete) throw new Error(notOnChain(sha));
      if (page === MAX_HISTORY_PAGES) {
        throw new Error(
          `${sha} is not on the first-parent chain in the newest ${page * PAGE_SIZE} commits of the branch's history. Give a newer commit, or, if a merge put ${sha} on the branch, the SHA of the merge commit.`,
        );
      }
      page += 1;
      const query = new URLSearchParams({ sha: tip, per_page: String(PAGE_SIZE), page: String(page) });
      const commits = await github.get(`/repos/${repository}/commits?${query}`);
      for (const commit of commits) {
        parents.set(commit.sha, commit.parents.map((parent) => parent.sha));
      }
      complete = commits.length < PAGE_SIZE;
    }
    chain.push(current);
    const [firstParent] = parents.get(current);
    if (firstParent === undefined) throw new Error(notOnChain(sha));
    current = firstParent;
  }
  return chain;
}

// Returns the newest commit on `branch`'s first-parent chain, from `sha` to the
// tip, that passed `checkName`. Throws unless `branch` and `sha` are valid, `ref`
// is `refs/heads/<branch>`, `sha` is on the chain, and `sha` passed `checkName`.
async function chooseDeployCommit({ github, repository, ref, branch, sha, checkName }) {
  branchName(branch);
  if (ref !== `refs/heads/${branch}`) {
    throw new Error(`This run is for ${ref}. The action runs only for refs/heads/${branch}.`);
  }
  commitSha(sha);

  const { object } = await github.get(`/repos/${repository}/git/ref/heads/${branch}`);
  const tip = commitSha(object.sha);
  const newer = await firstParentsAfter({ github, repository, tip, sha });

  if ((await passingRuns({ github, repository, sha, checkName })) === 0) {
    throw new Error(`No run of the "${checkName}" check by GitHub Actions on ${sha} has passed.`);
  }
  for (const commit of newer) {
    if ((await passingRuns({ github, repository, sha: commit, checkName })) > 0) {
      return commit;
    }
  }
  return sha;
}

module.exports = {
  GITHUB_ACTIONS_APP_ID,
  MAX_HISTORY_PAGES,
  PAGE_SIZE,
  commitSha,
  branchName,
  passingRuns,
  firstParentsAfter,
  chooseDeployCommit,
};
