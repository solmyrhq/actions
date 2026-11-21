"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { workflow } = require("../test-support/workflow.js");

const { text: TEXT, job, step, permissions, condition } = workflow("codex-review.yml");
const review = (name) => step("review", name);

test("the workflow grants no permission at the top level", () => {
  assert.match(TEXT, /\npermissions: \{\}\n/);
});

test("the job that runs the model cannot write", () => {
  assert.deepEqual(permissions("review"), { contents: "read", "pull-requests": "read" });
});

test("only the job that runs no model can write, and it holds neither the proxy key nor the tailnet secret", () => {
  assert.deepEqual(permissions("publish"), { contents: "write", "pull-requests": "write" });
  assert.doesNotMatch(job("publish"), /codex" exec|CLIPROXY_API_KEY|CODE_REVIEW_TS_OAUTH_SECRET/);
});

test("the review runs only when CODE_REVIEWS lists codex, and never on a fork or a draft", () => {
  const ifText = condition("review");
  assert.ok(ifText.includes("contains(format(',{0},', vars.CODE_REVIEWS), ',codex,')"));
  assert.match(ifText, /github\.event_name == 'workflow_dispatch'/);
  assert.match(ifText, /github\.event_name == 'pull_request_target'/);
  assert.match(ifText, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(ifText, /!github\.event\.pull_request\.draft/);
});

test("review-prepare checks the pull request, which refuses one given as anything but a number", () => {
  const prepare = review("Check the pull request");
  assert.match(prepare, /\n {14}uses: solmyrhq\/actions\/review-prepare@[0-9a-f]{40}\n/);
  assert.match(prepare, /\n {18}pr: \$\{\{ github\.event\.pull_request\.number \|\| inputs\.pr \}\}\n/);
  assert.match(prepare, /\n {18}artifact-prefix: codex-review\n/);
  assert.doesNotMatch(prepare, /\n {14}run: /);
});

test("the proxy key reaches only the step that runs Codex and the step that looks for it in the review", () => {
  const uses = TEXT.match(/secrets\.CLIPROXY_API_KEY/g) ?? [];
  assert.equal(uses.length, 2);
  assert.match(review("Review the pull request"), /CLIPROXY_API_KEY: \$\{\{ secrets\.CLIPROXY_API_KEY \}\}/);
  assert.match(review("Check that the review holds no key"), /CLIPROXY_API_KEY: \$\{\{ secrets\.CLIPROXY_API_KEY \}\}/);
});

test("the CLIProxyAPI base URL comes only from the CLIPROXY_BASE_URL secret, in the step that runs Codex", () => {
  assert.doesNotMatch(TEXT, /base-url|ts\.net/);
  const uses = TEXT.match(/secrets\.CLIPROXY_BASE_URL/g) ?? [];
  assert.equal(uses.length, 1);
  assert.match(review("Review the pull request"), /BASE_URL: \$\{\{ secrets\.CLIPROXY_BASE_URL \}\}/);
});

test("both jobs run on the self-hosted runners in a private repository and on a GitHub-hosted runner in a public one", () => {
  const runsOn = /\n {8}runs-on: \$\{\{ github\.event\.repository\.private && fromJSON\('\["self-hosted", "X64"\]'\) \|\| 'ubuntu-latest' \}\}\n/;
  assert.match(job("review"), runsOn);
  assert.match(job("publish"), runsOn);
});

test("unprivileged user namespaces are allowed only on a GitHub-hosted runner, before the sandbox check", () => {
  const userns = review("Allow unprivileged user namespaces");
  assert.match(userns, /runner\.environment == 'github-hosted'/);
  assert.match(userns, /sudo sysctl -w kernel\.apparmor_restrict_unprivileged_userns=0/);
  assert.ok(TEXT.indexOf("- name: Allow unprivileged user namespaces") < TEXT.indexOf("- name: Check the Codex sandbox"));
});

test("the model gets only the comments of bots, of the pull request's author and of people with access to the repository", () => {
  const read = review("Read the pull request");
  for (const file of ["review-comments.json", "reviews.json", "issue-comments.json"]) {
    assert.ok(read.includes(`"$context/${file}" "$trusted"`), `${file} is not filtered`);
  }
  assert.ok(!read.includes('"$context/files.json" "$trusted"'), "the changed files are filtered too");
  assert.match(read, /trusted='map\(select\(\.user\.type == "Bot" or \.user\.login == \$author or \(\.author_association \| IN\("OWNER", "MEMBER", "COLLABORATOR"\)\)\)\)'/);
  assert.match(read, /\.comments\.nodes \|= map\(select\(\.author\.__typename == "Bot" or \.author\.login == \$author or \(\.authorAssociation \| IN\("OWNER", "MEMBER", "COLLABORATOR"\)\)\)\)/);
});

test("the model and effort are taken from the caller's input, then from the CODEX_REVIEW_* variables, and default to gpt-6.1-sol and max", () => {
  const choose = review("Choose the model");
  assert.ok(choose.includes("MODEL: ${{ inputs.model || vars.CODEX_REVIEW_MODEL || 'gpt-6.1-sol' }}"));
  assert.ok(choose.includes("EFFORT: ${{ inputs.effort || vars.CODEX_REVIEW_EFFORT || 'max' }}"));
  assert.ok(choose.includes(`pattern='^[A-Za-z0-9._/:-]+$'`), "Codex would read a quote in a value as the end of its TOML string");
  const run = review("Review the pull request");
  assert.match(run, /MODEL: \$\{\{ steps\.model\.outputs\.model \}\}\n/);
  assert.match(run, /EFFORT: \$\{\{ steps\.model\.outputs\.effort \}\}\n/);
  assert.doesNotMatch(TEXT, /\n {16}default: (gpt|xhigh|max)/, "with an input default, the workflow never uses the variables");
});

test("the step that runs Codex holds no GitHub token", () => {
  assert.doesNotMatch(review("Review the pull request"), /GH_TOKEN|GITHUB_TOKEN|github\.token/);
});

test("Codex runs with an exact configuration, no session files and no project rules", () => {
  const run = review("Review the pull request");
  for (const flag of ["--strict-config", "--ephemeral", "--ignore-rules", "--output-schema", "--output-last-message"]) {
    assert.ok(run.includes(flag), `codex exec is not given ${flag}`);
  }
  assert.doesNotMatch(run, /dangerously|--add-dir|workspace-write|danger-full-access/);
});

test("Codex exec takes its sandbox from the review profile, not from --sandbox", () => {
  assert.doesNotMatch(review("Review the pull request"), /--sandbox\b/);
});

test("the review profile denies the model's commands the runner's own Bun install cache", () => {
  const setup = review("Set up Codex");
  assert.ok(setup.includes(`printf '"%s" = "deny"\\n' "$HOME/.bun/install/cache" >> "$home/.codex/config.toml"`));
  assert.doesNotMatch(setup, /\n {18}HOME:/, "the step must read the runner user's own HOME");
});

// Runs the setup step's script with the bash options of a GitHub Actions
// runner, against a harness whose config.toml is `config`.
function runSetup(config) {
  const run = /\n {14}run: \|\n((?: {18}.*\n|\n)+)/.exec(review("Set up Codex") + "\n");
  assert.ok(run, "the setup step has no run script");
  const script = run[1].replace(/^ {18}/gm, "");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-setup-"));
  const harness = path.join(root, "harness");
  const skills = path.join(root, "skills");
  fs.mkdirSync(harness);
  fs.mkdirSync(path.join(skills, "exhaustive-review"), { recursive: true });
  fs.writeFileSync(path.join(skills, "codex-tools.md"), "tools\n");
  fs.writeFileSync(path.join(harness, "config.toml"), config);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: "/home/runner", HARNESS: harness, SKILLS: skills, RUNNER_TEMP: root },
  });
  const written = path.join(root, "codex-review/home/.codex/config.toml");
  const output = fs.existsSync(written) ? fs.readFileSync(written, "utf8") : null;
  fs.rmSync(root, { recursive: true, force: true });
  return { ...result, config: output };
}

