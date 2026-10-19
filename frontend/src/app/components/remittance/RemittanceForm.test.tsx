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
    close: jest.fn(),
    confirm: jest.fn(),
    data: null,
    isLoading: false,
  })),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// A valid 56-character Stellar address using only base32 chars (A-Z, 2-7)
const VALID_ADDRESS = "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTWA";

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

  it("should show error when recipient address is empty", () => {
    render(<RemittanceForm onSuccess={mockOnSuccess} />);
    // The form disables the button when the address or amount field is empty
    const reviewButton = screen.getByRole("button", { name: /review/i });
    expect(reviewButton).toBeDisabled();
  });

  it("should show error for invalid Stellar address", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    const amountInput = screen.getByPlaceholderText("0.00");

    await user.type(addressInput, "INVALID123");
    await user.type(amountInput, "100");

    const reviewButton = screen.getByRole("button", { name: /review/i });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText(/Invalid Stellar address format/)).toBeInTheDocument();
    });
  });

  it("should show error when amount is empty", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    await user.type(addressInput, VALID_ADDRESS);

    // Button is disabled when amount is not yet filled
    const reviewButton = screen.getByRole("button", { name: /review/i });
    expect(reviewButton).toBeDisabled();
  });

  it("should show error for amount that is not greater than zero", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    await user.type(addressInput, VALID_ADDRESS);

    const amountInput = screen.getByPlaceholderText("0.00");
    await user.type(amountInput, "0");

    const reviewButton = screen.getByRole("button", { name: /review/i });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText("Amount must be greater than 0")).toBeInTheDocument();
    });
  });

  it("should reject memo that exceeds 28 UTF-8 bytes (multibyte characters)", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    const amountInput = screen.getByPlaceholderText("0.00");

    await user.type(addressInput, VALID_ADDRESS);
    await user.type(amountInput, "100");

    const memoInput = screen.getByLabelText(/^Memo/);
    // "¡Hola mundo! 🌍" is 18 characters but 24 bytes in UTF-8.
    // Adding more to exceed 28 bytes: "¡Hola mundo! 🌍 es un saludo" is 29 chars but 35 bytes
    fireEvent.change(memoInput, {
      target: { value: "¡Hola mundo! 🌍 es un saludo" },
    });

    const reviewButton = screen.getByRole("button", { name: /review/i });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.getByText(/Memo must be 28 bytes or less/)).toBeInTheDocument();
    });
  });

  it("should allow memo with multibyte characters that fit within 28 bytes", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    const amountInput = screen.getByPlaceholderText("0.00");

    await user.type(addressInput, VALID_ADDRESS);
    await user.type(amountInput, "100");

    const memoInput = screen.getByLabelText(/^Memo/);
    // "¡Hola!" is 6 chars but 7 bytes — fits in 28 bytes
    await user.type(memoInput, "¡Hola!");

    const reviewButton = screen.getByRole("button", { name: /review/i });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.queryByText(/Memo must be 28 bytes or less/)).not.toBeInTheDocument();
    });
  });

  it("should allow ASCII memo up to 28 characters", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
    const amountInput = screen.getByPlaceholderText("0.00");

    await user.type(addressInput, VALID_ADDRESS);
    await user.type(amountInput, "100");

    const memoInput = screen.getByLabelText(/^Memo/);
    // 28 ASCII characters = 28 bytes — should pass
    await user.type(memoInput, "Hello World! This is a memo!");

    await waitFor(() => {
      expect(screen.getByText("28/28 bytes")).toBeInTheDocument();
    });

    const reviewButton = screen.getByRole("button", { name: /review/i });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(screen.queryByText(/Memo must be 28 bytes or less/)).not.toBeInTheDocument();
    });
  });

  it("should display byte count for memo", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const memoInput = screen.getByLabelText(/^Memo/);
    await user.type(memoInput, "Test memo");

    await waitFor(() => {
      expect(screen.getByText("9/28 bytes")).toBeInTheDocument();
    });
  });

  it("should allow token selection", async () => {
    const user = userEvent.setup();
    render(<RemittanceForm onSuccess={mockOnSuccess} />);

    const tokenSelect = screen.getByLabelText(/^Token/);
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
    // When isPending, the button renders a "Processing..." spinner instead of "Review & Send"
    const submitButton = screen.getByRole("status").closest("button") as HTMLButtonElement;

    expect(addressInput.disabled).toBe(true);
    expect(amountInput.disabled).toBe(true);
    expect(submitButton.disabled).toBe(true);
  });
});
