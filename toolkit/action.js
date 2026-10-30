"use strict";

// The parts of @actions/core that the JavaScript actions here use. The actions
// have no dependencies to install, so they cannot use the package itself.

const fs = require("node:fs");

function input(name, { required = true } = {}) {
  const value = (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
  if (value === "" && required) {
    throw new Error(`Input '${name}' is required.`);
  }
  return value;
}

function appendCommandFile(variable, name, value) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Cannot write '${name}' to ${variable}: the value contains a line break.`);
  }
  fs.appendFileSync(process.env[variable], `${name}=${value}\n`);
}

const saveState = (name, value) => appendCommandFile("GITHUB_STATE", name, value);
const setOutput = (name, value) => appendCommandFile("GITHUB_OUTPUT", name, value);

function hyphenatedName(label, value, example) {
  if (!/^[a-z]+(?:-[a-z]+)*$/.test(value)) {
    throw new Error(`${label} must be lowercase words joined by hyphens, such as '${example}': ${JSON.stringify(value)}`);
  }
  return value;
}

// Returns the ID and the attempt number of the current workflow run, as
// strings of digits.
function currentRun(env = process.env) {
  const id = env.GITHUB_RUN_ID ?? "";
  const attempt = env.GITHUB_RUN_ATTEMPT ?? "";
  if (!/^\d+$/.test(id) || !/^\d+$/.test(attempt)) {
    throw new Error("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must be numbers.");
  }
  return { id, attempt };
}

// Text that a model or a pull request chose must not start a log line: the
// runner reads a line that starts with `::` as a workflow command.
function escapeData(text) {
  return String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function annotate(level, message) {
  console.log(`::${level}::${escapeData(message)}`);
}

// Logs `message` as one line, with its line breaks escaped.
function info(message) {
  console.log(escapeData(message));
}

function run(main) {
  main().catch((error) => {
    annotate("error", error.message);
    process.exitCode = 1;
  });
}

module.exports = { input, saveState, setOutput, hyphenatedName, currentRun, escapeData, annotate, info, run };
