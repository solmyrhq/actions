"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { workflow } = require("../test-support/workflow.js");

const { text: TEXT, job, step, permissions, condition } = workflow("opencode-review.yml");
const review = (name) => step("review", name);

test("the workflow grants no permission at the top level", () => {
  assert.match(TEXT, /\npermissions: \{\}\n/);
});

test("the job that runs the model cannot write", () => {
  assert.deepEqual(permissions("review"), { contents: "read", "pull-requests": "read" });
});

test("only the job that runs no model can write", () => {
  assert.deepEqual(permissions("publish"), { contents: "write", "pull-requests": "write" });
  assert.doesNotMatch(workflow("opencode-review.yml").job("publish"), /opencode" run|OPENROUTER_API_KEY/);
});

test("the review runs only when CODE_REVIEWS lists opencode", () => {
  assert.ok(condition("review").includes("contains(format(',{0},', vars.CODE_REVIEWS), ',opencode,')"));
});

test("the OpenRouter key reaches only the step that writes it to a file", () => {
  const uses = TEXT.match(/secrets\.OPENROUTER_API_KEY/g) ?? [];
  assert.equal(uses.length, 1);
  assert.match(review("Write the OpenRouter key"), /secrets\.OPENROUTER_API_KEY/);
});

test("the step that runs the model has no OpenRouter key in its environment", () => {
  const run = review("Review the pull request");
  assert.match(run, /opencode" run/);
  assert.doesNotMatch(run, /OPENROUTER_API_KEY/);
  assert.ok(run.includes('"{file:$key_file}"'), "OpenCode does not read the key from the file");
});

test("the key sits where OpenCode V2 reads a provider's API key", () => {
  // The V1 `provider.<id>.options` shape is deprecated in OpenCode's config schema.
  const run = review("Review the pull request");
  assert.match(run, /providers: \{openrouter: \{settings: \{apiKey: \$key\}\}\}/);
  assert.doesNotMatch(run, /\bprovider: \{/);
});

test("the key is written outside the checkout", () => {
  assert.ok(
    review("Write the OpenRouter key").includes('> "$RUNNER_TEMP/opencode-secrets/openrouter-key"'),
    "the key file is not under $RUNNER_TEMP/opencode-secrets",
  );
  assert.ok(review("Review the pull request").includes('key_file="$RUNNER_TEMP/opencode-secrets/openrouter-key"'));
});

test("OpenCode skips the pull request's .claude, .agents and CLAUDE.md", () => {
  const run = review("Review the pull request");
  assert.match(run, /OPENCODE_DISABLE_EXTERNAL_SKILLS: "1"/);
  assert.match(run, /OPENCODE_DISABLE_CLAUDE_CODE: "1"/);
});

test("the key file is removed with the rest of OpenCode's state, even after a failure", () => {
  const cleanup = review("Remove OpenCode and its state");
  assert.match(cleanup, /\n {14}if: always\(\)\n/);
  assert.match(cleanup, /"\$RUNNER_TEMP\/opencode-secrets"/);
});

test("a pull request from a fork or a draft is not reviewed", () => {
  assert.match(condition("review"), /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(condition("review"), /!github\.event\.pull_request\.draft/);
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

test("the skills come from the skills action, with the tool mappings that SKILL.md links to", () => {
  assert.match(review("Get the review skills"), /uses: solmyrhq\/actions\/skills@/);
  const install = review("Install the harness");
  assert.ok(install.includes('cp -R "$SKILLS/exhaustive-review" .opencode/skills/exhaustive-review'));
  assert.ok(install.includes('cp "$SKILLS/opencode-tools.md" .opencode/skills/opencode-tools.md'));
});

test("the guide is read from the base commit, not from the pull request", () => {
  assert.match(TEXT, /contents\/\$GUIDE\?ref=\$BASE_SHA/);
});

test("the publish job downloads the artifact by the name the review job uploaded, so a re-run of only the publish job finds it", () => {
  assert.match(job("review"), /\n {12}artifact: \$\{\{ steps\.prepare\.outputs\.artifact \}\}\n/);
  assert.match(review("Upload the review"), /name: \$\{\{ steps\.prepare\.outputs\.artifact \}\}\n/);
  assert.match(step("publish", "Download the review"), /name: \$\{\{ needs\.review\.outputs\.artifact \}\}\n/);
  assert.doesNotMatch(job("publish"), /run_attempt/);
});

test("the review is checked and posted by the shared actions under the OpenCode marker", () => {
  const check = review("Check the review");
  assert.match(check, /uses: solmyrhq\/actions\/review-check@/);
  assert.match(check, /marker: opencode-code-review\n/);
  const post = step("publish", "Post the review");
  assert.match(post, /uses: solmyrhq\/actions\/review-publish@/);
  assert.match(post, /marker: opencode-code-review\n/);
});
