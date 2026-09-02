import { useMutation } from "@tanstack/react-query";
import { useState, useCallback } from "react";

interface RevealOptions {
  recipientId: string;
  field: "email" | "phone" | "name";
  reason: string;
}

export function useReveal() {
  const [revealedValue, setRevealedValue] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (options: RevealOptions): Promise<string> => {
      const res = await fetch(`/api/recipients/${options.recipientId}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: options.field,
          reason: options.reason,
        }),
      });

      if (!res.ok) {
        throw new Error(`Reveal failed: ${res.statusText}`);
      }

      const data = (await res.json()) as { value: string };
      return data.value;
    },
    onSuccess: (value) => {
      setRevealedValue(value);
    },
  });

  const clearRevealed = useCallback(() => {
    setRevealedValue(null);
    mutation.reset();
  }, [mutation]);

  return {
    reveal: mutation.mutate,
    revealedValue,
    clearRevealed,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
