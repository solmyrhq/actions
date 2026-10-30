"use strict";

// Checks the files that a model wrote for a review, and adds this run's
// marker to each of them. A model run exits 0 even when it wrote nothing
// usable, so this is what fails the job instead. The publish job trusts these
// files, and finds its own comments again by the marker.

const fs = require("node:fs");
const path = require("node:path");

const SIDES = ["RIGHT", "LEFT"];

function validateMarkerName(name) {
  if (!/^[a-z][a-z-]*[a-z]$/.test(name)) {
    throw new Error(`marker must be lowercase words joined by hyphens, such as 'codex-code-review': ${JSON.stringify(name)}`);
  }
  return name;
}

function validateSha(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`head-sha must be a full commit SHA: ${JSON.stringify(sha)}`);
  }
  return sha;
}

function runMarker(name, headSha, runId, runAttempt) {
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt)) {
    throw new Error("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must be numbers.");
  }
  return `<!-- ${validateMarkerName(name)}:${validateSha(headSha)}:${runId}:${runAttempt} -->`;
}

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

function commentProblem(comment, headSha) {
  if (comment === null || typeof comment !== "object" || Array.isArray(comment)) return "is not an object";
  if (!isNonEmptyString(comment.body)) return "has no body";
  if (comment.commit_id !== headSha) return "is not on the head commit";
  if (!isNonEmptyString(comment.path)) return "has no path";
  if (!isPositiveInteger(comment.line)) return "has no line";
  if (!SIDES.includes(comment.side)) return "has no side";
  const hasStart = "start_line" in comment || "start_side" in comment;
  if (hasStart) {
    if (!isPositiveInteger(comment.start_line) || comment.start_line >= comment.line) return "has a start_line that is not before its line";
    if (!SIDES.includes(comment.start_side)) return "has a start_line with no start_side";
  }
  return undefined;
}

function resolveProblem(resolve) {
  if (resolve === null || typeof resolve !== "object" || !Array.isArray(resolve.threads)) return "is not a list of threads";
  for (const thread of resolve.threads) {
    if (!isNonEmptyString(thread?.id) || !isNonEmptyString(thread?.reason)) return "lists a thread with no id or no reason";
  }
  return undefined;
}

// Writes a structured review, such as the final message of `codex exec
// --output-schema`, as the files that check() reads.
function writeStructured(directory, review, headSha) {
  if (review === null || typeof review !== "object") throw new Error("The review is not a JSON object.");
  if (!Array.isArray(review.comments)) throw new Error("The review has no list of comments.");
  if (!Array.isArray(review.resolve)) throw new Error("The review has no list of threads to resolve.");
  if (typeof review.summary !== "string") throw new Error("The review has no summary.");
  if (fs.readdirSync(directory).length > 0) throw new Error(`${directory} is not empty.`);

  review.comments.forEach((comment, index) => {
    const file = { body: comment?.body, commit_id: headSha, path: comment?.path, line: comment?.line, side: comment?.side };
    if (comment?.start_line !== null && comment?.start_line !== undefined) {
      file.start_line = comment.start_line;
      file.start_side = comment.start_side;
    }
    const name = `comment-${String(index + 1).padStart(3, "0")}.json`;
    fs.writeFileSync(path.join(directory, name), `${JSON.stringify(file, null, 4)}\n`);
  });
  fs.writeFileSync(path.join(directory, "summary.md"), review.summary);
  fs.writeFileSync(path.join(directory, "resolve.json"), `${JSON.stringify({ threads: review.resolve }, null, 4)}\n`);
}

// Checks the review files in `directory` and adds `marker` to the summary and
// to every inline comment. Returns the number of inline comments.
function check(directory, markerName, marker, headSha) {
  const markerPrefix = `<!-- ${markerName}:`;
  const summaryFile = path.join(directory, "summary.md");
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8") : "";
  if (summary.trim() === "") throw new Error("The review wrote no summary.");
  if (summary.includes(markerPrefix)) throw new Error("The summary already carries a marker.");

  const resolveFile = path.join(directory, "resolve.json");
  let resolve = { threads: [] };
  if (fs.existsSync(resolveFile) && fs.statSync(resolveFile).size > 0) {
    try {
      resolve = JSON.parse(fs.readFileSync(resolveFile, "utf8"));
    } catch {
      throw new Error("resolve.json is not JSON.");
    }
  }
  const resolveIssue = resolveProblem(resolve);
  if (resolveIssue) throw new Error(`resolve.json ${resolveIssue}.`);
  for (const thread of resolve.threads) {
    if (!summary.includes(thread.id)) throw new Error(`The summary does not list the thread ${thread.id} that it asks to resolve.`);
  }

  const commentFiles = fs.readdirSync(directory).filter((name) => /^comment-.*\.json$/.test(name)).sort();
  const comments = commentFiles.map((name) => {
    let comment;
    try {
      comment = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    } catch {
      throw new Error(`${name} is not JSON.`);
    }
    const issue = commentProblem(comment, headSha);
    if (issue) throw new Error(`${name} is not a valid inline comment: it ${issue}.`);
    if (comment.body.includes(markerPrefix)) throw new Error(`${name} already carries a marker.`);
    return [name, comment];
  });

  fs.writeFileSync(summaryFile, `${marker}\n${summary}`);
  fs.writeFileSync(resolveFile, `${JSON.stringify(resolve, null, 4)}\n`);
  for (const [name, comment] of comments) {
    fs.writeFileSync(path.join(directory, name), `${JSON.stringify({ ...comment, body: `${marker}\n${comment.body}` }, null, 4)}\n`);
  }
  return comments.length;
}

module.exports = { validateMarkerName, validateSha, runMarker, writeStructured, check };
