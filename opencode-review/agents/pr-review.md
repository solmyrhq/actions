---
description: Reviews a pull request in CI, writes the review files and changes no tracked file
mode: primary
permissions:
    - action: "*"
      resource: "*"
      effect: deny
    - action: read
      resource: "*"
      effect: allow
    - action: read
      resource: "*.env"
      effect: deny
    - action: read
      resource: "*.env.*"
      effect: deny
    - action: read
      resource: "*.env.example"
      effect: allow
    - action: read
      resource: ".git/*"
      effect: deny
    # `glob` and `grep` match their permission resource against the tool's
    # search pattern, not the path it reads, so they cannot enforce the
    # `.env` and `.git` denials above. This agent is for CI, which has no
    # tracked `.env`; do not run it on a checkout that has one, or whose
    # `.git` holds credentials. The deny-all also refuses `external_directory`;
    # that rule is what keeps the host outside the checkout out of reach. The
    # HOME and XDG variables only keep OpenCode's own state under a temporary
    # directory. The review job's read-only token, not this list, is what
    # refuses a write: a trailing `*` accepts extra arguments.
    - action: glob
      resource: "*"
      effect: allow
    - action: grep
      resource: "*"
      effect: allow
    - action: edit
      resource: "review-output/*"
      effect: allow
    - action: skill
      resource: "exhaustive-review"
      effect: allow
    - action: shell
      resource: "gh pr view *"
      effect: allow
    - action: shell
      resource: "gh pr diff *"
      effect: allow
    - action: shell
      resource: "gh api repos/*/pulls/*/comments --paginate --jq *"
      effect: allow
    - action: shell
      resource: "gh api repos/*/pulls/*/reviews --paginate"
      effect: allow
    - action: shell
      resource: "gh api repos/*/pulls/*/reviews --paginate --jq *"
      effect: allow
    - action: shell
      resource: "gh api repos/*/issues/*/comments --paginate --jq *"
      effect: allow
    - action: shell
      resource: "gh api repos/*/pulls/*/files --paginate --jq *"
      effect: allow
---

# Pull request review

Before you begin, read `.opencode/guide.md`. It is the project's guide as it is
on the base branch. If the pull request changes the guide, review that change
in the diff as you review any other change.

The caller is a CI workflow. Follow the `exhaustive-review` skill and its
`references/ci-opencode.md`. Write the review to files under `review-output/`
as that file instructs; the workflow posts them.

Do not edit a tracked file. The only files you may write are scratch files under
`review-output/`.
