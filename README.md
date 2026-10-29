# actions

GitHub Actions shared by the solmyrhq organization's private repositories.

Only workflows in solmyrhq repositories can use these actions, because this repository's Actions access level is `organization`. The repository and that setting are declared in `infra/terraform/github-repositories.tf` in the gingerbread repository.

When you use an action from this repository, pin it to a full commit SHA.

## tailnet-ssh

This action joins the tailnet as an ephemeral node for the rest of the job and writes an SSH config for connecting to one host over it. The self-hosted runners cannot use `tailscale/github-action`: it runs `tailscaled` with `sudo`, and the runner user has no `sudo`. This action runs `tailscaled` as the runner user in userspace-networking mode, so the VM's routes and DNS do not change. Only connections made through the SSH config reach the tailnet. When the job ends, whether it passed, failed or was cancelled, the action logs the node out, stops `tailscaled` and deletes its files.

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

ssh uses the settings in the SSH config only when the destination on the ssh command line is exactly the `host` input. With these settings, ssh accepts only an ed25519 host key with the given fingerprint, and does not read or write `known_hosts`.

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

For a `pull_request_target` event, GitHub runs the caller from the default branch. A pull request therefore cannot change the workflow that reviews it. The workflow does not review a draft pull request or a pull request from a fork. To review a pull request again, run the caller from the Actions tab and give the pull request number.

The `review` job runs the model with a read-only token. The model writes the review to files, and the `review` job uploads them. The `publish` job does not run a model. It posts the comments from these files and resolves the review threads that the model selected. Only the `publish` job can write to the pull request.

OpenCode reads the model's permissions, skills and instructions from `.opencode`, `opencode.json`, `opencode.jsonc` and `AGENTS.md`. OpenCode also runs the plugins in `.opencode` before it examines a permission. For these reasons, before OpenCode starts, the `review` job replaces these files in the pull request with:

- the `pr-review` agent and the skills from the `opencode-review` action
- the guide from the base commit of the pull request
- an `opencode.json` that loads the guide

After the run, the `review` job puts back the pull request's versions of these files, and then examines the working tree. If the model changed a file, the `review` job fails.

### Change the review

Callers run the review on `pull_request_target` events. For these events, GitHub runs the caller from the default branch. When a pull request changes the review workflow or the `opencode-review` action, GitHub runs the previous version of the review on that pull request. GitHub runs the changed version for the first time on the next pull request after the merge.

In `.github/workflows/opencode-review.yml`, the `opencode-review` action is pinned to a full commit SHA. Pull requests in this repository can be merged only as squash commits, and GitHub deletes the branch of a pull request when the pull request is merged. Thus you must use two pull requests to change the action:

1. Merge a pull request that changes the action.
2. In `.github/workflows/opencode-review.yml`, change the pin to the squash commit of step 1 on the main branch. Merge a second pull request with this change.

Do not pin the action to a commit on the branch of a pull request. After the squash merge, GitHub deletes the branch, and the commit is then on no branch. GitHub can delete a commit that is on no branch, and then the runner cannot download the action at the pinned commit.

## opencode-review

This action holds the files for the OpenCode code review: the `pr-review` agent in `agents/`, the review prompt in `prompt.md`, and the `exhaustive-review` skill in `skills/`. The `path` output of the action is the directory that holds these files. The review workflow, `.github/workflows/opencode-review.yml`, copies the files from that directory. Before the model starts, the workflow also reads the project's guide from the base branch of the caller's repository, and writes it to `.opencode/guide.md` in the checkout. The only step of the action checks that the agent file is not empty.

The files are in an action because a job in another private repository cannot check out this repository with its `GITHUB_TOKEN`. The job can use an action from this repository, and the runner then downloads the directory of the action.

The permission list in the front matter of the agent is the sandbox of the model. OpenCode lets the model read and edit only the files that the list allows, and run only the commands that it allows. A trailing `*` in a shell rule matches extra arguments. The model can add an argument such as `-X POST` to an allowed `gh api` command to make it write. GitHub rejects that write because the token of the review job is read-only. Keep that token read-only, and examine it again when you change the list.

`skills/exhaustive-review/` is a copy of `skills/exhaustive-review` in the agent-config repository. The exception is `references/ci-opencode.md`, which is a copy of the file in the gingerbread repository. `skills/opencode-tools.md` is a copy of the file with the same name in agent-config, because `SKILL.md` links to it. When you change one of these files in its source repository, copy the changed file here.
