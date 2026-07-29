import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WizardStepper, type WizardStep } from "../WizardStepper";

const steps: WizardStep[] = [
  { id: 1, label: "Amount", description: "Choose amount" },
  { id: 2, label: "Collateral", description: "Select NFT" },
  { id: 3, label: "Schedule", description: "Repayment plan" },
  { id: 4, label: "Sign", description: "Final signature" },
];

function getStepButton(stepId: number) {
  return screen.getByRole("button", { name: new RegExp(`Step ${stepId}:`) });
}

describe("WizardStepper keyboard navigation", () => {
  it("marks the current step with aria-current", () => {
    render(<WizardStepper steps={steps} currentStep={2} />);

    expect(getStepButton(2)).toHaveAttribute("aria-current", "step");
    expect(getStepButton(1)).not.toHaveAttribute("aria-current");
    expect(getStepButton(3)).not.toHaveAttribute("aria-current");
  });

  it("allows moving focus between reachable steps with arrow keys", async () => {
    const user = userEvent.setup();
    render(<WizardStepper steps={steps} currentStep={3} />);

    getStepButton(3).focus();
    expect(getStepButton(3)).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(getStepButton(2)).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(getStepButton(1)).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(getStepButton(2)).toHaveFocus();
  });

  it("supports Home and End to jump to reachable boundary steps", async () => {
    const user = userEvent.setup();
    render(<WizardStepper steps={steps} currentStep={3} />);

    getStepButton(2).focus();
    await user.keyboard("{Home}");
    expect(getStepButton(1)).toHaveFocus();

    await user.keyboard("{End}");
    expect(getStepButton(3)).toHaveFocus();
  });

  it("does not move focus past the last reachable step", async () => {
    const user = userEvent.setup();
    render(<WizardStepper steps={steps} currentStep={2} />);

    getStepButton(2).focus();
    await user.keyboard("{ArrowRight}");
    expect(getStepButton(2)).toHaveFocus();
  });

  it("disables and removes future steps from the tab order", () => {
    render(<WizardStepper steps={steps} currentStep={2} />);

    const futureStep = getStepButton(3);
    expect(futureStep).toBeDisabled();
    expect(futureStep).toHaveAttribute("tabIndex", "-1");

    const anotherFutureStep = getStepButton(4);
    expect(anotherFutureStep).toBeDisabled();
    expect(anotherFutureStep).toHaveAttribute("tabIndex", "-1");
  });

  it("keeps completed and current steps enabled and reachable", () => {
    render(<WizardStepper steps={steps} currentStep={2} />);

    expect(getStepButton(1)).not.toBeDisabled();
    expect(getStepButton(2)).not.toBeDisabled();
  });

  it("invokes onStepSelect when a reachable step is activated via keyboard", async () => {
    const user = userEvent.setup();
    const onStepSelect = jest.fn();
    render(<WizardStepper steps={steps} currentStep={3} onStepSelect={onStepSelect} />);

    getStepButton(1).focus();
    await user.keyboard("{Enter}");

    expect(onStepSelect).toHaveBeenCalledWith(1);
  });
});
