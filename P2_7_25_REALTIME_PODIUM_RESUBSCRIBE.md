# P2.7.25 — Realtime podium resubscribe audit

1. No code patch applied.
2. Judge and Display derive `podiumId` once from `window.location.search` via `getPodiumIdFromSearch`.
3. Their active-pointer effects include `podiumId` in dependency arrays, so a React podium state change would recreate the subscription.
4. Heat-scoped effects depend on `currentHeatId`, so a heat change recreates heat/config/score subscriptions.
5. `subscribeToActiveHeatPointer` keys channels as `active-heat:<event>:podium:<A|B>` and filters `row.podium_id`.
6. Runtime initial Judge A observed `active-heat:10:podium:A`, heat config H2, and event config channels.
7. Admin A→B click completed, but Judge A remained explicitly URL-scoped to `podium=A`; this is correct isolation, not a B resubscribe.
8. No in-page control changes Judge/Display `podiumId`; switching the Admin podium does not mutate their URL or React podium state.
9. Runtime diagnostics then reported `CHANNEL_ERROR` and `fallback_polling` for active-heat, event-config, and heat-config channels; Realtime was unavailable for a valid A→B/B→A trace.
10. Therefore unsubscribe A → subscribe B and pointer-B delivery cannot be certified from this session.
11. First broken stage observed: runtime Realtime channel establishment (`CHANNEL_ERROR`), before pointer delivery.
12. No duplicate-subscription conclusion is possible under fallback polling.
13. No scores, timer, qualification, planning, DB, or Mamelles data changed.
14. Verdict: BLOCKED — restore Mac Field Realtime, then run Judge/Display contexts explicitly opened for A and B and trace A↔B without reload.
