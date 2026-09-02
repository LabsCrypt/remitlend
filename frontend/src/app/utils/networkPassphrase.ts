/**
 * utils/networkPassphrase.ts
 *
 * Single source of truth for mapping a Stellar wallet network to its network
 * passphrase. Kept free of @stellar/stellar-sdk so it can be imported by both
 * the client-side XDR builders (soroban.ts) and the WalletProvider signer
 * without pulling the SDK into unrelated module graphs.
 *
 * Both build-time and sign-time passphrase resolution are keyed off the same
 * `getNetworkPassphrase` helper so they are guaranteed to agree for whichever
 * network the connected wallet is on.
 */

export const NETWORK_PASSPHRASES: Record<string, string> = {
  PUBLIC: "Public Global Stellar Network ; October 2015",
  TESTNET: "Test SDF Network ; September 2015",
  FUTURENET: "Test SDF Future Network ; October 2022",
  STANDALONE: "Standalone Network ; September 2015",
};

export const DEFAULT_NETWORK_PASSPHRASE = NETWORK_PASSPHRASES.TESTNET;

export function getNetworkPassphrase(networkName: string | undefined): string {
  const normalized = (networkName ?? "TESTNET").toUpperCase();
  return NETWORK_PASSPHRASES[normalized] ?? DEFAULT_NETWORK_PASSPHRASE;
}
