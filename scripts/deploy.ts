import {
    Keypair,
    Operation,
    TransactionBuilder,
    Rpc,
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
function computeWasmHash(wasm: Buffer): Buffer {
    return createHash('sha256').update(wasm).digest();
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
                return StrKey.encodeContract(contract.contractId());
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
async function uploadWasm(
    server: Rpc.Server,
    wasmPath: string,
    account: Keypair,
    networkPassphrase: string,
): Promise<Buffer> {
    const wasm = await fs.readFile(wasmPath);
    const wasmHash = computeWasmHash(wasm);

    console.log(`  uploading ${path.basename(wasmPath)} (hash ${wasmHash.toString('hex').slice(0, 12)}…)`);

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
    //   e. Governance.initialize takes (admin, target_contract). We point it at
    //      LoanManager as the primary governed contract.
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
    await invoke(server, poolContractId, 'initialize', [config.token, adminAddr], account, passphrase);

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

    // Governance — target is LoanManager (the core protocol contract).
    console.log('  Governance.initialize(target=LoanManager)');
    await invoke(server, govContractId, 'initialize', [adminAddr, managerContractId], account, passphrase);

    // ── 4. Persist contract IDs ─────────────────────────────────────────────────
    console.log('\n[4/4] Writing contract addresses to .env files…');

    const envBlock = [
        ``,
        `# RemitLend contracts — ${network} — ${new Date().toISOString()}`,
        `NEXT_PUBLIC_NFT_CONTRACT_ID=${nftContractId}`,
        `NEXT_PUBLIC_POOL_CONTRACT_ID=${poolContractId}`,
        `NEXT_PUBLIC_MANAGER_CONTRACT_ID=${managerContractId}`,
        `NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID=${govContractId}`,
    ].join('\n');

    await fs.appendFile(path.join(__dirname, '../frontend/.env.local'), envBlock);
    await fs.appendFile(path.join(__dirname, '../backend/.env'), envBlock);

    console.log('\nDeployment complete.');
    console.log(`  RemittanceNFT  : ${nftContractId}`);
    console.log(`  LendingPool    : ${poolContractId}`);
    console.log(`  LoanManager    : ${managerContractId}`);
    console.log(`  Governance     : ${govContractId}`);
}

main().catch(error => {
    console.error('\nDeployment failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
