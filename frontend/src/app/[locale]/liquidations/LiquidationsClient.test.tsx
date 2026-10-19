import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LiquidationsClient from "./LiquidationsClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockSignTransaction = jest.fn().mockResolvedValue("signed-xdr-123");
const mockBuildLiquidateLoanTransaction = jest.fn().mockResolvedValue({
  unsignedTxXdr: "unsigned-xdr-123",
  networkPassphrase: "Test SDF Network ; September 2015",
});
const mockSubmitLoanTransaction = jest.fn().mockResolvedValue({ txHash: "0xabc123" });

jest.mock("../../hooks/useApi", () => ({
  useLiquidatableLoans: () => ({
    isLoading: false,
    isError: false,
    data: [
      {
        loanId: 42,
        borrower: "GBORROWER123",
        principal: 1000,
        collateralValue: 800,
        healthFactor: 0.8,
      },
    ],
  }),
  buildLiquidateLoanTransaction: (...args: any[]) => mockBuildLiquidateLoanTransaction(...args),
  submitLoanTransaction: (...args: any[]) => mockSubmitLoanTransaction(...args),
  queryKeys: {
    loans: {
      liquidatable: () => ["loans", "liquidatable"],
    },
  },
}));

jest.mock("../../components/providers/WalletProvider", () => ({
  useWallet: () => ({
    signTransaction: mockSignTransaction,
  }),
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: (selector: any) => selector({ address: "GLIQUIDATOR123" }),
  selectWalletAddress: (state: any) => state.address,
}));

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("LiquidationsClient", () => {
  it("passes networkPassphrase to signTransaction when liquidating a loan", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <LiquidationsClient />
      </QueryClientProvider>,
    );

    const liquidateButton = screen.getByRole("button", { name: /liquidate/i });
    fireEvent.click(liquidateButton);

    await waitFor(() => {
      expect(mockBuildLiquidateLoanTransaction).toHaveBeenCalledWith({
        loanId: 42,
        liquidatorPublicKey: "GLIQUIDATOR123",
      });
      expect(mockSignTransaction).toHaveBeenCalledWith("unsigned-xdr-123", {
        networkPassphrase: "Test SDF Network ; September 2015",
      });
      expect(mockSubmitLoanTransaction).toHaveBeenCalledWith("signed-xdr-123");
    });
  });
});
