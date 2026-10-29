# OpenCode tool mappings

Read this file before using a linked agent-config skill in OpenCode.

- For AskUserQuestion, use the `question` tool and wait for the answer. If it is dismissed or unavailable, ask in chat and end the turn. Do not continue work that depends on an unanswered question.
- For Read, use `read`. It returns images and PDFs as well as text. Use `glob` and `grep` to find files and text. If layout or images matter, render the requested pages locally.
- For Edit or Write, use `edit` and `write` and edit files individually.
- For Agent or Opus review steps, use the `subagent` tool with the `general` sub-agent. Give each reviewer only its assigned input. Run independent reviewers in parallel. Keep the specified number of reviewers and their separate assignments. Let each sub-agent use the session's model. A sub-agent cannot launch sub-agents of its own.
- For WebFetch or WebSearch, use Tavily: `tavily_search` to search and `tavily_extract` to read a public URL. If Tavily fails or isn't available in the session, try `arc url2md` for a URL, then `webfetch` and `websearch`, and tell the user when you do. Send Tavily or any other third-party service only search terms and public URLs.
- For Bash, use `shell`, and for Bash's `run_in_background: true`, use `background: true`. The `shell` tool stops a foreground command after two minutes. For a command that runs for minutes, such as `arc monitor-pr` or a `codex exec` run, use `background: true` and wait for the completion notice, or give `timeout` a value far above the two-minute default and wait for the call to return. Do not poll the command. Do not tail or head its output.
- For task lists, track the steps in the conversation. Do not create persistent tasks to track a skill run.
