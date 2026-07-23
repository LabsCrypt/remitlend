import { mergeInitNotifications } from "./useNotificationStream";
import type { AppNotification } from "./useApi";

function notification(id: number, createdAt: string, read = false): AppNotification {
  return {
    id,
    userId: "GUSER",
    type: "loan_approved",
    title: `Notification ${id}`,
    message: `Message ${id}`,
    read,
    createdAt,
  };
}

describe("mergeInitNotifications", () => {
  it("adds genuinely new init notifications and keeps existing ones", () => {
    const existing = [
      notification(1, "2026-07-23T10:00:00.000Z"),
      notification(2, "2026-07-23T09:00:00.000Z", true),
    ];
    const incoming = [
      notification(2, "2026-07-23T09:00:00.000Z", true),
      notification(3, "2026-07-23T11:00:00.000Z"),
    ];

    expect(mergeInitNotifications(existing, incoming).map((n) => n.id)).toEqual([3, 1, 2]);
  });
});