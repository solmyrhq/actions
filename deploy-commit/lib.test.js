"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const lib = require("./lib.js");

const REPOSITORY = "solmyrhq/x";
const CHECK = "Lint and test";
const REF = "refs/heads/main";

const sha = (n) => n.toString(16).padStart(40, "0");

const passed = { conclusion: "success", app: { id: lib.GITHUB_ACTIONS_APP_ID } };
const failed = { conclusion: "failure", app: { id: lib.GITHUB_ACTIONS_APP_ID } };

function github({ history, runs = {} }) {
  const commits = history.map(([commit, ...parents]) => ({ sha: commit, parents: parents.map((parent) => ({ sha: parent })) }));
  return {
    routes: [],
    async get(route) {
      this.routes.push(route);
      const url = new URL(route, "https://api.invalid");
      const page = Number(url.searchParams.get("page"));
      const pageOf = (items) => items.slice((page - 1) * lib.PAGE_SIZE, page * lib.PAGE_SIZE);
      if (url.pathname === `/repos/${REPOSITORY}/git/ref/heads/main`) {
        return { object: { sha: commits[0].sha } };
      }
      if (url.pathname === `/repos/${REPOSITORY}/commits`) {
        return pageOf(commits);
      }
      const checks = new RegExp(`^/repos/${REPOSITORY}/commits/([0-9a-f]{40})/check-runs$`).exec(url.pathname);
      if (checks) {
        return { check_runs: pageOf(runs[checks[1]] ?? []) };
      }
      throw new Error(`Unexpected route ${route}`);
    },
  };
}

const linearOf = (count) => Array.from({ length: count }, (_, i) => count - i).map((n) => (n === 1 ? [sha(n)] : [sha(n), sha(n - 1)]));
const linear = linearOf(5);

const choose = (gh, overrides = {}) =>
  lib.chooseDeployCommit({ github: gh, repository: REPOSITORY, ref: REF, branch: "main", sha: sha(3), checkName: CHECK, ...overrides });

test("the tip is deployed when it is the given commit and it passed", async () => {
  const gh = github({ history: linear, runs: { [sha(5)]: [passed] } });
  assert.equal(await choose(gh, { sha: sha(5) }), sha(5));
});

test("the newest commit after the given one that passed is deployed in its place, and a newer failed commit is skipped", async () => {
  const gh = github({ history: linear, runs: { [sha(5)]: [failed], [sha(4)]: [passed], [sha(3)]: [passed] } });
  assert.equal(await choose(gh), sha(4));
});

test("the given commit is deployed when no newer commit passed", async () => {
  const gh = github({ history: linear, runs: { [sha(5)]: [failed], [sha(3)]: [passed] } });
  assert.equal(await choose(gh), sha(3));
});

test("a commit with no passing run is not deployed, even when a newer commit passed", async () => {
  const gh = github({ history: linear, runs: { [sha(5)]: [passed], [sha(3)]: [failed] } });
  await assert.rejects(choose(gh), /No run of the "Lint and test" check by GitHub Actions on 0+3 has passed\./);
});

