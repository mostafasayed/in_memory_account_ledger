# REJECTED

## Part 1: Acceptance criteria

| # | Criterion | Verdict |
|---|---|---|
| 1 | Day 2 closing, at end of Day 5 before fees, is AED −370.00 | Accepted |
| 2 | E7 causes exactly one overdraft fee, on Day 2 | **Rejected** |
| 3 | The Day 4 settlement of Auth-A must be accepted | Accepted |
| 4 | A settlement with an unknown authorization ID must be rejected and funds must not leave | **Rejected** |
| 5 | If Auth-B is approved, its hold reduces available but not ledger | Accepted, premise false |
| 6 | After E9, all balances and fees return to their pre-E7 values | **Rejected** |
| 7 | The three BHD instalments must each be BHD 3.334 | **Rejected** |
| 8 | If rounded accruals don't sum to the capitalized total, discard the remainder | **Rejected** |

Every verdict has a test in `test/ledger.test.ts`, named `#N accepted` or `#N rejected`.

### Criterion 2 is rejected: E7 causes three fees, not one

Once E7 (−620.00, value Day 2) is known, restate each day in order. A fee is an entry, so it counts toward later days:

```
Day 2:  250.00 − 620.00             = −370.00  negative → fee → −395.00
Day 3: −395.00 + 400.00             =   +5.00  no fee
Day 4:    5.00 − 185.00 − 180.00    = −360.00  negative → fee → −385.00
Day 5: −385.00                      = −385.00  negative → fee → −410.00
```

Without E7, no day is ever negative and there are zero fees. So E7 causes **three** fees, on Days 2, 4 and 5.

The result is robust to the other choices:
- If Auth-Z were not posted, Day 4 would be −180.00, still negative.
- If the Day 2 fee didn't carry into Day 3, Day 3 would be +30.00, still positive.

The criterion only holds if you look at Day 2 alone.

### Criterion 4 is rejected: a settlement is not a request

The criterion treats a settlement like an authorization, something the bank can say no to. It isn't. In card schemes, a settlement (clearing record) reports a transaction that has *already* been paid between banks. By the time Auth-Z's settlement reaches this ledger, the issuer has already paid the scheme.

- "Funds must not leave the account" is not something the ledger can make true. Refusing to post doesn't bring the money back; it just makes the customer ledger disagree with the bank's real position, a reconciliation break.
- Settlements without a matching authorization are normal: offline purchases (in-flight, transit), authorizations approved by the scheme's stand-in processing while the issuer was down, expired authorizations, and merchant force-posts.
- "Any" makes it absolute. It would also refuse legitimate stand-in and offline transactions.

**What the ledger does instead:** post the debit (a force-post) and record `SETTLEMENT_WITHOUT_AUTH` so operations can review it and raise a chargeback if it is invalid. The money comes back through the dispute process, not by pretending it never left. E6 is posted on Day 4 and flagged.

### Criterion 5 is accepted, but its premise is false

As a rule it is true: a hold reduces available balance and never touches ledger balance. That is tested directly.

But **Auth-B is declined.** On Day 5, E7 has already landed, so:

```
ledger    = 1200 − 950 + 400 − 185 − 180 − 620 = −335.00
available = −335.00 − 90.00                   = −425.00  < 0  → DECLINED
```

The brief's note "Auth-B is never settled inside the window" nudges you to assume it was approved. It wasn't.

### Criterion 6 is rejected: a reversal restores the principal, not history

E9 appends +620.00 with value date Day 2, so E7 and E9 net to zero. But by the time E9 arrives (Day 6), two things have already happened that an append-only ledger can't undo:
1. **Three fees (AED 75.00) were booked on Day 5.** They are entries; deleting them would break the append-only rule. No rule says they are refunded.
2. **Auth-B was declined on Day 5** because of E7. A decline at the till can't be un-happened.

| | E7 never happened | E7, then E9 |
|---|---|---|
| Day 6 ledger (before interest) | 285.00 | 210.00 |
| Fees | 0 | 75.00 |
| Auth-B | Approved | Declined |
| Interest | 0.79 | 0.69 |

Even with fee reversals (see the failing test), the Auth-B line could never match. So "all balances and fees return" is false under any design that respects append-only history.

### Criterion 7 is rejected: 3 × 3.334 = 10.002

Three instalments of 3.334 add up to BHD 10.002. The account would be credited 0.002 BHD more than the 10.000 that was paid in, and the ledger would no longer balance. Splitting must preserve the total. The ledger posts **3.334 + 3.333 + 3.333 = 10.000**: the leftover fil goes to the first instalment.

### Criterion 8 is rejected: there is no remainder to discard

The non-negotiable rule is: "The rounded daily accruals must sum exactly to the capitalized total." That defines the capitalized total as the sum of the rounded accruals. Criterion 8 describes a situation ("if they do not sum") that the rule forbids, then handles it by silently losing money.

