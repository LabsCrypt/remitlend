"use client";

import { useState } from "react";
import { Copy, CheckCheck } from "lucide-react";

interface CopyButtonProps {
  value: string;
}

export const COPY_FEEDBACK_RESET_MS = 2000;

export function CopyButton({ value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_RESET_MS);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
      title="Copy to clipboard"
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
    >
      {copied ? <CheckCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}
