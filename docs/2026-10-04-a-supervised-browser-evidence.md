# A browser trial — implementation and verification boundary

The isolated preview now includes a request endpoint, browser-worker receipt endpoint, and an original-answer display. The receipt validates request binding, exact question, completion observations, stable text and link arrays. It does not call a summarization model or an indexed-document fallback.

The browser procedure reads the preview request, types the question into a new basic Notion AI chat, confirms the posted user message, waits for completion, reads the official Copy response output and rendered links, sends them to the preview receipt API, and rereads the displayed result for equality.

The procedure is supervised: ChatGPT starts and advances browser tool calls. This is not a server-callable daemon and does not enable a preview user to run the entire flow alone. The standalone reference driver records the exercised operations; it has not been independently executed as an imported module.

A clipboard read immediately after copying can still contain the previous value. Observe the copy notification and recheck the complete body before accepting a receipt.

Completion timing is observed wall-clock time, including orchestration delay, not a provider processing metric. One trial cannot establish an average or production reliability.

Actual questions, answers, document URLs, internal paths, request identifiers and response hashes are retained in the private report, not this development note.

Remaining A work: a separately hosted authenticated browser worker, per-user sessions, approved source enforcement, automated job transport, and a repeat of the complete flow without ChatGPT controlling tabs. B and C remain on hold. Production was not changed.
