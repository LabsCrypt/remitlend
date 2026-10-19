import {
    Keypair,
    Operation,
    TransactionBuilder,
    rpc as Rpc,
    Address,
    nativeToScVal,
    xdr,
    StrKey,
} from '@stellar/stellar-sdk';
import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const CONFIG_PATH = path.join(__dirname, 'deploy-config.json');
const POLL_INTERVAL_MS = 2000;

// Compute the SHA-256 hash of WASM bytes — this is the on-chain upload key.
export function computeWasmHash(wasm: Buffer): Buffer {
    return createHash('sha256').update(wasm).digest();
}

/**
 * Resolves the WASM artifact path.
 * The canonical artifact produced by `scripts/build.sh` is `<name>.optimized.wasm`.
 * If the configured artifact is `.optimized.wasm` but is not found (e.g. optimizer CLI was
 * not available during build), falls back to the unoptimized `<name>.wasm` with a logged warning.
 * If the configured artifact is `.wasm`, attempts to resolve the canonical `.optimized.wasm`
 * first, or uses `.wasm` with a warning.
 * Never fails silently or uploads empty data.
 */
export function resolveWasmPath(configuredPath: string, basePath: string = __dirname): string {
    const absolutePath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(basePath, configuredPath);

    if (absolutePath.endsWith('.optimized.wasm')) {
        if (fs.existsSync(absolutePath)) {
            return absolutePath;
        }
        const fallbackPath = absolutePath.replace(/\.optimized\.wasm$/, '.wasm');
        if (fs.existsSync(fallbackPath)) {
            console.warn(
                `WARNING: Canonical optimized WASM not found at ${absolutePath}. ` +
                `Falling back to unoptimized artifact: ${fallbackPath}. ` +
                `Ensure stellar/soroban CLI is installed and ./scripts/build.sh was executed.`
            );
            return fallbackPath;
        }
        throw new Error(
            `WASM binary not found: Neither canonical artifact '${absolutePath}' nor fallback '${fallbackPath}' exists. Run ./scripts/build.sh first.`
        );
    }

    if (absolutePath.endsWith('.wasm')) {
        const optimizedPath = absolutePath.replace(/\.wasm$/, '.optimized.wasm');
        if (fs.existsSync(optimizedPath)) {
            return optimizedPath;
        }
        if (fs.existsSync(absolutePath)) {
            console.warn(
                `WARNING: Canonical optimized WASM not found at ${optimizedPath}. ` +
                `Using unoptimized artifact: ${absolutePath}. ` +
                `Ensure stellar/soroban CLI is installed and ./scripts/build.sh was executed.`
            );
            return absolutePath;
        }
        throw new Error(
            `WASM binary not found: Neither canonical artifact '${optimizedPath}' nor fallback '${absolutePath}' exists. Run ./scripts/build.sh first.`
        );
    }

    if (fs.existsSync(absolutePath)) {
        return absolutePath;
    }
    throw new Error(`WASM binary not found at '${absolutePath}'. Run ./scripts/build.sh first.`);
}

// Deterministic per-contract salt so re-runs don't stomp each other's addresses.
function contractSalt(name: string): Buffer {
    return createHash('sha256').update(`remitlend:${name}`).digest();
}

// Extract the newly created contract ID from transaction result metadata.
function extractContractId(resultMeta: xdr.TransactionMeta): string {
    const v3 = resultMeta.v3();
    for (const opMeta of v3.operations()) {
        for (const change of opMeta.changes()) {
            if (change.switch().name !== 'ledgerEntryCreated') continue;
            const data = change.created().data();
            if (data.switch().name !== 'contractData') continue;
            const cd = data.contractData();
            if (cd.key().switch().name !== 'scvLedgerKeyContractInstance') continue;
            const contract = cd.contract();
            if (contract.switch().name === 'scAddressTypeContract') {
                return StrKey.encodeContract(
                    Buffer.from(contract.contractId() as unknown as Uint8Array),
                );
            }
        }
    }
    throw new Error('Could not extract contract ID from transaction metadata');
}

