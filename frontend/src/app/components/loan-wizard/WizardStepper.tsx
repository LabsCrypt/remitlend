"use client";

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
}

export function WizardStepper({ steps, currentStep }: WizardStepperProps) {
  return (
    <nav aria-label="Loan application progress" className="w-full">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const isCompleted = step.id < currentStep;
          const isCurrent = step.id === currentStep;
          const isLast = index === steps.length - 1;

          return (
            <li key={step.id} className={cn("flex items-center", !isLast && "flex-1")}>
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all",
                    isCompleted && "border-indigo-600 bg-indigo-600 text-white",
                    isCurrent &&
                      "border-indigo-600 bg-white text-indigo-600 dark:bg-zinc-950 dark:text-indigo-400 shadow-sm",
                    !isCompleted &&
                      !isCurrent &&
                      "border-zinc-300 bg-white text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-500",
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : <span>{step.id}</span>}
                </div>
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
