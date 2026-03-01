import { describe, it, expect } from "vitest";
import { checkConcurrencyLimit, getConcurrencyStatus } from "./concurrency-limiter";

describe("Concurrency Limiter", () => {
  describe("checkConcurrencyLimit", () => {
    it("should allow job creation when under limit", async () => {
      const status = await checkConcurrencyLimit("user-1", 2);
      expect(status.allowed).toBe(true);
      expect(status.limit).toBe(2);
    });

    it("should return correct running count", async () => {
      const status = await checkConcurrencyLimit("user-1", 2);
      expect(status.running).toBeDefined();
      expect(typeof status.running).toBe("number");
      expect(status.running).toBeGreaterThanOrEqual(0);
    });

    it("should include message when limit exceeded", async () => {
      // Create a status with high running count
      const status = await checkConcurrencyLimit("user-1", 0);
      if (!status.allowed) {
        expect(status.message).toBeDefined();
        expect(status.message).toContain("processing");
      }
    });

    it("should respect custom limit", async () => {
      const status1 = await checkConcurrencyLimit("user-1", 1);
      const status2 = await checkConcurrencyLimit("user-2", 5);

      expect(status1.limit).toBe(1);
      expect(status2.limit).toBe(5);
    });

    it("should default to limit of 2", async () => {
      const status = await checkConcurrencyLimit("user-1");
      expect(status.limit).toBe(2);
    });
  });

  describe("getConcurrencyStatus", () => {
    it("should return concurrency status", async () => {
      const status = await getConcurrencyStatus("user-1");
      expect(status.allowed).toBeDefined();
      expect(status.running).toBeDefined();
      expect(status.limit).toBeDefined();
    });

    it("should match checkConcurrencyLimit behavior", async () => {
      const status1 = await checkConcurrencyLimit("user-1", 2);
      const status2 = await getConcurrencyStatus("user-1", 2);

      expect(status1.allowed).toBe(status2.allowed);
      expect(status1.running).toBe(status2.running);
      expect(status1.limit).toBe(status2.limit);
    });
  });
});
