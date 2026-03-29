"use client";

import { useState } from "react";
import { WizardStepper } from "./WizardStepper";
import { StepAmountAsset } from "./StepAmountAsset";
import { StepRepaymentSchedule } from "./StepRepaymentSchedule";
import { StepCollateralNFT } from "./StepCollateralNFT";
import { StepFinalSignature } from "./StepFinalSignature";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoanWizardData {
  /** Step 1 */
  amount: string;
  asset: "USDC";
  termDays: 30 | 60 | 90;
  /** Step 3 */
  collateralConfirmed: boolean;
  /** Derived from credit score query (passed in) */
  creditScore: number;
  maxAmount: number;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { id: 1, label: "Amount & Asset", description: "Select loan amount" },
  { id: 2, label: "Repayment", description: "Preview schedule" },
  { id: 3, label: "Collateral", description: "Confirm NFT link" },
  { id: 4, label: "Signature", description: "Sign & submit" },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

interface LoanApplicationWizardProps {
  borrowerAddress: string;
  creditScore: number;
  maxAmount: number;
  onSuccess: (loanId: string) => void;
}

export function LoanApplicationWizard({
  borrowerAddress,
  creditScore,
  maxAmount,
  onSuccess,
}: LoanApplicationWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [wizardData, setWizardData] = useState<LoanWizardData>({
    amount: "",
    asset: "USDC",
    termDays: 30,
    collateralConfirmed: false,
    creditScore,
    maxAmount,
  });

  const updateData = (updates: Partial<LoanWizardData>) => {
    setWizardData((prev) => ({ ...prev, ...updates }));
  };

  const goNext = () => {
    setStepError(null);
    setCurrentStep((s) => Math.min(s + 1, 4));
  };

  const goBack = () => {
    setStepError(null);
    setCurrentStep((s) => Math.max(s - 1, 1));
  };

  return (
    <div className="space-y-8">
      {/* Step progress indicator */}
      <WizardStepper steps={[...WIZARD_STEPS]} currentStep={currentStep} />

      {/* Step panels */}
      {currentStep === 1 && (
        <StepAmountAsset
          data={wizardData}
          onChange={updateData}
          onNext={goNext}
          error={stepError}
          onError={setStepError}
        />
      )}

      {currentStep === 2 && (
        <StepRepaymentSchedule data={wizardData} onNext={goNext} onBack={goBack} />
      )}

      {currentStep === 3 && (
        <StepCollateralNFT
          data={wizardData}
          onChange={updateData}
          onNext={goNext}
          onBack={goBack}
        />
      )}

      {currentStep === 4 && (
        <StepFinalSignature
          data={wizardData}
          borrowerAddress={borrowerAddress}
          onBack={goBack}
          onSuccess={onSuccess}
        />
      )}
    </div>
  );
}
