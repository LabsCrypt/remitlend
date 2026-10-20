import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActivityPage from "./page";
import { useLoans, useRemittances } from "../../hooks/useApi";
import { useWalletStore } from "../../stores/useWalletStore";

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      title: "Activity",
      description: "Track all your loan applications, repayments, and remittances.",
      notConnected: "Wallet Not Connected",
      connectWalletToViewActivity: "Please connect your wallet to view your transaction history.",
      "emptyState.title": "No activity yet",
      "emptyState.description":
        "Your transaction history will appear here once you start using RemitLend.",
      "filters.all": "All Activity",
      "filters.loan": "Loans",
      "filters.remittance": "Remittances",
      "status.completed": "Completed",
      "status.repaid": "Repaid",
      "status.active": "Active",
      "status.pending": "Pending",
    };
    return translations[key] ?? key;
  },
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: jest.fn(),
  selectIsWalletConnected: (state: { status: string }) => state?.status === "connected",
}));

jest.mock("../../hooks/useApi", () => ({
  useLoans: jest.fn(),
  useRemittances: jest.fn(),
}));

const mockUseWalletStore = useWalletStore as unknown as jest.Mock;
const mockUseLoans = useLoans as unknown as jest.Mock;
const mockUseRemittances = useRemittances as unknown as jest.Mock;

describe("ActivityPage", () => {
  const refetchLoans = jest.fn();
  const refetchRemittances = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseWalletStore.mockReturnValue(true);

    mockUseLoans.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchLoans,
    });

    mockUseRemittances.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchRemittances,
    });
  });

  it("shows wallet not connected prompt when wallet is disconnected", () => {
    mockUseWalletStore.mockReturnValue(false);

    render(<ActivityPage />);

    expect(screen.getByText("Wallet Not Connected")).toBeInTheDocument();
    expect(
      screen.getByText("Please connect your wallet to view your transaction history."),
    ).toBeInTheDocument();
  });

  it("shows empty state when data loads successfully but has no activity", () => {
    render(<ActivityPage />);

    expect(screen.getByText("No activity yet")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-error-state")).not.toBeInTheDocument();
  });

  it("shows distinct error state with retry when useLoans fetch fails", async () => {
    const user = userEvent.setup();
    mockUseLoans.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error("Network timeout fetching loans"),
      refetch: refetchLoans,
    });

    render(<ActivityPage />);

    expect(screen.getByTestId("activity-error-state")).toBeInTheDocument();
    expect(screen.getByText("Failed to load activity")).toBeInTheDocument();
    expect(screen.getByText("Network timeout fetching loans")).toBeInTheDocument();
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: "Retry" });
    await user.click(retryBtn);

    expect(refetchLoans).toHaveBeenCalledTimes(1);
  });

  it("shows distinct error state with retry when useRemittances fetch fails", async () => {
    const user = userEvent.setup();
    mockUseRemittances.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error("Server error fetching remittances"),
      refetch: refetchRemittances,
    });

    render(<ActivityPage />);

    expect(screen.getByTestId("activity-error-state")).toBeInTheDocument();
    expect(screen.getByText("Failed to load activity")).toBeInTheDocument();
    expect(screen.getByText("Server error fetching remittances")).toBeInTheDocument();
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: "Retry" });
    await user.click(retryBtn);

    expect(refetchRemittances).toHaveBeenCalledTimes(1);
  });

  it("renders activities when data is loaded successfully", () => {
    mockUseLoans.mockReturnValue({
      data: [
        {
          id: 101,
          currency: "USDC",
          amount: 500,
          status: "active",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchLoans,
    });

    mockUseRemittances.mockReturnValue({
      data: [
        {
          id: 202,
          recipientAddress: "GDQP2KNTICK7DC5FT3GYA2T27SDBISFGFMQH",
          amount: 150,
          status: "completed",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchRemittances,
    });

    render(<ActivityPage />);

    expect(screen.getByText("Loan Active")).toBeInTheDocument();
    expect(screen.getByText("Remittance")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-error-state")).not.toBeInTheDocument();
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  });
});
