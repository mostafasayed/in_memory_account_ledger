import { describe, expect, test } from "bun:test";
import {
	ACCOUNTS,
	apply,
	type LedgerEvent,
	replay,
	SCENARIO,
} from "../src/events";
import { Ledger } from "../src/ledger";
import {
	divideHalfEven,
	formatAmount,
	parseAmount,
	splitEvenly,
} from "../src/money";

const aed = (text: string) => parseAmount(text, "AED");
const without = (...ids: string[]) =>
	SCENARIO.filter((e) => !ids.includes(e.id));
const feeDays = (ledger: Ledger, account: string) =>
	ledger.entries
		.filter((e) => e.kind === "FEE" && e.account === account)
		.map((e) => e.valueDate);

// Process events up to and including `lastId`, closing earlier days but NOT the last one,
// so tests can look at the ledger "before end-of-day fees run".
function openDayAfter(lastId: string) {
	const ledger = new Ledger(ACCOUNTS);
	let today = 1;
	for (const event of SCENARIO) {
		while (event.day > today) ledger.endOfDay(today++);
		apply(ledger, event, today);
		if (event.id === lastId) break;
	}
	return { ledger, today };
}

describe("replay output", () => {
	test("ACC-001 closing ledger per day, as known at the end of each day", () => {
		const { days } = replay();
		const closings = days.map(
			(d) => d.accounts.find((a) => a.account === "ACC-001")?.closing,
		);
		expect(closings.map((c) => formatAmount(c ?? 0, "AED"))).toEqual([
			"250.00",
			"250.00",
			"650.00",
			"285.00",
			"-410.00",
			"210.69", // 210.00 + 0.69 capitalized interest
		]);
	});

	test("E10 arrives after Day 5 closed and is flagged as a late arrival", () => {
		const { ledger } = replay();
		const late = ledger.errors.filter((e) => e.code === "LATE_ARRIVAL");
		expect(late.map((e) => [e.source, e.day])).toEqual([["E10", 6]]);
		expect(ledger.balance("ACC-002", 5)).toBe(parseAmount("10.000", "BHD"));
	});
});

