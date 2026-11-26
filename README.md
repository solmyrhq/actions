# actions

GitHub Actions shared by the solmyrhq organization's repositories.

When you use an action from this repository, pin it to a full commit SHA.

## tailnet-ssh

This action joins the tailnet as an ephemeral node for the rest of the job and writes an SSH config for connecting to one host over it. The self-hosted runners cannot use `tailscale/github-action`: it runs `tailscaled` with `sudo`, and the runner user has no `sudo`. This action runs `tailscaled` as the runner user in userspace-networking mode, so the VM's routes and DNS do not change. A connection can reach the tailnet only through the socket of `tailscaled`. With the SSH config, ssh connects through this socket. While the job runs, any process on the runner can use the socket. Thus, the socket is not a security boundary. When the job ends, whether it passed, failed or was cancelled, the action logs the node out, stops `tailscaled` and deletes its files.

```yaml
- id: tailnet
  uses: solmyrhq/actions/tailnet-ssh@<commit sha>
  with:
      oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
      tags: tag:ci-platform-deploy
      version: 1.98.9
      sha256: 11be30ad301d48f84ff52fec34f8a2f78eb3e3dee1be4e9624d19fccc8df5540
      host: ${{ secrets.PLATFORM_DEPLOY_HOST }}
      host-fingerprint: ${{ secrets.PLATFORM_DEPLOY_SSH_FINGERPRINT }}
- run: ssh -F "${{ steps.tailnet.outputs.ssh-config }}" -i "$key_file" "$DEPLOY_USER@$DEPLOY_HOST" "platform $DEPLOY_SHA"
```

`sha256` is the checksum of the tarball for the runner's architecture. Tailscale publishes it at `https://pkgs.tailscale.com/stable/tailscale_<version>_amd64.tgz.sha256`. On ARM64 runners, use `arm64` in place of `amd64`. Update `sha256` whenever you change `version`.

ssh uses the settings in the SSH config only when the host name in the destination on the ssh command line is exactly the `host` input. If the destination also has a user name, as in `user@host`, ssh compares only the host name after the `@`. With these settings, ssh accepts only an ed25519 host key with the given fingerprint, and does not read or write `known_hosts`.

`tailnet-ssh` and `tailnet-http` both use the code in `tailnet/` to join and leave the tailnet.

## tailnet-http

This action joins the tailnet in the same way as `tailnet-ssh`. For the rest of the job, it serves an HTTP proxy into the tailnet on a loopback port. The `http-proxy` output is the URL of the proxy. Give the proxy only to the process that must connect to the tailnet: set `HTTPS_PROXY` to this URL only in the environment of that process. As for `tailnet-ssh`, the socket of `tailscaled` is a second route to the tailnet. This socket is in the action's directory under `RUNNER_TEMP`. The proxy and the socket have no authentication. While the job runs, any process on the runner can use the proxy or the socket. Thus, neither is a security boundary.

```yaml
- id: tailnet
  uses: solmyrhq/actions/tailnet-http@<commit sha>
  with:
      oauth-secret: ${{ secrets.CODE_REVIEW_TS_OAUTH_SECRET }}
      tags: tag:ci-code-review
      version: 1.98.9
      sha256: 11be30ad301d48f84ff52fec34f8a2f78eb3e3dee1be4e9624d19fccc8df5540
- run: curl --fail https://<host>.<tailnet>.ts.net/
  env:
      HTTPS_PROXY: ${{ steps.tailnet.outputs.http-proxy }}
```

The proxy resolves MagicDNS names. It carries HTTP, and HTTPS in a `CONNECT` tunnel. It does not carry other protocols. The hosts and ports that a node with these tags can connect to are set in the tailnet policy.

## deploy-commit

This action chooses the commit that a deploy job deploys. Run the action in the deploy job, and deploy the commit in the `sha` output. Put the deploy job in a concurrency group with `cancel-in-progress: false`. If `cancel-in-progress` is `true`, GitHub can cancel a deploy while it runs. The job does not need a checkout.

