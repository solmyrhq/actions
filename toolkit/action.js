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

module.exports = { input, saveState, setOutput, escapeData, annotate, info, run };
