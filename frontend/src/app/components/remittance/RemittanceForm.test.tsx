import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemittanceForm } from "../remittance/RemittanceForm";

// Mock the dependencies
jest.mock("../../hooks/useApi", () => ({
  useCreateRemittance: jest.fn(() => ({
    mutateAsync: jest.fn(),
    isPending: false,
  })),
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: jest.fn((selector) => selector({ address: "GTEST123" })),
  selectWalletAddress: (state: Record<string, unknown>) => state.address,
}));

jest.mock("../../hooks/useTransactionPreview", () => ({
  useTransactionPreview: jest.fn(() => ({
    isOpen: false,
    show: jest.fn(),
    hide: jest.fn(),
    data: {},
    onConfirm: jest.fn(),
  })),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

describe("RemittanceForm", () => {
  const mockOnSuccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render the form", () => {
    render(<RemittanceForm onSuccess={mockOnSuccess} />);
    expect(screen.getByText("Send Remittance")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("G... (Stellar public key)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
  });

  it("should show error when recipient address is empty", async () => {
    render(<RemittanceForm onSuccess={mockOnSuccess} />);
    const reviewButton = screen.getByText("Review & Send");
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText("Recipient address is required")).toBeInTheDocument();
    });
  });

  it("should show error for invalid Stellar address", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    await user.type(addressInput, "INVALID123");

    const reviewButton = screen.getByText("Review & Send");
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText(/Invalid Stellar address format/)).toBeInTheDocument();
    });
  });

  it("should show error when amount is empty", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    await user.type(addressInput, "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTW");

    const reviewButton = screen.getByText("Review & Send");
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText("Amount is required")).toBeInTheDocument();
    });
  });

  it("should show error for negative amount", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    await user.type(addressInput, "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTW");

    const amountInput = screen.getByPlaceholderText("0.00");
    await user.type(amountInput, "-100");

    const reviewButton = screen.getByText("Review & Send");
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText("Amount must be greater than 0")).toBeInTheDocument();
    });
  });

  it("should show warning for memo longer than 28 characters", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const memoInput = screen.getByPlaceholderText(
      "Add a note for the recipient (max 28 characters)",
    );
    const longMemo = "This is a very long memo that exceeds the limit";
    await user.type(memoInput, longMemo);

    const reviewButton = screen.getByText("Review & Send");
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText("Memo must be 28 characters or less")).toBeInTheDocument();
    });
  });

  it("should display character count for memo", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const memoInput = screen.getByPlaceholderText(
      "Add a note for the recipient (max 28 characters)",
    );
    await user.type(memoInput, "Test memo");

    await waitFor(() => {
      expect(screen.getByText("9/28 characters")).toBeInTheDocument();
    });
  });

  it("should allow token selection", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const tokenSelect = screen.getByDisplayValue("USDC");
    expect(tokenSelect).toBeInTheDocument();

    await user.selectOptions(tokenSelect, "EURC");
    expect((tokenSelect as HTMLSelectElement).value).toBe("EURC");
  });

  it("should disable form when mutation is pending", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useCreateRemittance } = require("../../hooks/useApi");
    useCreateRemittance.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: true,
    });

    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText(
      "G... (Stellar public key)",
    ) as HTMLInputElement;
    const amountInput = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    const reviewButton = screen.getByText("Review & Send") as HTMLButtonElement;

    expect(addressInput.disabled).toBe(true);
    expect(amountInput.disabled).toBe(true);
    expect(reviewButton.disabled).toBe(true);
  });
});