```yaml
deploy:
    runs-on: <runner>
    concurrency:
        group: deploy
        cancel-in-progress: false
    permissions:
        contents: read
        actions: read
        checks: read
    steps:
        - id: commit
          uses: solmyrhq/actions/deploy-commit@<commit sha>
          with:
              token: ${{ github.token }}
              branch: main
              workflow: ci.yml
              job-name: Lint and test
              sha: ${{ inputs.sha }}
        - run: ssh -F "$SSH_CONFIG" -i "$key_file" "$DEPLOY_USER@$DEPLOY_HOST" "app $DEPLOY_SHA"
          env:
              DEPLOY_SHA: ${{ steps.commit.outputs.sha }}
```

The action does these steps in this order:

1. It fails if `branch` is not a valid branch name, if `workflow` is not a file name that ends in `.yml` or `.yaml`, or if the run is not for `refs/heads/<branch>`. It fails if `sha` is not empty and is not a full commit SHA in lower case. If `sha` is empty, the action does not do steps 2 to 4. It reads the newest 300 commits of the branch's history, as in step 2. It outputs the newest commit on the first-parent chain of these commits that passed the `job-name` job, as in step 3. If no commit on that chain passed, the action fails. This commit can be older than the tip of the branch. For example, if the push of the tip changes no file in the `paths` filter of `workflow`, GitHub does not run `workflow`. The tip then has no run of `workflow`.
2. It reads the newest 300 commits of the branch's history through the REST API, from the current tip of the branch. It fails if `sha` is not on the first-parent chain of these commits. A commit that is in the branch's history only through the second parent of a merge commit is not on the chain. To deploy that commit, give the SHA of the merge commit. If `sha` is further down the chain than these commits reach, the action also fails.
3. It fails if no run of `workflow` on `branch` for `sha` has a job named `job-name` that passed. Only a run that a push or a `workflow_dispatch` event started counts. A run that a pull request started tests the merge of the pull request into its base branch, and this merge can differ from `sha`. A job of the same name in another workflow does not count. The action counts the jobs of every attempt, because a commit that passed and then failed a rerun can already be in production. GitHub Actions records each job of a run as a check run with the name of the job, on the head commit of the run. The check run is in the check suite of the run. All the attempts of a run use the same check suite. First, the action reads the check runs named `job-name` that GitHub Actions recorded for `sha`. If none of these check runs passed, the action does not read the runs. If one passed, the action reads the runs of `workflow` for `sha`. The action counts a run only if one of these check runs that passed is in the check suite of the run. The action reads all of these through the REST API.
4. It outputs the newest commit on the first-parent chain, from `sha` to the tip, that passed the `job-name` job. If no commit newer than `sha` passed, it outputs `sha`. If `check-only` is `true`, the action does not do this step. It outputs `sha`.

The action makes one REST API request for each commit that it checks and that has no check run of `job-name` that passed. It makes two requests for each of the other commits that it checks. It also makes one request for each 100 commits of history that it reads. These counts are true when each response has 100 items or fewer. For a response with more items, the action makes one more request for each 100 more items. A run of the action makes the most requests when these two conditions are true:

- A job of the same name in another workflow passed for each of the newest 300 commits.
- Only the oldest of these commits passed the `job-name` job in `workflow`.

Then a run of the action makes about 600 requests. The rate limit of `GITHUB_TOKEN` is 1,000 REST API requests an hour for each repository, or 15,000 on GitHub Enterprise Cloud. A run of the action makes at most 650 requests, so that the other workflows in the repository can use the rest of the limit. If the action must make another request after 650 requests, it fails, and nothing is deployed.

The action counts a run of `workflow` only if the workflow path of the run is exactly `.github/workflows/<workflow>` or `.github/workflows/<workflow>@refs/heads/<branch>`. When the push of a tag starts a run, GitHub records the name of the tag as the branch of the run. The workflow path of this run is `.github/workflows/<workflow>`, with no ref. Thus, a run for a tag with the same name as `branch` has the same branch and the same workflow path as a run on `branch`. If the repository has a tag with the same name as `branch`, the action fails before it reads the history of the branch, and nothing is deployed. To deploy again, delete the tag.

The action can output a commit newer than `sha` because GitHub keeps at most one pending job in a concurrency group. When another job joins the group, GitHub cancels the pending job, even if that job is for a newer commit. The deploy that runs last can therefore be for an older commit. Each deploy job deploys the newest commit that passed the `job-name` job. Thus, unless someone force-pushes the branch, production does not go back to an older commit. After GitHub cancels a deploy, the next deploy deploys the commit of the cancelled deploy or a newer commit.

