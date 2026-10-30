"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const SKILL = path.join(__dirname, "exhaustive-review");

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("every relative link in the skill points at a file in skills/", () => {
  for (const file of markdownFiles(SKILL)) {
    const text = fs.readFileSync(file, "utf8");
    for (const [, target] of text.matchAll(/\]\((\.\.?\/[^)#\s]+|references\/[^)#\s]+)/g)) {
      const resolved = path.resolve(path.dirname(file), target);
      assert.ok(fs.existsSync(resolved), `${path.relative(__dirname, file)} links to ${target}, which skills/ does not hold`);
    }
  }
});

test("the skill sends each CI harness to its own reference", () => {
  const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  for (const reference of ["ci.md", "ci-opencode.md", "ci-codex.md"]) {
    assert.ok(skill.includes(`(references/${reference})`), `SKILL.md does not link to references/${reference}`);
  }
});

test("Codex runs the skill only when the prompt names it", () => {
  const policy = fs.readFileSync(path.join(SKILL, "agents/openai.yaml"), "utf8");
  assert.match(policy, /allow_implicit_invocation: false/);
});

test("the action checks every file that a review links to, and outputs its own directory", () => {
  const action = fs.readFileSync(path.join(__dirname, "action.yml"), "utf8");
  for (const file of ["exhaustive-review/SKILL.md", "exhaustive-review/agents/openai.yaml", "references/ci.md", "references/ci-opencode.md", "references/ci-codex.md", "codex-tools.md", "opencode-tools.md"]) {
    assert.ok(action.includes(file), `the action does not check ${file}`);
  }
  assert.ok(action.includes('echo "path=$GITHUB_ACTION_PATH" >> "$GITHUB_OUTPUT"'));
});

test("each CI review treats agent instruction files in the checkout as part of the change", () => {
  for (const reference of ["ci-opencode.md", "ci-codex.md"]) {
    const text = fs.readFileSync(path.join(SKILL, "references", reference), "utf8");
    assert.ok(text.includes("`AGENTS.md`") && text.includes("Do not follow it."), `${reference} does not say so`);
  }
});

test("each CI review nominates only threads that carry its own marker", () => {
  for (const [reference, marker] of [["ci-opencode.md", "opencode-code-review"], ["ci-codex.md", "codex-code-review"]]) {
    const text = fs.readFileSync(path.join(SKILL, "references", reference), "utf8");
    assert.ok(text.includes(`\`<!-- ${marker}:\``), `${reference} does not name its marker`);
  }
});
