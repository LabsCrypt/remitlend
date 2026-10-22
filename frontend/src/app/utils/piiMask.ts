export type PiiFieldType = "email" | "phone" | "name";

// Split on Unicode code points rather than UTF-16 code units so emoji and other
// astral characters are never cut into lone surrogate halves.
const toChars = (value: string): string[] => Array.from(value);

/**
 * Masks a recipient PII value for display. Never throws: empty, nullish and
 * non-string input, or an unknown field type, returns "***".
 */
export function maskRecipient(value: string, field: PiiFieldType): string {
  if (!value || typeof value !== "string") return "***";

  if (field === "email") {
    const atIndex = value.indexOf("@");
    if (atIndex === -1) return "***";
    const local = value.slice(0, atIndex);
    const domain = value.slice(atIndex + 1);
    const maskedLocal = local.length > 0 ? toChars(local)[0] + "***" : "***";
    const domainParts = domain.split(".");
    const maskedDomain =
      domainParts.length > 1
        ? (toChars(domainParts[0] ?? "")[0] ?? "*") + "***." + domainParts.slice(1).join(".")
        : "***";
    return `${maskedLocal}@${maskedDomain}`;
  }

  if (field === "phone") {
    const chars = toChars(value);
    if (chars.length <= 4) return "****";
    return "+xx...****" + chars.slice(-2).join("");
  }

  if (field === "name") {
    const chars = toChars(value);
    if (chars.length <= 1) return "*";
    return chars[0] + "***" + chars[chars.length - 1];
  }

  return "***";
}

/**
 * Masks a wallet address as its first 6 and last 4 characters. Addresses of 10
 * characters or fewer (where that would reveal every character), empty and
 * non-string input return "***".
 */
export function maskAddress(address: string): string {
  if (!address || typeof address !== "string") return "***";
  const chars = toChars(address);
  if (chars.length <= 10) return "***";
  return chars.slice(0, 6).join("") + "..." + chars.slice(-4).join("");
}
