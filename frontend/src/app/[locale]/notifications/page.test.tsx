import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import NotificationsPage from "./page";
import {
  useNotifications,
  useMarkNotificationsRead,
  type AppNotification,
} from "../../hooks/useApi";
import { useToastStore } from "../../stores/useToastStore";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/en/notifications",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      eyebrow: "Inbox",
      title: "Notifications",
      description: "Review repayment reminders, score changes, loan updates, and alerts.",
      unread: "Unread",
      markRead: "Mark read",
      markAllVisibleRead: "Mark unread as read",
      "filters.title": "Filters",
      "types.all": "All",
      "types.loan_approved": "Loan approved",
      "types.repayment_due": "Repayment due",
      "types.repayment_confirmed": "Repayment confirmed",
      "types.loan_defaulted": "Loan defaulted",
      "types.score_changed": "Score changed",
      "types.dispute_opened": "Dispute opened",
      "types.dispute_contested": "Default contested",
      "empty.title": "No notifications found",
      "empty.description": "New alerts and reminders will appear here.",
      "empty.action": "Back to dashboard",
      error: "Unable to load notifications. Please try again.",
      "pagination.summary": "Showing 2 of 2 notifications on page 1",
    };
    return translations[key] ?? key;
  },
}));

jest.mock("../../hooks/useApi", () => ({
  useNotifications: jest.fn(),
  useMarkNotificationsRead: jest.fn(),
}));

describe("NotificationsPage error handling (closes #1897)", () => {
  const mockMarkReadMutate = jest.fn();

  const sampleNotifications: AppNotification[] = [
    {
      id: 10,
      userId: 1,
      type: "repayment_due",
      title: "Repayment Overdue Alert",
      message: "Please submit your repayment promptly.",
      read: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: 11,
      userId: 1,
      type: "score_changed",
      title: "Score Increased",
      message: "Your credit score increased by 15 points.",
      read: false,
      createdAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    useToastStore.getState().clearToasts();

    (useMarkNotificationsRead as unknown as jest.Mock).mockReturnValue({
      mutate: mockMarkReadMutate,
      isPending: false,
    });

    (useNotifications as unknown as jest.Mock).mockReturnValue({
      data: {
        notifications: sampleNotifications,
        unreadCount: 2,
        total: 2,
      },
      isLoading: false,
      isError: false,
    });
  });

  it("calls markRead.mutate with onError when a row 'Mark read' button is clicked", () => {
    render(<NotificationsPage />);

    const markReadButtons = screen.getAllByRole("button", { name: /mark read/i });
    expect(markReadButtons.length).toBeGreaterThan(0);

    fireEvent.click(markReadButtons[0]);

    expect(mockMarkReadMutate).toHaveBeenCalledTimes(1);
    expect(mockMarkReadMutate).toHaveBeenCalledWith([10], {
      onError: expect.any(Function),
    });
  });

  it("surfaces an error toast when single row markRead mutation fails", () => {
    render(<NotificationsPage />);

    const markReadButtons = screen.getAllByRole("button", { name: /mark read/i });
    fireEvent.click(markReadButtons[0]);

    const options = mockMarkReadMutate.mock.calls[0][1];
    expect(options?.onError).toBeDefined();

    options.onError(new Error("Database connection refused"));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].title).toBe("Failed to mark notification as read");
    expect(toasts[0].description).toBe("Database connection refused");
  });

  it("calls markRead.mutate with unread IDs and onError when 'Mark unread as read' is clicked", () => {
    render(<NotificationsPage />);

    const markAllVisibleBtn = screen.getByRole("button", { name: /mark unread as read/i });
    fireEvent.click(markAllVisibleBtn);

    expect(mockMarkReadMutate).toHaveBeenCalledTimes(1);
    expect(mockMarkReadMutate).toHaveBeenCalledWith([10, 11], {
      onError: expect.any(Function),
    });
  });

  it("surfaces an error toast when bulk mark-read mutation fails", () => {
    render(<NotificationsPage />);

    const markAllVisibleBtn = screen.getByRole("button", { name: /mark unread as read/i });
    fireEvent.click(markAllVisibleBtn);

    const options = mockMarkReadMutate.mock.calls[0][1];
    expect(options?.onError).toBeDefined();

    options.onError(new Error("Bulk update rate-limited"));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].title).toBe("Failed to mark notifications as read");
    expect(toasts[0].description).toBe("Bulk update rate-limited");
  });

  it("does not optimistically hide unread badges when mutation fails", () => {
    render(<NotificationsPage />);

    const markReadButtons = screen.getAllByRole("button", { name: /mark read/i });
    fireEvent.click(markReadButtons[0]);

    const options = mockMarkReadMutate.mock.calls[0][1];
    options.onError(new Error("Failed"));

    // Both unread badges remain visible
    const unreadBadges = screen.getAllByText("Unread");
    expect(unreadBadges.length).toBe(2);
  });
});
