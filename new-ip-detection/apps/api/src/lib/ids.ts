// Prefixed-UUID generator (Decision 6). The suffix is a 12-char base32 random,
// which is short enough for log readability and large enough (60 bits) to
// avoid collisions at MVP scale.

import { randomBytes } from "node:crypto";
import { ID_PREFIXES, type IdKind } from "@ipd/contracts";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function encode(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

export function newId(kind: IdKind, length = 12): string {
  return `${ID_PREFIXES[kind]}_${encode(randomBytes(length))}`;
}

export function newApiToken(): string {
  return `ipd_${encode(randomBytes(32))}`;
}
