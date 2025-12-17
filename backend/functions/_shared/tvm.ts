import { Address, Cell } from "npm:@ton/core@0.60.0";

export type TvmStackRecord = {
  type: "cell" | "num" | "nan" | "null" | "tuple" | "slice";
  num?: string;
  cell?: string;
  slice?: string;
  tuple?: TvmStackRecord[];
};

export function parseTvmNum(value: string): bigint {
  const v = value.trim();
  if (v.startsWith("0x") || v.startsWith("0X")) {
    if (v === "0x" || v === "0X") return 0n;
    return BigInt(v);
  }
  return BigInt(v);
}

export function unwrapTuple(stack: unknown[]): TvmStackRecord[] {
  const s = stack as TvmStackRecord[];
  if (!Array.isArray(s)) return [];
  if (s.length === 1 && s[0]?.type === "tuple" && Array.isArray(s[0].tuple)) {
    return s[0].tuple!;
  }
  return s;
}

export function readNumAt(tuple: TvmStackRecord[], idx: number): bigint {
  const r = tuple[idx];
  if (!r || r.type !== "num" || typeof r.num !== "string") throw new Error("TVM_NUM_MISSING");
  return parseTvmNum(r.num);
}

export function readAddressFromStackRecord(record: TvmStackRecord): Address {
  const boc = record.type === "slice" ? record.slice : record.cell;
  if (!boc || typeof boc !== "string") throw new Error("TVM_ADDR_MISSING");
  const cell = Cell.fromBase64(boc);
  return cell.beginParse().loadAddress();
}

export function readOptionalAddressFromStackRecord(record: TvmStackRecord | undefined): Address | null {
  if (!record) return null;
  if (record.type === "null") return null;
  return readAddressFromStackRecord(record);
}
