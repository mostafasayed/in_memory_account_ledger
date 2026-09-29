# AMBIGUITIES

Each item is a question the brief leaves open, where two reasonable engineers would write different code. For each: the options, what I chose, why, and where it shows up.

Two terms used throughout:
- **Booked day**: the day the ledger learns about an entry.
- **Value date**: the day the entry counts for.

E7 is booked on Day 5 with value date Day 2. Almost every ambiguity below comes from the gap between these two dates.

---

## A. Time and ordering

### A1. List order vs. booked day (E10)
The brief says "replayed in this order", but E10 (Day 5) is listed after E9 (Day 6).
- **Option 1:** sort by booked day, so E10 is processed on Day 5.
- **Option 2:** keep list order. When E9 arrives, Day 5 closes; E10 then arrives after Day 5 is closed.
- **Chosen: option 2.** The list order is the arrival order. E10 is booked on Day 6 with value date Day 5 and flagged `LATE_ARRIVAL`. Sorting would hide exactly the kind of lateness this exercise is about.
- **Impact:** none on final numbers, since E10 only touches ACC-002 and no decision depends on it. It changes the Day 5 printout (ACC-002 shows 0.000 as known on Day 5) and adds one error line on Day 6.
- **Code:** `replay()` in `src/events.ts`. **Test:** "E10 arrives after Day 5 closed".

### A2. When does a day "close"?
There are no clock times, no cut-offs and no business-day calendar.
- **Chosen:** a day closes when the first event for a later day arrives, or at the end of the stream. End-of-day runs the fee check (and, on Day 6, interest).
- **Consequence:** E7 and E8 are both on Day 5, so E7 is known when Auth-B is decided. That is what makes Auth-B decline.

### A3. What does "Day N closing balance" mean when history changes?
"Day 2 closing balance" has three different answers depending on when you ask:

| Asked at end of | Day 2 closing | Why |
|---|---|---|
| Day 2 | 250.00 | E7 not known yet |
| Day 5 | −395.00 | −370 with E7, then the Day 2 fee |
| Day 6 | 225.00 | E9 cancels E7; the fee stays |

- **Chosen:** the per-day printout shows each day as known at the end of that day. That is what the bank actually saw and acted on. A final "restated view" then shows every day with everything known.
- **Code:** `balance(account, valueDay, knownBy)` supports both views. **Test:** criterion #1, "ACC-001 closing ledger per day".

### A4. Criterion 1: "before any fee is assessed"
- **Chosen:** read it as "after E7 and E8 are applied on Day 5, before the Day 5 end-of-day run". At that point no fee exists anywhere, because Days 1–4 all closed non-negative as known then.
- **Test:** criterion #1 checks both that no fee exists and that the balance is −370.00.

---

## B. Overdraft fees

### B1. Are past days re-checked for fees?
E7 arrives on Day 5, but makes Day 2 negative.
- **Option 1:** only check today's closing balance.
- **Option 2:** at every end-of-day, re-check every day so far.
- **Chosen: option 2.** The rule defines the fee by "that day's closing ledger balance (all entries with value_date ≤ that day)". Once E7 is known, Day 2's closing balance *is* negative, and criterion 1's "evaluated at end of Day 5" points the same way.
- **Result:** the Day 5 run charges fees for Days 2, 4 and 5.

### B2. What value date does a late-discovered fee get?
"Booked with value_date equal to the day assessed". Is the "day assessed" the negative day (Day 2) or the day we noticed (Day 5)?
- **Chosen:** value date = the negative day (Day 2), booked day = the day of the run (Day 5). Criterion 2's "assessed ... on Day 2" uses the same reading.
- **Why it matters:** if the fee were dated Day 5, Day 3 would restate to 30.00 instead of 5.00, and Days 2–4 would each look 25.00 better.

### B3. Does a fee count toward the next day's balance?
- **Chosen:** yes. A fee is an ordinary entry, and days are checked in order.
- **Risk (not triggered here):** a fee can make the next day negative on its own and trigger another fee, a "fee spiral". The brief's rule allows this. Day 3 restates to +5.00, so it stops here.

### B4. What happens to fees after E9 reverses E7?
- **Option 1:** keep them.
- **Option 2:** append fee reversals for every day that is no longer negative.
- **Chosen: option 1.** No rule says fees are refunded, and the ledger is append-only, so the fees stay. AED 75.00 is kept.
- **Known weakness:** this is the subject of the failing test. The customer pays for the bank's late booking. Option 2 is the fix path, written up in `test/known-failure.test.ts`.

### B5. The fee is in AED; ACC-002 is BHD
- **Option 1:** convert AED 25.00 at some exchange rate (not given).
- **Option 2:** invent a BHD fee.
- **Option 3:** charge nothing and flag it.
- **Chosen: option 3.** A `NO_FEE_SCHEDULE` error per negative day, no charge. Options 1 and 2 would invent a constant the brief doesn't give. It never triggers here.

### B6. Order of end-of-day steps on Day 6
- **Chosen:** fees first, then interest. If interest ran first it could, in theory, lift a −0.01 balance above zero and avoid a fee.
- Day 6 closes at +210.00 before interest, so the order doesn't matter here.

