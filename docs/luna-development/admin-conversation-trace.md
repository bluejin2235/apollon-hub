# Administrator conversation trace

The existing LUNA administrator conversation history claims that clicking a row shows the original exchange, but the list has no click handler or detail endpoint. The new explicit button expands one conversation at a time and reads its saved messages through an administrator-only route.

The view shows the question and answer, recorded search rounds/scope, separately recorded candidate peak and source-card count, and the saved source titles/paths and relation hint when present. These are different measurements. A retrieved candidate is not a cited source; a saved card is not proof that its title was cited in the answer. Legacy answers without search metadata explicitly say that the trace was not stored, which is not proof of zero source material. Missing values are shown as unrecorded, not zero. Messages, content and card lists are bounded and truncated explicitly.

The endpoint is read-only, looks up one conversation by ID, and uses the same administrator gate as other admin APIs. It does not reconstruct intermediate search steps that were never persisted. For the hands-on review, compare each answer and source in the actual Hub with this stored trace and disclose gaps. A complete candidate-to-answer trace remains additional work.
