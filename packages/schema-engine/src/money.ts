// Trusted-write guard for money fields. PostgreSQL enforces the exact numeric
// type (and therefore magnitude overflow) plus the three-letter currency
// syntax; currency membership, fractional-digit exactness and two-sided
// nullability have no database predicate and must be enforced here.
const refuse = (reason: string): never => {
  throw Error("MONEY_REFUSED:" + reason);
};

export interface MoneyField {
  precision?: number;
  scale?: number;
  required?: boolean;
}
export interface MoneyValue {
  amount: string | null;
  currency: string | null;
}
export const MONEY_ENFORCEMENT = Object.freeze({
  exactType: "POSTGRES_TYPE",
  overflow: "POSTGRES_TYPE",
  scale: "APPLICATION",
  pairNullability: "APPLICATION",
  currencySyntax: "POSTGRES_CHECK",
  currencyMembership: "APPLICATION",
} as const);

// Active ISO-4217 alphabetic codes (funds, metals and testing codes included
// for completeness). Membership is a closed set; the SQL CHECK only proves the
// shape, so syntactic look-alikes such as "AAA"/"ZZZ" are refused here.
const ISO_4217 = new Set(("AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWL").split(" "));

function digits(value: string): number {
  return value.replace(/^0+(?=\d)/, "").length;
}

export function validateMoney(field: MoneyField, amount: unknown, currency: unknown): MoneyValue {
  const precision = field.precision ?? 19, scale = field.scale ?? 2, required = field.required ?? false;
  if (!Number.isInteger(precision) || precision < 1 || precision > 38 || !Number.isInteger(scale) || scale < 0 || scale > precision) return refuse("FIELD");
  const a = amount ?? null, c = currency ?? null;
  if ((a === null) !== (c === null)) return refuse("PAIR");
  if (a === null || c === null) {
    if (required) return refuse("PAIR");
    return { amount: null, currency: null };
  }
  if (typeof c !== "string" || !/^[A-Z]{3}$/.test(c) || !ISO_4217.has(c)) return refuse("CURRENCY");
  const text = typeof a === "bigint" ? a.toString() : typeof a === "string" ? a : refuse("AMOUNT");
  // Decimal grammar only: no exponent, separators, padding or signs beyond
  // a single leading minus. Fractional digits beyond `scale` would be rounded
  // by PostgreSQL, so they are refused rather than silently altered.
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) return refuse("AMOUNT");
  const [whole = "", fraction = ""] = text.replace(/^-/, "").split(".");
  if (fraction.length > scale) return refuse("SCALE");
  // numeric(p,p) permits only a zero integer part.
  if (digits(whole) > precision - scale && !(whole === "0" && precision - scale === 0)) return refuse("PRECISION");
  return { amount: text, currency: c };
}