Run the action twice: once in a job before the deploy job, and once in the deploy job. Give the first job no concurrency group and the same permissions as the deploy job. In the first job, set `check-only` to `true`. The first job then checks `sha` and does not look for a newer commit. If `sha` is empty, the first job checks nothing. Set `needs` in the deploy job to the first job. If `sha` is wrong, the first job fails, GitHub skips the deploy job, and the deploy job does not join the concurrency group. Without the first job, a deploy job with a wrong `sha` joins the group. If another deploy job is pending, GitHub cancels it. Then the deploy job with the wrong `sha` fails. The commit of the cancelled job is not deployed until a later deploy job succeeds. The first job needs no secret other than the job's `GITHUB_TOKEN`. Thus, it can run on shared runners.

Start the deploy from `workflow`. In `workflow`, add a job that `needs` the `job-name` job. Run this job only for a push to `branch` or a `workflow_dispatch` event on `branch`. In this job, run `gh workflow run` for the deploy workflow, and give the commit in the `sha` input. If `branch` is not the default branch of the repository, also give `--ref <branch>`. Without `--ref`, the deploy run is for the default branch, and step 1 fails. The token of this job needs the `actions: write` permission. An event that `GITHUB_TOKEN` causes usually starts no workflow run. A `workflow_dispatch` event is an exception. Do not start the deploy workflow on `push` with a job that waits for the `job-name` job. On shared runners, the waiting job can hold the last free runner, and then the `job-name` job cannot start. Add `workflow_dispatch` to the `on` triggers of `workflow`. Then, if GitHub does not run `workflow` for a push, you can start a run of `workflow` on `branch` by hand. For example, GitHub does not run `workflow` for a push with `[skip ci]` in the commit message. A run that you start by hand tests the tip of `branch` at that time. If the `job-name` job passes, the job that `needs` it starts the deploy.

## Review workflows

Three reusable workflows review a pull request with the `exhaustive-review` skill: `.github/workflows/claude-review.yml`, `.github/workflows/codex-review.yml` and `.github/workflows/opencode-review.yml`. A fourth reusable workflow, `.github/workflows/review.yml`, calls these three workflows. Each repository calls `review.yml` from one caller workflow in that repository. The caller runs on `pull_request_target` for pull requests. For `pull_request_target`, GitHub runs the caller from the base branch of the pull request. A pull request therefore cannot change the workflow that reviews it. No workflow reviews a draft pull request or a pull request from a fork. Under `pull_request_target`, the job for a pull request from a fork would get the secrets of the repository.

### Turn a review on or off

`CODE_REVIEWS` is an organization variable. Its value is the list of reviews to run, from the names `claude`, `codex` and `opencode`. Separate the names with commas and no spaces, as in `claude,codex`. If a repository has a variable with the same name, GitHub uses the value of the repository variable in that repository. If the name of a workflow is not in the list, the review job of that workflow does not run, and the workflow posts nothing. To change the reviews that run, change the variable. You do not have to change the callers. In a public repository, only the Codex review can run (see "Public repositories").

### Choose the model

Set the model and the reasoning effort of each review with organization variables. If a repository has a variable with the same name, GitHub uses the value of the repository variable in that repository. If a variable is not set, the workflow uses the default value in the table.

| Review   | Model variable          | Effort variable          | Default model                       | Default effort |
| -------- | ----------------------- | ------------------------ | ----------------------------------- | -------------- |
| Claude   | `CLAUDE_REVIEW_MODEL`   | `CLAUDE_REVIEW_EFFORT`   | `claude-opus-5-5`                   | `high`         |
| Codex    | `CODEX_REVIEW_MODEL`    | `CODEX_REVIEW_EFFORT`    | `gpt-6.1-sol`                       | `max`          |
| OpenCode | `OPENCODE_REVIEW_MODEL` | `OPENCODE_REVIEW_EFFORT` | `deepseek/deepseek-v4.1-flash-1017` | `max`          |

For the OpenCode model, use an OpenRouter model ID without the `openrouter/` prefix. For the OpenCode effort, use the name of an OpenCode model variant.