test("the setup step appends the deny rule to the review profile's filesystem table", () => {
  const result = runSetup('approval_policy = "never"\n\n[permissions.review.filesystem]\n');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.config, /\[permissions\.review\.filesystem\]\n"\/home\/runner\/\.bun\/install\/cache" = "deny"\n$/);
});

test("the review fails before Codex starts when the pinned harness has no review profile", () => {
  const result = runSetup('[model_providers.cliproxy]\nsupports_websockets = false\n');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[permissions\.review\.filesystem\]/);
  assert.doesNotMatch(result.config ?? "", /deny/);
});

// Runs the review step's script against a fake Codex and a fake curl. The
// fake curl answers each request with the next of `answers`, as
// [status, retryAfterSeconds]. The step's timings come from WATCH_INTERVAL and
// RECONNECT_QUIET, which the test sets to seconds.
function runReview({ answers, codex, env = {}, stopAfter }) {
  const run = /\n {14}run: \|\n((?: {18}.*\n|\n)+)/.exec(review("Review the pull request") + "\n");
  assert.ok(run, "the review step has no run script");
  const script = run[1].replace(/^ {18}/gm, "");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-review-"));
  const bin = path.join(root, "bin");
  const harness = path.join(root, "harness");
  const context = path.join(root, "context");
  for (const dir of [bin, harness, context, path.join(root, "codex-review")]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(harness, "prompt.md"), "Review it.\n");
  fs.writeFileSync(path.join(context, "diff.patch"), "");
  fs.writeFileSync(path.join(root, "answers"), answers.map(([status, retry]) => `${status} ${retry ?? ""}`).join("\n") + "\n");
  fs.writeFileSync(
    path.join(bin, "curl"),
    `#!/bin/bash
echo "$*" >> "${root}/curl-args"
cat >> "${root}/curl-config"
headers=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--dump-header" ]; then headers="$2"; fi
  shift
done
count=$(wc -l < "${root}/curl-args")
read -r status retry < <(sed -n "\${count}p" "${root}/answers")
status=\${status:-200}
printf 'HTTP/1.1 %s\\r\\n' "$status" > "$headers"
if [ -n "$retry" ]; then printf 'Retry-After: %s\\r\\n' "$retry" >> "$headers"; fi
printf '%s' "$status"
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, "codex"), `#!/bin/bash\ntouch "${root}/codex-started"\n${codex}\n`, { mode: 0o755 });
  const started = Date.now();
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    encoding: "utf8",
    timeout: stopAfter ?? 60_000,
    killSignal: "SIGTERM",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      CODEX: path.join(bin, "codex"),
      HARNESS: harness,
      CONTEXT: context,
      PR_NUMBER: "7",
      REPOSITORY: "solmyrhq/example",
      HEAD_SHA: "0".repeat(40),
      BASE_URL: "https://proxy.example/v1",
      MODEL: "gpt-test",
      EFFORT: "high",
      RUNNER_TEMP: root,
      GITHUB_WORKSPACE: root,
      HTTPS_PROXY: "http://127.0.0.1:9",
      CLIPROXY_API_KEY: "secret-proxy-key",
      WATCH_INTERVAL: "1",
      RECONNECT_QUIET: "2",
      ...env,
    },
  });
  const read = (name) => (fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), "utf8") : "");
  const out = {
    ...result,
    seconds: (Date.now() - started) / 1000,
    codexStarted: fs.existsSync(path.join(root, "codex-started")),
    curlArgs: read("curl-args"),
    curlConfig: read("curl-config"),
    sleeper: read("sleeper").trim(),
  };
  fs.rmSync(root, { recursive: true, force: true });
  return out;
}

