import { Buffer } from "buffer";

// @ton/core relies on `Buffer` being available in the browser global scope.
const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;

