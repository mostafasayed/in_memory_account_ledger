# NUMBERS

Every constant in the ledger, where it lives, why it has that value, and what would break at half of it.

All money is stored as **integer minor units** (fils). AED 12.23 is `1223`; BHD 24.012 is `24012`. No float ever holds an amount.

| # | Constant | Value | Where | Given or chosen |
|---|---|---|---|---|
| 1 | Overdraft fee | `2500` (AED 25.00) | `OVERDRAFT_FEE` in `src/ledger.ts` | Given |
| 2 | Interest rate | `4` basis points per day (0.04%) over `10_000` | `INTEREST_BPS_PER_DAY`, `BPS` | Given |
| 3 | AED precision | `2` decimals | `DECIMALS` in `src/money.ts` | Given (ISO 4217) |
| 4 | BHD precision | `3` decimals | `DECIMALS` | Given (ISO 4217) |
| 5 | Window | `6` days | `WINDOW_DAYS` | Given |
| 6 | Approval threshold | available after hold `>= 0` | `Ledger.authorize` | Given |
| 7 | Fee trigger | closing balance `< 0` | `Ledger.endOfDay` | Given |
| 8 | Interest trigger | closing balance `> 0` | `Ledger.capitalizeInterest` | Given |
| 9 | Rounding mode | half-to-even | `divideHalfEven` | **Chosen** |
| 10 | Instalment leftover goes to | the first instalment(s) | `splitEvenly` | **Chosen** |
| 11 | Fees per account per value day | at most `1` | `#hasFee` | Given |
| 12 | Fee currencies | AED only | `OVERDRAFT_FEE.currency` | **Chosen** |
| 13 | Hold expiry | none inside the window | `activeHolds` | **Chosen** |
| 14 | Largest safe amount | `Number.MAX_SAFE_INTEGER` minor units | `assertPositive`, `parseAmount` | **Chosen** |

## Why each value, and not half of it

**1. Overdraft fee: AED 25.00 (`2500`).** Given by the brief. At half (12.50) the numbers in every test change, but nothing structural does. What matters is that it is stored as `2500`, not `25` or `25.0`. The fee is flat: an overdraft of AED 0.01 costs the same AED 25.00 as an overdraft of AED 10,000. That is why E7 is so expensive here: three flat fees on days that were negative by 370, 360 and 385.

**2. Interest: 0.04% per day, stored as `4 / 10_000`.** Given. Stored as an integer numerator and denominator so the calculation is `balance × 4 / 10000` in integers with one explicit rounding step. At half the rate (2 bps), every AED accrual in this scenario halves and some round to zero.

Two consequences worth knowing:
- 0.04% per day is about 14.6% a year (simple interest), which is high for a deposit rate. I kept it because it is given, but I would query it in real life.
- **The smallest balance that earns anything is AED 12.51 (or BHD 1.251).** AED 12.50 × 0.0004 = 0.005, exactly half a fil. Half-even rounds that to 0; half-up would round it to 1. Below that, a positive balance earns nothing.

**3–4. Precision: AED 2, BHD 3.** These are ISO 4217 minor units: 1 AED = 100 fils, 1 BHD = 1000 fils. Using fewer decimals would throw away real money: BHD with 2 decimals can't represent this scenario's 0.004 daily accrual at all. Using more would store precision the currency can't pay out. `parseAmount` rejects input with too many decimals (`"10.0001"` BHD throws) instead of silently rounding it.

**5. Window: 6 days.** Given. Interest is capitalized at the end of the last day. A shorter window would stop before E9, and the account would end negative.

**6. Approval threshold: `>= 0`, inclusive.** The brief says "at or above zero". A hold that takes available to exactly 0.00 is approved; one more fil is declined. The boundary is tested.

**7. Fee trigger: `< 0`, strict.** "Negative" means below zero; a closing balance of exactly 0.00 is not charged.

**8. Interest trigger: `> 0`.** "Positive balances only". A zero balance earns zero anyway, so `>=` would give the same result; `>` states the rule directly.

**9. Rounding: half-to-even (chosen).** Each daily accrual is rounded to the currency's precision. Half-even sends exact ties (0.5 fil) to the even neighbour, so rounding errors don't lean one way over many accruals. That's the usual banking convention. Half-up is the other defensible choice.
- **In this scenario the choice changes nothing.** The raw accruals are 10, 9, 25, 9.4, 8.4, 8.4 fils (AED) and 4, 4 fils (BHD), with no exact ties.
- Rounding happens per day, not once on the total. The brief requires the rounded daily accruals to sum to the capitalized amount, so each day must be rounded on its own.

**10. Instalment leftover goes to the first part (chosen).** BHD 10.000 in 3 parts is 3333.33… fils each, which is impossible. `splitEvenly` gives `base = 3333` to every part, then hands out the leftover fils one at a time from the front: `[3334, 3333, 3333]`. Any fixed rule is fine as long as it's deterministic and the parts sum exactly. "First" is the most common convention and easy to explain. Rounding every part up (criterion 7's 3.334 × 3) would create 0.002 BHD out of nothing.

**11. One fee per account per value day.** Given. The end-of-day run re-checks every earlier day, because a back-dated entry can make a closed day negative. `#hasFee` stops it from charging a second fee for the same day on a later run.

**12. Fee currencies: AED only (chosen).** The fee is defined as AED 25.00. For a non-AED account that goes negative, the ledger records a `NO_FEE_SCHEDULE` error and charges nothing, rather than inventing an exchange rate or a BHD fee. It never triggers in this scenario (ACC-002 only receives a credit).

**13. Hold expiry: none (chosen).** Real card holds expire after about 7–30 days. The window is 6 days and the brief says Auth-B "is never settled inside the window", implying it simply stays open. So an approved hold stays active until it is settled. Since Auth-B is declined, this doesn't affect the result.

**14. Largest amount: `Number.MAX_SAFE_INTEGER` (≈ 9 × 10^15 minor units).** That is about AED 90 trillion. Every amount is checked with `Number.isSafeInteger`, and `divideHalfEven` refuses unsafe inputs. The interest step multiplies by 4, so the practical ceiling for interest is a quarter of that. `bigint` would remove the ceiling but makes every call site noisier, which isn't worth it at this scale.