test("a commit that is on the branch only through the second parent of a merge is refused", async () => {
  const history = [[sha(9), sha(2), sha(8)], [sha(8), sha(1)], [sha(2), sha(1)], [sha(1)]];
  const gh = github({ history, runs: { [sha(8)]: [passed], [sha(9)]: [passed] } });
  await assert.rejects(choose(gh, { sha: sha(8) }), /is not on the branch's first-parent chain\. If a merge put it on the branch, give the SHA of the merge commit\./);
  assert.equal(await choose(gh, { sha: sha(9) }), sha(9));
});

test("with no commit given, the newest commit that passed is deployed, even when the tip has no check run", async () => {
  const gh = github({ history: linear, runs: { [sha(4)]: [passed], [sha(3)]: [passed] } });
  assert.equal(await choose(gh, { sha: "" }), sha(4));
});

test("with no commit given and a tip that passed, the branch's history is not read", async () => {
  const gh = github({ history: linear, runs: { [sha(5)]: [passed] } });
  assert.equal(await choose(gh, { sha: "" }), sha(5));
  assert.deepEqual(
    gh.routes.filter((route) => route.startsWith(`/repos/${REPOSITORY}/commits?`)),
    [],
  );
});

test("with no commit given, nothing is deployed when no commit in the history that the walk may read passed", async () => {
  await assert.rejects(
    choose(github({ history: linear, runs: { [sha(5)]: [failed] } }), { sha: "" }),
    /^Error: No commit on the branch's first-parent chain has a run of the "Lint and test" check by GitHub Actions that passed\.$/,
  );
  const count = lib.PAGE_SIZE * lib.MAX_HISTORY_PAGES + 2;
  await assert.rejects(
    choose(github({ history: linearOf(count) }), { sha: "" }),
    new RegExp(`that passed\\. The action read only the newest ${lib.PAGE_SIZE * lib.MAX_HISTORY_PAGES} commits of the branch's history\\.$`),
  );
});

test("a short or upper-case SHA, a run for another ref and a bad branch name are refused before any request", async () => {
  const gh = github({ history: linear });
  await assert.rejects(choose(gh, { sha: "abc1234" }), /is not a full commit SHA/);
  await assert.rejects(choose(gh, { sha: sha(3).toUpperCase().replace(/^0+/, "A") }), /is not a full commit SHA/);
  await assert.rejects(choose(gh, { ref: "refs/heads/feature" }), /This run is for refs\/heads\/feature\. The action runs only for refs\/heads\/main\./);
  for (const branch of ["", "/main", "main/", "a..b", "main.lock", "main branch"]) {
    await assert.rejects(choose(gh, { branch, ref: `refs/heads/${branch}` }), /is not a branch name/, branch);
  }
  assert.deepEqual(gh.routes, []);
});

test("a passing run is looked for on every page until one is found, and only a successful run by GitHub Actions counts", async () => {
  const other = { conclusion: "success", app: { id: 1 } };
  const check = (runs) => {
    const gh = github({ history: linear, runs: { [sha(3)]: runs } });
    return lib.hasPassingRun({ github: gh, repository: REPOSITORY, sha: sha(3), checkName: CHECK }).then((found) => ({ found, gh }));
  };

  const later = await check([...Array(lib.PAGE_SIZE).fill(failed), other, passed]);
  assert.equal(later.found, true);
  assert.equal(later.gh.routes.length, 2);
  const query = new URL(later.gh.routes[0], "https://api.invalid").searchParams;
  assert.equal(query.get("check_name"), CHECK);
  assert.equal(query.get("filter"), "all");
  assert.equal(query.get("app_id"), String(lib.GITHUB_ACTIONS_APP_ID));

  const first = await check([passed, ...Array(lib.PAGE_SIZE + 1).fill(failed)]);
  assert.equal(first.found, true);
  assert.equal(first.gh.routes.length, 1);

  const none = await check([...Array(lib.PAGE_SIZE).fill(failed), other]);
  assert.equal(none.found, false);
  assert.equal(none.gh.routes.length, 2);
});

test("the walk reads more of the branch's history only when it needs to, and stops after the last page it may read", async () => {
  // Reaching sha(1) needs the parents of PAGE_SIZE * MAX_HISTORY_PAGES + 1
  // commits, one more than the walk may read.
  const count = lib.PAGE_SIZE * lib.MAX_HISTORY_PAGES + 2;
  const gh = github({ history: linearOf(count) });
  const walk = (target) => lib.firstParentsAfter({ github: gh, repository: REPOSITORY, tip: sha(count), sha: target });

  assert.deepEqual(await walk(sha(count - 2)), [sha(count), sha(count - 1)]);
  assert.equal(gh.routes.length, 1);

  gh.routes.length = 0;
  assert.equal((await walk(sha(count - lib.PAGE_SIZE - 1))).length, lib.PAGE_SIZE + 1);
  assert.equal(gh.routes.length, 2);

  gh.routes.length = 0;
  await assert.rejects(walk(sha(1)), new RegExp(`is not on the first-parent chain in the newest ${lib.PAGE_SIZE * lib.MAX_HISTORY_PAGES} commits of the branch's history\\. Give a newer commit`));
  assert.equal(gh.routes.length, lib.MAX_HISTORY_PAGES);
});
