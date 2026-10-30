"use strict";

// Reads a workflow's jobs and steps as text, for assertions that match one job
// or one step. The tests run on plain Node with no packages, and have no YAML
// parser. These helpers find jobs and steps by the workflows' four-space
// indentation.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOWS = path.join(__dirname, "../.github/workflows");

function workflow(name) {
  const text = fs.readFileSync(path.join(WORKFLOWS, name), "utf8");

  // Returns the text from a job's key to the next job's key.
  function job(id) {
    const start = text.indexOf(`\n    ${id}:\n`);
    assert.notEqual(start, -1, `no ${id} job`);
    const rest = text.slice(start + 1);
    const next = rest.slice(1).search(/\n {4}[a-z-]+:\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  }

  // Returns the text of one step of a job, from its `- name:` line up to the next step's.
  function step(jobId, name) {
    const jobText = job(jobId);
    const start = jobText.indexOf(`- name: ${name}\n`);
    assert.notEqual(start, -1, `no step named ${name} in ${jobId}`);
    const next = jobText.indexOf("\n            - name: ", start + 1);
    return next === -1 ? jobText.slice(start) : jobText.slice(start, next);
  }

  function permissions(jobId) {
    const block = /\n {8}permissions:\n((?: {12}.+\n)+)/.exec(job(jobId));
    assert.ok(block, `${jobId} sets no permissions`);
    return Object.fromEntries(
      block[1].trim().split("\n").map((line) => {
        const [key, value] = line.replace(/#.*/, "").trim().split(/:\s*/);
        return [key, value];
      }),
    );
  }

  function condition(jobId) {
    const block = /\n {8}if: >-\n((?: {12}.+\n)+)/.exec(job(jobId));
    assert.ok(block, `${jobId} has no folded if condition`);
    return block[1];
  }

  return { text, job, step, permissions, condition };
}

module.exports = { WORKFLOWS, workflow };
