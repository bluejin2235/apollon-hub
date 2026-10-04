# B API trial checkpoint

- Added a preview-only, same-origin test endpoint and UI using request-local credentials. No token is committed, logged, or persisted by this endpoint.
- The fixed question is submitted directly to the official Custom Agent sessions API. It is not basic Notion AI mirroring.
- Verified one real request through the protected preview UI: exact question in the session history, completed answer, and complete content equality on repeated API reads.
- The selected agent has read-only access to three explicitly approved Working page trees. This is not proven identical to A's broader source-filter scope.
- The returned answer omitted key project sources present in the earlier basic-AI result. Do not equate transport success with search-quality equivalence.
- Usage insights API reads returned no usable measurements. The individual run's credit display was observed in the Notion UI; private evidence is kept outside the public repository.
- C has not run. It still needs an authenticated receiver and an actual basic-AI-to-receiver execution.
- No production deployment, DB edits, Notion index fallback, or recurring runs were introduced.

Private report, original response, session identifiers, hashes, screenshots and billing observations are deliberately excluded from this public repository.
