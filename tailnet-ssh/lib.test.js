"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const lib = require("./lib.js");

const BODY = "TLAoGUNQrBDKv2M/vm7JkSS7OmaouCzhO3N0gO0Z4Pg";

test("a fingerprint with the SHA256: prefix is returned unchanged", () => {
  assert.equal(lib.normaliseFingerprint(`SHA256:${BODY}`), `SHA256:${BODY}`);
});

test("the prefix is added to a bare body, and whitespace and padding are removed", () => {
  assert.equal(lib.normaliseFingerprint(` ${BODY}=\n`), `SHA256:${BODY}`);
});

test("the fingerprint is read out of ssh-keygen -l output", () => {
  assert.equal(lib.normaliseFingerprint(`256 SHA256:${BODY} host (ED25519)\n`), `SHA256:${BODY}`);
});

test("two different fingerprints are refused", () => {
  assert.throws(() => lib.normaliseFingerprint(`SHA256:${BODY}\nSHA256:${BODY.replace("T", "U")}`), /2 fingerprints/);
});

test("the same fingerprint listed twice is accepted", () => {
  assert.equal(lib.normaliseFingerprint(`SHA256:${BODY} SHA256:${BODY}`), `SHA256:${BODY}`);
});

test("a truncated fingerprint is refused", () => {
  assert.throws(() => lib.normaliseFingerprint(`SHA256:${BODY.slice(0, 40)}`), /not a SHA256 fingerprint/);
});

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
  assert.throws(() => lib.validateHost("-oProxyCommand=evil"));
  assert.throws(() => lib.validateSha256("abc"));
  assert.throws(() => lib.validateTags("ci-platform-deploy"));
  assert.throws(() => lib.validateHost("host\nProxyCommand evil"));
});

test("the known-hosts script exits without output unless the fingerprint is the pin", () => {
  const script = lib.knownHostsScript(`SHA256:${BODY}`);
  assert.match(script, new RegExp(`\\[ "\\$1" = "SHA256:${BODY.replace(/[+/]/g, "\\$&")}" \\] \\|\\| exit 0`));
});

test("the SSH config has a tailscale nc ProxyCommand and strict host key checking", () => {
  const config = lib.sshConfig({ host: "linux-hetzner-4", tailscale: "/t/tailscale", socket: "/t/sock", knownHostsCommand: "/t/kh" });
  assert.match(config, /^Host linux-hetzner-4$/m);
  assert.match(config, /ProxyCommand "\/t\/tailscale" --socket="\/t\/sock" nc %h %p/);
  assert.match(config, /StrictHostKeyChecking yes/);
  assert.match(config, /UserKnownHostsFile \/dev\/null/);
});

test("a path with a character the shell or ssh would interpret is refused", () => {
  for (const tailscale of ['/t/"x', "/t/$x", "/t/`x`", "/t/%h", "/t/a b"]) {
    assert.throws(() => lib.sshConfig({ host: "h", tailscale, socket: "/t/s", knownHostsCommand: "/t/k" }), undefined, tailscale);
  }
});
