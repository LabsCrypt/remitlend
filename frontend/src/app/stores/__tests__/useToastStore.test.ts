import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "../useToastStore";

describe("useToastStore", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  describe("addToast", () => {
    it("adds a toast with default duration for success type", () => {
      const id = useToastStore.getState().addToast({
        type: "success",
        title: "Success",
      });

      const toast = useToastStore.getState().toasts[0];
      expect(toast).toMatchObject({
        type: "success",
        title: "Success",
        duration: 5000,
      });
      expect(toast.id).toBe(id);
    });

    it("adds a toast with error duration for error type", () => {
      const id = useToastStore.getState().addToast({
        type: "error",
        title: "Error",
      });

      const toast = useToastStore.getState().toasts[0];
      expect(toast.duration).toBe(10000);
    });

    it("respects custom duration when provided", () => {
      useToastStore.getState().addToast({
        type: "success",
        title: "Success",
        duration: 3000,
      });

      const toast = useToastStore.getState().toasts[0];
      expect(toast.duration).toBe(3000);
    });

    it("generates unique IDs for each toast", () => {
      const id1 = useToastStore.getState().addToast({
        type: "success",
        title: "First",
      });
      const id2 = useToastStore.getState().addToast({
        type: "success",
        title: "Second",
      });

      expect(id1).not.toBe(id2);
    });

    it("prepends new toasts to the array", () => {
      useToastStore.getState().addToast({ type: "success", title: "First" });
      useToastStore.getState().addToast({ type: "success", title: "Second" });

      const toasts = useToastStore.getState().toasts;
      expect(toasts[0].title).toBe("Second");
      expect(toasts[1].title).toBe("First");
    });

    it("truncates toasts to MAX_STORED_TOASTS (20)", () => {
      for (let i = 0; i < 25; i++) {
        useToastStore.getState().addToast({
          type: "success",
          title: `Toast ${i}`,
        });
      }

      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(20);
      expect(toasts[0].title).toBe("Toast 24");
      expect(toasts[19].title).toBe("Toast 5");
    });

    it("uses provided ID if supplied", () => {
      useToastStore.getState().addToast({
        id: "custom-id",
        type: "success",
        title: "Custom",
      });

      const toast = useToastStore.getState().toasts[0];
      expect(toast.id).toBe("custom-id");
    });
  });

  describe("updateToast", () => {
    it("updates an existing toast", () => {
      const id = useToastStore.getState().addToast({
        type: "success",
        title: "Original",
      });

      useToastStore.getState().updateToast(id, {
        title: "Updated",
      });

      const toast = useToastStore.getState().toasts[0];
      expect(toast.title).toBe("Updated");
    });

    it("recomputes duration when type changes and duration is not provided", () => {
      const id = useToastStore.getState().addToast({
        type: "success",
        title: "Test",
      });

      useToastStore.getState().updateToast(id, {
        type: "error",
      });

      const toast = useToastStore.getState().toasts[0];
      expect(toast.duration).toBe(10000);
    });

    it("preserves custom duration when provided during update", () => {
      const id = useToastStore.getState().addToast({
        type: "success",
        title: "Test",
      });

      useToastStore.getState().updateToast(id, {
        type: "error",
        duration: 7000,
      });

      const toast = useToastStore.getState().toasts[0];
      expect(toast.duration).toBe(7000);
    });

    it("does not recompute duration when type is unchanged", () => {
      const id = useToastStore.getState().addToast({
        type: "success",
        title: "Test",
        duration: 3000,
      });

      useToastStore.getState().updateToast(id, {
        description: "Added description",
      });

      const toast = useToastStore.getState().toasts[0];
      expect(toast.duration).toBe(3000);
    });

    it("does not affect other toasts when updating one", () => {
      const id1 = useToastStore.getState().addToast({
        type: "success",
        title: "First",
      });
      const id2 = useToastStore.getState().addToast({
        type: "success",
        title: "Second",
      });

      useToastStore.getState().updateToast(id1, {
        title: "First Updated",
      });

      const toasts = useToastStore.getState().toasts;
      expect(toasts[1].title).toBe("First Updated");
      expect(toasts[0].title).toBe("Second");
    });

    it("silently ignores update to non-existent toast", () => {
      useToastStore.getState().addToast({
        type: "success",
        title: "Test",
      });

      useToastStore.getState().updateToast("non-existent", {
        title: "Updated",
      });

      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].title).toBe("Test");
    });
  });

  describe("dismissToast", () => {
    it("removes a toast by ID", () => {
      const id = useToastStore.getState().addToast({
        type: "success",
        title: "Test",
      });

      useToastStore.getState().dismissToast(id);

      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it("only removes the specified toast", () => {
      const id1 = useToastStore.getState().addToast({
        type: "success",
        title: "First",
      });
      const id2 = useToastStore.getState().addToast({
        type: "success",
        title: "Second",
      });

      useToastStore.getState().dismissToast(id2);

      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].id).toBe(id1);
    });

    it("silently handles dismissal of non-existent toast", () => {
      useToastStore.getState().addToast({
        type: "success",
        title: "Test",
      });

      useToastStore.getState().dismissToast("non-existent");

      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe("clearToasts", () => {
    it("removes all toasts", () => {
      useToastStore.getState().addToast({ type: "success", title: "First" });
      useToastStore.getState().addToast({ type: "success", title: "Second" });
      useToastStore.getState().addToast({ type: "success", title: "Third" });

      useToastStore.getState().clearToasts();

      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it("can be called on empty store without error", () => {
      expect(() => {
        useToastStore.getState().clearToasts();
      }).not.toThrow();

      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });
});
