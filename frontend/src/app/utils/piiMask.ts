export type PiiFieldType = "email" | "phone" | "name";

export function maskRecipient(value: string, field: PiiFieldType): string {
  if (!value) return "***";

  if (field === "email") {
    const atIndex = value.indexOf("@");
    if (atIndex === -1) return "***";
    const local = value.slice(0, atIndex);
    const domain = value.slice(atIndex + 1);
    const maskedLocal = local.length > 0 ? local[0] + "***" : "***";
    const domainParts = domain.split(".");
    const maskedDomain =
      domainParts.length > 1
        ? (domainParts[0]?.[0] ?? "*") + "***." + domainParts.slice(1).join(".")
        : "***";
    return `${maskedLocal}@${maskedDomain}`;
  }

  if (field === "phone") {
    if (value.length <= 4) return "****";
    return "+xx...****" + value.slice(-2);
  }

  if (field === "name") {
    if (value.length <= 1) return "*";
    return value[0] + "***" + (value.length > 1 ? value.slice(-1) : "");
  }

  return "***";
}

export function maskAddress(address: string): string {
  if (!address || address.length < 10) return "***";
  return address.slice(0, 6) + "..." + address.slice(-4);
}