test("the review fails before Codex starts when the proxy reports a long quota cooldown", () => {
  const result = runReview({ answers: [[429, 90000]], codex: "exit 0" });
  assert.notEqual(result.status, 0);
  assert.equal(result.codexStarted, false);
  assert.match(result.stdout + result.stderr, /429/);
  assert.match(result.stdout + result.stderr, /25 hours/);
  assert.match(result.stdout + result.stderr, /reset-quota/);
});

test("the proxy check sends the key in curl's configuration on stdin, never on the command line", () => {
  const result = runReview({ answers: [[200]], codex: "exit 0" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.curlArgs.includes("secret-proxy-key"), "the key is on curl's command line");
  assert.ok(result.curlConfig.includes("Authorization: Bearer secret-proxy-key"));
  assert.ok(result.curlArgs.includes("https://proxy.example/v1/responses"));
  assert.ok(result.curlArgs.includes("--proxy http://127.0.0.1:9"));
});

test("a quote or a backslash in the key is escaped in curl's configuration", () => {
  const result = runReview({ answers: [[200]], codex: "exit 0", env: { CLIPROXY_API_KEY: 'a"b\\c' } });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.curlConfig.includes('header = "Authorization: Bearer a\\"b\\\\c"\n'), result.curlConfig);
});

test("Codex still runs after a short 429 or a 429 without Retry-After, which Codex handles itself", () => {
  for (const answer of [[429, 30], [429], [500]]) {
    const result = runReview({ answers: [answer], codex: "echo reviewed" });
    assert.equal(result.status, 0, `${answer}: ${result.stderr}`);
    assert.equal(result.codexStarted, true);
    assert.match(result.stdout, /reviewed/);
  }
});

test("the step shows Codex's output and ends with Codex's exit code", () => {
  const result = runReview({ answers: [[200]], codex: "echo first line; echo second line >&2; exit 3" });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /first line/);
  assert.match(result.stdout, /second line/);
});

