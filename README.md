# actions

GitHub Actions shared by the solmyrhq organization's private repositories.

Only workflows in solmyrhq repositories can use these actions, because this repository's Actions access level is `organization`. The repository and that setting are declared in `infra/terraform/github-repositories.tf` in the gingerbread repository.

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

## OpenCode review workflow

The `.github/workflows/opencode-review.yml` workflow runs OpenCode to review a pull request, and posts the review as inline comments and one summary comment. Each repository calls this workflow from its own `.github/workflows/opencode-code-review.yml`. In the example, replace `<commit sha>` with the SHA of a commit on the main branch of this repository. Set `guide` to the path of the file that holds the instructions for agents in your repository.

```yaml
name: OpenCode Code Review

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
        uses: solmyrhq/actions/.github/workflows/opencode-review.yml@<commit sha>
        permissions:
            contents: write
            pull-requests: write
        with:
            pr: ${{ inputs.pr }}
            guide: CLAUDE.md
        secrets:
            OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

For a `pull_request_target` event, GitHub runs the caller from the base branch of the pull request. A pull request therefore cannot change the workflow that reviews it. The workflow does not review a draft pull request or a pull request from a fork. To review a pull request again, run the caller from the Actions tab and give the pull request number.

The `review` job runs the model with a read-only token. The model writes the review to files, and the `review` job uploads them. The `publish` job does not run a model. It posts the comments from these files and resolves the review threads that the model selected. Only the `publish` job can write to the pull request.

OpenCode reads the model's permissions, skills and instructions from `.opencode`, `opencode.json`, `opencode.jsonc` and `AGENTS.md`. OpenCode also runs the plugins in `.opencode` before it examines a permission. For these reasons, before OpenCode starts, the `review` job replaces these files in the pull request with:

- the `pr-review` agent and the skills from the `opencode-review` action
- the guide from the base commit of the pull request
- an `opencode.json` that loads the guide

After the run, the `review` job puts back the pull request's versions of these files, and then examines the working tree. If the model changed a file, the `review` job fails.

OpenCode also loads skills from `.claude/skills` and `.agents/skills`, and reads instructions from `CLAUDE.md`. The `review` job does not replace these files, because they are part of the changes under review. Instead, the step that runs OpenCode sets two environment variables. When `OPENCODE_DISABLE_EXTERNAL_SKILLS` is `1`, OpenCode does not load skills from `.claude` or `.agents`. When `OPENCODE_DISABLE_CLAUDE_CODE` is `1`, OpenCode does not read `CLAUDE.md` or the skills in `.claude`.

### Change the review

Callers run the review on `pull_request_target` events. For these events, GitHub runs the caller from the base branch of the pull request. When a pull request changes the review workflow or the `opencode-review` action, GitHub runs the previous version of the review on that pull request. In this repository, the caller refers to the workflow by a local path, and GitHub runs the changed version for the first time on the next pull request after the merge. In every other repository, the caller pins the workflow to a commit SHA. GitHub runs the changed version there only after you change that pin.

In `.github/workflows/opencode-review.yml`, each action from this repository is pinned to a full commit SHA. Pull requests in this repository can be merged only as squash commits, and GitHub deletes the branch of a pull request when the pull request is merged. Thus, to change an action that the workflow uses, you must use two pull requests in this repository, and then one pull request in each repository that calls the workflow:

1. Merge a pull request that changes the action.
2. In `.github/workflows/opencode-review.yml`, change the pin to the squash commit of step 1 on the main branch. Merge a second pull request with this change.
3. In each repository that calls the workflow, change the pin in `.github/workflows/opencode-code-review.yml` to the squash commit of step 2 on the main branch. Merge a pull request with this change.

Do not pin the action to a commit on the branch of a pull request. After the squash merge, GitHub deletes the branch, and the commit is then on no branch. GitHub can delete a commit that is on no branch, and then the runner cannot download the action at the pinned commit.

## opencode-review

This action holds the files for the OpenCode code review: the `pr-review` agent in `agents/` and the review prompt in `prompt.md`. The `path` output of the action is the directory that holds these files. The review workflow, `.github/workflows/opencode-review.yml`, copies the files from that directory. Before the model starts, the workflow also reads the project's guide from the base branch of the caller's repository, and writes it to `.opencode/guide.md` in the checkout. The action has one step. This step checks that `agents/pr-review.md` and `prompt.md` are not empty.

The files are in an action because a job in another private repository cannot check out this repository with its `GITHUB_TOKEN`. The job can use an action from this repository, and the runner then downloads this repository at the pinned commit. An action can therefore read files outside its own directory, such as `skills/`, `tailnet/` and `toolkit/`.

The permission list in the front matter of the agent is the sandbox of the model. OpenCode lets the model read and edit only the files that the list allows, and run only the commands that it allows. A trailing `*` in a shell rule matches extra arguments. The model can add an argument such as `-X POST` to an allowed `gh api` command to make it write. GitHub rejects that write because the token of the review job is read-only. Keep that token read-only, and examine it again when you change the list.

## codex-review

This action holds the files for the Codex code review: the review prompt in `prompt.md`, the Codex configuration in `config.toml`, and the schema of the review in `output-schema.json`. The `path` output of the action is the directory that holds these files. The action has one step. This step checks that the three files are not empty.

The configuration and the read-only token of the job are the sandbox of the review:

- Codex runs each command that the model asks for in a read-only sandbox with no network access. Codex never asks for approval.
- Codex gives the commands only the core environment variables, such as `PATH` and `HOME`. It does not give them the key for the model provider.
- Web search, apps, plugins, hooks, memories, browser use, computer use and image generation are off, because their traffic does not go through the sandbox. Codex starts no daemon, because the runners are not ephemeral and a daemon could continue to run after the job.
- Codex does not read the pull request's `AGENTS.md`. The model reads the guide from the pull request's base commit instead.
- Codex connects to the model provider, CLIProxyAPI, through the Responses API. Codex reads the provider's key from `CLIPROXY_API_KEY`. The workflow passes the provider's base URL, the model and the reasoning effort on the command line.

The final message of the model is the review, as a JSON object that matches `output-schema.json`. The `review-check` action writes that message as the files that `review-publish` posts.

## skills

This action holds the `exhaustive-review` skill and the tool mappings that the skill links to. The Claude, Codex and OpenCode reviews all load the skill from here. The `path` output of the action is this directory. The action has one step. This step checks that these files are not empty: `SKILL.md`, `agents/openai.yaml`, each file in `references/`, `codex-tools.md` and `opencode-tools.md`. Codex reads `agents/openai.yaml`. Because this file sets `allow_implicit_invocation` to `false`, Codex loads the skill only when the prompt names it.

The files in `skills/` are copies of these files in the agent-config repository: `skills/exhaustive-review/`, `skills/codex-tools.md` and `skills/opencode-tools.md`. Every file in `skills/exhaustive-review/` is a copy, including the CI references `references/ci-opencode.md` and `references/ci-codex.md`. To change a file, change it in agent-config first. Then copy the changed file here.

## review-check

The review job runs this action after the model finishes. The action checks the files that the model wrote under `directory`: a non-empty `summary.md`, a valid inline comment on the head commit in each `comment-*.json`, and a valid `resolve.json`. `resolve.json` is optional. If `resolve.json` is missing or empty, the action uses an empty list of threads and writes this list to `resolve.json`. Each thread in `resolve.json` must also be listed in the summary. The action then adds this run's marker, `<!-- <marker>:<head sha>:<run id>:<run attempt> -->`, as the first line of the summary and of each inline comment. The action fails if `summary.md` is missing or empty, or if `resolve.json` or a `comment-*.json` file is not valid. It also fails if the summary does not list a thread in `resolve.json`, or if the summary or an inline comment already starts with a marker. A marker lower in the text is allowed, because a review can quote an earlier comment.

If `structured-review` is set, it is the path of a JSON file that holds the final message of Codex. Before the checks, the action reads that file and writes the files above from it.

## review-publish

The publish job runs this action with a token that can write to the pull request. The action runs no model. It uses only the files that `review-check` passed, and does these steps in this order:

1. It posts each inline comment. If GitHub rejects a comment, the action adds the comment to the summary instead.
2. It posts the summary.
3. It resolves each thread in `resolve.json` that is unresolved, is on this pull request in this repository, and has a first comment by `github-actions` that starts with this review's marker. If `resolve.json` lists any other thread that is not already resolved, the action does not resolve it, and fails after it completes the other steps.
4. It fails if no comment on the pull request by `github-actions[bot]` starts with this run's marker.
