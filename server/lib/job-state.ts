/**
 * State Machine & Ownership Layer
 *
 * Defines valid state transitions and enforces state ownership.
 * Only authorized actors can transition states they own.
 *
 * Invariants:
 * - State transitions are explicit, never inferred
 * - Only authorized actors can transition states
 * - Transitions are validated before execution
 * - No auto-correction of invalid states
 */

import { JOB_STATES, JobState } from "./filesystem";

/**
 * Actors that can transition states
 */
export enum Actor {
  // Lifecycle adapters (own state transitions)
  DOWNLOAD_WORKER = "DOWNLOAD_WORKER",
  DEMUCS_WORKER = "DEMUCS_WORKER",
  LYRICS_WORKER = "LYRICS_WORKER",
  AUDACITY_WORKER = "AUDACITY_WORKER",

  // System actors
  SYSTEM = "SYSTEM",
  USER = "USER",

  // Feature adapters (no state transitions)
  // (Feature adapters update metadata but don't transition states)
}

/**
 * State transition rules
 * Maps (from, to) -> authorized actors
 */
const TRANSITION_RULES: Record<string, Record<string, Actor[]>> = {
  [JOB_STATES.NEW]: {
    [JOB_STATES.CLAIMED]: [Actor.SYSTEM, Actor.DOWNLOAD_WORKER],
  },
  [JOB_STATES.CLAIMED]: {
    [JOB_STATES.RUNNING]: [Actor.DOWNLOAD_WORKER],
    [JOB_STATES.NEW]: [Actor.SYSTEM], // Reclaim on lease expiry
  },
  [JOB_STATES.RUNNING]: {
    [JOB_STATES.DONE]: [Actor.DOWNLOAD_WORKER, Actor.DEMUCS_WORKER, Actor.AUDACITY_WORKER],
    [JOB_STATES.FAILED]: [Actor.DOWNLOAD_WORKER, Actor.DEMUCS_WORKER, Actor.AUDACITY_WORKER],
    [JOB_STATES.NEW]: [Actor.SYSTEM], // Reclaim on lease expiry
  },
  [JOB_STATES.DONE]: {
    // Terminal state, no transitions
  },
  [JOB_STATES.FAILED]: {
    [JOB_STATES.NEW]: [Actor.SYSTEM, Actor.USER], // Retry
  },
};

/**
 * Validate a state transition
 */
export function validateTransition(
  fromState: JobState,
  toState: JobState,
  actor: Actor
): { valid: boolean; reason?: string } {
  // Check if transition is defined
  const allowedActors = TRANSITION_RULES[fromState]?.[toState];

  if (!allowedActors) {
    return {
      valid: false,
      reason: `Invalid transition: ${fromState} -> ${toState}`,
    };
  }

  // Check if actor is authorized
  if (!allowedActors.includes(actor)) {
    return {
      valid: false,
      reason: `Actor ${actor} not authorized for transition ${fromState} -> ${toState}. Allowed: ${allowedActors.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Get valid next states for a given state
 */
export function getValidNextStates(state: JobState): JobState[] {
  const nextStates = TRANSITION_RULES[state];
  return nextStates ? Object.keys(nextStates) as JobState[] : [];
}

/**
 * Get actors authorized for a transition
 */
export function getAuthorizedActors(fromState: JobState, toState: JobState): Actor[] {
  return TRANSITION_RULES[fromState]?.[toState] || [];
}

/**
 * Check if a state is terminal
 */
export function isTerminalState(state: JobState): boolean {
  return state === JOB_STATES.DONE || state === JOB_STATES.FAILED;
}

/**
 * Check if a state is intermediate
 */
export function isIntermediateState(state: JobState): boolean {
  return state === JOB_STATES.CLAIMED || state === JOB_STATES.RUNNING;
}
