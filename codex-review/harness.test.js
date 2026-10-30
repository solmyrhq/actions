"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const HERE = __dirname;
const CONFIG = fs.readFileSync(path.join(HERE, "config.toml"), "utf8");
const SCHEMA = JSON.parse(fs.readFileSync(path.join(HERE, "output-schema.json"), "utf8"));

// Returns the `key = value` lines of one TOML table, without comments.
function table(name) {
  const lines = CONFIG.split("\n");
  const start = name === "" ? 0 : lines.indexOf(`[${name}]`) + 1;
  assert.ok(start > 0 || name === "", `config.toml has no [${name}] table`);
  const entries = {};
  for (const line of lines.slice(start)) {
    if (line.startsWith("[")) break;
    const match = /^([a-z_]+) = (.+)$/.exec(line);
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

test("commands run in a read-only sandbox, and Codex never stops to ask", () => {
  const top = table("");
  assert.equal(top.sandbox_mode, '"read-only"');
  assert.equal(top.approval_policy, '"never"');
});

test("the pull request's AGENTS.md is not read as instructions", () => {
  assert.equal(table("").project_doc_max_bytes, "0");
});

test("nothing leaves the runner except the model's requests", () => {
  assert.equal(table("").web_search, '"disabled"');
  assert.equal(table("analytics").enabled, "false");
  assert.equal(table("feedback").enabled, "false");
  assert.equal(table("history").persistence, '"none"');
  const features = table("features");
  for (const feature of ["apps", "plugins", "remote_plugin", "hooks", "memories", "browser_use", "computer_use", "image_generation"]) {
    assert.equal(features[feature], "false", `features.${feature} is not off`);
  }
});

test("Codex starts no daemon that could outlive the job", () => {
  assert.equal(table("features").daemon_auto_start, "false");
});

test("commands that the model runs do not inherit the proxy key", () => {
  const policy = table("shell_environment_policy");
  assert.equal(policy.inherit, '"core"');
  assert.equal(policy.ignore_default_excludes, "false");
});

test("the provider is CLIProxyAPI over the Responses API, with its key from the environment", () => {
  assert.equal(table("").model_provider, '"cliproxy"');
  const provider = table("model_providers.cliproxy");
  assert.equal(provider.env_key, '"CLIPROXY_API_KEY"');
  assert.equal(provider.wire_api, '"responses"');
  assert.equal(provider.supports_websockets, "false");
  assert.equal(provider.base_url, undefined, "the workflow passes base_url, so the file must not");
});

test("every object in the output schema is closed and requires all of its properties", () => {
  const visit = (node, where) => {
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false, `${where} allows extra properties`);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${where} does not require every property`);
      for (const [key, child] of Object.entries(node.properties)) visit(child, `${where}.${key}`);
    }
    if (node.type === "array") visit(node.items, `${where}[]`);
  };
  visit(SCHEMA, "review");
});

test("the prompt names the skill and says the run is in CI in Codex", () => {
  const prompt = fs.readFileSync(path.join(HERE, "prompt.md"), "utf8");
  assert.match(prompt, /^\$exhaustive-review /);
  assert.match(prompt, /running in CI in Codex/);
  assert.match(prompt, /`references\/ci-codex\.md`/);
});

test("the action outputs its own directory from a step", () => {
  const action = fs.readFileSync(path.join(HERE, "action.yml"), "utf8");
  assert.doesNotMatch(action, /value: \$\{\{ github\.action_path \}\}/);
  assert.match(action, /value: \$\{\{ steps\.locate\.outputs\.path \}\}/);
  assert.ok(action.includes('echo "path=$GITHUB_ACTION_PATH" >> "$GITHUB_OUTPUT"'));
});