Each review workflow also has `model` and `effort` inputs. If an input has a value, the workflow uses that value instead of the variable. `review.yml` does not pass these inputs. To set these inputs in a repository, call the workflow of that review directly from that repository.

Each workflow stops with an error if a model or an effort contains a character other than a letter, a digit, `.`, `_`, `/`, `:` or `-`. In the Claude workflow, a model or an effort can also contain `[` and `]`, as in `claude-opus-5-5[1m]`.

### Call the reviews

Each repository calls `review.yml` from its own `.github/workflows/code-review.yml`. In the example, replace `<commit sha>` with the SHA of a commit on the main branch of this repository. Set `guide` to the path of the file that holds the instructions for agents in your repository.

```yaml
name: Code Review

on:
    pull_request_target:
        types: [opened, synchronize, ready_for_review, reopened]
    workflow_dispatch:
        inputs:
            pr:
                description: Pull request number
                required: true

permissions: {}

jobs:
    review:
        uses: solmyrhq/actions/.github/workflows/review.yml@<commit sha>
        permissions:
            actions: read
            contents: write
            id-token: write
            pull-requests: write
        with:
            pr: ${{ inputs.pr }}
            guide: CLAUDE.md
        secrets:
            CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
            OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
            CLIPROXY_API_KEY: ${{ secrets.CLIPROXY_API_KEY }}
            CLIPROXY_BASE_URL: ${{ secrets.CLIPROXY_BASE_URL }}
            CODE_REVIEW_TS_OAUTH_SECRET: ${{ secrets.CODE_REVIEW_TS_OAUTH_SECRET }}
```

In the caller, give `review.yml` each permission that one of the three reviews uses. Under `secrets:`, pass each secret that the reviews use by name. Do not use `secrets: inherit`. With `secrets: inherit`, GitHub passes every repository and organization secret that is available to the caller to `review.yml`. In `review.yml`, the `permissions:` and `secrets:` of each job contain only the permissions and the secrets that its review uses. In each review workflow, each job then gets only the permissions that the job uses. The reviews use these organization secrets: `CLAUDE_CODE_OAUTH_TOKEN` for the Claude review, `OPENROUTER_API_KEY` for the OpenCode review, and `CLIPROXY_API_KEY`, `CLIPROXY_BASE_URL` and `CODE_REVIEW_TS_OAUTH_SECRET` for the Codex review.

`review.yml` refers to each review with a path that starts with `$/`. GitHub resolves `$/` to this repository, at the commit of `review.yml` that is running, whichever repository calls `review.yml`. Thus, when a caller pins `review.yml` to a commit, GitHub also runs the reviews from that commit.

To review a pull request again, run the caller from the Actions tab and give the pull request number. In this manual run, only the Codex and OpenCode reviews run. The Claude review does not run (see "Claude").

### Public repositories

Anyone can comment on a pull request in a public repository. A comment can contain instructions for the model. The model posts its review on the pull request, where everyone can read it. Thus, in a public repository:

- Only the Codex review runs. In the Claude and OpenCode reviews, the model can read every comment on the pull request. Thus, in the Claude and OpenCode workflows, the review job does not run. This is also true when a caller calls one of these workflows directly.
- The Codex review gives the model only the comments of bots, of the pull request's author, and of people whose author association is `OWNER`, `MEMBER` or `COLLABORATOR`.
- The Codex review runs on a GitHub-hosted runner, because public repositories cannot use the organization's self-hosted runners. Each job on a GitHub-hosted runner gets a new virtual machine. Thus, the model cannot read the files of other jobs.

Give the public repository access to the organization secrets that the Codex review uses.

### OpenCode

The OpenCode workflow runs OpenCode to review a pull request, and posts the review as inline comments and one summary comment.

The `review` job runs the model with a read-only token. The model writes the review to files. The `review-check` action checks the files, and the `review` job uploads them. The `publish` job does not run a model. It posts the files with the `review-publish` action, which also resolves the review threads that the model selected. Only the `publish` job can write to the pull request.

