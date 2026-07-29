"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface WizardStep {
  id: number;
  label: string;
  description: string;
}

interface WizardStepperProps {
  steps: WizardStep[];
  currentStep: number;
  onStepSelect?: (stepId: number) => void;
}

export function WizardStepper({ steps, currentStep, onStepSelect }: WizardStepperProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const isReachable = (step: WizardStep) => step.id <= currentStep;

  const focusReachableStepAt = (index: number) => {
    const step = steps[index];
    if (!step || !isReachable(step)) return;
    buttonRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusReachableStepAt(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusReachableStepAt(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusReachableStepAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      const lastReachableIndex = steps.reduce(
        (lastIndex, step, i) => (isReachable(step) ? i : lastIndex),
        index,
      );
      focusReachableStepAt(lastReachableIndex);
    }
  };

  return (
    <nav aria-label="Loan application progress" className="w-full">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const isCompleted = step.id < currentStep;
          const isCurrent = step.id === currentStep;
          const isLast = index === steps.length - 1;
          const reachable = isReachable(step);

          return (
            <li key={step.id} className={cn("flex items-center", !isLast && "flex-1")}>
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <button
                  ref={(el) => {
                    buttonRefs.current[index] = el;
                  }}
                  type="button"
                  disabled={!reachable}
                  tabIndex={isCurrent ? 0 : -1}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`Step ${step.id}: ${step.label}`}
                  onClick={() => reachable && onStepSelect?.(step.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
                    !reachable && "cursor-not-allowed",
                    isCompleted && "border-indigo-600 bg-indigo-600 text-white",
                    isCurrent &&
                      "border-indigo-600 bg-white text-indigo-600 dark:bg-zinc-950 dark:text-indigo-400 shadow-sm",
                    !isCompleted &&
                      !isCurrent &&
                      "border-zinc-300 bg-white text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-500",
                  )}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : <span>{step.id}</span>}
                </button>
                <div className="hidden sm:block text-center">
                  <p
                    className={cn(
                      "text-xs font-medium leading-tight",
                      isCurrent
                        ? "text-indigo-600 dark:text-indigo-400"
                        : isCompleted
                          ? "text-zinc-700 dark:text-zinc-300"
                          : "text-zinc-400 dark:text-zinc-500",
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight max-w-[80px]">
                    {step.description}
                  </p>
                </div>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div
                  className={cn(
                    "mx-2 h-0.5 flex-1 transition-all",
                    isCompleted ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-700",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
