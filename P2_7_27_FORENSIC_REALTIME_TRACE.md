# P2.7.27 — Forensic Realtime trace

Runtime: MAC FIELD, expected LAN `10.0.0.10:8080`.
Runtime identity previously observed: release `surfjudging-2026.08.12-p2.7.24-display-convergence`, codeRevision `34795a0d8012565a6c20bd8cbe0dc25213c9671c`; served bundles included `DisplayPage-Cj0wtTaN.js` and `JudgePage-LNC65IoX.js`.

Starting pointers A/B: NOT OBSERVED in this run.
Transition: NOT PERFORMED. Playwright navigation failed before page load with `net::ERR_CONNECTION_TIMED_OUT`.
Database pointer H3: NOT OBSERVED.

| STAGE | JUDGE B | DISPLAY B |
|---|---|---|
| DB pointer H3 | NOT OBSERVED | common NOT OBSERVED |
| Realtime channel subscribed | NOT OBSERVED | NOT OBSERVED |
| Realtime UPDATE H3 received | NOT OBSERVED | NOT OBSERVED |
| Callback H3 called | NOT OBSERVED | NOT OBSERVED |
| Config H3 load started | NOT OBSERVED | NOT OBSERVED |
| Config H3 returned | NOT OBSERVED | NOT OBSERVED |
| Store/state became H3 | NOT OBSERVED | NOT OBSERVED |
| Old H2 subscriptions removed | NOT OBSERVED | NOT OBSERVED |
| New H3 subscriptions active | NOT OBSERVED | NOT OBSERVED |
| DOM became H3 | NOT OBSERVED | NOT OBSERVED |
| Still H3 after 30s | NOT OBSERVED | NOT OBSERVED |

FIRST BROKEN STAGE JUDGE: runtime unreachable before application load.
FIRST BROKEN STAGE DISPLAY: runtime unreachable before application load.
COMMON ROOT LAYER: UNPROVEN.

Screenshots/evidence: no new screenshots; Playwright error is the sole new runtime evidence.
NO PATCH APPLIED. No scores, START, close, or DB changes performed.
Runtime identity retry on `192.168.1.74:8080`: manifest served release `surfjudging-2026.08.12-p2.7.24-display-convergence`, codeRevision `34795a0d8012565a6c20bd8cbe0dc25213c9671c`; served entry bundle `assets/index-BKQHH_LH.js` (route chunks are loaded dynamically).
Repository HEAD is `89b7c28fd38a35ab6f67f03b7e821631babe3063`, so RUNTIME MATCHES CURRENT CODE: NO. The runtime is older than current main and must be rebuilt/deployed before behavioral certification. No transition was executed.
NO PATCH APPLIED. Verdict: ROOT CAUSE NOT YET PROVEN.
