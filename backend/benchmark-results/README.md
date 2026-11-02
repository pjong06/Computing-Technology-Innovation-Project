# Knowledge API completion evidence

Implemented in the existing local checkout, based on commit b2b8be6. Existing password-recovery changes were preserved. These changes are pushed to a feature branch for pull request review and are not deployed.

## Completed tasks

1. Added 45 Knowledge API tests, included in the backend test command, plus a GitHub Actions workflow for future pushes and pull requests. Search/filtering, input rejection, officer role enforcement, pagination, CRUD/archive behavior, duplicate and foreign-key errors, invalid IDs, failure responses and JSON parsing are covered. Database calls are mocked for automated tests; live authentication and photo-storage success workflows are not end-to-end tested.
2. Added consistent optional text checks for create/update, strict shared pagination validation, JSON parser errors (400 malformed, 413 oversized), and safe JSON responses for rejected database requests. Fixed whitespace-only family filtering so it does not accidentally require a taxonomy association. Existing field whitelists and officer checks remain in effect. No new category/status vocabulary was invented.
3. Added pagination and exact totals to officer species and public taxonomy lists, preserving each endpoint's default page size and existing data array. Both use an ID tie-breaker. Public species pagination uses the same bounds.
4. Ran a reproducible read-only benchmark against the existing live Supabase catalogue through the updated local Express router, including the taxonomy join, exact count and network transfer.

## Validation

59 tests included in this change passed: 45 Knowledge API tests and 14 existing IoT tests. The full local checkout passed 63 tests, including four unfinished password-recovery tests excluded from this change. Knowledge router line coverage was 73.96%, branch coverage 90.06%. The runtime reports 79.46% line coverage across loaded source files; this excludes unimported backend modules and does not prove 70% coverage of the entire backend. Coverage figures precede removal of one unused import. Photo storage success/failure workflows need additional coverage beyond the current input and permission tests.

## Live benchmark

Measured at 2026-10-30T10:15:58.994Z using Node v26.8.1. Six scenarios, 20 measured requests each, one excluded warm-up per scenario, concurrency 1. All 120 measured requests succeeded. Full raw timings are in knowledge-search.json. No live data was changed.

| Scenario | Median ms | p95 ms | Rows returned | Matching total |
| --- | ---: | ---: | ---: | ---: |
| catalogue | 102.8 | 140.1 | 2 | 7 |
| scientific_name | 75.9 | 131.3 | 1 | 1 |
| common_name | 82.2 | 94.7 | 2 | 2 |
| family | 80.7 | 101.7 | 0 | 0 |
| no_matches | 77.6 | 116.1 | 0 | 0 |
| second_page | 75.1 | 88.0 | 2 | 7 |

The reviewed database contains 8 species (7 approved, 1 archived), 2 taxonomy rows and development/test data. The public benchmark sees only the approved catalogue under RLS. The family result is affected by incomplete taxonomy associations. Results establish a baseline for this small dataset only, not larger-scale performance or the full proposal's page-action target. They exclude hosted backend latency and browser rendering. Repeat with a larger verified catalogue and representative deployed traffic before making production performance claims.

## Run again

From backend:

- `npm test`
- `npm run test:knowledge`
- `npm run test:coverage`
- `npm run benchmark:knowledge`

The benchmark requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the process environment or an ignored backend/.env. It uses public read access, never a service-role key. Optional BENCHMARK_SAMPLES is 1–100 (default 20); BENCHMARK_OUTPUT chooses the JSON destination. Failed requests abort the benchmark instead of generating a misleading success report. No keys are stored in benchmark results.

## Integration notes

Website clients must use pagination metadata and request subsequent pages. The current officer species website still needs its separate API integration work; this was outside these four backend tasks. The workflow runs on GitHub when this feature branch is pushed. No database schema changes were necessary.
