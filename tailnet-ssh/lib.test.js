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

test("a host that ssh would read as an option or a second line is refused", () => {
  assert.throws(() => lib.validateHost("-oProxyCommand=evil"));
  assert.throws(() => lib.validateHost("host\nProxyCommand evil"));
});

test("the known-hosts script exits without output unless the fingerprint is the pin", () => {
  const script = lib.knownHostsScript(`SHA256:${BODY}`);
  assert.match(script, new RegExp(`\\[ "\\$1" = "SHA256:${BODY.replace(/[+/]/g, "\\$&")}" \\] \\|\\| exit 0`));
});

test("the SSH config has a tailscale nc ProxyCommand and strict host key checking", () => {
  const config = lib.sshConfig({ host: "deploy-host", tailscale: "/t/tailscale", socket: "/t/sock", knownHostsCommand: "/t/kh" });
  assert.match(config, /^Host deploy-host$/m);
  assert.match(config, /ProxyCommand "\/t\/tailscale" --socket="\/t\/sock" nc %h %p/);
  assert.match(config, /StrictHostKeyChecking yes/);
  assert.match(config, /UserKnownHostsFile \/dev\/null/);
});

test("a path with a character the shell or ssh would interpret is refused", () => {
  for (const tailscale of ['/t/"x', "/t/$x", "/t/`x`", "/t/%h", "/t/a b"]) {
    assert.throws(() => lib.sshConfig({ host: "h", tailscale, socket: "/t/s", knownHostsCommand: "/t/k" }), undefined, tailscale);
  }
});