const CODEX_WITH_CHILD = `sleep 600 & echo $! > "$RUNNER_TEMP/sleeper"; wait`;

function assertChildStopped(result) {
  assert.ok(result.sleeper, "the fake Codex started no child");
  // In CI, Node is PID 1 of its container and reaps no orphans, so the killed child stays a zombie.
  let alive = true;
  try {
    alive = !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${result.sleeper}/stat`, "utf8"));
  } catch {
    alive = false;
  }
  if (alive) process.kill(Number(result.sleeper));
  assert.equal(alive, false, "a process that Codex started outlived the step");
}

test("the watchdog stops Codex when it hangs on a reconnect and the proxy then reports a cooldown", () => {
  const result = runReview({
    answers: [[200], [429, 90000]],
    codex: `echo 'ERROR: Reconnecting... 1/5'; ${CODEX_WITH_CHILD}`,
  });
  assert.notEqual(result.status, 0);
  assert.ok(result.seconds < 30, `the step ran for ${result.seconds} seconds`);
  assert.match(result.stdout + result.stderr, /25 hours/);
  assertChildStopped(result);
});

test("a cancelled or timed-out step stops Codex and every process that Codex started", () => {
  const result = runReview({ answers: [[200]], codex: `echo working; ${CODEX_WITH_CHILD}`, stopAfter: 3000 });
  assert.ok(result.seconds < 15, `the step ran for ${result.seconds} seconds after SIGTERM`);
  assertChildStopped(result);
});

test("a failed command in the watchdog stops Codex too", () => {
  const result = runReview({ answers: [[200]], codex: `echo working; rm "$RUNNER_TEMP/codex-review/codex.log"; ${CODEX_WITH_CHILD}` });
  assert.notEqual(result.status, 0);
  assert.ok(result.seconds < 15, `the step ran for ${result.seconds} seconds`);
  assertChildStopped(result);
});

test("a Codex that ignores SIGTERM is killed a few seconds after the step is stopped", () => {
  const result = runReview({ answers: [[200]], codex: `trap '' TERM; echo working; ${CODEX_WITH_CHILD}`, stopAfter: 3000 });
  assert.ok(result.seconds < 15, `the step ran for ${result.seconds} seconds after SIGTERM`);
  assertChildStopped(result);
});

test("a trailing slash on the base URL does not double the slash before /responses", () => {
  const result = runReview({ answers: [[200]], codex: "exit 0", env: { BASE_URL: "https://proxy.example/v1//" } });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.curlArgs.includes("https://proxy.example/v1/responses"), result.curlArgs);
});

test("the watchdog leaves Codex alone when output follows the reconnect", () => {
  const result = runReview({
    answers: [[200], [429, 90000]],
    codex: "echo 'ERROR: Reconnecting... 1/5'; sleep 1; echo working; sleep 4; echo done",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /done/);
  assert.equal(result.curlArgs.trim().split("\n").length, 1, "the proxy was checked again while Codex was working");
});

test("the watchdog lets Codex wait out a reconnect when the proxy has no cooldown", () => {
  const result = runReview({
    answers: [[200], [200], [200]],
    codex: "echo 'ERROR: Reconnecting... 1/5'; sleep 5; echo done",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /done/);
});

test("Codex and its skills live under a temporary HOME, outside the checkout", () => {
  const run = review("Review the pull request");
  assert.match(run, /HOME: \$\{\{ runner\.temp \}\}\/codex-review\/home\n/);
  assert.match(run, /CODEX_HOME: \$\{\{ runner\.temp \}\}\/codex-review\/home\/\.codex\n/);
  const setup = review("Set up Codex");
  assert.ok(setup.includes('cp -R "$SKILLS/exhaustive-review" "$home/.agents/skills/exhaustive-review"'));
  assert.ok(setup.includes('cp "$SKILLS/codex-tools.md" "$home/.agents/skills/codex-tools.md"'));
});

test("only the Codex process is given the tailnet proxy", () => {
  const proxies = TEXT.match(/HTTPS_PROXY:/g) ?? [];
  assert.equal(proxies.length, 1);
  assert.match(review("Review the pull request"), /HTTPS_PROXY: \$\{\{ steps\.tailnet\.outputs\.http-proxy \}\}/);
  assert.match(review("Join the tailnet"), /tags: tag:ci-code-review\n/);
});

test("the pull request's agent files are removed for the run and restored from the head commit after it", () => {
  const paths = ".agents .codex AGENTS.md AGENTS.override.md";
  assert.ok(review("Remove the pull request's agent files for the run").includes(`for path in ${paths}; do`));
  const restore = review("Restore the pull request's agent files");
  assert.ok(restore.includes(`for path in ${paths}; do`));
  assert.match(restore, /\n {14}if: always\(\) && steps\.prepare\.outputs\.review == 'true'\n/, "the files are not restored after a failed review");
});

test("the review profile is checked after it is set up and before the model starts, outside the pull request's checkout", () => {
  assert.ok(TEXT.indexOf("- name: Set up Codex") < TEXT.indexOf("- name: Check the Codex sandbox"));
  assert.ok(TEXT.indexOf("- name: Check the Codex sandbox") < TEXT.indexOf("- name: Review the pull request"));
  const check = review("Check the Codex sandbox");
  assert.match(check, /"\$CODEX" sandbox --permission-profile review -C "\$empty" -- true/);
  assert.ok(check.includes('empty="$RUNNER_TEMP/codex-review/sandbox-check"'));
  assert.doesNotMatch(check, /GITHUB_WORKSPACE/);
});

test("the review fails when the sandbox can list the runner's Bun install cache", () => {
  const check = review("Check the Codex sandbox");
  assert.ok(check.includes('cache="$HOME/.bun/install/cache"'));
  assert.ok(check.includes('"$CODEX" sandbox --permission-profile review -C "$empty" -- ls -A "$cache"'));
  assert.match(check, /\n {22}exit 1\n/);
});

test("Codex is installed from a pinned release whose checksum is checked", () => {
  const install = review("Install Codex");
  assert.match(install, /version=\d+\.\d+\.\d+\n/);
  assert.match(install, /sha256=[0-9a-f]{64}\n/);
  assert.match(install, /sha256sum --check --strict/);
});

test("a pull request whose diff GitHub refuses is still reviewed, from the patches in files.json", () => {
  const read = review("Read the pull request");
  assert.ok(read.includes('if ! gh pr diff "$PR_NUMBER" --repo "$REPOSITORY" > "$context/diff.patch"; then'), "a refused diff ends the step");
  assert.ok(read.indexOf("gh pr diff") > read.indexOf('"$context/threads.json"'), "a refused diff stops the files and threads being written");
  const run = review("Review the pull request");
  assert.ok(run.includes('if [ ! -e "$CONTEXT/diff.patch" ]; then'), "the prompt does not say that the diff is missing");
  assert.match(run, /Read the patch of each file from files\.json instead\./);
});

test("the guide is read from the base commit, not from the pull request", () => {
  assert.match(review("Read the pull request"), /contents\/\$GUIDE\?ref=\$BASE_SHA/);
});

test("the review is checked and posted by the shared actions under the Codex marker", () => {
  const check = review("Check the review");
  assert.match(check, /uses: solmyrhq\/actions\/review-check@/);
  assert.match(check, /marker: codex-code-review\n/);
  assert.match(check, /structured-review: /);
  const post = step("publish", "Post the review");
  assert.match(post, /uses: solmyrhq\/actions\/review-publish@/);
  assert.match(post, /marker: codex-code-review\n/);
});

test("the key check and the tree check run before the review is checked and uploaded", () => {
  const order = ["Check that the review changed nothing", "Check that the review holds no key", "Check the review", "Upload the review"];
  const positions = order.map((name) => TEXT.indexOf(`- name: ${name}\n`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("the publish job downloads the artifact by the name the review job uploaded, so a re-run of only the publish job finds it", () => {
  assert.match(job("review"), /\n {12}artifact: \$\{\{ steps\.prepare\.outputs\.artifact \}\}\n/);
  assert.match(review("Upload the review"), /name: \$\{\{ steps\.prepare\.outputs\.artifact \}\}\n/);
  assert.match(step("publish", "Download the review"), /name: \$\{\{ needs\.review\.outputs\.artifact \}\}\n/);
  assert.doesNotMatch(job("publish"), /run_attempt/);
});

test("Codex's files are removed even after a failure", () => {
  const cleanup = review("Remove Codex and its state");
  assert.match(cleanup, /\n {14}if: always\(\)\n/);
  assert.match(cleanup, /"\$RUNNER_TEMP\/codex-review"/);
});

test("no run script interpolates text that the pull request's author controls", () => {
  for (const field of ["title", "body", "head.ref", "head.label"]) {
    assert.ok(!TEXT.includes(`github.event.pull_request.${field}`), `the workflow reads pull_request.${field}`);
  }
});

test("every action is pinned to a full commit SHA", () => {
  const refs = [...TEXT.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is not pinned to a commit`);
});
