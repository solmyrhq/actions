"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const lib = require("./lib.js");

const REPOSITORY = "solmyrhq/x";
const CHECK = "Lint and test";
const WORKFLOW = "ci.yml";
const REF = "refs/heads/main";
const ACTIONS_APP = 15368;

const sha = (n) => n.toString(16).padStart(40, "0");

const job = (conclusion, name = CHECK) => ({ name, conclusion });
const run = (jobs, overrides = {}) => ({ event: "push", branch: "main", repository: REPOSITORY, workflow: WORKFLOW, jobs, ...overrides });
const passed = run([job("success")]);
const failed = run([job("failure")]);

function github({ history, runs = {}, lax = false }) {
  const commits = history.map(([commit, ...parents]) => ({ sha: commit, parents: parents.map((parent) => ({ sha: parent })) }));
  const all = Object.entries(runs).flatMap(([commit, specs]) => specs.map((spec) => ({ ...spec, sha: commit })));
  all.forEach((spec, index) => {
    spec.id = index + 1;
    if (!("suite" in spec)) spec.suite = 1000 + index;
  });
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
      const checkRuns = new RegExp(`^/repos/${REPOSITORY}/commits/([0-9a-f]{40})/check-runs$`).exec(url.pathname);
      if (checkRuns) {
        const query = url.searchParams;
        const matching = all
          .flatMap((spec) =>
            spec.jobs.map((j) => ({
              name: j.name,
              conclusion: j.conclusion,
              head_sha: spec.sha,
              app: { id: spec.app ?? ACTIONS_APP },
              check_suite: { id: spec.suite },
            })),
          )
          .filter(
            (checkRun) =>
              lax ||
              (checkRun.head_sha === checkRuns[1] &&
                checkRun.name === query.get("check_name") &&
                String(checkRun.app.id) === query.get("app_id")),
          );
        return { check_runs: pageOf(matching) };
      }
      const workflowRuns = new RegExp(`^/repos/${REPOSITORY}/actions/workflows/([^/]+)/runs$`).exec(url.pathname);
      if (workflowRuns) {
        const query = url.searchParams;
        const matching = all.filter(
          (spec) =>
            lax ||
            (spec.sha === query.get("head_sha") &&
              spec.workflow === workflowRuns[1] &&
              spec.branch === query.get("branch")),
        );
        return {
          workflow_runs: pageOf(matching).map((spec) => ({
            id: spec.id,
            event: spec.event,
            path: `.github/workflows/${spec.workflow}${spec.pathRef ?? ""}`,
            head_sha: spec.sha,
            head_branch: spec.branch,
            head_repository: { full_name: spec.repository },
            check_suite_id: spec.suite,
          })),
        };
      }
      throw new Error(`Unexpected route ${route}`);
    },
  };
}

const linearOf = (count) => Array.from({ length: count }, (_, i) => count - i).map((n) => (n === 1 ? [sha(n)] : [sha(n), sha(n - 1)]));
const linear = linearOf(5);

const choose = (gh, overrides = {}) =>
  lib.chooseDeployCommit({
    github: gh,
    repository: REPOSITORY,
    ref: REF,
    branch: "main",
    workflow: WORKFLOW,
    sha: sha(3),
    jobName: CHECK,
    ...overrides,
  });

const passes = (gh, commit) =>
  lib.hasPassingRun({ github: gh, repository: REPOSITORY, sha: commit, branch: "main", workflow: WORKFLOW, jobName: CHECK });

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
  await assert.rejects(
    choose(gh),
    /^Error: 0+3 has not passed the "Lint and test" job in a run of ci\.yml that a push or a workflow_dispatch event started on main\.$/,
  );
});

test("a pass from a pull request, another workflow, another ref, another branch, a fork or another commit does not count", async () => {
  const elsewhere = [
    failed,
    run([job("success")], { event: "pull_request" }),
    run([job("success")], { workflow: "deploy.yml" }),
    run([job("success")], { pathRef: "@refs/tags/main" }),
    run([job("success")], { pathRef: "@main" }),
    run([job("success")], { branch: "feature" }),
    run([job("success")], { repository: "someone/x" }),
  ];
  for (const lax of [false, true]) {
    const gh = github({ history: linear, runs: { [sha(3)]: elsewhere, [sha(5)]: [passed] }, lax });
    assert.equal(await passes(gh, sha(3)), false, `lax: ${lax}`);
  }
});

