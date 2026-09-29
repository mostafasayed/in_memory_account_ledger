// Replays the brief's event stream and prints, per day: closing ledger balance,
// fee assessments, authorization states and errors. Then a restated end-of-window view.
import { replay } from "./events";
import { WINDOW_DAYS } from "./ledger";
import { formatAmount } from "./money";

const { ledger, days, interest } = replay();

for (const report of days) {
	console.log(
		`\n=== Day ${report.day} ===  events: ${report.events.join(", ") || "none"}`,
	);
	for (const a of report.accounts) {
		const money = (minor: number) =>
			`${a.currency} ${formatAmount(minor, a.currency)}`;
		const fees = a.feesAssessed.map(
			(f) => `${money(-f.amount)} (value Day ${f.valueDate})`,
		);
		const auths = a.auths.map((x) =>
			x.status === "SETTLED"
				? `${x.authId} SETTLED ${money(x.settledAmount ?? 0)} (hold ${money(x.holdAmount)} released)`
				: `${x.authId} ${x.status} hold ${money(x.holdAmount)}`,
		);
		console.log(`  ${a.account}`);
		console.log(`    closing ledger : ${money(a.closing)}`);
		console.log(`    available      : ${money(a.available)}`);
		console.log(`    fees assessed  : ${fees.join("; ") || "none"}`);
		console.log(`    authorizations : ${auths.join("; ") || "none"}`);
	}
	console.log(`  errors: ${report.errors.length ? "" : "none"}`);
	for (const e of report.errors)
		console.log(`    [${e.code}] ${e.source}: ${e.message}`);
}

console.log(
	"\n=== Restated view at end of window (all entries known, by value date) ===",
);
for (const { account, accruals, capitalized } of interest) {
	const currency = ledger.currencyOf(account);
	const fmt = (minor: number) => formatAmount(minor, currency);
	console.log(`  ${account} (${currency})`);
	console.log("    day | closing ledger | interest accrual");
	for (let d = 1; d <= WINDOW_DAYS; d++) {
		const closing = ledger.balance(account, d);
		console.log(
			`    ${d}   | ${fmt(closing).padStart(14)} | ${fmt(accruals[d - 1] ?? 0).padStart(8)}`,
		);
	}
	console.log(
		`    interest capitalized on Day ${WINDOW_DAYS}: ${currency} ${fmt(capitalized)} (= sum of daily accruals)`,
	);
	const fees = ledger.entries.filter(
		(e) => e.account === account && e.kind === "FEE",
	);
	console.log(
		`    fees charged in window: ${fees.length} (${currency} ${fmt(-fees.reduce((s, f) => s + f.amount, 0))})`,
	);
}
