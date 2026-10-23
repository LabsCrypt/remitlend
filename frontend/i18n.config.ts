import { getRequestConfig } from "next-intl/server";

const DEFAULT_LOCALE = "en";

export async function loadMessages(locale: string | undefined) {
  const target = locale || DEFAULT_LOCALE;
  try {
    return (await import(`./messages/${target}.json`)).default;
  } catch (error) {
    if (target !== DEFAULT_LOCALE) {
      console.warn(
        `[i18n] Failed to load messages for locale "${target}", falling back to "${DEFAULT_LOCALE}".`,
        error,
      );
      return (await import(`./messages/${DEFAULT_LOCALE}.json`)).default;
    }
    throw error;
  }
}

export default getRequestConfig(async ({ locale }) => {
  const resolved = locale || DEFAULT_LOCALE;
  const messages = await loadMessages(resolved);
  return {
    locale: resolved,
    messages,
  };
});