test("a run that someone started by hand on the branch counts, like a push run", async () => {
  const gh = github({ history: linear, runs: { [sha(3)]: [run([job("success")], { event: "workflow_dispatch" })] } });
  assert.equal(await passes(gh, sha(3)), true);
});

test("a run whose path names the workflow with a ref after it counts", async () => {
  const gh = github({ history: linear, runs: { [sha(3)]: [run([job("success")], { pathRef: "@refs/heads/main" })] } });
  assert.equal(await passes(gh, sha(3)), true);
});

test("the check runs are read first, then the runs of the workflow on the branch at the commit", async () => {
  const gh = github({ history: linear, runs: { [sha(3)]: [passed] } });
  assert.equal(await passes(gh, sha(3)), true);
  assert.equal(gh.routes.length, 2);
  const [checks, runs] = gh.routes.map((route) => new URL(route, "https://api.invalid"));
  assert.equal(checks.pathname, `/repos/${REPOSITORY}/commits/${sha(3)}/check-runs`);
  assert.equal(checks.searchParams.get("check_name"), CHECK);
  assert.equal(checks.searchParams.get("app_id"), String(ACTIONS_APP));
  assert.equal(checks.searchParams.get("filter"), "all");
  assert.equal(runs.pathname, `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs`);
  assert.equal(runs.searchParams.get("event"), null);
  assert.equal(runs.searchParams.get("branch"), "main");
  assert.equal(runs.searchParams.get("head_sha"), sha(3));
});

test("one request is made for a commit with no successful check run of the job", async () => {
  const gh = github({ history: linear, runs: { [sha(3)]: [failed, failed] } });
  assert.equal(await passes(gh, sha(3)), false);
  assert.equal(gh.routes.length, 1);
});

test("a check run of another job, from another app or on another commit does not count, on any page", async () => {
  const filler = Array(lib.PAGE_SIZE).fill(job("success", "Another job"));
  const elsewhere = github({
    history: linear,
    runs: { [sha(3)]: [run(filler), run([job("success")], { app: 1 })], [sha(5)]: [passed] },
    lax: true,
  });
  assert.equal(await passes(elsewhere, sha(3)), false);
  assert.equal(elsewhere.routes.length, 2);

  const later = github({ history: linear, runs: { [sha(3)]: [run(filler), passed] }, lax: true });
  assert.equal(await passes(later, sha(3)), true);
});

test("a scan of all the history that the action can read makes at most two requests for each commit, and fewer than MAX_REQUESTS, when each response has one page", async () => {
  const count = lib.PAGE_SIZE * lib.MAX_HISTORY_PAGES;
  const otherWorkflow = run([job("success")], { workflow: "deploy.yml" });
  const scan = (failing) => {
    const runs = Object.fromEntries(Array.from({ length: count }, (_, i) => [sha(i + 1), i === 0 ? [passed] : failing]));
    return github({ history: linearOf(count), runs });
  };

  const usual = scan([failed]);
  assert.equal(await choose(usual, { sha: "" }), sha(1));
  assert.equal(usual.routes.length, 1 + lib.MAX_HISTORY_PAGES + count + 1);

  const worst = scan([failed, otherWorkflow]);
  assert.equal(await choose(worst, { sha: "" }), sha(1));
  assert.equal(worst.routes.length, 1 + lib.MAX_HISTORY_PAGES + 2 * count);
  assert.ok(worst.routes.length < lib.MAX_REQUESTS);
});

test("the action fails after MAX_REQUESTS requests and deploys nothing, even when responses have more than one page", async () => {
  const count = lib.PAGE_SIZE * lib.MAX_HISTORY_PAGES;
  const sameNameElsewhere = run(Array(lib.PAGE_SIZE + 1).fill(job("success")), { workflow: "deploy.yml" });
  const runs = Object.fromEntries(Array.from({ length: count }, (_, i) => [sha(i + 1), i === 0 ? [passed] : [sameNameElsewhere]]));
  const gh = github({ history: linearOf(count), runs });
  await assert.rejects(
    choose(gh, { sha: "" }),
    new RegExp(`^Error: The action stopped after ${lib.MAX_REQUESTS} REST API requests, the most that a run can make\\. Nothing was deployed\\.`),
  );
  assert.equal(gh.routes.length, lib.MAX_REQUESTS);
});

