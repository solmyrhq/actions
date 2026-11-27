"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { workflow } = require("../test-support/workflow.js");

const { text: TEXT, job, step, permissions } = workflow("zizmor.yml");
const audit = (name) => step("audit", name);

/** The script of a step's `run: |` block, with the block's indentation removed. */
function script(stepText) {
  const block = /\n {14}run: \|\n((?: {18}.*\n|\n)+)/.exec(`${stepText}\n`);
  assert.ok(block, "the step has no run block");
  return block[1].replace(/^ {18}/gm, "");
}

test("it runs only when another workflow calls it, and its top-level permissions are empty", () => {
  assert.match(TEXT, /\non:\n {4}workflow_call:\n\npermissions: \{\}\n/);
});

test("the audit job's token has only contents: read, and the workflow uses no secret", () => {
  assert.deepEqual(permissions("audit"), { contents: "read" });
  assert.doesNotMatch(TEXT, /secrets\.|github\.token/);
});

test("it runs on the self-hosted runners in a private repository and on a GitHub-hosted runner in a public one", () => {
  assert.match(
    job("audit"),
    /\n {8}runs-on: \$\{\{ github\.event\.repository\.private && fromJSON\('\["self-hosted", "X64"\]'\) \|\| 'ubuntu-latest' \}\}\n/,
  );
});

test("it checks out only .github/ with actions/checkout pinned to a commit, and does not keep the token in the checkout", () => {
  const checkout = audit("Check out .github/");
  assert.match(checkout, /\n {14}uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
  assert.match(checkout, /\n {18}persist-credentials: false\n/);
  assert.match(checkout, /\n {18}sparse-checkout: \.github\n/);
});

test("it installs a pinned release of zizmor, and checks its digest before it extracts it", () => {
  const install = script(audit("Install zizmor"));
  assert.match(install, /^version=\d+\.\d+\.\d+$/m);
  assert.match(install, /^sha256=[0-9a-f]{64}$/m);
  assert.ok(install.indexOf("sha256sum --check --strict") < install.indexOf("tar "), "tar runs before the digest check");
});

test("the install stops before it extracts anything when the download does not match the pinned digest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zizmor-install-"));
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "curl"),
      '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then printf other > "$2"; fi; shift; done\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(bin, "tar"), `#!/bin/sh\ntouch "${root}/tar-ran"\n`, { mode: 0o755 });
    const output = path.join(root, "github-output");
    const result = spawnSync("bash", ["-e", "-c", script(audit("Install zizmor"))], {
      env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, GITHUB_OUTPUT: output },
      encoding: "utf8",
      timeout: 10_000,
    });

    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(root, "tar-ran")), false);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("it audits .github/ offline with the pedantic persona, and reports each finding as an annotation", () => {
  assert.match(
    audit("Audit .github/"),
    /\n {14}run: '"\$ZIZMOR" --offline --persona=pedantic --no-progress --format=github \.github'\n/,
  );
});

test("test.yml runs it on this repository", () => {
  const tests = workflow("test.yml");
  assert.ok(tests.job("zizmor").includes("\n        uses: $/.github/workflows/zizmor.yml\n"));
  assert.deepEqual(tests.permissions("zizmor"), { contents: "read" });
});