describe("acceptance criteria", () => {
	test("#1 accepted: Day 2 closing, evaluated end of Day 5 before fees, is AED -370.00", () => {
		const { ledger, today } = openDayAfter("E8");
		expect(today).toBe(5);
		expect(feeDays(ledger, "ACC-001")).toEqual([]); // no fee has run yet
		expect(ledger.balance("ACC-001", 2)).toBe(aed("-370.00"));
	});

	test("#2 rejected: E7 causes three fees (Days 2, 4, 5), not one", () => {
		const withE7 = replay().ledger;
		const neverE7 = replay(without("E7", "E9")).ledger;
		expect(feeDays(withE7, "ACC-001")).toEqual([2, 4, 5]);
		expect(feeDays(neverE7, "ACC-001")).toEqual([]);
	});

	test("#3 accepted: Auth-A settles for 185.00 and its 200.00 hold is released", () => {
		const { ledger } = replay();
		expect(ledger.authState("Auth-A")).toMatchObject({
			status: "SETTLED",
			holdAmount: aed("200.00"),
			settledAmount: aed("185.00"),
		});
		expect(ledger.errors.filter((e) => e.source === "E5")).toEqual([]);
	});

	test("#4 rejected: Auth-Z settlement is force-posted and flagged, not refused", () => {
		const { ledger } = replay();
		const e6 = ledger.entries.filter((e) => e.source === "E6");
		expect(e6.map((e) => e.amount)).toEqual([aed("-180.00")]);
		expect(ledger.errors.find((e) => e.source === "E6")?.code).toBe(
			"SETTLEMENT_WITHOUT_AUTH",
		);
	});

	test("#5 premise false: Auth-B is declined because E7 landed first", () => {
		const { ledger } = replay();
		expect(ledger.authState("Auth-B")?.status).toBe("DECLINED");
		expect(ledger.activeHolds("ACC-001")).toBe(0);
	});

	test("#5 principle holds: an approved hold reduces available, not ledger", () => {
		const ledger = new Ledger({ X: "AED" });
		ledger.credit("C", "X", aed("100.00"), 1, 1);
		expect(ledger.authorize("A1", "H1", "X", aed("90.00"), 1)).toBe("APPROVED");
		expect(ledger.balance("X", 1)).toBe(aed("100.00"));
		expect(ledger.available("X", 1)).toBe(aed("10.00"));
	});

	test("#6 rejected: after E9 the fees and the Auth-B decline remain", () => {
		const reversed = replay().ledger;
		const neverE7 = replay(without("E7", "E9")).ledger;
		// Principal is back: E7 and its reversal net to zero...
		const e7Net = reversed.entries
			.filter((e) => e.source === "E7" || e.source === "E9")
			.reduce((sum, e) => sum + e.amount, 0);
		expect(e7Net).toBe(0);
		// ...but history is not undone.
		expect(feeDays(reversed, "ACC-001")).toHaveLength(3);
		expect(reversed.authState("Auth-B")?.status).toBe("DECLINED");
		expect(neverE7.authState("Auth-B")?.status).toBe("APPROVED");
		expect(reversed.balance("ACC-001", 6)).not.toBe(
			neverE7.balance("ACC-001", 6),
		);
	});

	test("#7 rejected: E10 instalments are 3.334 + 3.333 + 3.333 = 10.000", () => {
		const { ledger } = replay();
		const parts = ledger.entries
			.filter((e) => e.source === "E10")
			.map((e) => formatAmount(e.amount, "BHD"));
		expect(parts).toEqual(["3.334", "3.333", "3.333"]);
		expect(3 * 3334).not.toBe(10_000); // 3 x 3.334 would mint 0.002 BHD
	});

	test("#8 rejected: capitalized interest is exactly the sum of rounded accruals", () => {
		const { ledger, interest } = replay();
		for (const { account, accruals, capitalized } of interest) {
			expect(capitalized).toBe(accruals.reduce((s, a) => s + a, 0));
			const posted = ledger.entries.filter(
				(e) => e.account === account && e.kind === "INTEREST",
			);
			expect(posted.map((e) => e.amount)).toEqual([capitalized]);
		}
		expect(interest.map((i) => i.capitalized)).toEqual([69, 8]); // AED 0.69, BHD 0.008
	});
});

