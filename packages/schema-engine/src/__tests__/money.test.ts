import { describe, expect, it } from "vitest";
import { MONEY_ENFORCEMENT, validateMoney } from "..";

const field = { precision: 19, scale: 2, required: true };

describe("money trusted-write guard", () => {
  it("accepts an exact amount and an active ISO-4217 currency", () => {
    expect(validateMoney(field, "1234.50", "EUR")).toEqual({ amount: "1234.50", currency: "EUR" });
    expect(validateMoney(field, "-0.01", "USD")).toEqual({ amount: "-0.01", currency: "USD" });
    expect(validateMoney(field, 7n, "JPY")).toEqual({ amount: "7", currency: "JPY" });
    expect(validateMoney({ ...field, required: false }, null, null)).toEqual({ amount: null, currency: null });
  });

  it("refuses one-sided nullability instead of storing an orphan amount or currency", () => {
    for (const required of [true, false]) {
      expect(() => validateMoney({ ...field, required }, "1.00", null)).toThrow("MONEY_REFUSED:PAIR");
      expect(() => validateMoney({ ...field, required }, null, "EUR")).toThrow("MONEY_REFUSED:PAIR");
      expect(() => validateMoney({ ...field, required }, undefined, "EUR")).toThrow("MONEY_REFUSED:PAIR");
    }
    expect(() => validateMoney(field, null, null)).toThrow("MONEY_REFUSED:PAIR");
  });

  it("refuses inexact, unbounded or unrepresentable amounts instead of rounding", () => {
    for (const amount of ["1.234", "1e3", " 1.00", "01.00", "1,00", "NaN", "Infinity", "", 1.5, Number.NaN, true, {}]) {
      expect(() => validateMoney(field, amount, "EUR"), String(amount)).toThrow(/MONEY_REFUSED:(SCALE|AMOUNT)/);
    }
    // precision 19 scale 2 leaves 17 integer digits.
    expect(validateMoney(field, "99999999999999999.99", "EUR").amount).toBe("99999999999999999.99");
    expect(() => validateMoney(field, "100000000000000000.00", "EUR")).toThrow("MONEY_REFUSED:PRECISION");
  });

  it("requires ISO-4217 membership rather than any three uppercase letters", () => {
    for (const currency of ["AAA", "ZZZ", "usd", "EU", "EURO", "", "XQZ"] as const) {
      expect(() => validateMoney(field, "1.00", currency), currency).toThrow("MONEY_REFUSED:CURRENCY");
    }
    expect(validateMoney(field, "1.00", "CHF").currency).toBe("CHF");
  });

  it("distinguishes PostgreSQL-enforced exactness from application-only guarantees", () => {
    expect(MONEY_ENFORCEMENT).toEqual({
      exactType: "POSTGRES_TYPE",
      overflow: "POSTGRES_TYPE",
      scale: "APPLICATION",
      pairNullability: "APPLICATION",
      currencySyntax: "POSTGRES_CHECK",
      currencyMembership: "APPLICATION",
    });
  });
});