test("a run counts only if its check suite has a successful check run of the job, on any page", async () => {
  const first = github({ history: linear, runs: { [sha(3)]: [passed, failed] } });
  assert.equal(await passes(first, sha(3)), true);
  assert.equal(first.routes.length, 2);

  const later = github({ history: linear, runs: { [sha(3)]: [...Array(lib.PAGE_SIZE).fill(failed), passed] } });
  assert.equal(await passes(later, sha(3)), true);
  assert.equal(later.routes.length, 4);

  const noSuite = github({ history: linear, runs: { [sha(3)]: [run([job("success")], { suite: null })] } });
  assert.equal(await passes(noSuite, sha(3)), false);

  const pullRequest = run([job("success")], { event: "pull_request" });
  const none = github({ history: linear, runs: { [sha(3)]: [run([job("success", "Another job"), job("failure")]), failed, pullRequest] } });
  assert.equal(await passes(none, sha(3)), false);
  assert.equal(none.routes.length, 2);
});

test("with check-only, the given commit is checked and returned, and newer commits are not read", async () => {
  const gh = github({ history: linear, runs: { [sha(5)]: [passed], [sha(3)]: [passed] } });
  assert.equal(await choose(gh, { checkOnly: true }), sha(3));
  const checked = gh.routes.filter((route) => route.includes("/check-runs?")).map((route) => new URL(route, "https://api.invalid").pathname);
  assert.deepEqual(checked, [`/repos/${REPOSITORY}/commits/${sha(3)}/check-runs`]);

  await assert.rejects(choose(github({ history: linear, runs: { [sha(5)]: [passed] } }), { checkOnly: true }), /has not passed/);
  await assert.rejects(choose(gh, { checkOnly: true, sha: sha(9) }), /is not on the branch's first-parent chain/);
});

test("with check-only and no commit given, nothing is checked and nothing is requested", async () => {
  const gh = github({ history: linear });
  assert.equal(await choose(gh, { checkOnly: true, sha: "" }), "");
  assert.deepEqual(gh.routes, []);
  await assert.rejects(choose(gh, { checkOnly: true, sha: "", ref: "refs/heads/feature" }), /This run is for refs\/heads\/feature/);
});

test("check-only must be true or false", () => {
  assert.equal(lib.checkOnlyFlag("true"), true);
  assert.equal(lib.checkOnlyFlag("false"), false);
  for (const value of ["", "yes", "True", "1"]) {
    assert.throws(() => lib.checkOnlyFlag(value), /is not a valid value for check-only/, value);
  }
});

test("a commit that is on the branch only through the second parent of a merge is refused", async () => {
  const history = [[sha(9), sha(2), sha(8)], [sha(8), sha(1)], [sha(2), sha(1)], [sha(1)]];
  const gh = github({ history, runs: { [sha(8)]: [passed], [sha(9)]: [passed] } });
  await assert.rejects(choose(gh, { sha: sha(8) }), /is not on the branch's first-parent chain\. If a merge put it on the branch, give the SHA of the merge commit\./);
  assert.equal(await choose(gh, { sha: sha(9) }), sha(9));
});

test("with no commit given, the newest commit that passed is deployed, even when the tip has no run", async () => {
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
    /^Error: No commit on the branch's first-parent chain passed the "Lint and test" job in a run of ci\.yml that a push or a workflow_dispatch event started on main\.$/,
  );
  const count = lib.PAGE_SIZE * lib.MAX_HISTORY_PAGES + 2;
  await assert.rejects(
    choose(github({ history: linearOf(count) }), { sha: "" }),
    new RegExp(`started on main\\. The action read only the newest ${lib.PAGE_SIZE * lib.MAX_HISTORY_PAGES} commits of the branch's history\\.$`),
  );
});

test("a bad SHA, workflow or branch, and a run for another ref, are refused before any request", async () => {
  const gh = github({ history: linear });
  await assert.rejects(choose(gh, { sha: "abc1234" }), /is not a full commit SHA/);
  await assert.rejects(choose(gh, { sha: sha(3).toUpperCase().replace(/^0+/, "A") }), /is not a full commit SHA/);
  await assert.rejects(choose(gh, { ref: "refs/heads/feature" }), /This run is for refs\/heads\/feature\. The action runs only for refs\/heads\/main\./);
  for (const branch of ["", "/main", "main/", "a..b", "main.lock", "main branch"]) {
    await assert.rejects(choose(gh, { branch, ref: `refs/heads/${branch}` }), /is not a branch name/, branch);
  }
  for (const workflow of ["", "ci", "../ci.yml", "dir/ci.yml", "ci.yml?x=1"]) {
    await assert.rejects(choose(gh, { workflow }), /is not a workflow file name/, workflow);
  }
  assert.deepEqual(gh.routes, []);
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