---

## C. Interest

### C1. Which balances does interest use?
Day 2 interest looked like 0.10 on Day 2, like 0 on Day 5 (negative), and like 0.09 on Day 6.
- **Option 1:** accrue daily on the as-known balance and post adjustments when history changes.
- **Option 2:** compute every day's accrual at capitalization, on the final restated balances.
- **Chosen: option 2.** Interest is only posted once, at the end of Day 6. By then every entry is known, so there is nothing to adjust. The result is 0.10 + 0.09 + 0.25 + 0.09 + 0.08 + 0.08 = **AED 0.69**.
- **Consequence:** the kept fees reduce the restated balances, so they also reduce interest (0.79 without E7).

### C2. What counts in the interest base?
- **Chosen:** all entries with value date ≤ that day, including fees. The capitalization credit itself is excluded because it is posted after the accruals are computed. Day 6 is accrued.

### C3. "Rounded daily accruals must sum exactly to the capitalized total"
- **Chosen:** round each day to the currency's precision (half-even), then capitalize exactly their sum. The equality holds by construction and is tested.
- The unrounded exact interest is AED 0.702, and the ledger capitalizes 0.69. That gap is inherent to rounding each day to fils. It is not a "remainder" between the rounded accruals and the capitalized total (see REJECTED criterion 8).
- The alternative, carrying each day's sub-fil remainder into the next day, would give 0.70. It also satisfies the rule, but a single day's accrual can then no longer be recomputed on its own. Why I didn't choose it is in REJECTED, abandoned approach 1.

### C4. Rounding mode
- **Chosen:** half-to-even. There are no exact ties in this data, so half-up would give identical numbers. See NUMBERS #9.

---

## D. Authorizations and settlements

### D1. Are authorization decisions revisited when back-dated entries arrive?
Auth-A was approved on Day 2 with available 50.00. Once E7 is known, Day 2 was really −370, and Auth-A "should" have been declined.
- **Chosen:** never re-decided. The decision was correct on what was known; the goods have been handed over. Auth-A stays approved and then settled.

### D2. Which balance does the approval check use?
- **Chosen:** balance by value date up to today, with every entry known so far, minus active holds, minus the new hold.
- That includes back-dated entries (E7 counts on Day 5), which is why Auth-B is declined.

### D3. What does an authorization's value_date mean?
E3 and E8 carry value dates, but a hold is not a ledger entry.
- **Chosen:** holds affect available balance from the moment they are approved; their value_date is kept on the event but not used.

### D4. Settlement for a different amount than the hold
Auth-A holds 200.00 and settles 185.00.
- **Chosen:** post 185.00 and release the whole 200.00 hold. The unused 15.00 is not kept.
- **Not handled:** a settlement *above* the hold (tips, currency conversion) is posted without any flag. That is a gap I would close with a tolerance rule.

### D5. Settlement with no authorization (Auth-Z)
- **Chosen:** post it (a force-post) and record `SETTLEMENT_WITHOUT_AUTH` for chargeback review. See REJECTED criterion 4.
- The same applies to a settlement against a *declined* authorization, or one that was already settled.

### D6. Hold expiry
- **Chosen:** no expiry inside the window. See NUMBERS #13.

### D7. Duplicate authorization ID
- **Chosen:** ignored, returns DECLINED and records a `DUPLICATE_AUTH` error. The first record stands.

### D8. Are posted debits checked against available balance?
- **Chosen:** no. The approval rule is written for authorizations only. A posted debit like E7 has already happened, so it goes into overdraft, which is what the overdraft fee exists for.

---

## E. Reversals and instalments

### E1. How is a reversal represented?
- **Chosen:** append the opposite of every entry the target event created, each pointing at the entry it reverses via `ref`. Nothing is edited or deleted.
- Reversing the same event twice, or an unknown event, records an error and posts nothing.

### E2. Reversal value date
- E9 gives value date Day 2 explicitly, matching E7, so the reversal cancels E7 in every day's restated balance. **Chosen:** use it as given.
- A reversal dated Day 6 instead would leave Days 2–5 negative even when restated.

### E3. Partial reversals
- **Not supported.** E9 reverses E7 in full, which is all the brief needs.

### E4. "Three equal instalments" of BHD 10.000
Three equal parts of 10.000 are impossible at 3 decimals.
- **Chosen:** as-equal-as-possible parts that sum exactly: 3.334 + 3.333 + 3.333.
- They are three separate ledger entries, all from source E10 with value date Day 5. See REJECTED criterion 7.

---

## F. Output

### F1. What counts as an "error" in the printout?
- **Chosen:** operational exceptions that need a human: `SETTLEMENT_WITHOUT_AUTH`, `LATE_ARRIVAL`, `NO_FEE_SCHEDULE`, `DUPLICATE_AUTH`, `REVERSAL_TARGET_NOT_FOUND`, `ALREADY_REVERSED`.
- A declined authorization is a normal outcome, shown under authorization states, not as an error.

### F2. Malformed input
- An unknown account, a non-positive amount, or too many decimals is a programming error in the event feed. These throw instead of being recorded, because a replay that silently skips bad data can't be trusted.
