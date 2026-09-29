// ─────────────────────────────────────────────────────────────────────────────
// KNOWN FAILURE — this test is red on purpose. It is the one test written
// against our own design (see README "Running the suite").
// ─────────────────────────────────────────────────────────────────────────────
import { expect, test } from "bun:test";
import { replay, SCENARIO } from "../src/events";
import type { Ledger } from "../src/ledger";

// What a customer (or an auditor) would reasonably expect:
//   "My account should end up the same whether the bank booked E7 on time or
//    three days late. Only WHICH transactions happened, and WHEN THEY COUNT
//    (value date), should matter — not when the bank got round to booking them."
const summary = (ledger: Ledger) => ({
	closingDay6: ledger.balance("ACC-001", 6),
	feesCharged: ledger.entries.filter((e) => e.kind === "FEE").length,
	authB: ledger.authState("Auth-B")?.status,
});

test("the final ledger does not depend on when late entries arrived (FAILS)", () => {
	const asArrived = replay(SCENARIO);

	// The same ten events, but every one arrives on its value date: E7 and its reversal
	// E9 both land on Day 2 and cancel out before Day 2 closes; E10 lands on Day 5.
	const onTime = replay(
		SCENARIO.map((e) => ({ ...e, day: e.valueDate })).sort(
			(a, b) => a.day - b.day,
		),
	);

	// Actual result:
	//   as arrived: { closingDay6: 21069, feesCharged: 3, authB: "DECLINED" }
	//   on time   : { closingDay6: 28579, feesCharged: 0, authB: "APPROVED" }
	//
	// What it reveals:
	// 1. Our ledger is path-dependent. Balances are restated by value date, but
	//    DECISIONS (fee assessments, authorization approvals) are made on what was
	//    known at the time and are never re-decided. That is deliberate (append-only;
	//    you cannot un-decline a card at a till), but it means the same set of
	//    transactions can produce two different customer outcomes.
	// 2. The customer pays AED 75.00 in fees and gets a declined card purely because
	//    the bank booked E7 three days late and then reversed it. Every one of those
	//    fees belongs to a day whose restated balance (after E9) is not negative.
	// 3. The gap leaks into interest too: 0.69 vs 0.79, because the kept fees lower
	//    the restated balances that interest is computed on.
	// 4. Nothing in the design notices this. There is no rule that says "a fee whose
	//    day is no longer negative after a back-dated correction is refunded".
	//    Fix path: at end of day, for each FEE whose value day now closes >= 0 without
	//    it, append a FEE_REVERSAL entry (never delete the fee). That would close
	//    the fee gap (2) and interest gap (3), but NOT the Auth-B decline (1) —
	//    that one is irreducible, so this test could never fully pass.
	expect(summary(asArrived.ledger)).toEqual(summary(onTime.ledger));
});
