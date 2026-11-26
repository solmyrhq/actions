"use strict";

const { input, setOutput, annotate, info, run } = require("../toolkit/action.js");
const { runnerClient } = require("../toolkit/github.js");
const lib = require("./lib.js");

run(async () => {
  const branch = input("branch");
  const workflow = input("workflow");
  const jobName = input("job-name");
  const requested = input("sha", { required: false });

  const sha = await lib.chooseDeployCommit({
    github: runnerClient(input("token")),
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
    branch,
    workflow,
    sha: requested,
    jobName,
  });
  const passed = `passed ${lib.passedIn({ jobName, workflow, branch })}`;
  if (requested === "") {
    info(`The commit to deploy is ${sha}, the newest commit on the first-parent chain of ${branch} that ${passed}.`);
  } else if (sha === requested) {
    info(`The commit to deploy is ${sha}. It ${passed}.`);
  } else {
    annotate(
      "notice",
      `The commit to deploy is ${sha}, in place of ${requested}. ${sha} is the newest commit on the first-parent chain of ${branch} that ${passed}.`,
    );
  }
  setOutput("sha", sha);
});
