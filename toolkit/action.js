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

function annotate(level, message) {
  console.log(`::${level}::${message.replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
}

function run(main) {
  main().catch((error) => {
    annotate("error", error.message);
    process.exitCode = 1;
  });
}

module.exports = { input, saveState, setOutput, annotate, run };
