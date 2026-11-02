"use strict";

const FINGERPRINT_TOKEN = /SHA256:[A-Za-z0-9+/]+=*/g;
const BASE64_BODY = /^[A-Za-z0-9+/]+=*$/;

const SHA256_BODY_LENGTH = 43;

// Returns the pin in the form ssh passes as %f: "SHA256:" and the unpadded
// base64 body. Accepts one "SHA256:<base64>" token, also inside `ssh-keygen -l`
// output, or the bare body.
function normaliseFingerprint(value) {
  const tokens = [...new Set(value.match(FINGERPRINT_TOKEN) ?? [])];
  if (tokens.length > 1) {
    throw new Error(`host-fingerprint contains ${tokens.length} fingerprints. Store exactly one.`);
  }
  const body = (tokens.length === 1 ? tokens[0].slice("SHA256:".length) : value.replace(/\s+/g, "")).replace(/=+$/, "");
  if (!BASE64_BODY.test(body) || body.length !== SHA256_BODY_LENGTH) {
    throw new Error("host-fingerprint is not a SHA256 fingerprint. Expected 'SHA256:<base64>' or the base64 body alone.");
  }
  return `SHA256:${body}`;
}

function validateHost(host) {
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(host)) {
    throw new Error("host must be a tailnet hostname or address.");
  }
  return host;
}

function assertConfigSafe(value) {
  if (!/^[A-Za-z0-9/._-]+$/.test(value)) {
    throw new Error(`Path is not safe to write into an SSH config: ${JSON.stringify(value)}`);
  }
  return value;
}

// Returns the KnownHostsCommand script, run as `<script> %f %H %t %K`. It
// prints a known_hosts line only for the key whose fingerprint is the pin.
function knownHostsScript(pin) {
  return [
    "#!/bin/sh",
    `[ "$1" = "${pin}" ] || exit 0`,
    `printf '%s %s %s\\n' "$2" "$3" "$4"`,
    "",
  ].join("\n");
}

function sshConfig({ host, tailscale, socket, knownHostsCommand }) {
  for (const value of [tailscale, socket, knownHostsCommand]) {
    assertConfigSafe(value);
  }
  validateHost(host);
  return [
    `Host ${host}`,
    `    ProxyCommand "${tailscale}" --socket="${socket}" nc %h %p`,
    `    KnownHostsCommand "${knownHostsCommand}" %f %H %t %K`,
    "    HostKeyAlgorithms ssh-ed25519",
    "    StrictHostKeyChecking yes",
    "    UserKnownHostsFile /dev/null",
    "    GlobalKnownHostsFile /dev/null",
    "    UpdateHostKeys no",
    "",
  ].join("\n");
}

module.exports = {
  normaliseFingerprint,
  validateHost,
  knownHostsScript,
  sshConfig,
};
