import { FC } from "react";

interface SpinnerProps {
  type?: "spin" | "bounce" | "double-spinner";
  color?: string;
  size?: number | "sm" | "md" | "lg";
  duration?: number;
  delayStep?: number;
  label?: string;
}

const SIZE_MAP = {
  sm: 16,
  md: 24,
  lg: 40,
} as const;

export const Spinner: FC<SpinnerProps> = ({
  type = "spin",
  color,
  size = "md",
  duration = 1,
  delayStep = 0.2,
  label = "Loading...",
}) => {
  const numericSize = typeof size === "string" ? SIZE_MAP[size] : size;
  if (type === "spin") {
    return (
      <div role="status" className="inline-flex">
        <div
          style={{
            width: numericSize + "px",
            height: numericSize + "px",
            borderColor: color || "white",
            borderTopColor: "transparent",
            borderStyle: "solid",
            borderWidth: "4px",
            animationDuration: `${duration}s`,
          }}
          aria-hidden="true"
          className="animate-spin rounded-full inline-block box-border"
        />
        <span className="sr-only">{label}</span>
      </div>
    );
  } else if (type === "double-spinner") {
    return (
      <div role="status" className="relative inline-block">
        {/* Outer Spinner */}
        <div
          style={{
            width: numericSize + "px",
            height: numericSize + "px",
            borderColor: color || "white",
            borderTopColor: "transparent",
            borderStyle: "solid",
            borderWidth: "3px",
            animationDuration: `${duration}s`,
          }}
          aria-hidden="true"
          className="animate-spin rounded-full box-border"
        />

        {/* Inner Spinner (reverse) */}
        <div
          style={{
            width: numericSize * 0.6 + "px",
            height: numericSize * 0.6 + "px",
            borderColor: color || "white",
            borderTopColor: "transparent",
            borderStyle: "solid",
            borderWidth: "3px",
            animationDuration: `${duration}s`,
          }}
          aria-hidden="true"
          className="animate-reverse-spin rounded-full box-border absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        />
        <span className="sr-only">{label}</span>
      </div>
    );
  }

  // Bounce Loader
  else {
    return (
      <div role="status" className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: numericSize + "px",
              height: numericSize + "px",
              backgroundColor: color || "white",
              animationDuration: `${duration}s`,
              animationDelay: `${i * delayStep}s`,
            }}
            aria-hidden="true"
            className="animate-dot-bounce rounded-full"
          />
        ))}
        <span className="sr-only">{label}</span>
      </div>
    );
  }
};
