import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./page";

const mockReplace = jest.fn();

jest.mock("next-intl", () => ({
  useLocale: () => "en",
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/en/settings",
}));

jest.mock("../../lib/session", () => ({
  logoutUser: jest.fn(),
}));

jest.mock("../../hooks/useLogout", () => ({
  useLogout: () => ({ logout: jest.fn() }),
}));

jest.mock("../../stores/useUserStore", () => ({
  useUserStore: jest.fn((selector) =>
    selector({
      user: { id: "user1", email: "test@example.com" },
    }),
  ),
  selectUser: (state: { user: { id: string; email: string } }) => state.user,
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: jest.fn((selector) =>
    selector({
      address: null,
      network: "testnet",
      disconnect: jest.fn(),
    }),
  ),
  selectWalletAddress: (state: { address: string | null }) => state.address,
  selectWalletNetwork: (state: { network: string }) => state.network,
}));

jest.mock("../../stores/useThemeStore", () => ({
  useThemeStore: jest.fn((selector) =>
    selector
      ? selector({
          theme: "system",
          hydrated: true,
          initializeTheme: jest.fn(),
          setTheme: jest.fn(),
        })
      : {
          theme: "system",
          hydrated: true,
          initializeTheme: jest.fn(),
          setTheme: jest.fn(),
        },
  ),
}));

jest.mock("../../hooks/useApi", () => ({
  useNotificationPreferences: () => ({ data: undefined, isLoading: false, error: null }),
  useUpdateNotificationPreferences: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("../../components/gamification/GamificationSettings", () => ({
  GamificationSettings: () => <div>Gamification Settings</div>,
}));

describe("SettingsPage section navigation", () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it("exposes the default active section via aria-selected", () => {
    render(<SettingsPage />);

    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Wallet" })).toHaveAttribute("aria-selected", "false");
  });

  it("updates accessible state and focus when switching sections", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    const walletTab = screen.getByRole("tab", { name: "Wallet" });
    await user.click(walletTab);

    expect(walletTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "false");
    expect(document.activeElement).toBe(walletTab);
  });

  it("links each tab to its panel with aria-controls and tabpanel semantics", () => {
    render(<SettingsPage />);

    const profileTab = screen.getByRole("tab", { name: "Profile" });
    const panelId = profileTab.getAttribute("aria-controls");

    expect(panelId).toBe("settings-panel-profile");

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", panelId);
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-profile");
  });

  it("renders supported locales (en, es, tl) in DisplaySection and navigates via router.replace on change", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    const displayTab = screen.getByRole("tab", { name: "Display" });
    await user.click(displayTab);

    const languageSelect = screen.getByLabelText("Language") as HTMLSelectElement;
    expect(languageSelect.value).toBe("en");

    const optionValues = Array.from(languageSelect.options).map((o) => o.value);
    expect(optionValues).toEqual(["en", "es", "tl"]);

    expect(screen.queryByText(/Only English is fully translated/i)).not.toBeInTheDocument();

    await user.selectOptions(languageSelect, "es");
    expect(mockReplace).toHaveBeenCalledWith("/es/settings");
  });
});
