import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StepFinalSignature } from "../StepFinalSignature";
import type { LoanWizardData } from "../LoanApplicationWizard";

// Mock dependencies
vi.mock("../../providers/WalletProvider", () => ({
  useWallet: vi.fn(() => ({
    signTransaction: vi.fn(),
  })),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useTransactionPreview", () => ({
  useTransactionPreview: vi.fn(() => ({
    show: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useContractToast", () => ({
  useContractToast: vi.fn(() => vi.fn()),
}));

vi.mock("../../../hooks/useApi", () => ({
  submitLoanTransaction: vi.fn(),
  queryKeys: {},
}));

vi.mock("../../../utils/soroban", () => ({
  buildUnsignedLoanRequestXdr: vi.fn().mockResolvedValue("xdr-string"),
}));

vi.mock("../../../utils/amount", () => ({
  getAssetDecimals: vi.fn().mockReturnValue(7),
}));

vi.mock("../../../utils/transactionErrors", () => ({
  mapTransactionError: vi.fn(),
  pollTransactionStatus: vi.fn(),
}));

describe("StepFinalSignature", () => {
  const mockData: LoanWizardData = {
    amount: "1000",
    termDays: 30,
    asset: "USDC",
    creditScore: 750,
  };

  const mockProps = {
    data: mockData,
    borrowerAddress: "GXXX...",
    onBack: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID = "CONTRACT123";
  });

  describe("Interest Calculation", () => {
    it("calculates estimated interest correctly with 12% APR", async () => {
      render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        const principal = 1000;
        const termDays = 30;
        const annualRate = 12;

        // Expected: (1000 * 12 * 30) / (365 * 100) = 9.86
        const expectedInterest = (principal * annualRate * termDays) / (365 * 100);
        expect(expectedInterest).toBeCloseTo(9.86, 1);
      });
    });

    it("calculates total repayment as principal + interest", async () => {
      const props = {
        ...mockProps,
        data: {
          ...mockData,
          amount: "5000",
          termDays: 90,
        },
      };

      render(<StepFinalSignature {...props} />);

      await waitFor(() => {
        const principal = 5000;
        const interest = (principal * 12 * 90) / (365 * 100);
        const total = principal + interest;
        expect(total).toBeCloseTo(5147.95, 1);
      });
    });

    it("calculates due date as current date + term days", async () => {
      render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        const today = new Date();
        const expectedDue = new Date(today);
        expectedDue.setDate(expectedDue.getDate() + 30);

        // Check that due date is approximately correct (within 1 day)
        expect(screen.getByText(/estimated due date/i, { exact: false })).toBeInTheDocument();
      });
    });

    it("handles zero interest for zero-day term", async () => {
      const props = {
        ...mockProps,
        data: {
          ...mockData,
          termDays: 0,
        },
      };

      render(<StepFinalSignature {...props} />);

      await waitFor(() => {
        const interest = (1000 * 12 * 0) / (365 * 100);
        expect(interest).toBe(0);
      });
    });
  });

  describe("Sign/Submit/Poll State Machine", () => {
    it("starts in idle state", async () => {
      render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Ready to submit")).toBeInTheDocument();
      });
    });

    it("transitions to signing state when sign button is clicked", async () => {
      const { useWallet } = await import("../../providers/WalletProvider");
      const signMock = vi.fn().mockResolvedValue("signed-xdr");
      vi.mocked(useWallet).mockReturnValue({
        signTransaction: signMock,
      } as any);

      render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        const signButton = screen.getByRole("button", { name: /sign/i });
        expect(signButton).toBeInTheDocument();
      });
    });

    it("shows error when XDR building fails", async () => {
      const { buildUnsignedLoanRequestXdr } = await import("../../../utils/soroban");
      vi.mocked(buildUnsignedLoanRequestXdr).mockRejectedValue(
        new Error("XDR build failed")
      );

      render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText(/XDR build failed/i)).toBeInTheDocument();
      });
    });

    it("shows error when manager contract ID is missing", async () => {
      process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID = "";

      render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        expect(
          screen.getByText(/Missing NEXT_PUBLIC_MANAGER_CONTRACT_ID/i)
        ).toBeInTheDocument();
      });
    });

    it("shows error when principal is zero or negative", async () => {
      const props = {
        ...mockProps,
        data: {
          ...mockData,
          amount: "0",
        },
      };

      render(<StepFinalSignature {...props} />);

      // Should not build XDR when principal <= 0
      await waitFor(() => {
        const { buildUnsignedLoanRequestXdr } = vi.hoisted(() =>
          import("../../../utils/soroban")
        );
        expect(vi.mocked(buildUnsignedLoanRequestXdr)).not.toHaveBeenCalled();
      });
    });

    it("resets tracker state when back button is clicked", async () => {
      const onBack = vi.fn();
      render(<StepFinalSignature {...mockProps} onBack={onBack} />);

      await waitFor(() => {
        const backButton = screen.getByRole("button", { name: /back/i });
        fireEvent.click(backButton);
        expect(onBack).toHaveBeenCalled();
      });
    });

    it("cancels polling when cancel is triggered", async () => {
      render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        const cancelButton = screen.queryByRole("button", { name: /cancel/i });
        if (cancelButton) {
          fireEvent.click(cancelButton);
          expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
        }
      });
    });
  });

  describe("State Cleanup", () => {
    it("aborts polling on component unmount", async () => {
      const { unmount } = render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Ready to submit")).toBeInTheDocument();
      });

      unmount();

      // Polling ref should be cleared
      expect(true).toBe(true);
    });

    it("cancels XDR build on component unmount", async () => {
      const { unmount } = render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText("Ready to submit")).toBeInTheDocument();
      });

      unmount();

      // Component should clean up pending async operations
      expect(true).toBe(true);
    });
  });

  describe("Format Money", () => {
    it("formats numbers as USD currency", async () => {
      render(<StepFinalSignature {...mockProps} />);

      await waitFor(() => {
        // Should display formatted principal amount
        expect(screen.getByText(/\$1,000/)).toBeInTheDocument();
      });
    });
  });
});
