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

// Maps RUNNER_ARCH to the architecture in Tailscale's tarball names.
function tailscaleArch(runnerArch) {
  const arch = { X64: "amd64", ARM64: "arm64" }[runnerArch];
  if (arch === undefined) {
    throw new Error(`No Tailscale build is mapped for runner architecture '${runnerArch}'.`);
  }
  return arch;
}

// Returns a node name that fits one DNS label. Jobs in one run share the run ID
// and attempt, so the random part keeps their names apart.
function nodeHostname(repository, runId, runAttempt, random) {
  const repo = (repository.split("/").pop() ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const suffix = `-${runId}-${runAttempt}-${random}`;
  const head = `gha-${repo}`.slice(0, 63 - suffix.length).replace(/-+$/, "");
  return `${head}${suffix}`;
}

function validateTags(tags) {
  if (!/^tag:[a-z0-9-]+(,tag:[a-z0-9-]+)*$/.test(tags)) {
    throw new Error("tags must be a comma-separated list of 'tag:<name>' entries, such as 'tag:ci-platform-deploy'.");
  }
  return tags;
}

function validateVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.exec(version);
  if (match === null) {
    throw new Error("version must be an exact Tailscale release such as '1.98.9'.");
  }
  const [major, minor] = [Number(match[1]), Number(match[2])];
  // main.js passes an OAuth client secret as `--auth-key`. Before Tailscale 1.40,
  // `tailscale up` named that flag `--authkey` and could not resolve a client secret.
  if (major < 1 || (major === 1 && minor < 40)) {
    throw new Error(`version ${version} is older than Tailscale 1.40. Use Tailscale 1.40 or later.`);
  }
  if (minor % 2 !== 0) {
    throw new Error(`version ${version} is an unstable Tailscale build. Use a stable release, which has an even minor version.`);
  }
  return version;
}

function validateSha256(sha256) {
  const value = sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("sha256 must be the 64-character hex checksum of the Tailscale tarball.");
  }
  return value;
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
    // The pins in gingerbread's github-deploy-targets.tf are ed25519 keys.
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
  tailscaleArch,
  nodeHostname,
  validateTags,
  validateVersion,
  validateSha256,
  validateHost,
  knownHostsScript,
  sshConfig,
};
