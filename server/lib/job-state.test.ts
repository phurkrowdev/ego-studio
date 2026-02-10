import { describe, it, expect } from "vitest";
import { JOB_STATES } from "./filesystem";
import {
  Actor,
  validateTransition,
  getValidNextStates,
  getAuthorizedActors,
  isTerminalState,
  isIntermediateState,
} from "./job-state";

describe("State Machine", () => {
  describe("validateTransition", () => {
    it("should allow NEW -> CLAIMED by SYSTEM", () => {
      const result = validateTransition(JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.SYSTEM);
      expect(result.valid).toBe(true);
    });

    it("should allow NEW -> CLAIMED by DOWNLOAD_WORKER", () => {
      const result = validateTransition(JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.DOWNLOAD_WORKER);
      expect(result.valid).toBe(true);
    });

    it("should reject NEW -> CLAIMED by USER", () => {
      const result = validateTransition(JOB_STATES.NEW, JOB_STATES.CLAIMED, Actor.USER);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not authorized");
    });

    it("should allow CLAIMED -> RUNNING by DOWNLOAD_WORKER", () => {
      const result = validateTransition(JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.DOWNLOAD_WORKER);
      expect(result.valid).toBe(true);
    });

    it("should reject CLAIMED -> RUNNING by SYSTEM", () => {
      const result = validateTransition(JOB_STATES.CLAIMED, JOB_STATES.RUNNING, Actor.SYSTEM);
      expect(result.valid).toBe(false);
    });

    it("should allow RUNNING -> DONE by DOWNLOAD_WORKER", () => {
      const result = validateTransition(JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DOWNLOAD_WORKER);
      expect(result.valid).toBe(true);
    });

    it("should allow RUNNING -> DONE by DEMUCS_WORKER", () => {
      const result = validateTransition(JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.DEMUCS_WORKER);
      expect(result.valid).toBe(true);
    });

    it("should allow RUNNING -> DONE by AUDACITY_WORKER", () => {
      const result = validateTransition(JOB_STATES.RUNNING, JOB_STATES.DONE, Actor.AUDACITY_WORKER);
      expect(result.valid).toBe(true);
    });

    it("should allow RUNNING -> FAILED by DOWNLOAD_WORKER", () => {
      const result = validateTransition(JOB_STATES.RUNNING, JOB_STATES.FAILED, Actor.DOWNLOAD_WORKER);
      expect(result.valid).toBe(true);
    });

    it("should reject DONE -> RUNNING (terminal state)", () => {
      const result = validateTransition(JOB_STATES.DONE, JOB_STATES.RUNNING, Actor.SYSTEM);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Invalid transition");
    });

    it("should allow FAILED -> NEW by SYSTEM (retry)", () => {
      const result = validateTransition(JOB_STATES.FAILED, JOB_STATES.NEW, Actor.SYSTEM);
      expect(result.valid).toBe(true);
    });

    it("should allow FAILED -> NEW by USER (retry)", () => {
      const result = validateTransition(JOB_STATES.FAILED, JOB_STATES.NEW, Actor.USER);
      expect(result.valid).toBe(true);
    });

    it("should allow CLAIMED -> NEW by SYSTEM (reclaim)", () => {
      const result = validateTransition(JOB_STATES.CLAIMED, JOB_STATES.NEW, Actor.SYSTEM);
      expect(result.valid).toBe(true);
    });

    it("should allow RUNNING -> NEW by SYSTEM (reclaim)", () => {
      const result = validateTransition(JOB_STATES.RUNNING, JOB_STATES.NEW, Actor.SYSTEM);
      expect(result.valid).toBe(true);
    });
  });

  describe("getValidNextStates", () => {
    it("should return valid next states for NEW", () => {
      const states = getValidNextStates(JOB_STATES.NEW);
      expect(states).toContain(JOB_STATES.CLAIMED);
      expect(states).not.toContain(JOB_STATES.RUNNING);
      expect(states).not.toContain(JOB_STATES.DONE);
    });

    it("should return valid next states for CLAIMED", () => {
      const states = getValidNextStates(JOB_STATES.CLAIMED);
      expect(states).toContain(JOB_STATES.RUNNING);
      expect(states).toContain(JOB_STATES.NEW); // Reclaim
      expect(states).not.toContain(JOB_STATES.DONE);
    });

    it("should return valid next states for RUNNING", () => {
      const states = getValidNextStates(JOB_STATES.RUNNING);
      expect(states).toContain(JOB_STATES.DONE);
      expect(states).toContain(JOB_STATES.FAILED);
      expect(states).toContain(JOB_STATES.NEW); // Reclaim
    });

    it("should return empty array for DONE (terminal)", () => {
      const states = getValidNextStates(JOB_STATES.DONE);
      expect(states).toHaveLength(0);
    });

    it("should return valid next states for FAILED", () => {
      const states = getValidNextStates(JOB_STATES.FAILED);
      expect(states).toContain(JOB_STATES.NEW); // Retry
    });
  });

  describe("getAuthorizedActors", () => {
    it("should return authorized actors for NEW -> CLAIMED", () => {
      const actors = getAuthorizedActors(JOB_STATES.NEW, JOB_STATES.CLAIMED);
      expect(actors).toContain(Actor.SYSTEM);
      expect(actors).toContain(Actor.DOWNLOAD_WORKER);
    });

    it("should return authorized actors for CLAIMED -> RUNNING", () => {
      const actors = getAuthorizedActors(JOB_STATES.CLAIMED, JOB_STATES.RUNNING);
      expect(actors).toContain(Actor.DOWNLOAD_WORKER);
      expect(actors).not.toContain(Actor.SYSTEM);
    });

    it("should return authorized actors for RUNNING -> DONE", () => {
      const actors = getAuthorizedActors(JOB_STATES.RUNNING, JOB_STATES.DONE);
      expect(actors).toContain(Actor.DOWNLOAD_WORKER);
      expect(actors).toContain(Actor.DEMUCS_WORKER);
      expect(actors).toContain(Actor.AUDACITY_WORKER);
    });

    it("should return empty array for invalid transition", () => {
      const actors = getAuthorizedActors(JOB_STATES.DONE, JOB_STATES.RUNNING);
      expect(actors).toHaveLength(0);
    });
  });

  describe("isTerminalState", () => {
    it("should return true for DONE", () => {
      expect(isTerminalState(JOB_STATES.DONE)).toBe(true);
    });

    it("should return true for FAILED", () => {
      expect(isTerminalState(JOB_STATES.FAILED)).toBe(true);
    });

    it("should return false for NEW", () => {
      expect(isTerminalState(JOB_STATES.NEW)).toBe(false);
    });

    it("should return false for CLAIMED", () => {
      expect(isTerminalState(JOB_STATES.CLAIMED)).toBe(false);
    });

    it("should return false for RUNNING", () => {
      expect(isTerminalState(JOB_STATES.RUNNING)).toBe(false);
    });
  });

  describe("isIntermediateState", () => {
    it("should return true for CLAIMED", () => {
      expect(isIntermediateState(JOB_STATES.CLAIMED)).toBe(true);
    });

    it("should return true for RUNNING", () => {
      expect(isIntermediateState(JOB_STATES.RUNNING)).toBe(true);
    });

    it("should return false for NEW", () => {
      expect(isIntermediateState(JOB_STATES.NEW)).toBe(false);
    });

    it("should return false for DONE", () => {
      expect(isIntermediateState(JOB_STATES.DONE)).toBe(false);
    });

    it("should return false for FAILED", () => {
      expect(isIntermediateState(JOB_STATES.FAILED)).toBe(false);
    });
  });
});
