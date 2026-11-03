"use strict";

// The Claude review has no harness action. This directory holds only the tests
// of .github/workflows/claude-review.yml.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { workflow } = require("../test-support/workflow.js");

const { text: TEXT, job, step, permissions, condition } = workflow("claude-review.yml");
const review = (name) => step("review", name);
const reviewJob = () => job("review");

test("the workflow grants no permission at the top level", () => {
  assert.match(TEXT, /\npermissions: \{\}\n/);
});

test("the job reads, and writes only through the Claude GitHub App's token", () => {
  assert.deepEqual(permissions("review"), { contents: "read", "id-token": "write", actions: "read" });
});

test("the review runs only when CODE_REVIEWS lists claude, on a pull request from this repository that is not a draft", () => {
  const ifText = condition("review");
  assert.ok(ifText.includes("contains(format(',{0},', vars.CODE_REVIEWS), ',claude,')"));
  assert.match(ifText, /github\.event_name == 'pull_request_target'/);
  assert.match(ifText, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(ifText, /!github\.event\.pull_request\.draft/);
});

test("the skill reaches Claude through a temporary configuration directory, not the checkout", () => {
  assert.ok(review("Set up Claude's configuration").includes('cp -R "$SKILLS/exhaustive-review" "$config/skills/exhaustive-review"'));
  assert.match(review("Review the pull request"), /CLAUDE_CONFIG_DIR: \$\{\{ steps\.config\.outputs\.path \}\}/);
  const cleanup = review("Remove Claude's configuration");
  assert.match(cleanup, /\n {14}if: always\(\)\n/);
});

test("Claude uses the default API server and no key command, whatever the project's settings say", () => {
  const setup = review("Set up Claude's configuration");
  assert.ok(setup.includes(`jq -n '{apiKeyHelper: "", env: {ANTHROPIC_BASE_URL: "https://api.anthropic.com"}}' > "$RUNNER_TEMP/claude-review/settings.json"`));
  assert.ok(setup.includes('echo "settings=$RUNNER_TEMP/claude-review/settings.json" >> "$GITHUB_OUTPUT"'));
  assert.match(review("Review the pull request"), /\n {22}--settings \$\{\{ steps\.config\.outputs\.settings \}\}\n/);
  assert.doesNotMatch(review("Review the pull request"), /\n {18}settings:/);
});

test("the job starts and ends with an empty inline-comment buffer, even after a failure", () => {
  const steps = [...reviewJob().matchAll(/\n {12}- name: (.+)\n/g)].map((match) => match[1]);
  assert.equal(steps[0], "Clear claude-code-action's inline-comment buffer");
  assert.equal(steps.at(-1), "Clear claude-code-action's inline-comment buffer again");
  for (const name of [steps[0], steps.at(-1)]) {
    assert.match(review(name), /\n {14}run: rm -f \/tmp\/inline-comments-buffer\.jsonl\n/);
  }
  assert.doesNotMatch(review(steps[0]), /\n {14}if:/);
  assert.match(review(steps.at(-1)), /\n {14}if: always\(\)\n/);
});

test("the checkout keeps no credentials, and the app token is removed from it even after a failure", () => {
  assert.match(review("Check out the pull request"), /persist-credentials: false/);
  assert.match(review("Remove the app token from the checkout"), /if: always\(\)/);
});

test("the model and effort are taken from the caller's input, then from the CLAUDE_REVIEW_* variables, and default to claude-opus-5-5 and high", () => {
  const choose = review("Choose the model");
  assert.ok(choose.includes("MODEL: ${{ inputs.model || vars.CLAUDE_REVIEW_MODEL || 'claude-opus-5-5' }}"));
  assert.ok(choose.includes("EFFORT: ${{ inputs.effort || vars.CLAUDE_REVIEW_EFFORT || 'high' }}"));
  assert.ok(choose.includes(`pattern='^[][A-Za-z0-9._/:-]+$'`), "claude-code-action would split a value with a space into more options in claude_args");
  const run = review("Review the pull request");
  assert.match(run, /\n {22}--model \$\{\{ steps\.model\.outputs\.model \}\}\n/);
  assert.match(run, /\n {22}--effort \$\{\{ steps\.model\.outputs\.effort \}\}\n/);
  assert.doesNotMatch(TEXT, /inputs\.(model|effort) \}\}/, "a step uses inputs.model or inputs.effort without the variables as a fallback");
});

test("Claude may run only read commands and the comment tools", () => {
  const run = review("Review the pull request");
  assert.doesNotMatch(run, /"Bash\((?!gh pr view|gh pr diff|gh pr comment|gh api )/);
  assert.doesNotMatch(run, /"(Edit|Write|NotebookEdit|WebFetch|WebSearch)"/);
});

test("no expression interpolates text that the pull request's author controls", () => {
  for (const field of ["title", "body", "head.ref", "head.label"]) {
    assert.ok(!TEXT.includes(`github.event.pull_request.${field}`), `the workflow reads pull_request.${field}`);
  }
});

test("every action is pinned to a full commit SHA", () => {
  const refs = [...TEXT.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is not pinned to a commit`);
});
