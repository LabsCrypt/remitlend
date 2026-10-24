import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ActivityPage from "./page";
import { useWalletStore } from "@/app/stores";
import { useLoans, useRemittances } from "../../hooks/useApi";

const replace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const messages: Record<string, string> = {
      title: "Activity",
      description: "Your transaction history",
      errorTitle: "Error loading activity",
      loansError: "Failed to load loans. Please retry.",
      remittancesError: "Failed to load remittances. Please retry.",
      retry: "Retry",
      "emptyState.title": "No activity yet",
      "emptyState.description":
        "Your transaction history will appear here once you start using RemitLend.",
      "filters.all": "All Activity",
      "filters.loan": "Loans",
      "filters.remittance": "Remittances",
      notConnected: "Connect Wallet",
      connectWalletToViewActivity: "Connect your wallet to view activity",
    };
    return (key: string) => messages[key] ?? key;
  },
}));

jest.mock("../../hooks/useApi", () => {
  const actual = jest.requireActual("../../hooks/useApi");
  return {
    ...actual,
    useLoans: jest.fn(),
    useRemittances: jest.fn(),
  };
});

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ActivityPage />
    </QueryClientProvider>,
  );
};

describe("ActivityPage", () => {
  beforeEach(() => {
    replace.mockClear();
    useWalletStore.setState({
      status: "disconnected",
      address: null,
      error: null,
    });
  });

  it("renders activity list when data is available and wallet connected", () => {
    useWalletStore.setState({
      status: "connected",
      address: "GREMITLENDACTIVITYTEST",
    });

    // Mock the hooks to return data
    jest.mocked(useLoans).mockReturnValue({
      data: [
        {
          id: "1",
          status: "active",
          currency: "USD",
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useLoans>);
    jest.mocked(useRemittances).mockReturnValue({
      data: [
        {
          id: "1",
          status: "completed",
          amount: 100,
          fromCurrency: "USD",
          toCurrency: "EUR",
          recipientAddress: "0x123...4567",
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useRemittances>);

    renderPage();

    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
  });

  it("shows error state when loans fetch fails", async () => {
    useWalletStore.setState({
      status: "connected",
      address: "GREMITLENDACTIVITYTEST",
    });

    jest.mocked(useLoans).mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useLoans>);
    jest.mocked(useRemittances).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useRemittances>);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Error loading activity")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to load loans. Please retry.")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("shows error state when remittances fetch fails", async () => {
    useWalletStore.setState({
      status: "connected",
      address: "GREMITLENDACTIVITYTEST",
    });

    jest.mocked(useLoans).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useLoans>);
    jest.mocked(useRemittances).mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useRemittances>);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Error loading activity")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to load remittances. Please retry.")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  it("renders empty state when no activity and no errors", () => {
    useWalletStore.setState({
      status: "connected",
      address: "GREMITLENDACTIVITYTEST",
    });

    jest.mocked(useLoans).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useLoans>);
    jest.mocked(useRemittances).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useRemittances>);

    renderPage();

    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
});
