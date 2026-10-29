import { cn } from "./cn";

describe("cn utils", () => {
  describe("cn", () => {
    it("joins multiple class names with a space", () => {
      expect(cn("btn", "btn-primary")).toBe("btn btn-primary");
    });

    it("returns an empty string when called with no arguments", () => {
      expect(cn()).toBe("");
    });

    it("skips falsy conditional values", () => {
      expect(cn("btn", false && "hidden", undefined, null, "px-2")).toBe("btn px-2");
    });

    it("supports object-style conditional classes", () => {
      expect(cn({ "text-red-500": true, "text-blue-500": false }, "font-bold")).toBe(
        "text-red-500 font-bold",
      );
    });

    it("flattens arrays and nested arrays", () => {
      expect(cn(["p-2", ["mt-1", null]])).toBe("p-2 mt-1");
    });

    it("deduplicates identical class names", () => {
      expect(cn("mx-2", "mx-2")).toBe("mx-2");
    });

    it("keeps non-conflicting classes from every argument", () => {
      expect(cn("p-2 text-sm", "text-red-500 rounded")).toBe("p-2 text-sm text-red-500 rounded");
    });

    it("lets a later conflicting tailwind class override an earlier one", () => {
      expect(cn("p-2", "p-4")).toBe("p-4");
      expect(cn("text-sm", "text-lg")).toBe("text-lg");
      expect(cn("bg-white", "bg-slate-900")).toBe("bg-slate-900");
    });

    it("resolves conflicts inside arrays and across array/argument boundaries", () => {
      expect(cn(["p-2", "p-4"])).toBe("p-4");
      expect(cn(["p-2", "p-4"], "p-8")).toBe("p-8");
    });

    it("resolves arbitrary-value conflicts by property", () => {
      expect(cn("w-16", "w-[13rem]")).toBe("w-[13rem]");
    });

    it("keeps variant-scoped classes separate from unscoped ones", () => {
      expect(cn("p-2", "hover:p-4")).toBe("p-2 hover:p-4");
    });

    it("resolves conflicts within the same variant", () => {
      expect(cn("hover:p-2", "hover:p-4")).toBe("hover:p-4");
      expect(cn("md:flex", "md:grid")).toBe("md:grid");
    });

    it("merges conflicting groups independently in one string", () => {
      expect(cn("p-2 text-sm", "p-6 text-lg", "text-red-500")).toBe("p-6 text-lg text-red-500");
    });
  });
});