- If they ever didn't match, that would be a bug, and the right response is to fail loudly, not to paper over it.
- "Discard" is also wrong on its own terms: money a ledger can't account for is a reconciliation break, not rounding noise.

The ledger capitalizes exactly `Σ rounded accruals` (AED 0.69, BHD 0.008) and the test asserts the equality.

---

## Part 2: Approaches abandoned mid-build

**1. Carry the rounding remainder forward into the next day (abandoned during analysis, ~10:55).**
My first answer to criterion 8 was "don't discard it, carry the sub-fil remainder into the next day's accrual".
- *Why abandoned as the answer to criterion 8:* it answers the wrong question. The rule makes the capitalized total equal to the sum of rounded accruals by definition, so there is no remainder between them.
- *Why abandoned as a design:* it is a legitimate alternative, and it is actually more accurate here. The exact unrounded interest is AED 0.702. Carry-forward gives 0.70; plain per-day rounding gives 0.69. I still chose per-day rounding because each day's accrual is then independently checkable: Day 5's accrual is 0.04% of Day 5's balance, full stop. With carry-forward, Day 5 would show 0.09 on a balance whose 0.04% is 0.084, and an auditor can only reproduce it by replaying every earlier day. With a flat 0.04% rule and six days, the most per-day rounding can lose is half a fil per day.
- *Correction during the build:* my first draft of this entry claimed the exact total was 0.692 and that carry-forward was *less* accurate. Recomputing (10 + 9 + 25 + 9.4 + 8.4 + 8.4 = 70.2 fils) showed the opposite, so the reasoning above was rewritten around auditability rather than accuracy.

**2. Accrue interest daily on the as-known balance, then post adjustments (abandoned at design time).**
- *Why abandoned:* interest is only posted at the end of Day 6. Accruing daily would mean computing 0.10 for Day 2, reversing it on Day 5 (when Day 2 went negative), then re-accruing 0.09 on Day 6. That is three bookings to reach the number a single pass over the final restated balances gives directly.

**3. Sort events by booked day before replaying (abandoned during analysis).**
It would process E10 on Day 5 and look tidier.
- *Why abandoned:* the brief says "replayed in this order". Sorting would hide E10's late arrival instead of handling and flagging it (AMBIGUITIES A1).

**4. Mutate an authorization's status when it settles (abandoned at design time).**
The obvious model is `auth.status = "SETTLED"`.
- *Why abandoned:* "No event record is ever mutated." Authorization history is now an append-only log. A settlement appends a new `SETTLED` record, and the latest record per ID is the current state. The records are frozen.

**5. Convert the AED fee to BHD for ACC-002 (abandoned during analysis).**
- *Why abandoned:* no exchange rate is given, and choosing one would be an invented constant with no defence. The ledger flags `NO_FEE_SCHEDULE` instead (AMBIGUITIES B5).

**6. Refund fees automatically when a back-dated entry clears the negative day (built on a scratch branch, not adopted).**
This is the fix path named in the failing test. It is built on branch `scratch/fee-refund` (commit `e1ce200`).
- *The rule:* at each end-of-day, before charging new fees, walk the days in order. For any fee not yet refunded whose day would close at zero or above without it, append a `REVERSAL` entry pointing at the fee (`ref = fee.id`), with the fee's own value date. The fee itself is never deleted.
- *Measured results:*

  | | Adopted design | With refunds |
  |---|---|---|
  | ACC-001 restated Days 2 / 4 / 5 | 225.00 / 235.00 / 210.00 | 250.00 / 285.00 / 285.00 |
  | Interest capitalized | 0.69 | 0.79 |
  | Final ACC-001 balance | 210.69 | 285.79 |
  | Fee lines in the ledger | 3 | still 3, plus 3 refunds |
  | Auth-B | DECLINED | still DECLINED |

- *Effect on the tests:* 3 tests in `test/ledger.test.ts` turn red by design: the per-day closing (210.69 becomes 285.79), criterion #6 (the balance now matches the E7-never-happened world) and criterion #8 (0.69 becomes 0.79). `test/known-failure.test.ts` still fails, but only on the gross fee count (3 vs 0) and on Auth-B.
- *Why not adopted:*
  1. The brief defines when a fee is assessed, but gives no refund rule. Adding one is inventing policy, the same reason I refused to invent an FX rate for the BHD fee.
  2. It raises questions the brief can't answer. Can a refunded day be charged again if it goes negative later? (`#hasFee` says no.) Should a late *customer* credit also trigger refunds, or only a bank correction? The rule as written can't tell the two apart.
  3. It still can't undo the Auth-B decline. So criterion 6 stays rejected, and the failing test still fails.
- *The case for adopting it, which I'd accept from the business:* the customer shouldn't pay AED 75 for the bank's own late, reversed posting. And the fee is defined by "that day's closing balance", which after restatement is no longer negative.
