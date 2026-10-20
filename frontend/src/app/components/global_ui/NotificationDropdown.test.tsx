import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotificationDropdown } from "./NotificationDropdown";
import {
  useNotifications,
  useMarkNotificationsRead,
  useMarkAllNotificationsRead,
  type AppNotification,
} from "../../hooks/useApi";

const mockRouterPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      viewAll: "View all notifications",
    };
    return translations[key] ?? key;
  },
}));

jest.mock("../../hooks/useNotificationStream", () => ({
  useNotificationStream: jest.fn(),
}));

jest.mock("../../hooks/useApi", () => ({
  useNotifications: jest.fn(),
  useMarkNotificationsRead: jest.fn(),
  useMarkAllNotificationsRead: jest.fn(),
}));

describe("NotificationDropdown focus management (#1885)", () => {
  const mockMarkReadMutate = jest.fn();
  const mockMarkAllReadMutate = jest.fn();

  const sampleNotifications: AppNotification[] = [
    {
      id: 42,
      userId: 1,
      type: "repayment_due",
      title: "Repayment Due Soon",
      message: "Your loan payment is due in 3 days.",
      read: false,
      createdAt: new Date().toISOString(),
      loanId: 101,
    },
    {
      id: 43,
      userId: 1,
      type: "loan_approved",
      title: "Loan Approved",
      message: "Your loan request #102 was approved.",
      read: true,
      createdAt: new Date().toISOString(),
      loanId: 102,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    (useMarkNotificationsRead as unknown as jest.Mock).mockReturnValue({
      mutate: mockMarkReadMutate,
      isPending: false,
    });

    (useMarkAllNotificationsRead as unknown as jest.Mock).mockReturnValue({
      mutate: mockMarkAllReadMutate,
      isPending: false,
    });

    (useNotifications as unknown as jest.Mock).mockReturnValue({
      data: {
        notifications: sampleNotifications,
        unreadCount: 1,
        total: 2,
      },
      isLoading: false,
    });
  });

  it("moves focus to the panel when the dropdown is opened via the bell button", async () => {
    render(<NotificationDropdown />);

    const bellButton = screen.getByRole("button", { name: /notifications, 1 unread/i });
    fireEvent.click(bellButton);

    const dialogPanel = screen.getByRole("dialog", { name: /notifications panel/i });
    expect(dialogPanel).toBeInTheDocument();

    await waitFor(() => {
      expect(document.activeElement).toBe(dialogPanel);
    });
  });

  it("returns focus to the bell trigger button when closed via Escape key", async () => {
    render(<NotificationDropdown />);

    const bellButton = screen.getByRole("button", { name: /notifications, 1 unread/i });
    fireEvent.click(bellButton);

    const dialogPanel = screen.getByRole("dialog", { name: /notifications panel/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(dialogPanel);
    });

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });

    // Verify aria-expanded is updated and focus is restored to bell button
    expect(bellButton).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.activeElement).toBe(bellButton);
    });
  });

  it("returns focus to the bell trigger button when closed via outside click", async () => {
    render(
      <div>
        <div data-testid="outside-element">Outside Page Area</div>
        <NotificationDropdown />
      </div>,
    );

    const bellButton = screen.getByRole("button", { name: /notifications, 1 unread/i });
    fireEvent.click(bellButton);

    const dialogPanel = screen.getByRole("dialog", { name: /notifications panel/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(dialogPanel);
    });

    // Click outside
    const outsideEl = screen.getByTestId("outside-element");
    fireEvent.mouseDown(outsideEl);

    expect(bellButton).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.activeElement).toBe(bellButton);
    });
  });

  it("returns focus to the bell trigger button when closed via the X close button", async () => {
    render(<NotificationDropdown />);

    const bellButton = screen.getByRole("button", { name: /notifications, 1 unread/i });
    fireEvent.click(bellButton);

    const dialogPanel = screen.getByRole("dialog", { name: /notifications panel/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(dialogPanel);
    });

    // Click the X close button
    const closeButton = screen.getByRole("button", { name: /close notifications/i });
    fireEvent.click(closeButton);

    expect(bellButton).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.activeElement).toBe(bellButton);
    });
  });

  it("returns focus to the bell trigger button when closed via notification navigation", async () => {
    render(<NotificationDropdown />);

    const bellButton = screen.getByRole("button", { name: /notifications, 1 unread/i });
    fireEvent.click(bellButton);

    const dialogPanel = screen.getByRole("dialog", { name: /notifications panel/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(dialogPanel);
    });

    // Click an unread item
    const unreadItem = screen.getByText("Repayment Due Soon");
    fireEvent.click(unreadItem);

    expect(mockRouterPush).toHaveBeenCalledWith("/loans/101");
    expect(bellButton).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.activeElement).toBe(bellButton);
    });
  });

  it("returns focus to the bell trigger button when closed via view all link", async () => {
    render(<NotificationDropdown />);

    const bellButton = screen.getByRole("button", { name: /notifications, 1 unread/i });
    fireEvent.click(bellButton);

    const dialogPanel = screen.getByRole("dialog", { name: /notifications panel/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(dialogPanel);
    });

    // Click "View all notifications"
    const viewAllButton = screen.getByRole("button", { name: "View all notifications" });
    fireEvent.click(viewAllButton);

    expect(mockRouterPush).toHaveBeenCalledWith("/en/notifications");
    expect(bellButton).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.activeElement).toBe(bellButton);
    });
  });
});
