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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useCreateRemittance } = require("../../hooks/useApi");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useTransactionPreview } = require("../../hooks/useTransactionPreview");

    useCreateRemittance.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    });

    useTransactionPreview.mockReturnValue({
      isOpen: false,
      show: jest.fn(),
      close: jest.fn(),
      confirm: jest.fn(),
      data: null,
      isLoading: false,
    });
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

  describe("recipient validation", () => {
    it("should reject addresses with incorrect length", async () => {
      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
      const amountInput = screen.getByPlaceholderText("0.00");

      // Too short (55 chars starting with G)
      await user.type(addressInput, "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTW");
      await user.type(amountInput, "50");

      const reviewButton = screen.getByRole("button", { name: /review/i });
      fireEvent.click(reviewButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Invalid Stellar address format (must be 56 characters starting with G)",
          ),
        ).toBeInTheDocument();
      });
    });

    it("should reject addresses not starting with G", async () => {
      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
      const amountInput = screen.getByPlaceholderText("0.00");

      // 56 characters starting with C instead of G
      const nonGAddress = "C" + VALID_ADDRESS.slice(1);
      await user.type(addressInput, nonGAddress);
      await user.type(amountInput, "50");

      const reviewButton = screen.getByRole("button", { name: /review/i });
      fireEvent.click(reviewButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Invalid Stellar address format (must be 56 characters starting with G)",
          ),
        ).toBeInTheDocument();
      });
    });

    it("should reject addresses containing invalid base32 characters (0, 1, 8, 9, lowercase)", async () => {
      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
      const amountInput = screen.getByPlaceholderText("0.00");

      // Contains '0', '1', '8' or '9' which are invalid in Stellar RFC 4648 base32
      const invalidCharAddress = "G0" + VALID_ADDRESS.slice(2);
      await user.type(addressInput, invalidCharAddress);
      await user.type(amountInput, "50");

      const reviewButton = screen.getByRole("button", { name: /review/i });
      fireEvent.click(reviewButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Invalid Stellar address format (must be 56 characters starting with G)",
          ),
        ).toBeInTheDocument();
      });
    });

    it("should clear recipient address error when valid address is typed", async () => {
      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
      const amountInput = screen.getByPlaceholderText("0.00");

      await user.type(addressInput, "INVALID");
      await user.type(amountInput, "50");

      const reviewButton = screen.getByRole("button", { name: /review/i });
      fireEvent.click(reviewButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Invalid Stellar address format (must be 56 characters starting with G)",
          ),
        ).toBeInTheDocument();
      });

      // Now clear and type valid address
      await user.clear(addressInput);
      await user.type(addressInput, VALID_ADDRESS);

      expect(
        screen.queryByText(
          "Invalid Stellar address format (must be 56 characters starting with G)",
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("amount precision validation and boundaries", () => {
    it("should disable submit button when amount exceeds asset decimals", async () => {
      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
      const amountInput = screen.getByPlaceholderText("0.00");

      await user.type(addressInput, VALID_ADDRESS);
      // USDC default: 2 decimals, enter 3 decimal places
      await user.type(amountInput, "10.123");

      const reviewButton = screen.getByRole("button", { name: /review/i });
      expect(reviewButton).toBeDisabled();
    });

    it("should accept valid precision boundaries for 2-decimal asset (USDC)", async () => {
      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
      const amountInput = screen.getByPlaceholderText("0.00");

      await user.type(addressInput, VALID_ADDRESS);
      await user.type(amountInput, "10.99");

      const reviewButton = screen.getByRole("button", { name: /review/i });
      expect(reviewButton).toBeEnabled();
      expect(screen.queryByText(/supports at most 2 decimal places/)).not.toBeInTheDocument();
    });

    it("should format amount on blur with asset decimal precision", async () => {
      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const amountInput = screen.getByPlaceholderText("0.00");
      await user.type(amountInput, "15");
      fireEvent.blur(amountInput);

      await waitFor(() => {
        expect((amountInput as HTMLInputElement).value).toBe("15.00");
      });
    });

    it("should sanitize non-numeric input and multiple decimal points", () => {
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const amountInput = screen.getByPlaceholderText("0.00");
      fireEvent.change(amountInput, { target: { value: "12..34abc.5" } });

      expect((amountInput as HTMLInputElement).value).toBe("12.345");
    });
  });

  describe("duplicate submissions and mutation lifecycle", () => {
    it("should open preview modal and successfully call mutateAsync once on confirmation", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useCreateRemittance } = require("../../hooks/useApi");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useTransactionPreview } = require("../../hooks/useTransactionPreview");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { toast } = require("sonner");

      const mockMutateAsync = jest.fn().mockResolvedValue({ id: "remit-123" });
      useCreateRemittance.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      let confirmCallback: (() => Promise<void>) | null = null;
      const mockShow = jest.fn((previewData, onConfirm) => {
        confirmCallback = onConfirm;
      });

      useTransactionPreview.mockReturnValue({
        isOpen: false,
        show: mockShow,
        close: jest.fn(),
        confirm: jest.fn(),
        data: null,
        isLoading: false,
      });

      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
      const amountInput = screen.getByPlaceholderText("0.00");

      await user.type(addressInput, VALID_ADDRESS);
      await user.type(amountInput, "25.50");

      const reviewButton = screen.getByRole("button", { name: /review/i });
      fireEvent.click(reviewButton);

      expect(mockShow).toHaveBeenCalledTimes(1);
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({
              amount: "25.5",
              token: "USDC",
              type: "Send Remittance",
            }),
          ]),
          balanceChanges: expect.arrayContaining([
            expect.objectContaining({
              change: "-25.5",
              token: "USDC",
            }),
          ]),
        }),
        expect.any(Function),
      );

      // Confirm modal action executes the callback
      expect(confirmCallback).not.toBeNull();
      await waitFor(async () => {
        await confirmCallback!();
      });

      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).toHaveBeenCalledWith({
        amount: 25.5,
        fromCurrency: "USDC",
        toCurrency: "USDC",
        recipientAddress: VALID_ADDRESS,
        memo: undefined,
      });

      expect(toast.success).toHaveBeenCalledWith("Success!", {
        description: "Remittance sent successfully",
      });
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);

      // Form should be reset after successful submission
      await waitFor(() => {
        expect((addressInput as HTMLInputElement).value).toBe("");
        expect((amountInput as HTMLInputElement).value).toBe("");
      });
    });

    it("should handle submission failure and display error toast without resetting inputs", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useCreateRemittance } = require("../../hooks/useApi");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useTransactionPreview } = require("../../hooks/useTransactionPreview");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { toast } = require("sonner");

      const mockMutateAsync = jest
        .fn()
        .mockRejectedValue(new Error("Unauthorized: Insufficient balance or signer invalid"));
      useCreateRemittance.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      let confirmCallback: (() => Promise<void>) | null = null;
      useTransactionPreview.mockReturnValue({
        isOpen: false,
        show: jest.fn((_, onConfirm) => {
          confirmCallback = onConfirm;
        }),
        close: jest.fn(),
        confirm: jest.fn(),
        data: null,
        isLoading: false,
      });

      const user = userEvent.setup();
      render(<RemittanceForm onSuccess={mockOnSuccess} />);

      const addressInput = screen.getByPlaceholderText("G... (Stellar public key)");
      const amountInput = screen.getByPlaceholderText("0.00");

      await user.type(addressInput, VALID_ADDRESS);
      await user.type(amountInput, "100");

      const reviewButton = screen.getByRole("button", { name: /review/i });
      fireEvent.click(reviewButton);

      await confirmCallback!();

      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith("Error", {
        description: "Unauthorized: Insufficient balance or signer invalid",
      });
      expect(mockOnSuccess).not.toHaveBeenCalled();

      // Form inputs should remain intact on failure so user does not lose their data
      expect((addressInput as HTMLInputElement).value).toBe(VALID_ADDRESS);
      expect((amountInput as HTMLInputElement).value).toBe("100");
    });

    it("should prevent duplicate submission clicks while mutation is in pending state", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useCreateRemittance } = require("../../hooks/useApi");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useTransactionPreview } = require("../../hooks/useTransactionPreview");

      let resolvePromise: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      const mockMutateAsync = jest.fn(() => pendingPromise);

      const { rerender } = render(<RemittanceForm onSuccess={mockOnSuccess} />);

      // When mutation becomes pending, isPending is true
      useCreateRemittance.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      });
      useTransactionPreview.mockReturnValue({
        isOpen: false,
        show: jest.fn(),
        close: jest.fn(),
        confirm: jest.fn(),
        data: null,
        isLoading: true,
      });

      rerender(<RemittanceForm onSuccess={mockOnSuccess} />);

      const submitButton = screen.getByRole("status").closest("button") as HTMLButtonElement;
      expect(submitButton).toBeDisabled();
      expect(screen.getByText("Processing...")).toBeInTheDocument();

      // Attempting to click when disabled shouldn't invoke review or submission
      fireEvent.click(submitButton);
      expect(mockMutateAsync).not.toHaveBeenCalled();

      // Resolve the promise to clean up
      resolvePromise!({ id: "done" });
    });
  });
});
