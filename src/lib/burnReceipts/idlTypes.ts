/** The subset of the Anchor 1.x IDL (spec 0.1.0) the burn_receipts client reads. */

export type IdlType =
  | "bool" | "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "u64" | "i64" | "u128" | "i128" | "pubkey" | "string" | "bytes"
  | { vec: IdlType }
  | { array: [IdlType, number] }
  | { option: IdlType }
  | { defined: { name: string } };

export interface IdlField { name: string; docs?: string[]; type: IdlType }

export interface IdlTypeDef {
  name: string;
  docs?: string[];
  type: { kind: "struct"; fields: IdlField[] } | { kind: "enum"; variants: { name: string }[] };
}

export interface IdlInstructionAccount {
  name: string;
  docs?: string[];
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: unknown;
  relations?: string[];
}

export interface IdlInstruction {
  name: string;
  docs?: string[];
  discriminator: number[];
  accounts: IdlInstructionAccount[];
  args: IdlField[];
  returns?: IdlType;
}

export interface AnchorIdl {
  address: string;
  metadata: { name: string; version: string; spec: string; description?: string };
  instructions: IdlInstruction[];
  accounts: { name: string; discriminator: number[] }[];
  events: { name: string; discriminator: number[] }[];
  errors: { code: number; name: string; msg?: string }[];
  types: IdlTypeDef[];
}
