import { useToastStore, type ToastType } from "./useToastStore";

describe("useToastStore", () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
  });

  describe("addToast and default duration selection", () => {
    it("assigns 10000ms default duration to error toasts", () => {
      const id = useToastStore.getState().addToast({
        type: "error",
        title: "Transaction failed",
      });

      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(toast).toBeDefined();
      expect(toast?.duration).toBe(10000);
    });

    it("assigns 5000ms default duration to non-error toasts (success, warning, info)", () => {
      const nonErrorTypes: ToastType[] = ["success", "warning", "info"];

      for (const type of nonErrorTypes) {
        const id = useToastStore.getState().addToast({
          type,
          title: `${type} toast`,
        });

        const toast = useToastStore.getState().toasts.find((t) => t.id === id);
        expect(toast?.duration).toBe(5000);
      }
    });

    it("preserves explicit custom duration when provided", () => {
      const id = useToastStore.getState().addToast({
        type: "error",
        title: "Quick error",
        duration: 2500,
      });

      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(toast?.duration).toBe(2500);
    });

    it("preserves custom ID when provided or generates a unique id", () => {
      const customId = "my-custom-toast-id";
      const returnedId = useToastStore.getState().addToast({
        id: customId,
        type: "info",
        title: "Notice",
      });

      expect(returnedId).toBe(customId);
      expect(useToastStore.getState().toasts[0].id).toBe(customId);

      const generatedId = useToastStore.getState().addToast({
        type: "success",
        title: "Auto ID",
      });
      expect(generatedId).toMatch(/^toast-\d+-\d+$/);
    });

    it("prepends new toasts to the front of the list", () => {
      const id1 = useToastStore.getState().addToast({ type: "info", title: "First" });
      const id2 = useToastStore.getState().addToast({ type: "info", title: "Second" });

      const toasts = useToastStore.getState().toasts;
      expect(toasts[0].id).toBe(id2);
      expect(toasts[1].id).toBe(id1);
    });
  });

  describe("MAX_STORED_TOASTS truncation behavior", () => {
    it("bounds the stored toasts list to at most 20 entries", () => {
      for (let i = 1; i <= 25; i++) {
        useToastStore.getState().addToast({
          type: "info",
          title: `Toast #${i}`,
        });
      }

      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(20);

      // Most recent toast (#25) should be at the head
      expect(toasts[0].title).toBe("Toast #25");
      // 20th stored toast should be #6 (first 5 dropped)
      expect(toasts[19].title).toBe("Toast #6");
    });
  });

  describe("updateToast and duration recomputation on type change", () => {
    it("updates toast properties while retaining existing ID", () => {
      const id = useToastStore.getState().addToast({
        type: "info",
        title: "Processing payment...",
      });

      useToastStore.getState().updateToast(id, {
        description: "Checking ledger confirmations",
        txHash: "0x123abc",
      });

      const updated = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(updated?.title).toBe("Processing payment...");
      expect(updated?.description).toBe("Checking ledger confirmations");
      expect(updated?.txHash).toBe("0x123abc");
    });

    it("recomputes duration to 10000ms when type changes from non-error to error", () => {
      const id = useToastStore.getState().addToast({
        type: "info",
        title: "Submitting tx",
      });

      expect(useToastStore.getState().toasts[0].duration).toBe(5000);

      useToastStore.getState().updateToast(id, {
        type: "error",
        title: "Tx reverted",
      });

      const updated = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(updated?.type).toBe("error");
      expect(updated?.duration).toBe(10000);
    });

    it("recomputes duration to 5000ms when type changes from error to non-error", () => {
      const id = useToastStore.getState().addToast({
        type: "error",
        title: "Network error",
      });

      expect(useToastStore.getState().toasts[0].duration).toBe(10000);

      useToastStore.getState().updateToast(id, {
        type: "success",
        title: "Reconnected",
      });

      const updated = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(updated?.type).toBe("success");
      expect(updated?.duration).toBe(5000);
    });

    it("preserves explicit duration passed in update when type changes", () => {
      const id = useToastStore.getState().addToast({
        type: "info",
        title: "Pending",
      });

      useToastStore.getState().updateToast(id, {
        type: "error",
        duration: 3000,
      });

      const updated = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(updated?.duration).toBe(3000);
    });

    it("does not alter duration if the type does not change", () => {
      const id = useToastStore.getState().addToast({
        type: "error",
        title: "Initial error",
        duration: 12000,
      });

      useToastStore.getState().updateToast(id, {
        title: "Updated error title",
      });

      const updated = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(updated?.duration).toBe(12000);
    });

    it("safely ignores updates targeting a non-existent ID", () => {
      useToastStore.getState().addToast({ type: "info", title: "Existing" });

      expect(() => {
        useToastStore.getState().updateToast("non-existent-id", {
          title: "Ghost",
        });
      }).not.toThrow();

      expect(useToastStore.getState().toasts).toHaveLength(1);
      expect(useToastStore.getState().toasts[0].title).toBe("Existing");
    });
  });

  describe("dismissToast and clearToasts", () => {
    it("dismisses only the specified toast by ID", () => {
      const id1 = useToastStore.getState().addToast({ type: "info", title: "First" });
      const id2 = useToastStore.getState().addToast({ type: "info", title: "Second" });

      useToastStore.getState().dismissToast(id1);

      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].id).toBe(id2);
    });

    it("clearToasts empties all stored toasts", () => {
      useToastStore.getState().addToast({ type: "info", title: "A" });
      useToastStore.getState().addToast({ type: "info", title: "B" });

      useToastStore.getState().clearToasts();
      expect(useToastStore.getState().toasts).toEqual([]);
    });
  });
});