OpenCode reads the model's permissions, skills and instructions from `.opencode`, `opencode.json`, `opencode.jsonc` and `AGENTS.md`. OpenCode also runs the plugins in `.opencode` before it examines a permission. For these reasons, before OpenCode starts, the `review` job replaces these files in the pull request with:

- the `pr-review` agent from the `opencode-review` action, and the skills from the `skills` action
- the guide from the base commit of the pull request
- an `opencode.json` that loads the guide

After the run, the `review` job puts back the pull request's versions of these files, and then examines the working tree. If the model changed a file, the `review` job fails.

OpenCode also loads skills from `.claude/skills` and `.agents/skills`, and reads instructions from `CLAUDE.md`. The `review` job does not replace these files, because they are part of the changes under review. Instead, the step that runs OpenCode sets two environment variables. When `OPENCODE_DISABLE_EXTERNAL_SKILLS` is `1`, OpenCode does not load skills from `.claude` or `.agents`. When `OPENCODE_DISABLE_CLAUDE_CODE` is `1`, OpenCode does not read `CLAUDE.md` or the skills in `.claude`.

### Codex

The Codex workflow runs Codex with the `codex-review` harness, and posts the review in the same way as the OpenCode workflow, with the `codex-code-review` marker.

To set the model and its reasoning effort, see "Choose the model". The workflow reads the base URL of the CLIProxyAPI endpoint from the `CLIPROXY_BASE_URL` secret, so that GitHub masks the URL in the logs.

The commands that the model runs cannot connect to the network, and they have no GitHub token. Only the Codex process can connect to the model provider, CLIProxyAPI. The Codex process connects through the tailnet proxy and uses the CLIProxyAPI key. Before Codex starts, the `review` job does these steps:

1. It reads the pull request, its diff, its files, its comments, its reviews and its review threads, and the guide from the base commit, into a directory outside the checkout. In the comments, the reviews and the review threads, it keeps only the items of bots, of the pull request's author, and of people whose author association is `OWNER`, `MEMBER` or `COLLABORATOR`.
2. It installs Codex from a release whose checksum is pinned. On a GitHub-hosted runner, it allows unprivileged user namespaces. The Codex sandbox needs these namespaces. On Ubuntu, AppArmor blocks them by default.
3. It puts `config.toml` from the `codex-review` action in a temporary `CODEX_HOME`, and the skills in the `.agents/skills` directory of a temporary `HOME`. It adds a rule to `config.toml` that denies the model's commands the runner user's Bun install cache, `~/.bun/install/cache` (see the `codex-review` section). If `config.toml` does not end with the `[permissions.review.filesystem]` table of the review profile, the job fails before Codex starts.
4. It checks that the Codex sandbox works on the runner. If the Bun install cache exists, it also checks that a command in the sandbox cannot list the cache.
5. It removes the pull request's `.agents`, `.codex`, `AGENTS.md` and `AGENTS.override.md` from the checkout. Codex loads skills from `.agents/skills`, where a pull request could add its own copy of `exhaustive-review`.
6. It joins the tailnet with `tailnet-http`, as a node with the tag `tag:ci-code-review`. The job gives the proxy only to the Codex process.

Codex runs with `--strict-config`. With this option, Codex stops with an error if a key in `config.toml` is not a Codex setting. The model returns the review as its final message, in the format of `output-schema.json`. After the run, the `review` job restores the removed files from the head commit. The job fails if the model changed the working tree. The model can read the CLIProxyAPI key, and every file that the runner user can read (see the `codex-review` section). The job fails if the review contains an exact copy of the key. The job does not fail if the review contains an encoded copy of the key, or other content that the model copied from the runner.

Before Codex starts, the step that runs Codex sends one short request to CLIProxyAPI, through the tailnet proxy. When the quota of every credential for the model is in a cooldown, CLIProxyAPI answers 429 with a `Retry-After` header for the whole cooldown, which can be a day. Codex waits that long before it tries again. The review would then hang until the 120-minute timeout of the step. If the answer is 429 with a `Retry-After` of more than 10 minutes, the step fails at once. The error message contains the approximate number of hours until the cooldown ends. CLIProxyAPI keeps the cooldown in memory, even after the quota is reset upstream. To clear the cooldown, restart CLIProxyAPI or call `POST /reset-quota` on its management API. Then run the review again. A quota can also run out during the review. Codex then prints `Reconnecting...` and nothing more. While Codex prints nothing after that line, the step sends the same request every 2 minutes. If the answer is again 429 with a `Retry-After` of more than 10 minutes, the step stops Codex and fails with the same error.

