import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ locale }) => {
  const resolvedLocale = locale || "en";

  try {
    return {
      locale: resolvedLocale,
      messages: (await import(`./messages/${resolvedLocale}.json`)).default,
    };
  } catch {
    return {
      locale: resolvedLocale,
      messages: (await import("./messages/en.json")).default,
    };
  }
});
