import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoanRepaymentForm } from "./LoanRepaymentForm";
import { useGamificationStore } from "../../stores/useGamificationStore";

const mockAddXP = jest.fn();
const mockUnlockAchievement = jest.fn();

jest.mock("../../stores/useGamificationStore", () => ({
  useGamificationStore: () => ({
    addXP: mockAddXP,
    unlockAchievement: mockUnlockAchievement,
  }),
}));

let mockExecuteSuccess = true;
let mockOnSuccessCallback: (() => void) | undefined;

jest.mock("../../hooks/useRepaymentOperation", () => ({
  useRepaymentOperation: ({ onSuccess }: { onSuccess?: () => void }) => {
    mockOnSuccessCallback = onSuccess;
    return {
      execute: jest.fn(async () => {
        if (mockExecuteSuccess) {
          onSuccess?.();
        }
      }),
      isProcessing: false,
      progress: 0,
      step: "",
      statusText: "",
      error: null,
      txHash: null,
      reset: jest.fn(),
    };
  },
}));

jest.mock("../../hooks/useTransactionPreview", () => ({
  useTransactionPreview: () => ({
    isOpen: false,
    previewData: null,
    openPreview: jest.fn(),
    closePreview: jest.fn(),
    confirmPreview: jest.fn(),
  }),
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: (selector: any) => selector({ address: "GBORROWER123" }),
  selectWalletAddress: (state: any) => state.address,
}));

describe("LoanRepaymentForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("grants streak XP and achievement when repayment is on-time", async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    render(<LoanRepaymentForm loanId={1} totalOwed={500} dueDate={futureDate} isPastDue={false} />);

    mockOnSuccessCallback?.();

    expect(mockAddXP).toHaveBeenCalledWith(50, "Loan repayment");
    expect(mockUnlockAchievement).toHaveBeenCalledWith("first_repayment");

    jest.advanceTimersByTime(1000);

    expect(mockAddXP).toHaveBeenCalledWith(100, "On-time repayment streak");
    expect(mockUnlockAchievement).toHaveBeenCalledWith("streak_master");
  });

  it("does not grant streak XP or achievement when repayment is late / past-due", async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    render(<LoanRepaymentForm loanId={1} totalOwed={500} dueDate={pastDate} isPastDue={true} />);

    mockOnSuccessCallback?.();

    expect(mockAddXP).toHaveBeenCalledWith(50, "Loan repayment");
    expect(mockUnlockAchievement).toHaveBeenCalledWith("first_repayment");

    jest.advanceTimersByTime(1000);

    expect(mockAddXP).not.toHaveBeenCalledWith(100, "On-time repayment streak");
    expect(mockUnlockAchievement).not.toHaveBeenCalledWith("streak_master");
  });
});

