import { type Currency, divideHalfEven, splitEvenly } from "./money";

export const WINDOW_DAYS = 6;
export const OVERDRAFT_FEE = { amount: 2500, currency: "AED" as Currency }; // AED 25.00
export const INTEREST_BPS_PER_DAY = 4; // 0.04% per day = 4 / 10_000
const BPS = 10_000;

export type EntryKind =
	| "CREDIT"
	| "DEBIT"
	| "SETTLEMENT"
	| "REVERSAL"
	| "FEE"
	| "INTEREST";

// One immutable ledger line. `amount` is signed minor units: + credit, - debit.
export interface Entry {
	readonly id: string;
	readonly account: string;
	readonly kind: EntryKind;
	readonly amount: number;
	readonly valueDate: number; // the day the money counts for
	readonly bookedDay: number; // the day the ledger learned about it
	readonly source: string; // event that caused it: "E7", "EOD-D5", ...
	readonly ref?: string; // authorization id, or the entry id being reversed
}

export type AuthStatus = "APPROVED" | "DECLINED" | "SETTLED";

// Authorization history is append-only too: a settlement appends a SETTLED record,
// it never edits the APPROVED one. The latest record per authId is its current state.
export interface AuthRecord {
	readonly authId: string;
	readonly account: string;
	readonly holdAmount: number;
	readonly status: AuthStatus;
	readonly day: number;
	readonly settledAmount?: number;
}

export interface LedgerError {
	readonly day: number;
	readonly source: string;
	readonly code: string;
	readonly message: string;
}

export interface InterestResult {
	readonly account: string;
	readonly accruals: readonly number[]; // rounded accrual per day, index 0 = Day 1
	readonly capitalized: number; // always exactly the sum of `accruals`
}

export class Ledger {
	readonly #accounts: ReadonlyMap<string, Currency>;
	readonly #entries: Entry[] = [];
	readonly #auths: AuthRecord[] = [];
	readonly #errors: LedgerError[] = [];
	#interestCapitalized = false;

	constructor(accounts: Record<string, Currency>) {
		this.#accounts = new Map(Object.entries(accounts));
	}

	// Copies, so callers can't push into or splice the logs. Records themselves are frozen.
	get entries(): readonly Entry[] {
		return [...this.#entries];
	}
	get authorizations(): readonly AuthRecord[] {
		return [...this.#auths];
	}
	get errors(): readonly LedgerError[] {
		return [...this.#errors];
	}
	get accounts(): readonly [string, Currency][] {
		return [...this.#accounts];
	}

	currencyOf(account: string): Currency {
		const currency = this.#accounts.get(account);
		if (!currency) throw new Error(`Unknown account ${account}`);
		return currency;
	}

	// Closing ledger balance for `valueDay`: every entry with valueDate <= valueDay.
	// `knownBy` answers "what did the ledger say, using only entries booked by that day?".
	balance(
		account: string,
		valueDay: number,
		knownBy = Number.POSITIVE_INFINITY,
	) {
		let total = 0;
		for (const e of this.#entries) {
			if (e.account !== account) continue;
			if (e.valueDate > valueDay || e.bookedDay > knownBy) continue;
			total += e.amount;
		}
		return total;
	}

	authState(authId: string): AuthRecord | undefined {
		return this.#auths.findLast((a) => a.authId === authId);
	}

	activeHolds(account: string): number {
		const latest = new Map(this.#auths.map((a) => [a.authId, a]));
		let total = 0;
		for (const a of latest.values()) {
			if (a.account === account && a.status === "APPROVED")
				total += a.holdAmount;
		}
		return total;
	}

	available(account: string, day: number): number {
		return this.balance(account, day) - this.activeHolds(account);
	}

	credit(
		source: string,
		account: string,
		amount: number,
		valueDate: number,
		day: number,
	) {
		assertPositive(amount);
		return this.#post(account, "CREDIT", amount, valueDate, day, source);
	}

	// One credit booked as n entries that sum exactly to `total`.
	creditInInstalments(
		source: string,
		account: string,
		total: number,
		instalments: number,
		valueDate: number,
		day: number,
	) {
		return splitEvenly(total, instalments).map((part) =>
			this.credit(source, account, part, valueDate, day),
		);
	}

	// Posted debits are not gated by available balance: the money has already gone.
	// That's exactly what the overdraft fee exists for.
	debit(
		source: string,
		account: string,
		amount: number,
		valueDate: number,
		day: number,
	) {
		assertPositive(amount);
		return this.#post(account, "DEBIT", -amount, valueDate, day, source);
	}

	// Approve only if ledger - active holds - this hold stays >= 0.
	// Decided on what the ledger knows *today*; never re-decided when back-dated entries arrive.
	authorize(
		source: string,
		authId: string,
		account: string,
		amount: number,
		day: number,
	): AuthStatus {
		assertPositive(amount);
		this.currencyOf(account);
		if (this.authState(authId)) {
			this.recordError(
				day,
				source,
				"DUPLICATE_AUTH",
				`${authId} already exists; ignored`,
			);
			return "DECLINED";
		}
		const status =
			this.available(account, day) - amount >= 0 ? "APPROVED" : "DECLINED";
		this.#auths.push(
			Object.freeze({ authId, account, holdAmount: amount, status, day }),
		);
		return status;
	}

	// A settlement is money that has already cleared through the card scheme, so it is
	// always posted. Without a matching active hold it is a force-post, flagged for review.
	settle(
		source: string,
		authId: string,
		account: string,
		amount: number,
		valueDate: number,
		day: number,
	) {
		assertPositive(amount);
		const auth = this.authState(authId);
		const entry = this.#post(
			account,
			"SETTLEMENT",
			-amount,
			valueDate,
			day,
			source,
			authId,
		);
		if (auth?.status === "APPROVED" && auth.account === account) {
			this.#auths.push(
				Object.freeze({
					...auth,
					status: "SETTLED",
					day,
					settledAmount: amount,
				}),
			);
		} else {
			this.recordError(
				day,
				source,
				"SETTLEMENT_WITHOUT_AUTH",
				`${authId} has no active authorization on ${account}; force-posted, needs chargeback review`,
			);
		}
		return entry;
	}

	// Undo an event by appending the opposite of each of its entries. Nothing is deleted.
	reverse(
		source: string,
		targetSource: string,
		valueDate: number,
		day: number,
	) {
		const targets = this.#entries.filter(
			(e) => e.source === targetSource && e.kind !== "REVERSAL",
		);
		if (targets.length === 0) {
			this.recordError(
				day,
				source,
				"REVERSAL_TARGET_NOT_FOUND",
				`${targetSource} has no entries`,
			);
			return [];
		}
		const reversed = new Set(
			this.#entries.filter((e) => e.kind === "REVERSAL").map((e) => e.ref),
		);
		if (targets.some((t) => reversed.has(t.id))) {
			this.recordError(
				day,
				source,
				"ALREADY_REVERSED",
				`${targetSource} was already reversed`,
			);
			return [];
		}
		return targets.map((t) =>
			this.#post(
				t.account,
				"REVERSAL",
				-t.amount,
				valueDate,
				day,
				source,
				t.id,
			),
		);
	}

