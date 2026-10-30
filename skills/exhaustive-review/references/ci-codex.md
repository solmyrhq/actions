# Exhaustive review in CI, Codex

You are running in CI in Codex. Follow this file instead of `references/ci.md`.

The workflow runs you in a read-only sandbox with no network access and no
GitHub access. It fetched the pull request before you started, and it posts the
review after you finish. Your final message is the review: a JSON object that
matches the output schema that the workflow gives Codex. Do not write
`report.html`, and do not try to post anything. The rules in `SKILL.md` still
apply.

## Read the pull request

The prompt contains the path of a directory. That directory holds these files:

- `guide.md`: the project's guide from the pull request's base commit. Read it
  before you begin. If the pull request changes the guide, the change is in the
  diff.
- `pull-request.json`: the state, title, description, base branch, base commit,
  head branch and head commit.
- `diff.patch`: the diff of the pull request.
- `files.json`: each changed file with its status and its patch. If
  `diff.patch` is too large to read at once, read the patches one file at a
  time from `files.json`.
- `review-comments.json`: the earlier inline comments.
- `reviews.json`: the earlier reviews.
- `issue-comments.json`: the other comments on the pull request.
- `threads.json`: every review thread, with its `id`, `isResolved`,
  `isOutdated`, path, line and comments, including each comment's author.

The working directory is the repository at the head commit. It holds only that
commit. Read the base side of a change from the diff.

If the pull request is closed or is a draft, return an empty review. Leave
`comments` and `resolve` empty, and in `summary`, write that the pull request
is closed or is a draft.

When you give work to sub-agents, give each one the path of this directory.

## Check the earlier comments

Read the earlier inline comments, reviews and issue comments. Check each one
against the code at the head commit. A comment is fully addressed when the
problem that it reports is fixed completely in the current code, or when a
person has replied that they will not make the change. A reply from a bot does
not address a comment.

GitHub marks a thread as outdated when the lines that the thread is on change.
The outdated flag does not mean that the problem is fixed. Check the code at
the head commit.

Do not repeat a finding that an earlier comment or review already makes.

## Write the review

Your final message is one JSON object with three fields: `comments`, `summary`
and `resolve`. Do not add a marker to any text; the workflow adds this run's
marker before it posts.

### `comments`

Put each finding that is on a line in the diff in `comments`, one finding per
comment:

- `path`: the file's path in the repository.
- `line` and `side`: for a line that the change adds or keeps, the new-file
  line number and `RIGHT`. For a removed line, the old-file line number and
  `LEFT`.
- `start_line` and `start_side`: for a finding on more than one line, the first
  line and its side. Otherwise `null`.
- `body`: start with the finding's Conventional Comments label in bold, then the
  description, then its confidence, as in
  `**issue (blocking):** The description.\n\n**Confidence:** high`. Add a
  suggestion block only when committing it unchanged would fix the problem
  completely.

If GitHub rejects a comment's line, the workflow adds that finding to the
summary instead.

### `summary`

Markdown for the summary comment. It must:

- name the head commit;
- give the number of findings in `comments` for each Conventional Comments
  label;
- list each finding that is not on a line in the diff;
- list each earlier comment that is not yet fully addressed;
- list each thread in `resolve`, with its id and one line that gives the
  reason: the commit that contains the fix, or the person who declined the
  change;
- say so if you found nothing.

### `resolve`

The threads that the workflow should resolve, each with its `id` and the same
reason that you give in `summary`.

Examine each unresolved thread in `threads.json`. Nominate a thread only if all
of these are true:

- The workflow's bot (`github-actions`) posted its first comment.
- That comment starts with `<!-- codex-code-review:`.
- Its finding is fully addressed.

Other reviews, such as the OpenCode review, also post as `github-actions`, but
their comments start with a different marker. Do not nominate a thread whose
`isResolved` is true, or a thread whose first comment is from a person, from
Claude (`claude`), or from another bot.

A thread is fully addressed when its finding is fixed at the head commit, or
when a person has said that the change will not be made. Whether the thread is
resolved or outdated is not evidence either way.

Return an empty list when no thread is fully addressed. The workflow checks each
thread's first comment again, and resolves only the threads that the Codex
review opened on this pull request. Never ask for a thread to be unresolved.
