const defaultDateOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

export function formatDate(
  iso: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = defaultDateOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(iso));
}
