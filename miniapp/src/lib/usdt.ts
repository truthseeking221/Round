export function formatUsdt(units: bigint): string {
  const u = units < 0n ? -units : units;
  const intPart = u / 1_000_000n;
  const frac = (u % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const out = frac.length ? `${intPart}.${frac}` : `${intPart}`;
  return units < 0n ? `-${out}` : out;
}

export function parseUsdtToUnits(input: string): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("INVALID_AMOUNT");
  const [intPart, fracPartRaw] = s.split(".");
  const fracPart = (fracPartRaw ?? "").slice(0, 6).padEnd(6, "0");
  const units = BigInt(intPart) * 1_000_000n + BigInt(fracPart || "0");
  if (units <= 0n) throw new Error("INVALID_AMOUNT");
  return units;
}

