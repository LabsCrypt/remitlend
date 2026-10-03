import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackendEnvBlock, buildFrontendEnvBlock, DeployedContracts } from './deploy';

const mockContracts: DeployedContracts = {
    nftContractId: 'CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    poolContractId: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    managerContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    govContractId: 'CEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
    poolTokenAddress: 'CAS3J7GYCCXG7W35XU4643F2M3T63BGCV2X4D6C4V7G4X6C4V7G4X6C4',
};

test('buildFrontendEnvBlock writes NEXT_PUBLIC_* contract IDs without POOL_TOKEN_ADDRESS', () => {
    const timestamp = new Date('2026-06-27T15:00:00.000Z');
    const block = buildFrontendEnvBlock('testnet', mockContracts, timestamp);

    assert.ok(block.includes('# RemitLend contracts — testnet — 2026-06-27T15:00:00.000Z'));
    assert.ok(block.includes(`NEXT_PUBLIC_NFT_CONTRACT_ID=${mockContracts.nftContractId}`));
    assert.ok(block.includes(`NEXT_PUBLIC_POOL_CONTRACT_ID=${mockContracts.poolContractId}`));
    assert.ok(block.includes(`NEXT_PUBLIC_MANAGER_CONTRACT_ID=${mockContracts.managerContractId}`));
    assert.ok(block.includes(`NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID=${mockContracts.govContractId}`));
    assert.ok(!block.includes('POOL_TOKEN_ADDRESS'));
    assert.ok(!block.includes('LOAN_MANAGER_CONTRACT_ID'));
});

test('buildBackendEnvBlock writes exact backend contract IDs and POOL_TOKEN_ADDRESS', () => {
    const timestamp = new Date('2026-06-27T15:00:00.000Z');
    const block = buildBackendEnvBlock('testnet', mockContracts, timestamp);

    assert.ok(block.includes('# RemitLend contracts — testnet — 2026-06-27T15:00:00.000Z'));
    assert.ok(block.includes(`LOAN_MANAGER_CONTRACT_ID=${mockContracts.managerContractId}`));
    assert.ok(block.includes(`LENDING_POOL_CONTRACT_ID=${mockContracts.poolContractId}`));
    assert.ok(block.includes(`REMITTANCE_NFT_CONTRACT_ID=${mockContracts.nftContractId}`));
    assert.ok(block.includes(`MULTISIG_GOVERNANCE_CONTRACT_ID=${mockContracts.govContractId}`));
    assert.ok(block.includes(`POOL_TOKEN_ADDRESS=${mockContracts.poolTokenAddress}`));

    // Ensure frontend NEXT_PUBLIC_* prefix is not used in backend block
    assert.ok(!block.includes('NEXT_PUBLIC_'));
});

test('buildBackendEnvBlock emits all 5 required contract and token keys for backend validation', () => {
    const block = buildBackendEnvBlock('testnet', mockContracts);
    const parsed: Record<string, string> = {};

    for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...rest] = trimmed.split('=');
        parsed[key] = rest.join('=');
    }

    const expectedKeys = [
        'LOAN_MANAGER_CONTRACT_ID',
        'LENDING_POOL_CONTRACT_ID',
        'REMITTANCE_NFT_CONTRACT_ID',
        'MULTISIG_GOVERNANCE_CONTRACT_ID',
        'POOL_TOKEN_ADDRESS',
    ];

    for (const key of expectedKeys) {
        assert.ok(key in parsed, `Missing expected key: ${key}`);
        assert.ok(parsed[key].length > 0, `Key ${key} should not be empty`);
    }
});
