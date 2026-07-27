export type LeadGetResponse = {
  submitted: boolean;
};

export type LeadPostResponse = {
  leadId: string;
  wasCreated: boolean;
};

export function buildLeadGetResponse(submitted: boolean): LeadGetResponse {
  return { submitted };
}

export function buildLeadPostResponse(leadId: string, wasCreated: boolean): LeadPostResponse {
  return { leadId, wasCreated };
}

export const LEAD_GET_RESPONSE_KEYS = ["submitted"] as const;
export const LEAD_POST_RESPONSE_KEYS = ["leadId", "wasCreated"] as const;

export function assertExactResponseKeys(
  body: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const keys = Object.keys(body).sort();
  const expected = [...allowedKeys].sort();

  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`Unexpected response keys: ${keys.join(", ")}`);
  }
}
