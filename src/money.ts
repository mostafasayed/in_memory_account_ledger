// Money is always an integer count of minor units (fils) plus its currency.
// Floats never touch an amount: 0.1 + 0.2 !== 0.3, but 10 + 20 === 30.

export type Currency = "AED" | "BHD";

// ISO 4217 minor units.
export const DECIMALS: Record<Currency, number> = { AED: 2, BHD: 3 };

// "1,200.00" -> 120000 (AED). Parsed as text so no float rounding can creep in.
export function parseAmount(text: string, currency: Currency): number {
	const decimals = DECIMALS[currency];
	const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.replaceAll(",", ""));
	if (!match) throw new Error(`Not an amount: "${text}"`);
	const [, sign, whole = "", fraction = ""] = match;
	if (fraction.length > decimals) {
		throw new Error(`${currency} allows ${decimals} decimals, got "${text}"`);
	}
	const minor = Number(whole + fraction.padEnd(decimals, "0"));
	if (!Number.isSafeInteger(minor))
		throw new Error(`Amount too large: "${text}"`);
	return sign === "-" ? -minor : minor;
}

// 120000 (AED) -> "1200.00"; -37000 -> "-370.00"
export function formatAmount(minor: number, currency: Currency): string {
	const decimals = DECIMALS[currency];
	const digits = Math.abs(minor)
		.toString()
		.padStart(decimals + 1, "0");
	const whole = digits.slice(0, -decimals);
	const fraction = digits.slice(-decimals);
	return `${minor < 0 ? "-" : ""}${whole}.${fraction}`;
}

// Integer division rounded half-to-even (banker's rounding).
// Ties go to the even neighbour so rounding errors don't drift one way over many accruals.
export function divideHalfEven(numerator: number, denominator: number): number {
	if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
		throw new Error("divideHalfEven needs safe integers");
	}
	const quotient = Math.floor(numerator / denominator);
	const twiceRemainder = 2 * (numerator - quotient * denominator);
	if (twiceRemainder > denominator) return quotient + 1;
	if (twiceRemainder < denominator) return quotient;
	return quotient % 2 === 0 ? quotient : quotient + 1;
}

// Split a total into n parts that sum exactly to the total.
// The leftover minor units go one each to the first parts: 10000 / 3 -> [3334, 3333, 3333].
export function splitEvenly(total: number, parts: number): number[] {
	const base = Math.floor(total / parts);
	const leftover = total - base * parts;
	return Array.from({ length: parts }, (_, i) => base + (i < leftover ? 1 : 0));
}
