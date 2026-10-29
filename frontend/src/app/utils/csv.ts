export type CsvRow = Record<string, string | number | boolean | null | undefined>;

// A cell that starts with one of these characters is treated as a formula (or a
// DDE command) by spreadsheet applications, so exported data must be prefixed.
const FORMULA_TRIGGER = /^[-+=@\t\r]/;

// A leading sign in front of a plain decimal is an amount, not a formula: keep
// `-12.5` numeric instead of turning it into the text `'-12.5`.
const SIGNED_NUMBER = /^[+-](\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

const neutralizeFormula = (value: string): string =>
  FORMULA_TRIGGER.test(value) && !SIGNED_NUMBER.test(value) ? `'${value}` : value;

function escapeCsvValue(value: string): string {
  const escaped = neutralizeFormula(value);
  if (
    escaped.includes('"') ||
    escaped.includes(",") ||
    escaped.includes("\n") ||
    escaped.includes("\r")
  ) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
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

  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    // Detach the anchor and release the object URL even when the browser
    // refuses the click, so a failed export leaks neither DOM nodes nor blob
    // memory. `remove()` is a no-op when the append itself failed.
    link.remove();
    URL.revokeObjectURL(url);
  }
}
