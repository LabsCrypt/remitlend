"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { getTxUrl, truncateHash } from "../../utils/stellar";

interface TxHashLinkProps {
  txHash: string;
  chars?: number;
  className?: string;
}

export function TxHashLink({ txHash, chars = 8, className = "" }: TxHashLinkProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs text-zinc-600 dark:text-zinc-400 ${className}`}
      title={txHash}
    >
      <span>{truncateHash(txHash, chars)}</span>

      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy transaction hash"
        className="rounded p-0.5 transition hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>

      <a
        href={getTxUrl(txHash)}
        target="_blank"
        rel="noreferrer"
        aria-label="View on Stellar Explorer"
        className="rounded p-0.5 transition hover:text-indigo-600 dark:hover:text-indigo-400"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}