### Claude

The Claude workflow runs `anthropics/claude-code-action`, which posts the review with the Claude GitHub App's token.

Before Claude starts, `claude-code-action` puts back `.claude/`, `CLAUDE.md` and the other configuration paths of Claude Code from the base branch. It removes each of these paths that the base branch does not have. The skill therefore cannot be in the checkout. The workflow copies the skill from the `skills` action into a temporary `CLAUDE_CONFIG_DIR`. Claude Code loads user skills from this directory.

Claude Code reads the `.claude/settings.json` of the base branch as its project settings. If that file has a value for `env.ANTHROPIC_BASE_URL`, Claude Code sends its requests to that server. If that file has a value for `apiKeyHelper`, Claude Code runs that command to get its key. If the runner cannot connect to that server or cannot run that command, the review fails. For example, in the `.claude/settings.json` of a repository, `env.ANTHROPIC_BASE_URL` can be a server on a private network of the repository's owner. The workflow therefore writes a settings file in which `apiKeyHelper` is an empty string and `env.ANTHROPIC_BASE_URL` is `https://api.anthropic.com`. The workflow gives this file to Claude Code with `--settings`. Claude Code uses a value from `--settings` before a value from the project settings, and a value from the project settings before a value from the user settings. The `settings` input of `claude-code-action` cannot replace the values of the project, because the action merges that input into `~/.claude/settings.json`, which holds the user settings.

In a manual run of the caller (`workflow_dispatch`), the review job of the Claude workflow does not run. Without a pull request in the event, `claude-code-action` has no pull request to comment on.

### Change a review

When a pull request changes a review workflow, or an action that a review workflow uses, GitHub runs the previous version of the review on that pull request, because the caller runs from the base branch. In this repository, the caller refers to `review.yml` by a local path, and GitHub runs the changed version for the first time on the next pull request after the merge. In every other repository, the caller refers to `review.yml` at a pinned commit SHA, and GitHub runs the reviews from that commit. GitHub runs the changed version there only after you change that pin.

In each review workflow, each action from this repository is pinned to a full commit SHA. Pull requests in this repository can be merged only as squash commits, and GitHub deletes the branch of a pull request when the pull request is merged. Thus, to change an action that a workflow uses, you must use two pull requests in this repository, and then one pull request in each repository that calls `review.yml`:

1. Merge a pull request that changes the action.
2. In each workflow that uses the action, change the pin to the squash commit of step 1 on the main branch. Merge a second pull request with this change.
3. In each repository that calls `review.yml`, change the pin in its caller to the squash commit of step 2 on the main branch. Merge a pull request with this change.

To change a review workflow and no action, merge one pull request that changes the workflow in this repository. Then do step 3, with the squash commit of that pull request in place of the squash commit of step 2.

Do not pin the action to a commit on the branch of a pull request. After the squash merge, GitHub deletes the branch, and the commit is then on no branch. GitHub can delete a commit that is on no branch, and then the runner cannot download the action at the pinned commit.

## opencode-review

This action holds the files for the OpenCode code review: the `pr-review` agent in `agents/` and the review prompt in `prompt.md`. The `path` output of the action is the directory that holds these files. The review workflow, `.github/workflows/opencode-review.yml`, copies the files from that directory. Before the model starts, the workflow also reads the project's guide from the base branch of the caller's repository, and writes it to `.opencode/guide.md` in the checkout. The action has one step. This step checks that `agents/pr-review.md` and `prompt.md` are not empty.

The files are in an action so that a job gets them at the pinned commit. When a job uses an action from this repository, the runner downloads this repository at that commit. An action can therefore read files outside its own directory, such as `skills/`, `tailnet/` and `toolkit/`.

The permission list in the front matter of the agent is the sandbox of the model. OpenCode lets the model read and edit only the files that the list allows, and run only the commands that it allows. A trailing `*` in a shell rule matches extra arguments. The model can add an argument such as `-X POST` to an allowed `gh api` command to make it write. GitHub rejects that write because the token of the review job is read-only. Keep that token read-only, and examine it again when you change the list.

