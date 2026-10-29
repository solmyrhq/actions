"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const WORKFLOWS = path.join(__dirname, "../.github/workflows");
const TEXT = fs.readFileSync(path.join(WORKFLOWS, "opencode-review.yml"), "utf8");

// Returns the text from a job's key to the next job's key, so that an
// assertion matches only that job.
function job(name) {
  const start = TEXT.indexOf(`\n    ${name}:\n`);
  assert.notEqual(start, -1, `no ${name} job`);
  const rest = TEXT.slice(start + 1);
  const next = rest.slice(1).search(/\n {4}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function permissions(jobText) {
  const block = /\n {8}permissions:\n((?: {12}.+\n)+)/.exec(jobText);
  assert.ok(block, "the job sets no permissions");
  return Object.fromEntries(
    block[1].trim().split("\n").map((line) => {
      const [key, value] = line.replace(/#.*/, "").trim().split(/:\s*/);
      return [key, value];
    }),
  );
}

test("the workflow grants no permission at the top level", () => {
  assert.match(TEXT, /\npermissions: \{\}\n/);
});

test("the job that runs the model cannot write", () => {
  assert.deepEqual(permissions(job("review")), { contents: "read", "pull-requests": "read" });
});

test("only the job that runs no model can write", () => {
  assert.deepEqual(permissions(job("publish")), { contents: "write", "pull-requests": "write" });
  assert.doesNotMatch(job("publish"), /opencode" run|OPENROUTER_API_KEY/);
});

// Returns the text of one step of the review job, from its `- name:` line up to the next step's.
function step(name) {
  const text = job("review");
  const start = text.indexOf(`- name: ${name}\n`);
  assert.notEqual(start, -1, `no step named ${name}`);
  const next = text.indexOf("\n            - name: ", start + 1);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

test("the OpenRouter key reaches only the step that writes it to a file", () => {
  const uses = TEXT.match(/secrets\.OPENROUTER_API_KEY/g) ?? [];
  assert.equal(uses.length, 1);
  assert.match(step("Write the OpenRouter key"), /secrets\.OPENROUTER_API_KEY/);
});

test("the step that runs the model has no OpenRouter key in its environment", () => {
  const review = step("Review the pull request");
  assert.match(review, /opencode" run/);
  assert.doesNotMatch(review, /OPENROUTER_API_KEY/);
  assert.ok(review.includes('"{file:$key_file}"'), "OpenCode does not read the key from the file");
});

test("the key file is removed with the rest of OpenCode's state", () => {
  assert.match(step("Remove OpenCode and its state"), /"\$RUNNER_TEMP\/opencode-secrets"/);
});

test("a pull request from a fork or a draft is not reviewed", () => {
  const condition = /\n {8}if: >-\n((?: {12}.+\n)+)/.exec(job("review"));
  assert.ok(condition);
  assert.match(condition[1], /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(condition[1], /!github\.event\.pull_request\.draft/);
});

test("no run script interpolates text that the pull request's author controls", () => {
  for (const field of ["title", "body", "head.ref", "head.label"]) {
    assert.ok(!TEXT.includes(`github.event.pull_request.${field}`), `the workflow reads pull_request.${field}`);
  }
});

test("every action is pinned to a full commit SHA", () => {
  const refs = [...TEXT.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is not pinned to a commit`);
});

test("the pull request's OpenCode files are replaced for the run and restored after it", () => {
  const replaced = ".opencode opencode.json opencode.jsonc AGENTS.md";
  assert.ok(TEXT.includes(`rm -rf ${replaced}`));
  assert.ok(TEXT.includes(`for path in ${replaced}; do`));
});

test("the guide is read from the base commit, not from the pull request", () => {
  assert.match(TEXT, /contents\/\$GUIDE\?ref=\$BASE_SHA/);
});

test("this repository's own caller reviews with the shared workflow", () => {
  const caller = fs.readFileSync(path.join(WORKFLOWS, "opencode-code-review.yml"), "utf8");
  assert.match(caller, /\n {4}pull_request_target:\n/);
  assert.match(caller, /uses: \.\/\.github\/workflows\/opencode-review\.yml\n/);
});
