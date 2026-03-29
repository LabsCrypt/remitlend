"use client";

import { RouteErrorView } from "../../components/global_ui/RouteErrorView";

export default function SendRemittanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorView error={error} reset={reset} scope="send remittance page" />;
}