## codex-review

This action holds the files for the Codex code review: the review prompt in `prompt.md`, the Codex configuration in `config.toml`, and the schema of the review in `output-schema.json`. The `path` output of the action is the directory that holds these files. The action has one step. This step checks that the three files are not empty.

The configuration and the read-only token of the job are the sandbox of the review:

- Codex runs each command that the model asks for in a read-only sandbox with no network access. The sandbox is the `review` permission profile in `config.toml`, which extends Codex's built-in `:read-only` profile. Codex does not use the profile if `codex exec` gets `--sandbox`, or if a config layer with a higher precedence than `config.toml` sets `sandbox_mode`. Examples of such layers are a `-c` option and a project's `.codex/config.toml`. The workflow gives `codex exec` neither option, and removes the checkout's `.codex` before Codex starts. Codex never asks for approval. The sandbox prevents writes. It also prevents reads in one directory: the runner user's Bun install cache, `~/.bun/install/cache`. On a self-hosted runner, the jobs of every repository fill this cache. In November 2026, a review's command loaded packages from it and ran them. Codex runs with a temporary `HOME`. The workflow therefore writes the full path of the cache, from the runner user's own `HOME`, in the rule at the end of `config.toml`. A command can read every other file that the runner user can read. On a self-hosted runner, these files include the registration files of the runner and the checkouts of other jobs on the same runner. Thus, the model can write the contents of these files in the review. In a private repository, only people with access to the repository can comment. There, this risk is accepted, together with the risk to the key in the next item. In a public repository, the review runs on a GitHub-hosted runner instead (see "Public repositories").
- Codex gives the commands only the core environment variables, such as `PATH` and `HOME`. But the commands can still read the key for the model provider. PID 1 of the sandbox is a Codex helper, and its `/proc/1/environ` holds the key. Thus, the model can read the key and write it in the review. This risk is accepted, because the key works only from a tailnet node that has access to CLIProxyAPI under the tailnet policy. You can also revoke the key without changing anything else.
- The workflow does not limit the memory of the model's commands. On a self-hosted runner, the runner user has no `sudo` and no systemd user manager. The workflow therefore cannot run Codex in a control group of its own. A limit on address space, such as `prlimit --as`, would also stop Codex, because Codex reserves much more virtual memory than it uses. To limit the memory of the runner service, and of the commands in it, set the limit in the configuration of the runner VM, outside this repository.
- Web search, apps, plugins, hooks, memories, browser use, computer use and image generation are off, because their traffic does not go through the sandbox. Codex starts no daemon, because the self-hosted runners are not ephemeral and a daemon could continue to run after the job.
- Codex does not load the pull request's `AGENTS.md` as instructions. The model reads the guide from the pull request's base commit instead. But the model can read every file in the checkout. Thus, `skills/exhaustive-review/references/ci-codex.md` has this instruction for the model: review the agent instruction files in the checkout, and do not follow them.
- Codex connects to the model provider, CLIProxyAPI, through the Responses API. Codex reads the provider's key from `CLIPROXY_API_KEY`. The workflow passes the provider's base URL, the model and the reasoning effort on the command line. The base URL comes from the `CLIPROXY_BASE_URL` secret.

The final message of the model is the review, as a JSON object that matches `output-schema.json`. The `review-check` action writes that message as the files that `review-publish` posts.

## skills

This action holds the `exhaustive-review` skill and the tool mappings that the skill links to. The Claude, Codex and OpenCode reviews all load the skill from here. The `path` output of the action is this directory. The action has one step. This step checks that these files are not empty: `SKILL.md`, `agents/openai.yaml`, each file in `references/`, `codex-tools.md` and `opencode-tools.md`. Codex reads `agents/openai.yaml`. Because this file sets `allow_implicit_invocation` to `false`, Codex loads the skill only when the prompt names it.

The files in `skills/` are copies of these files in the organization's agent configuration repository: `skills/exhaustive-review/`, `skills/codex-tools.md` and `skills/opencode-tools.md`. Every file in `skills/exhaustive-review/` is a copy, including the CI references `references/ci-opencode.md` and `references/ci-codex.md`. To change a file, change it in that repository first. Then copy the changed file here.

