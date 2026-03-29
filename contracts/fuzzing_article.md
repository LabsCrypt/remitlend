# Reverts vs. Crashes: Why Fuzzing Soroban (Rust/WASM) is a Different Beast than Solidity

If you’ve spent any time in the Ethereum ecosystem, you probably take **Foundry** for granted. You write an `invariant_` test, run `forge test`, and a few seconds later, you have a nice report of edge cases. 

But when you move to **Stellar’s Soroban**, things change. You aren't just in a different VM; you're in a different execution paradigm. Fuzzing Soroban contracts (Rust/WASM) requires a shift in mindset—from "watching transactions revert" to "stopping processes from crashing."

Here is why fuzzing in the Rust/WASM world is a completely different beast than the EVM.

---

### 1. The "Process Crash" vs. The "Transaction Revert"
In **Solidity**, a failure is a first-class citizen. If a contract hits an `assert(false)`, the EVM catches it, reverts the state, and the fuzzer (like Foundry or Echidna) says, "Aha! I found a failing path." The test runner stays alive and keeps going.

In **Soroban/Rust**, a failure is a **panic**. When a WASM contract panics (e.g., an integer overflow or an `assert!`), it triggers a trap. Because Soroban fuzzing typically uses **cargo-fuzz** (a general-purpose C++/Rust fuzzer), a contract panic can actually **crash the fuzzer process itself**.

To a general-purpose fuzzer, a crash is a "Deadly Signal" (SIGABRT). It thinks the software has a critical memory bug, not that a contract logic check failed. This is why Soroban fuzzing often requires "insulating" the contract calls using `try_invoke_contract` to turn those panics into `Result` values before they kill the fuzzer.

### 2. General Purpose vs. Domain-Specific Tooling
**Foundry** is a domain-specific tool. It *understands* the EVM. It knows how to manage state, mock addresses, and interpret revert strings out of the box.

**Cargo-fuzz/libFuzzer** is a general-purpose tool. It doesn't know what a "Smart Contract" or an "Address" is. It only knows how to generate raw, random bytes.
As a developer, you have to write the "glue code" (the harness) that:
1. Takes random bytes from the fuzzer.
2. Converts them into contract Actions (Deposit, Withdraw, Mint).
3. Mocks the entire **Soroban Host Environment** (storage, ledger, assets) for every single iteration.

### 3. The "Context" Cage
Solidity tests often allow you to reach in and manipulate state globally. Soroban, being built on Rust’s strict safety principles, is much more guarded.

In Soroban, even in tests, you often cannot touch storage unless you are explicitly in a "contract context." If your fuzzer setup tries to inject data into persistent storage without wrapping it in an `env.as_contract()` block, the SDK will punish you with a panic. This forces a much higher level of discipline in how you mock your testing environment.

### 4. The WASM Performance Trade-off
While the setup is more manual, the performance is devastatingly fast. Because you are fuzzing compiled WASM/Rust code at nearly native speeds, you can often reach execution rates of **10,000+ runs per second**. 

In a recent campaign for a lending protocol, we found a critical logic overflow in under 10 seconds—an edge case that would have required millions of "random" manual transactions to hit on a testnet.

---

### Conclusion: The "Better Code" Dividend
Fuzzing Soroban is harder to set up than Solidity, but it rewards you with something better. Because you are forced to handle errors as `Result` types (thanks to `try_invoke_contract`) and strictly manage environments, your "test harness" often ends up being as robust as the contract itself.

In the world of smart contract security, "easy" is often the enemy of "thorough." Soroban fuzzing makes you work for it, but the bugs it uncovers are the ones that would otherwise keep you up at night.

---
*Are you building on Soroban? Check out [soroban-sdk](https://github.com/stellar/soroban-sdk) and start your first fuzzing campaign today.*
