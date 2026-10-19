// Signed loanbook entries. Whoever runs the loanbook cannot change a party's words: each
// entry is signed with that party's Base key, and referees verify before acting.
import { verifyMessage, keccak256, toHex, type Address, type Hex } from "viem";

export type Fields = Record<string, string | number>;

/// Canonical text: fixed header, then the fields sorted by name, one per line. Loan
/// entries name their loan; a desk's published terms name the desk ("desk=<owner>").
export function message(kind: string, loanId: Hex, fields: Fields, idLabel = "loan"): string {
  const lines = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`);
  return [`Hypothec ${kind}`, `${idLabel}=${loanId}`, ...lines].join("\n");
}

export function digest(kind: string, loanId: Hex, fields: Fields): Hex {
  return keccak256(toHex(message(kind, loanId, fields)));
}

export function verify(signer: Address, kind: string, loanId: Hex, fields: Fields, signature: Hex, idLabel = "loan"): Promise<boolean> {
  return verifyMessage({ address: signer, message: message(kind, loanId, fields, idLabel), signature });
}
