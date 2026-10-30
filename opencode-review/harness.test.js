"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const HERE = __dirname;
const AGENT = fs.readFileSync(path.join(HERE, "agents/pr-review.md"), "utf8");

const SHELL_ALLOW = [
  "gh pr view *",
  "gh pr diff *",
  "gh api repos/*/pulls/*/comments --paginate --jq *",
  "gh api repos/*/pulls/*/reviews --paginate",
  "gh api repos/*/pulls/*/reviews --paginate --jq *",
  "gh api repos/*/issues/*/comments --paginate --jq *",
  "gh api repos/*/pulls/*/files --paginate --jq *",
];

function frontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, "the agent has no front matter");
  return match[1];
}

function permissions(text) {
  const rules = [];
  const pattern = /- action: (.+)\n\s+resource: (.+)\n\s+effect: (.+)/g;
  for (const [, action, resource, effect] of frontMatter(text).matchAll(pattern)) {
    rules.push({ action: JSON.parse(quoted(action)), resource: JSON.parse(quoted(resource)), effect: effect.trim() });
  }
  return rules;
}

function quoted(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') ? trimmed : JSON.stringify(trimmed);
}

test("the agent denies everything before it allows anything", () => {
  assert.deepEqual(permissions(AGENT)[0], { action: "*", resource: "*", effect: "deny" });
});

test("the agent runs only the listed gh commands", () => {
  const shell = permissions(AGENT).filter((rule) => rule.action === "shell");
  assert.deepEqual(
    shell.filter((rule) => rule.effect === "allow").map((rule) => rule.resource),
    SHELL_ALLOW,
  );
});

test("the agent writes only under review-output", () => {
  const edits = permissions(AGENT).filter((rule) => rule.action === "edit" && rule.effect === "allow");
  assert.deepEqual(edits.map((rule) => rule.resource), ["review-output/*"]);
});

test("the agent loads only the exhaustive-review skill", () => {
  const skills = permissions(AGENT).filter((rule) => rule.action === "skill" && rule.effect === "allow");
  assert.deepEqual(skills.map((rule) => rule.resource), ["exhaustive-review"]);
});

test("the agent reads the guide that the workflow installs", () => {
  assert.match(AGENT, /`\.opencode\/guide\.md`/);
});

test("the prompt tells the model to load the skill", () => {
  const prompt = fs.readFileSync(path.join(HERE, "prompt.md"), "utf8");
  assert.match(prompt, /`exhaustive-review` skill/);
});

test("the action outputs its own directory from a step", () => {
  const action = fs.readFileSync(path.join(HERE, "action.yml"), "utf8");
  assert.doesNotMatch(action, /value: \$\{\{ github\.action_path \}\}/);
  assert.match(action, /value: \$\{\{ steps\.locate\.outputs\.path \}\}/);
  assert.match(action, /- id: locate\n/);
  assert.ok(action.includes('echo "path=$GITHUB_ACTION_PATH" >> "$GITHUB_OUTPUT"'));
});
