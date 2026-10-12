const currencyDigitsCache = new Map<string, number>();

export function currencyFractionDigits(currency: string): number {
  const code = normalizeCurrency(currency);
  const cached = currencyDigitsCache.get(code);
  if (cached !== undefined) return cached;
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  currencyDigitsCache.set(code, digits);
  return digits;
}

export function parseMinorUnits(input: string, currency: string): string | null {
  let digits: number;
  try { digits = currencyFractionDigits(currency); } catch { return null; }
  const match = input.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[3] ?? "";
  if (fraction.length > digits) return null;
  const scale = BigInt(10) ** BigInt(digits);
  const wholeMinor = BigInt(match[2]) * scale;
  const fractionMinor = fraction ? BigInt(fraction.padEnd(digits, "0")) : BigInt(0);
  const amount = wholeMinor + fractionMinor;
  return (match[1] === "-" ? -amount : amount).toString();
}

export function formatMinorUnits(value: string | bigint, currency: string, locale?: string): string {
  const code = normalizeCurrency(currency);
  const digits = currencyFractionDigits(code);
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const negative = amount < BigInt(0);
  const absolute = negative ? -amount : amount;
  const scale = BigInt(10) ** BigInt(digits);
  const whole = digits ? absolute / scale : absolute;
  const fraction = digits ? (absolute % scale).toString().padStart(digits, "0") : "";
  const wholeForFormat = negative && whole === BigInt(0) ? BigInt(-1) : negative ? -whole : whole;
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency", currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  const wholeFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const wholeParts = wholeFormatter.formatToParts(whole);
  let integerPosition = 0;
  return formatter.formatToParts(wholeForFormat).map((part) => {
    if (part.type === "integer") return wholeParts.filter(({ type }) => type === "integer")[integerPosition++]?.value ?? part.value;
    if (part.type === "group") return wholeParts.filter(({ type }) => type === "group")[integerPosition - 1]?.value ?? part.value;
    if (part.type === "fraction") return fraction;
    return part.value;
  }).join("");
}

export function minorUnitsInput(value: string, currency: string): string {
  const digits = currencyFractionDigits(currency);
  const amount = BigInt(value);
  const negative = amount < BigInt(0);
  const absolute = negative ? -amount : amount;
  if (digits === 0) return `${negative ? "-" : ""}${absolute}`;
  const scale = BigInt(10) ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function convertMinorUnits(
  amountMinor: string | bigint,
  fromCurrency: string,
  toCurrency: string,
  rate: string,
): string {
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  const amount = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  if (from === to) return amount.toString();
  const match = rate.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("Exchange rate must be a positive decimal value");
  const rateFraction = match[2] ?? "";
  const rateNumerator = BigInt(match[1] + rateFraction);
  if (rateNumerator <= BigInt(0)) throw new Error("Exchange rate must be greater than zero");
  const rateDenominator = BigInt(10) ** BigInt(rateFraction.length);
  const fromScale = BigInt(10) ** BigInt(currencyFractionDigits(from));
  const toScale = BigInt(10) ** BigInt(currencyFractionDigits(to));
  const negative = amount < BigInt(0);
  const numerator = (negative ? -amount : amount) * rateNumerator * toScale;
  const denominator = fromScale * rateDenominator;
  const rounded = (numerator + denominator / BigInt(2)) / denominator;
  return (negative ? -rounded : rounded).toString();
}

export function multiplyMinorUnitsByQuantity(unitMinor: string | bigint, quantity: string): string {
  const match = quantity.trim().match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!match) throw new Error("Quantity must be a non-negative decimal with at most eight places");
  const fraction = match[2] ?? "";
  const quantityScale = BigInt(10) ** BigInt(fraction.length);
  const quantityNumerator = BigInt(match[1]) * quantityScale + (fraction ? BigInt(fraction) : BigInt(0));
  const numerator = BigInt(unitMinor) * quantityNumerator;
  return ((numerator + quantityScale / BigInt(2)) / quantityScale).toString();
}

function normalizeCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Currency must be a three-letter ISO code");
  return code;
}
