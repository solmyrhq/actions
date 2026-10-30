"use strict";

const assert = require("node:assert/strict");
const net = require("node:net");
const { test } = require("node:test");
const lib = require("./lib.js");

test("runner architectures are mapped to Tailscale's names, and unknown ones are refused", () => {
  assert.equal(lib.tailscaleArch("X64"), "amd64");
  assert.equal(lib.tailscaleArch("ARM64"), "arm64");
  assert.throws(() => lib.tailscaleArch("X86"));
});

test("node names are DNS labels of at most 63 characters that end in the run ID, attempt and random part", () => {
  assert.equal(lib.nodeHostname("solmyrhq/sheet.stream", "123", "2", "a1b2c3"), "gha-sheet-stream-123-2-a1b2c3");
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

test("only a listening socket on 127.0.0.1 and the given port is found in /proc/net/tcp", () => {
  const table = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:A0D5 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1 0000000000000000 100 0 0 10 0",
    "   1: 00000000:A0D5 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 222 1 0000000000000000 100 0 0 10 0",
    "   2: 0100007F:A0D5 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 333 1 0000000000000000 20 4 30 10 -1",
    "   3: 0100007F:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 444 1 0000000000000000 100 0 0 10 0",
    "",
  ].join("\n");
  assert.deepEqual(lib.loopbackListenerInodes(table, 0xa0d5), ["111"]);
  assert.deepEqual(lib.loopbackListenerInodes(table, 80), ["444"]);
  assert.deepEqual(lib.loopbackListenerInodes(table, 81), []);
});

test("a process is found to listen on a loopback port only while it holds the listening socket", { skip: process.platform !== "linux" }, async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  assert.equal(lib.listensOnLoopback(process.pid, port), true);
  assert.equal(lib.listensOnLoopback(process.ppid, port), false, "another process was taken for the listener");
  await new Promise((resolve) => server.close(resolve));
  assert.equal(lib.listensOnLoopback(process.pid, port), false);
});

test("the HTTP proxy listens only on loopback, on a valid port", () => {
  assert.equal(lib.httpProxyListen(8080), "127.0.0.1:8080");
  assert.throws(() => lib.httpProxyListen(0));
  assert.throws(() => lib.httpProxyListen(70000));
});
