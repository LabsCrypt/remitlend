import { cn } from "./cn";

describe("cn utility (clsx + tailwind-merge)", () => {
  describe("basic class merging", () => {
    it("merges multiple string class names", () => {
      expect(cn("px-2", "py-1", "bg-white")).toBe("px-2 py-1 bg-white");
    });

    it("handles whitespace and trims excess spaces", () => {
      expect(cn("  px-4  ", " py-2 ")).toBe("px-4 py-2");
    });

    it("returns an empty string when given no arguments", () => {
      expect(cn()).toBe("");
    });

    it("filters out null, undefined, false, and empty string arguments", () => {
      expect(cn("base-class", null, undefined, false, "", "extra-class")).toBe(
        "base-class extra-class",
      );
    });

    it("returns empty string when all arguments are falsy", () => {
      expect(cn(null, undefined, false, "")).toBe("");
    });
  });

  describe("conditional class evaluation", () => {
    it("evaluates object-based conditional classes", () => {
      expect(
        cn("btn", {
          "btn-active": true,
          "btn-disabled": false,
          "btn-loading": true,
        }),
      ).toBe("btn btn-active btn-loading");
    });

    it("handles boolean short-circuit expressions", () => {
      const isPrimary = true;
      const isLarge = false;

      expect(cn("button", isPrimary && "button-primary", isLarge && "button-large")).toBe(
        "button button-primary",
      );
    });

    it("handles nested arrays and deep structures", () => {
      expect(cn(["layout", ["card", { "card-elevated": true, "card-flat": false }]])).toBe(
        "layout card card-elevated",
      );
    });
  });

  describe("tailwind-merge conflict resolution", () => {
    it("overrides earlier conflicting padding utility classes with later ones", () => {
      expect(cn("p-4", "p-2")).toBe("p-2");
    });

    it("correctly handles directional padding conflicts", () => {
      expect(cn("p-4", "px-2")).toBe("p-4 px-2");
      expect(cn("px-2", "p-4")).toBe("p-4");
    });

    it("overrides text color conflicts with the later class", () => {
      expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    });

    it("overrides background color conflicts with the later class", () => {
      expect(cn("bg-white", "bg-slate-900")).toBe("bg-slate-900");
    });

    it("overrides margin conflicts with the later class", () => {
      expect(cn("mt-2", "mt-6")).toBe("mt-6");
      expect(cn("m-4", "m-0")).toBe("m-0");
    });

    it("overrides display utility conflicts with the later class", () => {
      expect(cn("block", "flex", "hidden")).toBe("hidden");
    });

    it("handles modifier and responsive variant conflicts correctly", () => {
      expect(cn("hover:bg-red-500", "hover:bg-blue-500")).toBe("hover:bg-blue-500");
      expect(cn("md:p-4", "md:p-8")).toBe("md:p-8");
      expect(cn("p-4", "md:p-8")).toBe("p-4 md:p-8");
    });
  });
});
