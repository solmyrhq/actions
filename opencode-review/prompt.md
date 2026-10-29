# OpenCode review prompt

You are running in CI in OpenCode.

The pull request is given in the prompt that loads this file: its number, its
repository and its head commit are also in `$PR_NUMBER`, `$REPOSITORY` and
`$HEAD_SHA`. You have a GitHub token that can read this pull request.

Load the `exhaustive-review` skill with the `skill` tool, then follow
`references/ci-opencode.md`. That file replaces `references/ci.md` for this
harness and says how to read the pull request and write the inline comments,
the summary and the threads to resolve under `review-output/`. The workflow
posts the review, adds this run's marker, and resolves the threads.

Do not change a tracked file. The only files you may write are scratch files
under `review-output/`, which the workflow removes afterwards.
