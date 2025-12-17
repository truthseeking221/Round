export function parseUsdtToUnits(input: string | number): bigint {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error("INVALID_AMOUNT");
  }
  const [intPart, fracPartRaw] = s.split(".");
  const fracPart = (fracPartRaw ?? "").slice(0, 6).padEnd(6, "0");
  const units = BigInt(intPart) * 1_000_000n + BigInt(fracPart || "0");
  if (units <= 0n) throw new Error("INVALID_AMOUNT");
  return units;
}

