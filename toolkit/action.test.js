"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const toolkit = require("./action.js");

test("logged text cannot start a workflow command on a new line", () => {
  assert.equal(toolkit.escapeData("ok\n::add-mask::x\r::error::y"), "ok%0A::add-mask::x%0D::error::y");
});

test("a percent sign is escaped first, so an escape in the text is not decoded", () => {
  assert.equal(toolkit.escapeData("50% %0A"), "50%25 %250A");
});

test("a name is lowercase words joined by single hyphens, and the error names the input", () => {
  for (const good of ["codex", "codex-review", "opencode-code-review"]) {
    assert.equal(toolkit.hyphenatedName("marker", good, "codex-code-review"), good);
  }
  for (const bad of ["Codex", "codex_review", "-codex", "codex-", "codex--review", "codex review", ""]) {
    assert.throws(() => toolkit.hyphenatedName("artifact-prefix", bad, "codex-review"), /^Error: artifact-prefix must be .* such as 'codex-review'/, bad);
  }
});

test("the run's ID and attempt are returned as strings of digits, and a missing or malformed one is refused", () => {
  assert.deepEqual(toolkit.currentRun({ GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "2" }), { id: "42", attempt: "2" });
  for (const env of [{}, { GITHUB_RUN_ID: "42" }, { GITHUB_RUN_ID: "", GITHUB_RUN_ATTEMPT: "1" }, { GITHUB_RUN_ID: "4 2", GITHUB_RUN_ATTEMPT: "1" }]) {
    assert.throws(() => toolkit.currentRun(env), /must be numbers/, JSON.stringify(env));
  }
});
