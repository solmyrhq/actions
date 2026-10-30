# Codex tool mappings

Read this file before using a linked agent-config skill in Codex.

- For AskUserQuestion, use a Codex question tool that waits for an answer. If none is available, ask in chat and end the turn. Do not continue work that depends on an unanswered question.
- For Read, use a file-reading tool or local shell command. Use view_image for local images. Extract PDF text locally. If layout or images matter, render the requested pages locally.
- For Edit or Write, use a file-editing tool and edit files individually.
- For Agent or Opus review steps, use Codex sub-agents with an available GPT-6 model selected explicitly. Give each reviewer only its assigned input. Run reviewers in batches that fit the available agent slots. Keep the specified number of reviewers and their separate assignments.
- For WebFetch or WebSearch, use Tavily: tavily_search to search and tavily_extract to read a public URL. If Tavily fails or isn't available, try arc url2md for a URL, then web search or browser retrieval. Send Tavily or any other third-party service only search terms and public URLs.
- For task lists, use a plan tool or track the steps in the conversation. Do not create persistent tasks to track a skill run.
