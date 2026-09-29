# In-Memory Account Ledger Core

An append-only, in-memory account ledger that replays a six-day event stream for two accounts (ACC-001 in AED, ACC-002 in BHD). It covers overdraft fees, daily interest, card authorizations and settlements, and back-dated corrections. There is no web layer, database or UI.

## Running it

Requires [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
bun run replay        # replay E1–E10 and print the per-day report
bun test              # full suite: 21 pass, 1 fail (the intentional one, see below)
bun run test:green    # only the passing suite
bun run typecheck     # tsc --noEmit
bun run lint          # biome check
```

**`bun test` exits non-zero on purpose.** `test/known-failure.test.ts` is the required "failing test against your own design". Its inline notes explain what it reveals. Everything else is in `test/ledger.test.ts` and passes.

## Reading the output

`bun run replay` prints one block per day, then a restated summary.

```
=== Day 5 ===  events: E7, E8
  ACC-001
    closing ledger : AED -410.00
    available      : AED -410.00
    fees assessed  : AED 25.00 (value Day 2); AED 25.00 (value Day 4); AED 25.00 (value Day 5)
    authorizations : Auth-A SETTLED AED 185.00 (hold AED 200.00 released); Auth-B DECLINED hold AED 90.00
  ...
  errors: none
```

| Line | Meaning |
|---|---|
| `events` | Events that arrived (were booked) that day, in stream order |
| `closing ledger` | Sum of every entry with value date ≤ this day, **as known at the end of this day**. Later back-dated entries don't rewrite this line. |
| `available` | Closing ledger minus active authorization holds |
| `fees assessed` | Fees booked by this day's end-of-day run. The value date in brackets can be earlier, because a back-dated entry can make an already-closed day negative. |
| `authorizations` | Current state of each authorization on the account: `APPROVED` (hold active), `DECLINED`, or `SETTLED` (hold released) |
| `errors` | Operational exceptions raised that day that need a human, e.g. `SETTLEMENT_WITHOUT_AUTH`, `LATE_ARRIVAL` |

The final **restated view** shows every day's closing balance again, using everything known at the end of the window. It also shows each day's rounded interest accrual and the capitalized total, which always equals the sum of the accruals.

"As known that day" and "restated" differ because of back-dated entries. For example, Day 2 prints 250.00 on Day 2, but restates to 225.00 at the end. See AMBIGUITIES A3.

## Results at a glance

| Day | ACC-001 closing (as known) | What happened |
|---|---|---|
| 1 | 250.00 | E1 +1,200, E2 −950 |
| 2 | 250.00 | Auth-A hold 200 approved (available 50) |
| 3 | 650.00 | E4 +400 |
| 4 | 285.00 | Auth-A settles 185; Auth-Z settles 180 with no authorization, so it is posted and flagged |
| 5 | −410.00 | E7 −620 back-dated to Day 2; Auth-B declined; fees back-assessed for Days 2, 4, 5 |
| 6 | 210.69 | E9 reverses E7 (value Day 2); interest 0.69 capitalized |

ACC-002 receives BHD 10.000 as 3.334 + 3.333 + 3.333 (value Day 5, arriving late on Day 6) and earns BHD 0.008 in interest. Its closing balance is BHD 10.008.

## Design in one paragraph

Money is integer minor units (fils); floats never hold an amount. Every ledger entry carries two dates: the **value date** (when it counts) and the **booked day** (when the ledger learned of it). Balances are computed by summing entries, never stored.

Entries, authorization records and errors are frozen and only ever appended. A settlement appends a `SETTLED` record, and a reversal appends opposite entries.

Decisions are made on what is known at the time and never re-decided: authorization approvals, and fees once assessed. Balances, on the other hand, are always restatable by value date. The failing test is about the tension between those two.

## Files

| Path | Contents |
|---|---|
| `src/money.ts` | Parsing, formatting, half-even integer division, exact splitting |
| `src/ledger.ts` | `Ledger`: entries, balances, authorizations, settlements, reversals, end-of-day fees, interest |
| `src/events.ts` | The E1–E10 stream as data, and the `replay()` driver that moves the day clock |
| `src/replay.ts` | The runnable report |
| `test/ledger.test.ts` | One test per acceptance criterion, plus invariants and money tests |
| `test/known-failure.test.ts` | The intentional failing test, annotated |
| `NUMBERS.md` | Every constant, and why that value and not half of it |
| `AMBIGUITIES.md` | Every ambiguity found, and how it was resolved |
| `REJECTED.md` | Refused acceptance criteria with reasons, plus approaches abandoned mid-build |
| `WORKLOG.md` | Timestamped log of the work |

**History note:** before the first push, the commit history was rewritten to remove earlier drafts of `WORKLOG.md`. No code, test or other document content was altered. Details are at the top of `WORKLOG.md`.
