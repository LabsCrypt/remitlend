import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseContractImplMethods, parseDocumentedMethods } from "./check-contract-doc-sync.mjs";

describe("check-contract-doc-sync", () => {
  it("extracts methods from #[contractimpl] blocks", () => {
    const rustSource = `
      pub struct MyContract;

      #[contractimpl]
      impl MyContract {
          pub fn initialize(env: Env, admin: Address) {}
          pub fn deposit(env: Env, amount: i128) -> i128 {}
          fn private_helper() {}
      }
    `;

    const methods = parseContractImplMethods(rustSource);
    assert.deepEqual(Array.from(methods).sort(), ["deposit", "initialize"]);
  });

  it("extracts documented methods from Access Control markdown", () => {
    const md = `
### Access Control

**Remittance NFT Contract**:
- \`mint\`: Only admin or authorized minter
- \`update_score\`: Authorized minters

**Loan Manager Contract**:
- \`request_loan\`: Borrower
- \`approve_loan\`, \`reject_loan\`: Admin

## Other Section
- \`not_checked\`: ignored
    `;

    const docMethods = parseDocumentedMethods(md);
    assert.deepEqual(Array.from(docMethods.get("Remittance NFT")).sort(), ["mint", "update_score"]);
    assert.deepEqual(Array.from(docMethods.get("Loan Manager")).sort(), ["approve_loan", "reject_loan", "request_loan"]);
  });
});
