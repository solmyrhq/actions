"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const lib = require("./lib.js");

test("runner architectures are mapped to Tailscale's names, and unknown ones are refused", () => {
  assert.equal(lib.tailscaleArch("X64"), "amd64");
  assert.equal(lib.tailscaleArch("ARM64"), "arm64");
  assert.throws(() => lib.tailscaleArch("X86"));
});

test("node names are DNS labels of at most 63 characters that end in the run ID, attempt and random part", () => {
  assert.equal(lib.nodeHostname("solmyrhq/example.app", "123", "2", "a1b2c3"), "gha-example-app-123-2-a1b2c3");
  const long = lib.nodeHostname(`solmyrhq/${"a".repeat(100)}`, "123456789012", "1", "a1b2c3");
  assert.ok(long.length <= 63);
  assert.ok(long.endsWith("-123456789012-1-a1b2c3"));
});

test("malformed inputs and unpinned or unstable versions are refused", () => {
  assert.throws(() => lib.validateVersion("latest"));
  assert.throws(() => lib.validateVersion("1.99.0"), /unstable/);
  assert.throws(() => lib.validateVersion("1.098.9"));
  assert.throws(() => lib.validateVersion("1.38.0"), /older than Tailscale 1.40/);
  assert.equal(lib.validateVersion("1.40.0"), "1.40.0");
  assert.equal(lib.validateVersion("1.98.9"), "1.98.9");
  assert.throws(() => lib.validateSha256("abc"));
  assert.throws(() => lib.validateTags("ci-platform-deploy"));
});

test("tailscaled runs in userspace with its state in memory, and takes extra arguments last", () => {
  assert.deepEqual(lib.daemonArgs({ dir: "/t", socket: "/t/sock", extra: ["--x"] }), [
    "--tun=userspace-networking",
    "--state=mem:",
    "--statedir=/t/state",
    "--socket=/t/sock",
    "--port=0",
    "--x",
  ]);
});

test("the proxy's address is read from the line that tailscaled logs when it binds port 0", () => {
  const log = [
    "2026/10/30 02:02:08 logtail started",
    "2026/10/30 02:02:08 HTTP proxy listening on 127.0.0.1:41234",
    "2026/10/30 02:02:09 wgengine.NewUserspaceEngine(tun \"userspace-networking\") ...",
  ].join("\n");
  assert.equal(lib.httpProxyAddress(log), "127.0.0.1:41234");
});

test("no address is read from a log without the line, or with an address off loopback or out of range", () => {
  assert.equal(lib.httpProxyAddress("2026/10/30 logtail started"), undefined);
  assert.equal(lib.httpProxyAddress("HTTP proxy listening on 0.0.0.0:41234"), undefined);
  assert.equal(lib.httpProxyAddress("HTTP proxy listening on 127.0.0.1:70000"), undefined);
  assert.equal(lib.httpProxyAddress("HTTP proxy listening on 127.0.0.1:0"), undefined);
});
