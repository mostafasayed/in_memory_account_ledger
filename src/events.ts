import {
	type AuthRecord,
	type Entry,
	type InterestResult,
	Ledger,
	type LedgerError,
	WINDOW_DAYS,
} from "./ledger";
import { type Currency, parseAmount } from "./money";

interface BaseEvent {
	id: string;
	day: number; // booked day as listed in the brief
	account: string;
	valueDate: number;
}

export type LedgerEvent =
	| (BaseEvent & { type: "CREDIT"; amount: string; instalments?: number })
	| (BaseEvent & { type: "DEBIT"; amount: string })
	| (BaseEvent & { type: "AUTHORIZATION"; authId: string; amount: string })
	| (BaseEvent & { type: "SETTLEMENT"; authId: string; amount: string })
	| (BaseEvent & { type: "REVERSAL"; reverses: string });

export const ACCOUNTS: Record<string, Currency> = {
	"ACC-001": "AED",
	"ACC-002": "BHD",
};

// The brief's event stream, in the brief's order. Note E10 (Day 5) comes after E9 (Day 6).
// biome-ignore format: one event per line mirrors the brief's table
export const SCENARIO: readonly LedgerEvent[] = [
	{ id: "E1", day: 1, type: "CREDIT", account: "ACC-001", amount: "1,200.00", valueDate: 1 },
	{ id: "E2", day: 1, type: "DEBIT", account: "ACC-001", amount: "950.00", valueDate: 1 },
	{ id: "E3", day: 2, type: "AUTHORIZATION", account: "ACC-001", authId: "Auth-A", amount: "200.00", valueDate: 2 },
	{ id: "E4", day: 3, type: "CREDIT", account: "ACC-001", amount: "400.00", valueDate: 3 },
	{ id: "E5", day: 4, type: "SETTLEMENT", account: "ACC-001", authId: "Auth-A", amount: "185.00", valueDate: 4 },
	{ id: "E6", day: 4, type: "SETTLEMENT", account: "ACC-001", authId: "Auth-Z", amount: "180.00", valueDate: 4 },
	{ id: "E7", day: 5, type: "DEBIT", account: "ACC-001", amount: "620.00", valueDate: 2 },
	{ id: "E8", day: 5, type: "AUTHORIZATION", account: "ACC-001", authId: "Auth-B", amount: "90.00", valueDate: 5 },
	{ id: "E9", day: 6, type: "REVERSAL", account: "ACC-001", reverses: "E7", valueDate: 2 },
	{ id: "E10", day: 5, type: "CREDIT", account: "ACC-002", amount: "10.000", instalments: 3, valueDate: 5 },
];

export interface AccountDay {
	account: string;
	currency: Currency;
	closing: number; // closing ledger balance for this day, as known at end of this day
	available: number;
	feesAssessed: Entry[]; // fees booked at this end-of-day (their value dates may be earlier)
	auths: AuthRecord[]; // current state of every authorization on the account
}

export interface DayReport {
	day: number;
	events: string[];
	accounts: AccountDay[];
	errors: LedgerError[];
}

export interface ReplayResult {
	ledger: Ledger;
	days: DayReport[];
	interest: InterestResult[];
}

// Feed events to the ledger in list order. The processing clock only moves forward:
// when an event for a later day arrives, the days before it are closed (fees run).
// An event listed for a day that is already closed is booked today, keeping its value date.
export function replay(
	events: readonly LedgerEvent[] = SCENARIO,
): ReplayResult {
	const ledger = new Ledger(ACCOUNTS);
	const days: DayReport[] = [];
	let interest: InterestResult[] = [];
	let today = 1;
	let processed: string[] = [];

	const closeDay = () => {
		const fees = ledger.endOfDay(today);
		if (today === WINDOW_DAYS) interest = ledger.capitalizeInterest(today);
		days.push(snapshot(ledger, today, processed, fees));
		processed = [];
		today++;
	};

	for (const event of events) {
		while (event.day > today) closeDay();
		if (event.day < today) {
			ledger.recordError(
				today,
				event.id,
				"LATE_ARRIVAL",
				`${event.id} listed for Day ${event.day} arrived after Day ${event.day} closed; booked Day ${today}, value date Day ${event.valueDate}`,
			);
		}
		apply(ledger, event, today);
		processed.push(event.id);
	}
	while (today <= WINDOW_DAYS) closeDay();

	return { ledger, days, interest };
}

export function apply(ledger: Ledger, event: LedgerEvent, today: number) {
	const { id, account, valueDate } = event;
	const currency = ledger.currencyOf(account);
	switch (event.type) {
		case "CREDIT": {
			const amount = parseAmount(event.amount, currency);
			if (event.instalments) {
				ledger.creditInInstalments(
					id,
					account,
					amount,
					event.instalments,
					valueDate,
					today,
				);
			} else {
				ledger.credit(id, account, amount, valueDate, today);
			}
			return;
		}
		case "DEBIT":
			ledger.debit(
				id,
				account,
				parseAmount(event.amount, currency),
				valueDate,
				today,
			);
			return;
		case "AUTHORIZATION":
			ledger.authorize(
				id,
				event.authId,
				account,
				parseAmount(event.amount, currency),
				today,
			);
			return;
		case "SETTLEMENT":
			ledger.settle(
				id,
				event.authId,
				account,
				parseAmount(event.amount, currency),
				valueDate,
				today,
			);
			return;
		case "REVERSAL":
			ledger.reverse(id, event.reverses, valueDate, today);
			return;
	}
}

function snapshot(
	ledger: Ledger,
	day: number,
	events: string[],
	fees: Entry[],
): DayReport {
	const accounts = ledger.accounts.map(([account, currency]) => {
		const latest = new Map(
			ledger.authorizations
				.filter((a) => a.account === account)
				.map((a) => [a.authId, a]),
		);
		return {
			account,
			currency,
			closing: ledger.balance(account, day),
			available: ledger.available(account, day),
			feesAssessed: fees.filter((f) => f.account === account),
			auths: [...latest.values()],
		};
	});
	const errors = ledger.errors.filter((e) => e.day === day);
	return { day, events, accounts, errors };
}
