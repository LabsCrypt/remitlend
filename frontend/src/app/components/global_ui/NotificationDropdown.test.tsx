import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationDropdown } from "./NotificationDropdown";
import {
  useNotifications,
  useMarkNotificationsRead,
  useMarkAllNotificationsRead,
  type AppNotification,
} from "../../hooks/useApi";
import { useToastStore } from "../../stores/useToastStore";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
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

describe("NotificationDropdown error handling (closes #1897)", () => {
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
    useToastStore.getState().clearToasts();

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

  it("renders notification trigger with unread badge count", () => {
    render(<NotificationDropdown />);
    const bellButton = screen.getByRole("button", { name: /notifications, 1 unread/i });
    expect(bellButton).toBeInTheDocument();
  });

  it("calls markRead.mutate with onError handler when an unread notification is clicked", () => {
    render(<NotificationDropdown />);

    // Open dropdown panel
    const bellButton = screen.getByRole("button", { name: /notifications, 1 unread/i });
    fireEvent.click(bellButton);

    // Click on unread notification item
    const unreadItem = screen.getByText("Repayment Due Soon");
    fireEvent.click(unreadItem);

    expect(mockMarkReadMutate).toHaveBeenCalledTimes(1);
    expect(mockMarkReadMutate).toHaveBeenCalledWith([42], {
      onError: expect.any(Function),
    });
  });

  it("surfaces an error toast when single notification markRead mutation fails", () => {
    render(<NotificationDropdown />);

    // Open dropdown panel
    fireEvent.click(screen.getByRole("button", { name: /notifications, 1 unread/i }));

    // Click unread notification item
    fireEvent.click(screen.getByText("Repayment Due Soon"));

    // Extract onError callback passed to mutate
    const options = mockMarkReadMutate.mock.calls[0][1];
    expect(options?.onError).toBeDefined();

    // Trigger onError
    options.onError(new Error("Network connection lost"));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].title).toBe("Failed to mark notification as read");
    expect(toasts[0].description).toBe("Network connection lost");
  });

  it("calls markAllRead.mutate with onError handler when 'Mark all read' is clicked", () => {
    render(<NotificationDropdown />);

    // Open dropdown panel
    fireEvent.click(screen.getByRole("button", { name: /notifications, 1 unread/i }));

    const markAllButton = screen.getByRole("button", { name: /mark all read/i });
    fireEvent.click(markAllButton);

    expect(mockMarkAllReadMutate).toHaveBeenCalledTimes(1);
    expect(mockMarkAllReadMutate).toHaveBeenCalledWith(undefined, {
      onError: expect.any(Function),
    });
  });

  it("surfaces an error toast when markAllRead mutation fails", () => {
    render(<NotificationDropdown />);

    // Open dropdown panel
    fireEvent.click(screen.getByRole("button", { name: /notifications, 1 unread/i }));

    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));

    const options = mockMarkAllReadMutate.mock.calls[0][1];
    expect(options?.onError).toBeDefined();

    options.onError(new Error("Server 500 error"));

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].title).toBe("Failed to mark all notifications as read");
    expect(toasts[0].description).toBe("Server 500 error");
  });

  it("does not optimistically show the notification as read when mutation fails", () => {
    render(<NotificationDropdown />);

    fireEvent.click(screen.getByRole("button", { name: /notifications, 1 unread/i }));
    fireEvent.click(screen.getByText("Repayment Due Soon"));

    // Trigger failure
    const options = mockMarkReadMutate.mock.calls[0][1];
    options.onError(new Error("Failed"));

    // Notification still presents unread status indicator
    expect(screen.getByTitle("Unread notification")).toBeInTheDocument();
  });
});
