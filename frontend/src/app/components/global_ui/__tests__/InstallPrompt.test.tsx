import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InstallPrompt, DISMISSED_STORAGE_KEY } from "../InstallPrompt";

type Outcome = "accepted" | "dismissed";

interface MockBeforeInstallPromptEvent extends Event {
  prompt: jest.Mock<Promise<void>, []>;
  userChoice: Promise<{ outcome: Outcome }>;
}

const PROMPT_TEXT = /Install RemitLend for offline access/i;

const createInstallEvent = (outcome: Outcome): MockBeforeInstallPromptEvent => {
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as MockBeforeInstallPromptEvent;
  event.prompt = jest.fn(() => Promise.resolve());
  event.userChoice = Promise.resolve({ outcome });
  return event;
};

const dispatchBeforeInstallPrompt = (outcome: Outcome): MockBeforeInstallPromptEvent => {
  const event = createInstallEvent(outcome);
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

const installButton = () => screen.getByRole("button", { name: /^install$/i });
const dismissButton = () => screen.getByRole("button", { name: /dismiss install prompt/i });

describe("InstallPrompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it("renders nothing when the browser does not support install prompts", () => {
    const { container } = render(<InstallPrompt />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument();
  });

  it("shows the prompt when the browser fires beforeinstallprompt", () => {
    render(<InstallPrompt />);

    dispatchBeforeInstallPrompt("accepted");

    expect(screen.getByText(PROMPT_TEXT)).toBeInTheDocument();
    expect(installButton()).toBeInTheDocument();
  });

  it("prevents the default browser behavior for the install event", () => {
    render(<InstallPrompt />);

    const event = dispatchBeforeInstallPrompt("accepted");

    expect(event.defaultPrevented).toBe(true);
  });

  it("calls prompt and removes the prompt when the user accepts", async () => {
    render(<InstallPrompt />);

    const event = dispatchBeforeInstallPrompt("accepted");

    await act(async () => {
      fireEvent.click(installButton());
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument());
  });

  it("keeps the prompt visible when the user dismisses the native install dialog", async () => {
    render(<InstallPrompt />);

    const event = dispatchBeforeInstallPrompt("dismissed");

    await act(async () => {
      fireEvent.click(installButton());
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByText(PROMPT_TEXT)).toBeInTheDocument();
  });

  it("hides the prompt when the user clicks the dismiss button", () => {
    render(<InstallPrompt />);

    dispatchBeforeInstallPrompt("accepted");
    fireEvent.click(dismissButton());

    expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument();
  });

  it("persists the dismissal to localStorage", () => {
    render(<InstallPrompt />);

    dispatchBeforeInstallPrompt("accepted");
    fireEvent.click(dismissButton());

    expect(window.localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("true");
  });

  it("stays hidden on mount when a dismissal was previously persisted", () => {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, "true");

    render(<InstallPrompt />);

    dispatchBeforeInstallPrompt("accepted");

    expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument();
  });

  it("removes the beforeinstallprompt listener on unmount", () => {
    const removeSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = render(<InstallPrompt />);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("beforeinstallprompt", expect.anything());
  });
});
