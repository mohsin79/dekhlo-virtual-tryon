export function buildLeadMailtoLink(email: string): string {
  const trimmed = email.trim();

  if (!trimmed) {
    return "";
  }

  return `mailto:${encodeURIComponent(trimmed)}`;
}

export function buildLeadTelLink(phone: string | null): string | null {
  if (!phone?.trim()) {
    return null;
  }

  const digits = phone.replace(/[^\d+]/g, "");

  if (!digits) {
    return null;
  }

  return `tel:${digits}`;
}