describe("ledger invariants", () => {
	test("entries are frozen and the exposed log is a copy", () => {
		const { ledger } = replay();
		const first = ledger.entries[0] as { amount: number };
		expect(() => {
			first.amount = 0;
		}).toThrow();
		const before = ledger.entries.length;
		(ledger.entries as unknown[]).push({});
		expect(ledger.entries).toHaveLength(before);
	});

	test("approval boundary: available may land exactly on zero, not below", () => {
		const ledger = new Ledger({ X: "AED" });
		ledger.credit("C", "X", aed("50.00"), 1, 1);
		expect(ledger.authorize("A1", "H1", "X", aed("50.00"), 1)).toBe("APPROVED");
		expect(ledger.authorize("A2", "H2", "X", aed("0.01"), 1)).toBe("DECLINED");
	});

	// AMBIGUITIES B3: the rule allows a fee alone to trigger the next day's fee.
	test("fee spiral: a fee can make the next day negative on its own", () => {
		const ledger = new Ledger({ X: "AED" });
		ledger.debit("D1", "X", aed("1.00"), 1, 1);
		ledger.endOfDay(1); // Day 1: -1.00 -> fee -> -26.00
		ledger.credit("C2", "X", aed("20.00"), 2, 2);
		ledger.endOfDay(2); // Day 2: -26.00 + 20.00 = -6.00 -> fee -> -31.00
		expect(feeDays(ledger, "X")).toEqual([1, 2]);
		expect(ledger.balance("X", 2)).toBe(aed("-31.00"));
		// Without Day 1's fee, Day 2 would have closed at +19.00 and never been charged.
		expect(ledger.balance("X", 2) + 2 * 2500).toBe(aed("19.00"));
	});

	test("a settlement above its hold is posted but flagged", () => {
		const ledger = new Ledger({ X: "AED" });
		ledger.credit("C", "X", aed("100.00"), 1, 1);
		ledger.authorize("A1", "H1", "X", aed("50.00"), 1);
		ledger.authorize("A2", "H2", "X", aed("20.00"), 1);
		ledger.settle("S1", "H1", "X", aed("50.00"), 1, 1); // exactly the hold: fine
		ledger.settle("S2", "H2", "X", aed("25.00"), 1, 1); // 5.00 over: flagged
		expect(ledger.errors.map((e) => [e.code, e.source])).toEqual([
			["SETTLEMENT_EXCEEDS_HOLD", "S2"],
		]);
		expect(ledger.balance("X", 1)).toBe(aed("25.00")); // both still posted
		expect(ledger.authState("H2")?.status).toBe("SETTLED");
	});

	test("a reversal can't be applied twice or to an unknown event", () => {
		const ledger = new Ledger({ X: "AED" });
		ledger.debit("D1", "X", aed("10.00"), 1, 1);
		ledger.reverse("R1", "D1", 1, 1);
		ledger.reverse("R2", "D1", 1, 1);
		ledger.reverse("R3", "NOPE", 1, 1);
		expect(ledger.errors.map((e) => e.code)).toEqual([
			"ALREADY_REVERSED",
			"REVERSAL_TARGET_NOT_FOUND",
		]);
		expect(ledger.balance("X", 1)).toBe(0);
	});

	test("a negative BHD account is flagged, not charged an AED fee", () => {
		const ledger = new Ledger({ Y: "BHD" });
		ledger.debit("D1", "Y", parseAmount("1.000", "BHD"), 1, 1);
		expect(ledger.endOfDay(1)).toEqual([]);
		ledger.endOfDay(2); // re-checks Day 1 but must not flag it twice
		expect(ledger.errors.map((e) => [e.code, e.day])).toEqual([
			["NO_FEE_SCHEDULE", 1],
			["NO_FEE_SCHEDULE", 2],
		]);
	});

	test("a settlement against a declined authorization is still posted and flagged", () => {
		const events: LedgerEvent[] = [
			{
				id: "A",
				day: 1,
				type: "AUTHORIZATION",
				account: "ACC-001",
				authId: "H",
				amount: "5.00",
				valueDate: 1,
			},
			{
				id: "S",
				day: 1,
				type: "SETTLEMENT",
				account: "ACC-001",
				authId: "H",
				amount: "5.00",
				valueDate: 1,
			},
		];
		const { ledger } = replay(events);
		expect(ledger.authState("H")?.status).toBe("DECLINED");
		expect(ledger.errors.map((e) => e.code)).toContain(
			"SETTLEMENT_WITHOUT_AUTH",
		);
	});
});

describe("money", () => {
	test("parses and formats at each currency's precision", () => {
		expect(aed("1,200.00")).toBe(120_000);
		expect(parseAmount("24.012", "BHD")).toBe(24_012);
		expect(formatAmount(-37_000, "AED")).toBe("-370.00");
		expect(formatAmount(5, "BHD")).toBe("0.005");
		expect(() => parseAmount("10.0001", "BHD")).toThrow();
		expect(() => parseAmount("1.234", "AED")).toThrow();
	});

	test("half-even rounding sends ties to the even neighbour", () => {
		expect([5, 15, 25, 35, -15].map((n) => divideHalfEven(n, 10))).toEqual([
			0, 2, 2, 4, -2,
		]);
		expect(divideHalfEven(94, 10)).toBe(9); // 235.00 x 0.04% = 0.094 -> 0.09
	});

	test("splitting never creates or loses a minor unit", () => {
		for (const [total, parts] of [
			[10_000, 3],
			[1, 3],
			[100, 7],
		] as const) {
			const split = splitEvenly(total, parts);
			expect(split.reduce((s, p) => s + p, 0)).toBe(total);
			expect(Math.max(...split) - Math.min(...split)).toBeLessThanOrEqual(1);
		}
	});
});
