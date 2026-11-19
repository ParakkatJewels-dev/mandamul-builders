# Performance: before and after batch 7, re-run after batch 9

Same synthetic volume both times (30 projects, 9,000 POs, 36,000 measurements, 12,000 daily reports, 12,000 inspections, 9,000 defects, 200,000 notifications, ~190,000 audit rows), PostgreSQL 16 on the build machine, row-level security on, run as the real roles. Median of 7 runs (3 for the two heavy ones) after one warm-up run. Raw output: `before.txt`, `after.txt`. Reproduce with `scripts/perf-bench.sh <label>`.

| Read | Budget (ms) | Before (median ms) | After batch 7 (median ms) | Change | Within budget | Re-run after batch 9 (median ms) |
|---|---|---|---|---|---|---|
| cost report, one project | 100 | 85.2 | 7.1 | 12× faster | yes | 11.2 |
| portfolio cost, 30 projects | 500 | 2425.1 | 193.2 | 13× faster | yes | 198.8 |
| cash requirement, 90 days | 100 | 1442.8 | 10.8 | 134× faster | yes | 11.4 |
| unit readiness, 70 units | 100 | 86.9 | 3.7 | 23× faster | yes | 4.8 |
| approvals waiting for MD | 50 | 26.8 | 3.9 | 7× faster | yes | 3.9 |
| unread notifications | 50 | 3.7 | 8.7 | 2.4× slower — cause found: the benchmark query repeats a bare `auth.uid()`, which runs per row and steers the planner off the ordered index after the policy rewrite; see the next row | yes | 9.1 |
| unread notifications, app query form (filter left to row-level security) | 50 | — | — | added after batch 9 | yes | 0.1 |
| open defects, one project | 50 | 10.7 | 1 | 11× faster | yes | 1.0 |
| latest site reports | 50 | 24.9 | 0.9 | 28× faster | yes | 1.0 |
| PM approvals queue | 50 | 63.4 | 2.8 | 23× faster | yes | 2.8 |
| audit trail page, one project | 50 | 42.6 | 1.4 | 30× faster | yes | 2.4 |
| latest purchase orders (all projects) | 50 | 363.9 | 0.8 | 455× faster | yes | 1.7 |
| payables: approved unpaid invoices | 50 | 52.7 | 0.6 | 88× faster | yes | 1.1 |
| order tracking (no prices) | 50 | 121.3 | 1.3 | 93× faster | yes | 2.0 |
| exception scan (scheduler) | 2000 | 769.6 | 684.2 | 11% faster while doing more (alerts, playbooks, financial checks) | yes | 737.2 |

Not measured here: network latency to Supabase, PostgREST overhead, browser rendering of the production app (not built), concurrent users.


## Re-run after batch 9 (alert precision)

Raw output: `after-b9.txt`. Batch 9 changed only the exception scan and the delay playbook; the scan now takes 737 ms against 684 ms after batch 7 (still inside its 2,000 ms budget). Other rows moved by up to ±4 ms between runs on the same machine; the cost report (7.1 → 11.2 ms) is the largest move and was not changed by batch 9, so treat single-digit millisecond differences as run-to-run noise.

**Rule for the production app:** never put a bare `auth.uid()` in a query. Leave the user filter to row-level security, or write `(select auth.uid())` so it is evaluated once. The same read takes 0.1 ms in that form and 9.1 ms in the bare form.
