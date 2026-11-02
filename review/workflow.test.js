"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { WORKFLOWS, workflow } = require("../test-support/workflow.js");

const DISPATCHER = workflow("review.yml");
const CALLER = workflow("code-review.yml");

// Each job of review.yml, and the review workflow that it calls.
const REVIEWS = { claude: "claude-review.yml", codex: "codex-review.yml", opencode: "opencode-review.yml" };

const LEVEL = { none: 0, read: 1, write: 2 };

/** The IDs of the jobs in a workflow's text. */
function jobIds(text) {
  const jobs = text.slice(text.indexOf("\njobs:\n"));
  return [...jobs.matchAll(/\n {4}([a-z-]+):\n/g)].map((match) => match[1]);
}

/** The union of `sets`: each permission, at the highest level that one of the sets grants it. */
function widest(sets) {
  const merged = {};
  for (const set of sets) {
    for (const [scope, level] of Object.entries(set)) {
      if ((LEVEL[level] ?? -1) > (LEVEL[merged[scope]] ?? -1)) merged[scope] = level;
    }
  }
  return merged;
}

/** The union of the permissions of the jobs in the workflow `name`. */
function neededBy(name) {
  const called = workflow(name);
  return widest(jobIds(called.text).map((id) => called.permissions(id)));
}

/** The sorted names of the secrets under `workflow_call` in the workflow `name`. */
function declaredSecrets(name) {
  const text = workflow(name).text;
  const block = /\n {8}secrets:\n((?: {12,}.+\n)+)/.exec(text.slice(0, text.indexOf("\npermissions:")));
  assert.ok(block, `${name} declares no secrets`);
  return [...block[1].matchAll(/^ {12}([A-Z_]+):$/gm)].map((match) => match[1]).sort();
}

/** The `<key>: <value>` lines of a job's `with` or `secrets` block, as an object, or `{}` if the job has no such block. */
function jobBlock(job, name) {
  const block = new RegExp(`\\n {8}${name}:\\n((?: {12}.+\\n)+)`).exec(job);
  if (!block) return {};
  return Object.fromEntries(
    block[1].trim().split("\n").map((line) => {
      const [key, ...rest] = line.trim().split(": ");
      return [key, rest.join(": ")];
    }),
  );
}

test("review.yml grants no permission at the top level", () => {
  assert.match(DISPATCHER.text, /\npermissions: \{\}\n/);
});

test("review.yml calls each review workflow once, with a path that starts with $/", () => {
  assert.deepEqual(jobIds(DISPATCHER.text).sort(), Object.keys(REVIEWS).sort());
  for (const [id, name] of Object.entries(REVIEWS)) {
    assert.ok(DISPATCHER.job(id).includes(`\n        uses: $/.github/workflows/${name}\n`), `${id} does not call $/ ${name}`);
  }
});

test("every other reusable workflow in this repository is a review workflow that review.yml calls", () => {
  const reusable = fs
    .readdirSync(WORKFLOWS)
    .filter((file) => file !== "review.yml")
    .filter((file) => /\non:\n {4}workflow_call:\n/.test(fs.readFileSync(path.join(WORKFLOWS, file), "utf8")));
  assert.deepEqual(reusable.sort(), Object.values(REVIEWS).sort());
});

test("each job of review.yml grants its review exactly the union of the permissions of the review's jobs", () => {
  for (const [id, name] of Object.entries(REVIEWS)) {
    assert.deepEqual(DISPATCHER.permissions(id), neededBy(name), `${id} grants other permissions than ${name} needs`);
  }
});

test("each job of review.yml passes its review exactly the secrets that the review declares, each from the secret of the same name", () => {
  for (const [id, name] of Object.entries(REVIEWS)) {
    const passed = jobBlock(DISPATCHER.job(id), "secrets");
    assert.deepEqual(Object.keys(passed).sort(), declaredSecrets(name), `${id} passes other secrets than ${name} declares`);
    for (const [secret, value] of Object.entries(passed)) {
      assert.equal(value, `\${{ secrets.${secret} }}`, `${id} passes ${secret} under another name`);
    }
  }
});

test("review.yml accepts every review's secrets as optional, for a caller that leaves out the secrets of a review it never runs", () => {
  const all = Object.values(REVIEWS).flatMap(declaredSecrets).sort();
  assert.deepEqual(declaredSecrets("review.yml"), all);
  const block = DISPATCHER.text.slice(0, DISPATCHER.text.indexOf("\npermissions:"));
  assert.doesNotMatch(block, /required: true/);
});

test("review.yml passes pr and guide to the Codex and OpenCode reviews, and no input to the Claude review", () => {
  for (const id of ["codex", "opencode"]) {
    assert.deepEqual(jobBlock(DISPATCHER.job(id), "with"), { pr: "${{ inputs.pr }}", guide: "${{ inputs.guide }}" });
  }
  assert.deepEqual(jobBlock(DISPATCHER.job("claude"), "with"), {});
});

test("code-review.yml calls review.yml by a local path on pull_request_target and workflow_dispatch, with no top-level permissions", () => {
  assert.match(CALLER.text, /\n {4}pull_request_target:\n/);
  assert.match(CALLER.text, /\n {4}workflow_dispatch:\n/);
  assert.match(CALLER.text, /\npermissions: \{\}\n/);
  assert.ok(CALLER.job("review").includes("\n        uses: ./.github/workflows/review.yml\n"));
});

test("code-review.yml grants the union of the permissions of review.yml's jobs, and passes its secrets with secrets: inherit", () => {
  const needed = widest(Object.keys(REVIEWS).map((id) => DISPATCHER.permissions(id)));
  assert.deepEqual(CALLER.permissions("review"), needed);
  assert.match(CALLER.job("review"), /\n {8}secrets: inherit\n/);
});

test("review.yml runs the Claude and OpenCode reviews only in private repositories, and the Codex review in every repository", () => {
  for (const id of ["claude", "opencode"]) {
    assert.match(DISPATCHER.job(id), /\n {8}if: github\.event\.repository\.private\n/, `${id} also runs in a public repository`);
  }
  assert.doesNotMatch(DISPATCHER.job("codex"), /\n {8}if: /);
});

test("no workflow in this repository other than review.yml calls a review workflow", () => {
  for (const file of fs.readdirSync(WORKFLOWS)) {
    if (file === "review.yml") continue;
    const text = fs.readFileSync(path.join(WORKFLOWS, file), "utf8");
    assert.doesNotMatch(text, /uses: \S*\/[a-z]+-review\.yml/, `${file} calls a review workflow without the dispatcher`);
  }
});
