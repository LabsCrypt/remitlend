import en from "./messages/en.json";
import es from "./messages/es.json";
import i18nConfig from "./i18n.config";

jest.mock("next-intl/server", () => ({
  getRequestConfig: (configFn: unknown) => configFn,
}));

type RequestConfigFunction = (args: { locale?: string }) => Promise<{
  locale: string;
  messages: typeof en;
}>;

const requestConfig = i18nConfig as unknown as RequestConfigFunction;

describe("i18n.config", () => {
  it("loads messages for a supported locale", async () => {
    const config = await requestConfig({ locale: "es" });

    expect(config.locale).toBe("es");
    expect(config.messages).toEqual(es);
  });

  it("falls back to English messages when the requested locale file cannot be loaded", async () => {
    const config = await requestConfig({ locale: "xx" });

    expect(config.locale).toBe("xx");
    expect(config.messages).toEqual(en);
  });
});