async function sendTx(
    server: Rpc.Server,
    tx: ReturnType<TransactionBuilder['build']>,
    account: Keypair,
): Promise<Rpc.Api.GetSuccessfulTransactionResponse> {
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${JSON.stringify(sim.error, null, 2)}`);
    }

    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(account);

    const sendResponse = await server.sendTransaction(preparedTx);
    if (sendResponse.status !== 'PENDING') {
        throw new Error(`Send failed: ${JSON.stringify(sendResponse, null, 2)}`);
    }

    console.log(`    tx ${sendResponse.hash} … polling`);

    let txResponse = await server.getTransaction(sendResponse.hash);
    while (txResponse.status === 'NOT_FOUND') {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        txResponse = await server.getTransaction(sendResponse.hash);
    }

    if (txResponse.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${JSON.stringify(txResponse, null, 2)}`);
    }

    return txResponse as Rpc.Api.GetSuccessfulTransactionResponse;
}

// Upload WASM bytecode to the network and return its SHA-256 hash.
// If the same WASM was uploaded before the hash is already indexed, but the
// operation is idempotent and safe to repeat.
export async function uploadWasm(
    server: Rpc.Server,
    wasmPath: string,
    account: Keypair,
    networkPassphrase: string,
): Promise<Buffer> {
    const resolvedPath = resolveWasmPath(wasmPath);
    const wasm = await fs.readFile(resolvedPath);
    const wasmHash = computeWasmHash(wasm);

    console.log(`  uploading ${path.basename(resolvedPath)} (hash ${wasmHash.toString('hex').slice(0, 12)}…)`);

    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
        .addOperation(Operation.uploadContractWasm({ wasm }))
        .setTimeout(30)
        .build();

    await sendTx(server, tx, account);
    return wasmHash;
}

// Instantiate a contract from an uploaded WASM hash. Returns the new contract ID.
async function createInstance(
    server: Rpc.Server,
    wasmHash: Buffer,
    salt: Buffer,
    account: Keypair,
    networkPassphrase: string,
): Promise<string> {
    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
        .addOperation(
            Operation.createCustomContract({
                address: Address.fromString(account.publicKey()),
                wasmHash,
                salt,
            }),
        )
        .setTimeout(30)
        .build();

    const result = await sendTx(server, tx, account);
    return extractContractId(result.resultMetaXdr);
}

// Call a contract function with positional arguments.
async function invoke(
    server: Rpc.Server,
    contractId: string,
    method: string,
    args: unknown[],
    account: Keypair,
    networkPassphrase: string,
): Promise<void> {
    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
        .addOperation(
            Operation.invokeHostFunction({
                func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                    new xdr.InvokeContractArgs({
                        contractAddress: Address.fromString(contractId).toScAddress(),
                        functionName: method,
                        args: args.map(arg => nativeToScVal(arg)),
                    }),
                ),
                auth: [],
            }),
        )
        .setTimeout(30)
        .build();

    await sendTx(server, tx, account);
}

export interface DeployedContracts {
    nftContractId: string;
    poolContractId: string;
    managerContractId: string;
    govContractId: string;
    poolTokenAddress: string;
}

export function buildFrontendEnvBlock(
    network: string,
    contracts: Pick<DeployedContracts, 'nftContractId' | 'poolContractId' | 'managerContractId' | 'govContractId'>,
    date: Date = new Date(),
): string {
    return [
        ``,
        `# RemitLend contracts — ${network} — ${date.toISOString()}`,
        `NEXT_PUBLIC_NFT_CONTRACT_ID=${contracts.nftContractId}`,
        `NEXT_PUBLIC_POOL_CONTRACT_ID=${contracts.poolContractId}`,
        `NEXT_PUBLIC_MANAGER_CONTRACT_ID=${contracts.managerContractId}`,
        `NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID=${contracts.govContractId}`,
    ].join('\n');
}

