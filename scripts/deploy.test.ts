import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { resolveWasmPath } from './deploy';

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
