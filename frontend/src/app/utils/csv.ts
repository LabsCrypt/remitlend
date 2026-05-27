export type CsvRow = Record<string, string | number | boolean | null | undefined>;

function escapeCsvValue(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: CsvRow[], headers?: string[]): string {
  if (rows.length === 0) {
    const headerLine = (headers ?? []).map((h) => escapeCsvValue(h)).join(",");
    return headerLine ? `${headerLine}\n` : "";
  }

  const keys = headers ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const lines = [
    keys.map((k) => escapeCsvValue(k)).join(","),
    ...rows.map((row) =>
      keys
        .map((k) => {
          const raw = row[k];
          const value = raw === null || raw === undefined ? "" : String(raw);
          return escapeCsvValue(value);
        })
        .join(","),
    ),
  ];

  return `${lines.join("\n")}\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