	// End-of-day fee run. Re-checks every day up to `day`, because a back-dated entry can
	// make an earlier day negative after the fact. At most one fee per account per value day.
	// Days are walked in order so a fee on day d counts toward day d+1.
	endOfDay(day: number): Entry[] {
		const fees: Entry[] = [];
		for (const [account, currency] of this.#accounts) {
			// Refund a fee whose day is no longer negative without it (e.g. after a back-dated
			// reversal). Appends a REVERSAL pointing at the fee; the fee itself is never deleted.
			for (let d = 1; d <= day; d++) {
				const fee = this.#entries.find(
					(e) =>
						e.kind === "FEE" &&
						e.account === account &&
						e.valueDate === d &&
						!this.#entries.some((r) => r.ref === e.id),
				);
				if (!fee) continue;
				if (this.balance(account, d) - fee.amount < 0) continue;
				this.#post(
					account,
					"REVERSAL",
					-fee.amount,
					d,
					day,
					`EOD-D${day}`,
					fee.id,
				);
			}

			for (let d = 1; d <= day; d++) {
				if (this.balance(account, d) >= 0 || this.#hasFee(account, d)) continue;
				if (currency !== OVERDRAFT_FEE.currency) {
					this.#recordErrorOnce(
						day,
						`EOD-D${day}`,
						"NO_FEE_SCHEDULE",
						`${account} negative on Day ${d} but no ${currency} fee is defined; not charged`,
					);
					continue;
				}
				fees.push(
					this.#post(
						account,
						"FEE",
						-OVERDRAFT_FEE.amount,
						d,
						day,
						`EOD-D${day}`,
					),
				);
			}
		}
		return fees;
	}

	// Accrue 0.04% of each positive daily closing balance, round each day to the currency's
	// precision, and capitalize the sum as one credit. By construction the capitalized amount
	// IS the sum of the rounded accruals, so there is never a remainder to discard.
	// Uses the final value-dated balances (everything booked so far), not what each day looked like.
	capitalizeInterest(day: number): InterestResult[] {
		if (this.#interestCapitalized)
			throw new Error("Interest already capitalized");
		this.#interestCapitalized = true;
		return [...this.#accounts.keys()].map((account) => {
			const accruals = Array.from({ length: WINDOW_DAYS }, (_, i) => {
				const closing = this.balance(account, i + 1);
				return closing > 0
					? divideHalfEven(closing * INTEREST_BPS_PER_DAY, BPS)
					: 0;
			});
			const capitalized = accruals.reduce((sum, a) => sum + a, 0);
			if (capitalized > 0)
				this.#post(
					account,
					"INTEREST",
					capitalized,
					WINDOW_DAYS,
					day,
					"INTEREST",
				);
			return { account, accruals, capitalized };
		});
	}

	recordError(day: number, source: string, code: string, message: string) {
		this.#errors.push(Object.freeze({ day, source, code, message }));
	}

	#recordErrorOnce(day: number, source: string, code: string, message: string) {
		if (this.#errors.some((e) => e.code === code && e.message === message))
			return;
		this.recordError(day, source, code, message);
	}

	#hasFee(account: string, valueDate: number) {
		return this.#entries.some(
			(e) =>
				e.kind === "FEE" && e.account === account && e.valueDate === valueDate,
		);
	}

	#post(
		account: string,
		kind: EntryKind,
		amount: number,
		valueDate: number,
		bookedDay: number,
		source: string,
		ref?: string,
	): Entry {
		this.currencyOf(account);
		const id = `L${String(this.#entries.length + 1).padStart(3, "0")}`;
		const entry: Entry = Object.freeze({
			id,
			account,
			kind,
			amount,
			valueDate,
			bookedDay,
			source,
			...(ref ? { ref } : {}),
		});
		this.#entries.push(entry);
		return entry;
	}
}

function assertPositive(amount: number) {
	if (!Number.isSafeInteger(amount) || amount <= 0) {
		throw new Error(
			`Amount must be a positive integer of minor units, got ${amount}`,
		);
	}
}
