"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { workflow } = require("../test-support/workflow.js");

const { text: TEXT, job, step, permissions, condition } = workflow("codex-review.yml");
const review = (name) => step("review", name);

test("the workflow grants no permission at the top level", () => {
  assert.match(TEXT, /\npermissions: \{\}\n/);
});

test("the job that runs the model cannot write", () => {
  assert.deepEqual(permissions("review"), { contents: "read", "pull-requests": "read" });
});

test("only the job that runs no model can write, and it holds neither the proxy key nor the tailnet secret", () => {
  assert.deepEqual(permissions("publish"), { contents: "write", "pull-requests": "write" });
  assert.doesNotMatch(job("publish"), /codex" exec|CLIPROXY_API_KEY|CODE_REVIEW_TS_OAUTH_SECRET/);
});

test("the review runs only when CODE_REVIEWS lists codex, and never on a fork or a draft", () => {
  const ifText = condition("review");
  assert.ok(ifText.includes("contains(format(',{0},', vars.CODE_REVIEWS), ',codex,')"));
  assert.match(ifText, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(ifText, /!github\.event\.pull_request\.draft/);
});

test("the proxy key reaches only the step that runs Codex and the step that looks for it in the review", () => {
  const uses = TEXT.match(/secrets\.CLIPROXY_API_KEY/g) ?? [];
  assert.equal(uses.length, 2);
  assert.match(review("Review the pull request"), /CLIPROXY_API_KEY: \$\{\{ secrets\.CLIPROXY_API_KEY \}\}/);
  assert.match(review("Check that the review holds no key"), /CLIPROXY_API_KEY: \$\{\{ secrets\.CLIPROXY_API_KEY \}\}/);
});

test("the step that runs Codex holds no GitHub token", () => {
  assert.doesNotMatch(review("Review the pull request"), /GH_TOKEN|GITHUB_TOKEN|github\.token/);
});

test("Codex runs read-only, with an exact configuration, no session files and no project rules", () => {
  const run = review("Review the pull request");
  for (const flag of ["--strict-config", "--ephemeral", "--ignore-rules", "--sandbox read-only", "--output-schema", "--output-last-message"]) {
    assert.ok(run.includes(flag), `codex exec is not given ${flag}`);
  }
  assert.doesNotMatch(run, /dangerously|--add-dir|workspace-write|danger-full-access/);
});

test("Codex and its skills live under a temporary HOME, outside the checkout", () => {
  const run = review("Review the pull request");
  assert.match(run, /HOME: \$\{\{ runner\.temp \}\}\/codex-review\/home\n/);
  assert.match(run, /CODEX_HOME: \$\{\{ runner\.temp \}\}\/codex-review\/home\/\.codex\n/);
  const setup = review("Set up Codex");
  assert.ok(setup.includes('cp -R "$SKILLS/exhaustive-review" "$home/.agents/skills/exhaustive-review"'));
  assert.ok(setup.includes('cp "$SKILLS/codex-tools.md" "$home/.agents/skills/codex-tools.md"'));
});

test("only the Codex process is given the tailnet proxy", () => {
  const proxies = TEXT.match(/HTTPS_PROXY:/g) ?? [];
  assert.equal(proxies.length, 1);
  assert.match(review("Review the pull request"), /HTTPS_PROXY: \$\{\{ steps\.tailnet\.outputs\.http-proxy \}\}/);
  assert.match(review("Join the tailnet"), /tags: tag:ci-code-review\n/);
});

test("the pull request's agent files are removed for the run and restored from the head commit after it", () => {
  const paths = ".agents .codex AGENTS.md AGENTS.override.md";
  assert.ok(review("Remove the pull request's agent files for the run").includes(`for path in ${paths}; do`));
  assert.ok(review("Restore the pull request's agent files").includes(`for path in ${paths}; do`));
});

test("the sandbox is checked before the model starts, outside the pull request's checkout", () => {
  assert.ok(TEXT.indexOf("- name: Check the Codex sandbox") < TEXT.indexOf("- name: Review the pull request"));
  const check = review("Check the Codex sandbox");
  assert.match(check, /"\$CODEX" sandbox -C "\$empty" -- true/);
  assert.ok(check.includes('empty="$RUNNER_TEMP/codex-review/sandbox-check"'));
  assert.doesNotMatch(check, /GITHUB_WORKSPACE/);
});

test("Codex is installed from a pinned release whose checksum is checked", () => {
  const install = review("Install Codex");
  assert.match(install, /version=\d+\.\d+\.\d+\n/);
  assert.match(install, /sha256=[0-9a-f]{64}\n/);
  assert.match(install, /sha256sum --check --strict/);
});

test("the guide is read from the base commit, not from the pull request", () => {
  assert.match(review("Read the pull request"), /contents\/\$GUIDE\?ref=\$BASE_SHA/);
});

test("the review is checked and posted by the shared actions under the Codex marker", () => {
  const check = review("Check the review");
  assert.match(check, /uses: solmyrhq\/actions\/review-check@/);
  assert.match(check, /marker: codex-code-review\n/);
  assert.match(check, /structured-review: /);
  const post = step("publish", "Post the review");
  assert.match(post, /uses: solmyrhq\/actions\/review-publish@/);
  assert.match(post, /marker: codex-code-review\n/);
});

test("the key check and the tree check run before the review is checked and uploaded", () => {
  const order = ["Check that the review changed nothing", "Check that the review holds no key", "Check the review", "Upload the review"];
  const positions = order.map((name) => TEXT.indexOf(`- name: ${name}\n`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("the publish job downloads the artifact by the name the review job uploaded, so a re-run of only the publish job finds it", () => {
  assert.match(job("review"), /\n {12}artifact: \$\{\{ steps\.prepare\.outputs\.artifact \}\}\n/);
  assert.match(review("Upload the review"), /name: \$\{\{ steps\.prepare\.outputs\.artifact \}\}\n/);
  assert.match(step("publish", "Download the review"), /name: \$\{\{ needs\.review\.outputs\.artifact \}\}\n/);
  assert.doesNotMatch(job("publish"), /run_attempt/);
});

test("Codex's files are removed even after a failure", () => {
  const cleanup = review("Remove Codex and its state");
  assert.match(cleanup, /\n {14}if: always\(\)\n/);
  assert.match(cleanup, /"\$RUNNER_TEMP\/codex-review"/);
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