## review-prepare

Run this action as the first step of a review job. The action reads the pull request through the REST API, and then sets the `review` output. If the pull request is closed, is a draft, or is from a fork, `review` is `false`, and the job must not review the pull request. A pull request from a fork that was deleted is also from a fork. If `review` is `true`, the action also sets these outputs:

- `pr-number`: the number of the pull request.
- `head-sha` and `base-sha`: the head commit and the base commit of the pull request.
- `artifact`: the name of the artifact for the review, `<artifact-prefix>-<run id>-<run attempt>`. The review job uploads the files of the review in this artifact, and the publish job downloads them.

The `pr` input is required. It must be a positive whole number in decimal digits. If `pr` is a URL, the action fails, because a URL can identify a pull request in another repository. If a pull request event and a manual dispatch can both start the workflow, give the number from the pull request event. If a manual dispatch started the workflow, give the `pr` input of the dispatch. Write `pr` as in this example:

```yaml
- id: prepare
  uses: solmyrhq/actions/review-prepare@<commit sha>
  with:
      token: ${{ github.token }}
      pr: ${{ github.event.pull_request.number || inputs.pr }}
      artifact-prefix: codex-review
```

Give `artifact` to the publish job through an output of the review job. Do not make the name again in the publish job. If you re-run only the publish job, its run attempt is higher than the run attempt of the review job that uploaded the artifact. Thus, a name that the publish job makes from its own run attempt is not the name of the artifact.

`toolkit/github.js` is the REST and GraphQL client that `review-prepare` and `review-publish` use.

## review-check

The review job runs this action after the model finishes. The action checks the files that the model wrote under `directory`: a non-empty `summary.md`, a valid inline comment on the head commit in each `comment-*.json`, and a valid `resolve.json`. `resolve.json` is optional. If `resolve.json` is missing or empty, the action uses an empty list of threads and writes this list to `resolve.json`. Each thread in `resolve.json` must also be listed in the summary. The action then adds this run's marker, `<!-- <marker>:<head sha>:<run id>:<run attempt> -->`, as the first line of the summary and of each inline comment. The action fails if `summary.md` is missing or empty, or if `resolve.json` or a `comment-*.json` file is not valid. It also fails if the summary does not list a thread in `resolve.json`, or if the summary or an inline comment already starts with a marker. A marker lower in the text is allowed, because a review can quote an earlier comment.

If `structured-review` is set, it is the path of a JSON file that holds the final message of Codex. Before the checks, the action reads that file and writes the files above from it.

## review-publish

The publish job runs this action with the workflow's `GITHUB_TOKEN`. The token must have the `pull-requests: write` and `contents: write` permissions. Do not use a different token. The action finds the comments and threads of the review by their author. That author is `github-actions`, or `github-actions[bot]` in the REST API, only when the token is `GITHUB_TOKEN`. The action runs no model. It uses only the files that `review-check` passed, and does these steps in this order:

1. It posts each inline comment. If GitHub rejects a comment, the action adds the comment to the summary instead.
2. It posts the summary.
3. It resolves each thread in `resolve.json` that is unresolved, is on this pull request in this repository, and has a first comment by `github-actions` that starts with this review's marker. If `resolve.json` lists any other thread that is not already resolved, the action does not resolve it, and fails after it completes the other steps.
4. It fails if no issue comment on the pull request by `github-actions[bot]` starts with the review's marker. The summary is an issue comment. The inline comments are not issue comments, and the action does not read them in this step.

The `review-check` action writes the review's marker as the first line of `summary.md`. The `review-publish` action reads the marker from that line. If that line is not a marker for this review and the head commit, the action posts nothing and fails. The marker contains the run attempt of the review job. If you re-run only the publish job, the run attempt of the publish job is higher than the run attempt in the marker. The action does not use the run attempt of the publish job. Before it posts, the action reads the comments that `github-actions[bot]` posted earlier with the same marker. The action does not post an inline comment again if an earlier inline comment has the same text, file, line and side. The action does not post the summary again if an earlier issue comment has the marker.

The runner reads a log line that starts with `::` as a workflow command. The action escapes each line break in the text that it logs. Thus, text from the model or the pull request cannot start a new log line.
