# Exhaustive review in CI, OpenCode

You are running in CI in OpenCode. A GitHub token is in `$GH_TOKEN`, and the
pull request's number, repository and head commit are in `$PR_NUMBER`,
`$REPOSITORY` and `$HEAD_SHA`. The workflow writes this run's marker into the
review files, so you do not need the run id or attempt. Follow this file
instead of `references/ci.md`.
Write the review to files under `review-output/`; the workflow posts them on
the pull request. `report.html` is not used in CI; write the files below. In
CI, the rule "Don't post anything" in `SKILL.md` does not apply. The other
rules in `SKILL.md` still apply, except that you may write under
`review-output/`.

The shell is restricted to the read commands printed here. Keep each command's
program, path and flags exactly as written; only the `--jq` expression may
change. Do not pipe a command into another command, and do not run any other
command. Write the output files with the `write` tool, not with the shell.

## Read the pull request

```sh
gh pr view "$PR_NUMBER" --repo "$REPOSITORY" --json state,isDraft,title,body,baseRefName,baseRefOid,headRefName,headRefOid
gh pr diff "$PR_NUMBER" --repo "$REPOSITORY"
gh api repos/$REPOSITORY/pulls/$PR_NUMBER/comments --paginate --jq '.[] | {id, path, line, original_line, body, user: .user.login}'
gh api repos/$REPOSITORY/pulls/$PR_NUMBER/reviews --paginate
gh api repos/$REPOSITORY/issues/$PR_NUMBER/comments --paginate --jq '.[] | {id, body, user: .user.login}'
gh api repos/$REPOSITORY/pulls/$PR_NUMBER/files --paginate --jq '.[] | {filename, status, additions, deletions, patch}'
```

Read `review-output/threads.json` with the `read` tool. The workflow wrote it
before this run. It lists every review thread with its `id`, `isResolved`,
`isOutdated`, path, line and first comment, including the author.

If `gh pr diff` is too large to read in one result, read the patches from the
`files` command instead, filtering with `--jq` to one file at a time.

If the pull request is closed or is a draft, write no output files and stop.

## Check the earlier comments

Read the earlier inline comments, reviews and issue comments above. Check each
one against the code at the head commit. A comment is fully addressed when the
problem that it reports is fixed completely in the current code, or when a
person has replied that they will not make the change. A reply from a bot does
not address a comment.

GitHub marks a thread as outdated when the lines that the thread is on change.
The outdated flag does not mean that the problem is fixed. Check the code at
the head commit.

Do not repeat a finding that an earlier comment or review already makes.
Nominate the threads that are fully addressed for resolution; see below.

## Write the inline comments

For each finding on a line in the diff, write one JSON file with the `write`
tool: `review-output/comment-01.json`, `review-output/comment-02.json`, and so
on. Each file holds one comment:

```json
{
    "body": "**issue (blocking):** The description.\n\n**Confidence:** high",
    "commit_id": "<the head commit>",
    "path": "path/to/file.ts",
    "line": 42,
    "side": "RIGHT"
}
```

Use the new-file line number and `RIGHT` for a line that the change adds or
keeps. Use the old-file line number and `LEFT` for a removed line. For a
multi-line finding, add `"start_line"` and `"start_side": "RIGHT"`.

The workflow adds this run's marker to every inline comment before it posts
the file. Do not add a marker yourself. A suggestion block is fine in the body
when committing it unchanged would fix the problem completely. The workflow
posts each file in name order. If the API rejects a line, it adds that finding
to the summary instead of posting it.

## Write the summary

Write `review-output/summary.md` with the `write` tool. Do not add a marker;
the workflow adds this run's marker as its first line. It must:

- name the head commit;
- give the number of findings posted for each Conventional Comments label;
- list each finding that is not on a line in the diff;
- list each earlier comment that is not yet fully addressed;
- list each thread that you asked the workflow to resolve, with its id and one
  line that gives the reason: the commit that contains the fix, or the person
  who declined the change;
- say so if you found nothing.

Never unresolve a thread. The workflow posts this file after the inline
comments, and checks that the summary comment exists with this run's marker.

## Nominate the threads that are fully addressed

Examine each unresolved thread in `threads.json`. Nominate a thread only if all
of these are true:

- This workflow's bot posted its first comment (`github-actions` in GraphQL;
  `github-actions[bot]` in REST).
- That comment starts with `<!-- opencode-code-review:`.
- Its finding is fully addressed.

Other reviews, such as the Codex review, also post as `github-actions`, but
their comments start with a different marker. Do not nominate a thread whose
`isResolved` is true. Do not nominate a thread whose first comment is from a
person, from Claude (`claude` in GraphQL; `claude[bot]` in REST), or from
another bot.

A thread is fully addressed when its finding is fixed at the head commit, or
when a person has said the change will not be made. The thread being resolved
or unresolved is not evidence either way.

Write `review-output/resolve.json` with the `write` tool. List each nominated
thread with its id and the same reason that the summary gives:

```json
{
    "threads": [
        {
            "id": "PRRT_kwDO...",
            "reason": "Fixed in 1234abc: the check now names the head commit."
        }
    ]
}
```

Write `{"threads": []}` when no thread is fully addressed. The workflow checks
each thread's first comment again and resolves only the threads the OpenCode
review opened on this pull request. It does not resolve a thread from another
pull request, from a person, from Claude, or from another bot.
