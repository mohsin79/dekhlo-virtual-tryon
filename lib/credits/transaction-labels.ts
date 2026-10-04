const CREDIT_TRANSACTION_LABELS: Record<string, string> = {
  grant: "Grant",
  reserve: "Reserved for try-on",
  consume: "Used by try-on",
  release: "Released after try-on",
  admin_grant: "Added by Dekhlo",
  admin_revoke: "Removed by Dekhlo",
};

/** Merchant-facing ledger label. Unknown types stay generic so internal names are not shown. */
export function formatCreditTransactionType(type: string): string {
  return CREDIT_TRANSACTION_LABELS[type] ?? "Credit update";
}