export function buildBackendEnvBlock(
    network: string,
    contracts: DeployedContracts,
    date: Date = new Date(),
): string {
    return [
        ``,
        `# RemitLend contracts — ${network} — ${date.toISOString()}`,
        `LOAN_MANAGER_CONTRACT_ID=${contracts.managerContractId}`,
        `LENDING_POOL_CONTRACT_ID=${contracts.poolContractId}`,
        `REMITTANCE_NFT_CONTRACT_ID=${contracts.nftContractId}`,
        `MULTISIG_GOVERNANCE_CONTRACT_ID=${contracts.govContractId}`,
        `POOL_TOKEN_ADDRESS=${contracts.poolTokenAddress}`,
    ].join('\n');
}

async function main() {
    const network = process.argv[2] || 'testnet';
    const config = (await fs.readJson(CONFIG_PATH))[network];
    if (!config) throw new Error(`No config for network: ${network}`);

    const secretKey = process.env.SECRET_KEY;
    if (!secretKey) throw new Error('SECRET_KEY environment variable is required');

    const account = Keypair.fromSecret(secretKey);
    // Fall back to the deployer's own key when admin is not set in config.
    const adminAddr =
        config.admin === 'YOUR_ADMIN_PUBLIC_KEY' ? account.publicKey() : config.admin;

    const server = new Rpc.Server(config.rpcUrl);
    const passphrase = config.networkPassphrase;

    console.log(`\nRemitLend deployment → ${network}`);
    console.log(`admin : ${adminAddr}`);
    console.log(`token : ${config.token}\n`);

    // ── 1. Upload all WASM binaries ─────────────────────────────────────────────
    console.log('[1/4] Uploading WASM binaries…');
    const nftWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.remittance_nft.wasm),
        account,
        passphrase,
    );
    const poolWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.lending_pool.wasm),
        account,
        passphrase,
    );
    const managerWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.loan_manager.wasm),
        account,
        passphrase,
    );
    const govWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.multisig_governance.wasm),
        account,
        passphrase,
    );

    // ── 2. Instantiate contracts ────────────────────────────────────────────────
    console.log('\n[2/4] Creating contract instances…');

    console.log('  RemittanceNFT');
    const nftContractId = await createInstance(server, nftWasmHash, contractSalt('nft'), account, passphrase);
    console.log(`    → ${nftContractId}`);

    console.log('  LendingPool');
    const poolContractId = await createInstance(server, poolWasmHash, contractSalt('pool'), account, passphrase);
    console.log(`    → ${poolContractId}`);

    console.log('  LoanManager');
    const managerContractId = await createInstance(server, managerWasmHash, contractSalt('manager'), account, passphrase);
    console.log(`    → ${managerContractId}`);

    console.log('  Governance');
    const govContractId = await createInstance(server, govWasmHash, contractSalt('governance'), account, passphrase);
    console.log(`    → ${govContractId}`);

    // ── 3. Initialize in dependency order ──────────────────────────────────────
    //
    // Ordering constraints:
    //   a. NFT must be initialized before authorize_minter can be called.
    //   b. authorize_minter(LoanManager) must run BEFORE LoanManager.initialize,
    //      because LoanManager.initialize asserts it is already an authorized minter.
    //   c. LendingPool has no dependency on NFT or LoanManager at init time.
    //   d. LoanManager.initialize takes (nft, pool, token, admin) so both NFT and
    //      Pool addresses must be known first.
    //   e. Governance.initialize takes (admin, targets). It governs every
    //      RemitLend protocol contract that maintains an admin role: LendingPool,
    //      LoanManager, and RemittanceNFT. Target selection must match the Admin API:
    //      each target exposes propose_admin(new_admin: Address), ccept_admin(),
    //      and set_admin(new_admin: Address). At deploy time, each target proposes
    //      Governance as its admin and Governance.accept_target_admins completes the
    //      handover. When finalize_admin_transfer runs, Governance cross-invokes
    //      propose_admin(new_admin) on all targets, which the new admin completes
    //      by calling ccept_admin().
    //   f. set_loan_manager on NFT and Pool must run AFTER LoanManager exists
    //      but BEFORE the governance handover, since both calls require the
    //      current admin and post-handover only Governance can authorize them.

    //
    console.log('\n[3/4] Initializing contracts…');

    // NFT
    console.log('  NFT.initialize');
    await invoke(server, nftContractId, 'initialize', [adminAddr], account, passphrase);

    // Authorize LoanManager as minter BEFORE LoanManager.initialize checks for it.
    console.log('  NFT.authorize_minter(LoanManager)');
    await invoke(server, nftContractId, 'authorize_minter', [managerContractId], account, passphrase);

    // LendingPool
    console.log('  LendingPool.initialize');
    await invoke(server, poolContractId, 'initialize', [adminAddr], account, passphrase);

    // LoanManager — validates minter authorization on-chain during this call.
    console.log('  LoanManager.initialize');
    await invoke(
        server,
        managerContractId,
        'initialize',
        [nftContractId, poolContractId, config.token, adminAddr],
        account,
        passphrase,
    );

    // Register LoanManager on RemittanceNFT so the anti-credit-wash transfer
    // guard is active. Without this, transfer() skips the active-loan check
    // and defaulting borrowers can wash reputation to a clean address.
    console.log('  NFT.set_loan_manager(LoanManager)');
    await invoke(server, nftContractId, 'set_loan_manager', [managerContractId], account, passphrase);

    // Register LoanManager on LendingPool so approve_loan / refinance_loan can
    // disburse liquidity via the pool-authorized disburse_loan entrypoint.
    console.log('  LendingPool.set_loan_manager(LoanManager)');
    await invoke(server, poolContractId, 'set_loan_manager', [managerContractId], account, passphrase);

    // Governance — targets every RemitLend contract with an admin role.
    const governedContractIds = [poolContractId, managerContractId, nftContractId];
    console.log('  Governance.initialize(targets=LendingPool,LoanManager,RemittanceNFT)');
    await invoke(
        server,
        govContractId,
        'initialize',
        [adminAddr, governedContractIds.map(id => Address.fromString(id))],
        account,
        passphrase,
    );

    for (const contractId of governedContractIds) {
        console.log(`  ${contractId}.propose_admin(Governance)`);
        await invoke(server, contractId, 'propose_admin', [Address.fromString(govContractId)], account, passphrase);
    }
    console.log('  Governance.accept_target_admins');
    await invoke(server, govContractId, 'accept_target_admins', [], account, passphrase);

    // ── 4. Persist contract IDs ─────────────────────────────────────────────────
    console.log('\n[4/4] Writing contract addresses to .env files…');

    const contracts: DeployedContracts = {
        nftContractId,
        poolContractId,
        managerContractId,
        govContractId,
        poolTokenAddress: config.token,
    };

    const frontendEnvBlock = buildFrontendEnvBlock(network, contracts);
    const backendEnvBlock = buildBackendEnvBlock(network, contracts);

    await fs.appendFile(path.join(__dirname, '../frontend/.env.local'), frontendEnvBlock);
    await fs.appendFile(path.join(__dirname, '../backend/.env'), backendEnvBlock);

    console.log('\nDeployment complete.');
    console.log(`  RemittanceNFT  : ${nftContractId}`);
    console.log(`  LendingPool    : ${poolContractId}`);
    console.log(`  LoanManager    : ${managerContractId}`);
    console.log(`  Governance     : ${govContractId}`);
    console.log(`  PoolToken      : ${config.token}`);
    console.log('\nNote: Contract addresses and POOL_TOKEN_ADDRESS written to backend/.env satisfy backend/src/config/env.ts validation.');
}

if (require.main === module) {
    main().catch(error => {
        console.error('\nDeployment failed:', error instanceof Error ? error.message : error);
        process.exit(1);
    });
}

