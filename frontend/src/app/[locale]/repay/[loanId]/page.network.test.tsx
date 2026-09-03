/**
 * [locale]/repay/[loanId]/page.network.test.tsx
 *
 * Tests for issue #1073: the repay page signs with the network-aware
 * WalletProvider signer, passes the resolved network passphrase to BOTH the
 * build step and the signer (guaranteeing they match on TESTNET and PUBLIC),
 * and blocks repayment on an unsupported wallet network before building or
 * signing anything.
 */

import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import RepayLoanPage from "./page";

const buildMock = jest.fn();
const signMock = jest.fn();
const toastError = jest.fn();

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; October 2015";

jest.mock("next/navigation", () => ({
  useParams: () => ({ loanId: "1" }),
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock("../../../hooks/useApi", () => ({
  submitLoanTransaction: jest.fn().mockResolvedValue({ status: "SUCCESS", txHash: "abc" }),
}));

jest.mock("../../../utils/soroban", () => ({
  buildUnsignedRepaymentXdr: jest
    .fn()
    .mockImplementation(async (opts: { networkPassphrase?: string }) => {
      buildMock(opts);
      return "unsigned-xdr";
    }),
  getNetworkPassphrase: jest.fn().mockImplementation((name?: string) => {
    const n = (name ?? "TESTNET").toUpperCase();
    return n === "PUBLIC" ? PUBLIC_PASSPHRASE : TESTNET_PASSPHRASE;
  }),
}));

jest.mock("../../../components/providers/WalletProvider", () => ({
  useWallet: () => ({
    signTransaction: jest.fn().mockImplementation(async (_xdr, opts) => {
      signMock(opts);
      return "signed-xdr";
    }),
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
    refreshWallet: jest.fn(),
    isFreighterAvailable: false,
  }),
}));

jest.mock("../../../hooks/useContractToast", () => ({
  useContractToast: () => ({
    showPending: jest.fn(() => "toast-id"),
    showSuccess: jest.fn(),
    showError: jest.fn(),
    success: jest.fn(),
    error: toastError,
    info: jest.fn(),
    warning: jest.fn(),
    getStellarExpertUrl: jest.fn(),
  }),
}));

function setWalletNetwork({ name, isSupported }: { name: string; isSupported: boolean }) {
  const { useWalletStore } = require("../../../stores/useWalletStore");
  useWalletStore.setState({
    status: isSupported ? "connected" : "error",
    address: "GABC",
    network: { chainId: isSupported ? (name === "PUBLIC" ? 1 : 2) : 0, name, isSupported },
    balances: [],
    error: null,
    shouldAutoReconnect: false,
  });
}

async function submitRepay() {
  render(<RepayLoanPage />);
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: "Review & Repay" }).closest("form")!);
  });
}

async function confirmRepay() {
  const checkbox = screen.getByRole("checkbox");
  await act(async () => {
    fireEvent.click(checkbox);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign Transaction" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("RepayLoanPage network-aware signer (issue #1073)", () => {
  beforeEach(() => {
    buildMock.mockClear();
    signMock.mockClear();
    toastError.mockClear();
    process.env.NEXT_PUBLIC_LOAN_MANAGER_CONTRACT_ID = "CAAA";
  });

  it("blocks repayment on an unsupported wallet network without building or signing", async () => {
    setWalletNetwork({ name: "SOMEUNSUPPORTEDNET", isSupported: false });

    await submitRepay();

    expect(buildMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Unsupported wallet network",
      "Switch your wallet to PUBLIC or TESTNET before repaying.",
    );
  });

  it("builds and signs with the same TESTNET passphrase when the wallet is on testnet", async () => {
    setWalletNetwork({ name: "TESTNET", isSupported: true });

    await submitRepay();
    await confirmRepay();

    expect(buildMock).toHaveBeenCalledWith(
      expect.objectContaining({ networkPassphrase: TESTNET_PASSPHRASE }),
    );
    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({ networkPassphrase: TESTNET_PASSPHRASE }),
    );
  });

  it("builds and signs with the same PUBLIC passphrase when the wallet is on public network", async () => {
    setWalletNetwork({ name: "PUBLIC", isSupported: true });

    await submitRepay();
    await confirmRepay();

    expect(buildMock).toHaveBeenCalledWith(
      expect.objectContaining({ networkPassphrase: PUBLIC_PASSPHRASE }),
    );
    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({ networkPassphrase: PUBLIC_PASSPHRASE }),
    );
  });

  it("proves network-awareness: build/sign passphrase differs between TESTNET and PUBLIC", async () => {
    setWalletNetwork({ name: "TESTNET", isSupported: true });
    await submitRepay();
    await confirmRepay();
    expect(buildMock.mock.calls[0][0].networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(signMock.mock.calls[0][0].networkPassphrase).toBe(TESTNET_PASSPHRASE);

    buildMock.mockClear();
    signMock.mockClear();
    cleanup();

    setWalletNetwork({ name: "PUBLIC", isSupported: true });
    await submitRepay();
    await confirmRepay();
    expect(buildMock.mock.calls[0][0].networkPassphrase).toBe(PUBLIC_PASSPHRASE);
    expect(signMock.mock.calls[0][0].networkPassphrase).toBe(PUBLIC_PASSPHRASE);

    // Different values per network, proving it is genuinely network-aware.
    expect(TESTNET_PASSPHRASE).not.toBe(PUBLIC_PASSPHRASE);
  });
});
