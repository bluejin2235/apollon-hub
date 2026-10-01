# Search quality release criteria

Search quality takes priority over latency. Return every verified relevant document without padding the results with unrelated documents.

Release verification must check:

- Complete source collection and explicit handling of unreadable sources.
- Retrieval across different wording without query-specific exceptions.
- Grounded source links and stable results during and after answer generation.
- End-to-end quality checks before production promotion.

Passing unit tests alone does not establish search quality. Internal evaluation records and operational details are maintained outside this public repository.
