"use strict";

const path = require("node:path");

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
  // join() passes an OAuth client secret as `--auth-key`. Before Tailscale 1.40,
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

function daemonArgs({ dir, socket, extra = [] }) {
  return ["--tun=userspace-networking", "--state=mem:", `--statedir=${path.join(dir, "state")}`, `--socket=${socket}`, "--port=0", ...extra];
}

// Returns the address that tailscaled logs after it binds a `:0` proxy listen
// address, as "HTTP proxy listening on 127.0.0.1:<port>", or undefined if the
// log has no such line.
function httpProxyAddress(log) {
  const match = /HTTP proxy listening on (127\.0\.0\.1:([1-9]\d{0,4}))\b/.exec(log);
  return match !== null && Number(match[2]) <= 65535 ? match[1] : undefined;
}

module.exports = {
  tailscaleArch,
  nodeHostname,
  validateTags,
  validateVersion,
  validateSha256,
  daemonArgs,
  httpProxyAddress,
};
