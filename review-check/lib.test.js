"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const lib = require("./lib.js");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const MARKER = lib.runMarker("codex-code-review", SHA, "42", "1");

function scratch(files = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-check-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return directory;
}

const read = (directory, name) => fs.readFileSync(path.join(directory, name), "utf8");
const comment = (extra = {}) => ({ body: "**issue (blocking):** x", commit_id: SHA, path: "a.ts", line: 3, side: "RIGHT", ...extra });

test("the marker names the review, the head commit, the run and the attempt", () => {
  assert.equal(MARKER, `<!-- codex-code-review:${SHA}:42:1 -->`);
  assert.throws(() => lib.runMarker("Codex review", SHA, "42", "1"));
  assert.throws(() => lib.runMarker("codex-code-review", "abc", "42", "1"));
  assert.throws(() => lib.runMarker("codex-code-review", SHA, "", "1"));
});

test("the summary and each inline comment get the marker on their first line", () => {
  const directory = scratch({ "summary.md": "Found one thing.", "comment-01.json": comment() });
  assert.equal(lib.check(directory, "codex-code-review", MARKER, SHA), 1);
  assert.equal(read(directory, "summary.md"), `${MARKER}\nFound one thing.`);
  assert.equal(JSON.parse(read(directory, "comment-01.json")).body, `${MARKER}\n**issue (blocking):** x`);
  assert.deepEqual(JSON.parse(read(directory, "resolve.json")), { threads: [] });
});

test("a review with no summary fails", () => {
  assert.throws(() => lib.check(scratch(), "codex-code-review", MARKER, SHA), /no summary/);
  assert.throws(() => lib.check(scratch({ "summary.md": "  \n" }), "codex-code-review", MARKER, SHA), /no summary/);
});

test("a marker that the model wrote itself is refused", () => {
  const forged = `<!-- codex-code-review:${SHA}:1:1 -->`;
  assert.throws(() => lib.check(scratch({ "summary.md": `x\n${forged}` }), "codex-code-review", MARKER, SHA), /already carries a marker/);
  assert.throws(
    () => lib.check(scratch({ "summary.md": "x", "comment-01.json": comment({ body: `${forged}\nx` }) }), "codex-code-review", MARKER, SHA),
    /already carries a marker/,
  );
});

test("an inline comment on another commit, or with no line or side, is refused", () => {
  for (const bad of [{ commit_id: "f".repeat(40) }, { line: 0 }, { side: "BOTH" }, { path: "" }, { body: "" }]) {
    assert.throws(
      () => lib.check(scratch({ "summary.md": "x", "comment-01.json": comment(bad) }), "codex-code-review", MARKER, SHA),
      /not a valid inline comment/,
      JSON.stringify(bad),
    );
  }
});

test("a multi-line comment needs a start line before its line and a start side", () => {
  const ok = scratch({ "summary.md": "x", "comment-01.json": comment({ start_line: 1, start_side: "RIGHT" }) });
  assert.equal(lib.check(ok, "codex-code-review", MARKER, SHA), 1);
  for (const bad of [{ start_line: 3, start_side: "RIGHT" }, { start_line: 1 }, { start_line: null, start_side: null }]) {
    assert.throws(
      () => lib.check(scratch({ "summary.md": "x", "comment-01.json": comment(bad) }), "codex-code-review", MARKER, SHA),
      /start_/,
      JSON.stringify(bad),
    );
  }
});

test("a thread to resolve must have an id and a reason, and the summary must list it", () => {
  const listed = scratch({ "summary.md": "Resolved PRRT_1.", "resolve.json": { threads: [{ id: "PRRT_1", reason: "Fixed in abc." }] } });
  lib.check(listed, "codex-code-review", MARKER, SHA);
  assert.throws(
    () => lib.check(scratch({ "summary.md": "x", "resolve.json": { threads: [{ id: "PRRT_1", reason: "Fixed." }] } }), "codex-code-review", MARKER, SHA),
    /does not list the thread PRRT_1/,
  );
  assert.throws(
    () => lib.check(scratch({ "summary.md": "PRRT_1", "resolve.json": { threads: [{ id: "PRRT_1" }] } }), "codex-code-review", MARKER, SHA),
    /no id or no reason/,
  );
  assert.throws(() => lib.check(scratch({ "summary.md": "x", "resolve.json": "{" }), "codex-code-review", MARKER, SHA), /not JSON/);
});

test("a structured review is written as numbered comment files on the head commit", () => {
  const directory = scratch();
  lib.writeStructured(directory, {
    comments: [
      { path: "a.ts", line: 3, side: "RIGHT", start_line: null, start_side: null, body: "one" },
      { path: "b.ts", line: 9, side: "LEFT", start_line: 7, start_side: "LEFT", body: "two" },
    ],
    summary: "Two findings.",
    resolve: [{ id: "PRRT_1", reason: "Fixed." }],
  }, SHA);
  assert.deepEqual(JSON.parse(read(directory, "comment-001.json")), { body: "one", commit_id: SHA, path: "a.ts", line: 3, side: "RIGHT" });
  assert.deepEqual(JSON.parse(read(directory, "comment-002.json")), {
    body: "two", commit_id: SHA, path: "b.ts", line: 9, side: "LEFT", start_line: 7, start_side: "LEFT",
  });
  assert.equal(read(directory, "summary.md"), "Two findings.");
  assert.deepEqual(JSON.parse(read(directory, "resolve.json")), { threads: [{ id: "PRRT_1", reason: "Fixed." }] });
});

test("a structured review that is missing a field, or a directory that already has files, is refused", () => {
  assert.throws(() => lib.writeStructured(scratch(), { comments: [], resolve: [] }, SHA), /no summary/);
  assert.throws(() => lib.writeStructured(scratch(), { summary: "x", resolve: [] }, SHA), /no list of comments/);
  assert.throws(() => lib.writeStructured(scratch({ "summary.md": "old" }), { comments: [], summary: "x", resolve: [] }, SHA), /not empty/);
});
