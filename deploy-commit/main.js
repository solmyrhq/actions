"use strict";

const { input, setOutput, annotate, info, run } = require("../toolkit/action.js");
const { runnerClient } = require("../toolkit/github.js");
const lib = require("./lib.js");

run(async () => {
  const branch = input("branch");
  const checkName = input("check-name");
  const requested = input("sha", { required: false });

  const sha = await lib.chooseDeployCommit({
    github: runnerClient(input("token")),
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
    branch,
    sha: requested,
    checkName,
  });
  if (requested === "") {
    info(`The commit to deploy is ${sha}, the newest commit on the first-parent chain of ${branch} that passed the "${checkName}" check.`);
  } else if (sha === requested) {
    info(`The commit to deploy is ${sha}. It passed the "${checkName}" check.`);
  } else {
    annotate(
      "notice",
      `The commit to deploy is ${sha}, in place of ${requested}. ${sha} is the newest commit on the first-parent chain of ${branch} that passed the "${checkName}" check.`,
    );
  }
  setOutput("sha", sha);
});
