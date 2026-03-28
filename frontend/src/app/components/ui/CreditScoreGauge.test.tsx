import { render, screen } from "@testing-library/react";
import { CreditScoreGauge } from "./CreditScoreGauge";

describe("CreditScoreGauge", () => {
  it("renders a loading skeleton", () => {
    render(<CreditScoreGauge isLoading score={null} />);

    expect(screen.getByLabelText("Loading credit score")).toBeInTheDocument();
  });

  it("renders an error fallback", () => {
    render(<CreditScoreGauge error="Network error" score={null} />);

    expect(screen.getByText("Credit score unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("We could not reach the score service. Reconnect or try again shortly."),
    ).toBeInTheDocument();
  });
});
