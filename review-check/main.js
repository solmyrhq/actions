"use strict";

const fs = require("node:fs");
const { input, setOutput, currentRun, run } = require("../toolkit/action.js");
const lib = require("./lib.js");

run(async () => {
  const directory = input("directory");
  const markerName = lib.validateMarkerName(input("marker"));
  const headSha = lib.validateSha(input("head-sha"));
  const structured = input("structured-review", { required: false });

  if (structured !== "") {
    let review;
    try {
      review = JSON.parse(fs.readFileSync(structured, "utf8"));
    } catch (error) {
      throw new Error(`Could not read the review in ${structured}: ${error.message}`);
    }
    lib.writeStructured(directory, review, headSha);
  }

  const marker = lib.runMarker(markerName, headSha, currentRun());
  const comments = lib.check(directory, markerName, marker, headSha);
  setOutput("marker", marker);
  console.log(`The review has a summary and ${comments} inline comment(s), all marked ${marker}.`);
});
