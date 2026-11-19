import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { resolveWasmPath, pollTransaction, resolveAdminAddress, upsertEnvBlock } from './deploy';

test('resolveWasmPath returns canonical .optimized.wasm when it exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-test-'));
    try {
        const optWasm = path.join(tempDir, 'contract.optimized.wasm');
        const rawWasm = path.join(tempDir, 'contract.wasm');
        fs.writeFileSync(optWasm, 'optimized-binary');
        fs.writeFileSync(rawWasm, 'raw-binary');

        const resolved = resolveWasmPath(optWasm, tempDir);
        assert.strictEqual(resolved, optWasm);
    } finally {
        fs.removeSync(tempDir);
    }
});

test('resolveWasmPath falls back to .wasm with a warning when .optimized.wasm is missing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-test-'));
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    try {
        const rawWasm = path.join(tempDir, 'contract.wasm');
        fs.writeFileSync(rawWasm, 'raw-binary');

        const optWasm = path.join(tempDir, 'contract.optimized.wasm');
        const resolved = resolveWasmPath(optWasm, tempDir);

        assert.strictEqual(resolved, rawWasm);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Canonical optimized WASM not found.*Falling back to unoptimized artifact/);
    } finally {
        console.warn = originalWarn;
        fs.removeSync(tempDir);
    }
});

test('resolveWasmPath prefers .optimized.wasm even if .wasm is configured when optimized binary exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-test-'));
    try {
        const optWasm = path.join(tempDir, 'contract.optimized.wasm');
        const rawWasm = path.join(tempDir, 'contract.wasm');
        fs.writeFileSync(optWasm, 'optimized-binary');
        fs.writeFileSync(rawWasm, 'raw-binary');

        const resolved = resolveWasmPath(rawWasm, tempDir);
        assert.strictEqual(resolved, optWasm);
    } finally {
        fs.removeSync(tempDir);
    }
});

test('resolveWasmPath falls back to .wasm with a warning when .wasm is configured and .optimized.wasm is absent', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-test-'));
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    try {
        const rawWasm = path.join(tempDir, 'contract.wasm');
        fs.writeFileSync(rawWasm, 'raw-binary');

        const resolved = resolveWasmPath(rawWasm, tempDir);
        assert.strictEqual(resolved, rawWasm);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Using unoptimized artifact/);
    } finally {
        console.warn = originalWarn;
        fs.removeSync(tempDir);
    }
});

test('resolveWasmPath throws error when neither optimized nor fallback WASM exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-test-'));
    try {
        const optWasm = path.join(tempDir, 'nonexistent.optimized.wasm');
        assert.throws(
            () => resolveWasmPath(optWasm, tempDir),
            /WASM binary not found: Neither canonical artifact.*nor fallback.*exists/
        );
    } finally {
        fs.removeSync(tempDir);
    }
});

test('pollTransaction throws a timeout naming the hash when the tx never lands', async () => {
    let calls = 0;
    const server = { getTransaction: async () => { calls++; return { status: 'NOT_FOUND' } as any; } };
    await assert.rejects(pollTransaction(server, 'abc123', 3, 0), /Timed out waiting for transaction abc123 after 3 attempts/);
    assert.strictEqual(calls, 3);
});

test('resolveAdminAddress rejects an external admin up front', () => {
    const deployer = 'GDEPLOYER';
    assert.strictEqual(resolveAdminAddress('YOUR_ADMIN_PUBLIC_KEY', deployer), deployer);
    assert.strictEqual(resolveAdminAddress(deployer, deployer), deployer);
    assert.throws(() => resolveAdminAddress('GOTHERADMIN', deployer), /differs from the deployer key/);
});

test('upsertEnvBlock replaces the previous RemitLend block instead of appending', () => {
    const block1 = '\n# RemitLend contracts — testnet — t1\nPOOL=A\nNFT=B';
    const block2 = '\n# RemitLend contracts — testnet — t2\nPOOL=C\nNFT=D';
    const once = upsertEnvBlock('OTHER=1\n', block1);
    const twice = upsertEnvBlock(once, block2);
    assert.strictEqual(twice.match(/# RemitLend contracts/g)?.length, 1);
    assert.match(twice, /OTHER=1/);
    assert.match(twice, /POOL=C/);
    assert.doesNotMatch(twice, /POOL=A/);
});
