import { fireEvent, render, screen } from "@testing-library/react";
import { LanguageSwitcher } from "./LanguageSwitcher";

const mockReplace = jest.fn();
let mockLocale = "en";
let mockPathname = "/en/dashboard";

jest.mock("next-intl", () => ({ useLocale: () => mockLocale }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockPathname,
}));

describe("LanguageSwitcher locale persistence (#2134)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocale = "en";
    mockPathname = "/en/dashboard";
  });

  function selectLanguage(value: string) {
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value },
    });
  }

  it("preserves nested routes and dynamic segments when switching locale", () => {
    mockPathname = "/en/loans/loan-42/repay";
    render(<LanguageSwitcher />);
    selectLanguage("es");
    expect(mockReplace).toHaveBeenCalledWith("/es/loans/loan-42/repay");
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("preserves the root locale route", () => {
    mockPathname = "/en";
    render(<LanguageSwitcher />);
    selectLanguage("tl");
    expect(mockReplace).toHaveBeenCalledWith("/tl");
  });

  it("does not navigate when the current language is selected", () => {
    render(<LanguageSwitcher />);
    selectLanguage("en");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not navigate for unsupported locales", () => {
    render(<LanguageSwitcher />);
    const select = screen.getByRole("combobox", { name: "Language" }) as HTMLSelectElement;
    const unsupported = document.createElement("option");
    unsupported.value = "xx";
    unsupported.textContent = "Unsupported";
    select.appendChild(unsupported);
    selectLanguage("xx");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(select.value).toBe("en");
  });

  it("rejects a pathname without a supported locale prefix", () => {
    mockPathname = "/private/dashboard";
    render(<LanguageSwitcher />);
    selectLanguage("es");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("en");
  });

  it("restores the selection if navigation throws", () => {
    mockReplace.mockImplementation(() => { throw new Error("Navigation failed"); });
    render(<LanguageSwitcher />);
    expect(() => selectLanguage("es")).not.toThrow();
    expect(mockReplace).toHaveBeenCalledWith("/es/dashboard");
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("en");
  });

  it("reflects the active locale after navigation updates the provider", () => {
    const { rerender } = render(<LanguageSwitcher />);
    mockLocale = "es";
    mockPathname = "/es/dashboard";
    rerender(<LanguageSwitcher />);
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("es");
  });
});
