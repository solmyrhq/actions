"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const toolkit = require("./action.js");

test("logged text cannot start a workflow command on a new line", () => {
  assert.equal(toolkit.escapeData("ok\n::add-mask::x\r::error::y"), "ok%0A::add-mask::x%0D::error::y");
});

test("a percent sign is escaped first, so an escape in the text is not decoded", () => {
  assert.equal(toolkit.escapeData("50% %0A"), "50%25 %250A");
});
