/**
 * Walking a sequence from one step to the next actionable one.
 *
 * Sequence progress is driven entirely by email sends: when an email goes out,
 * the enrollment advances and whatever comes next has to be resolved. Before
 * call/task steps existed there were only two shapes to resolve (an email, or a
 * delay followed by an email), so the cron special-cased both inline. With
 * non-email action steps in the mix a step can now be followed by any run of
 * delays, calls and tasks before the next email, so resolving "what happens
 * next" becomes a walk rather than a peek.
 *
 * The walk is pure — it decides what to do, the caller does it.
 */

export interface WalkableStep {
  id: string;
  step_order: number;
  type: string | null;
  delay_days: number | null;
  delay_hours: number | null;
}

export interface ScheduledTaskStep<T extends WalkableStep = WalkableStep> {
  step: T;
  /** Delay accumulated between the walk's start and this step, in ms. */
  offsetMs: number;
}

export interface WalkResult<T extends WalkableStep = WalkableStep> {
  /** Call/task steps passed on the way, in step order, each with its offset. */
  taskSteps: ScheduledTaskStep<T>[];
  /** The next email step to queue, or null if the walk found none. */
  emailStep: T | null;
  /** Delay to apply before `emailStep`, split the way the scheduler wants it. */
  delayDays: number;
  delayHours: number;
  /** step_order to park the enrollment at. */
  currentStep: number;
  /**
   * True when the walk ran off the end of the sequence — no email left, so the
   * enrollment is done. False when it stopped on an unhandled step (condition),
   * which leaves the enrollment parked where it is.
   */
  completed: boolean;
}

/**
 * Step types that create a task and let the sequence carry on.
 *
 * The two LinkedIn types are in here rather than in a category of their own
 * because, to the walk, they are the same shape: something a rep does, which
 * never holds the enrollment open. That stays true only while nothing is sent
 * automatically. A step that really sends would have to advance the enrollment
 * itself, and belongs nowhere near this list.
 */
export const TASK_STEP_TYPES = [
  "call",
  "task",
  "linkedin_invite",
  "linkedin_message",
] as const;

export function isTaskStepType(type: string | null): boolean {
  return (TASK_STEP_TYPES as readonly string[]).includes(type ?? "");
}

/**
 * Walks `steps` from `fromOrder` forward, collecting task steps and delays
 * until it hits the next email step (or runs out of steps).
 *
 * `condition` steps stop the walk without completing the enrollment — branching
 * is not implemented, and skipping past a condition would silently resume sends
 * in sequences that use one as a stop.
 */
export function walkFromStep<T extends WalkableStep>(
  steps: T[],
  fromOrder: number,
): WalkResult<T> {
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const taskSteps: ScheduledTaskStep<T>[] = [];
  let offsetMs = 0;
  let lastOrder = fromOrder - 1;

  for (const step of ordered) {
    if (step.step_order < fromOrder) continue;
    lastOrder = step.step_order;

    if (step.type === "email") {
      const totalHours = Math.round(offsetMs / (60 * 60 * 1000));
      return {
        taskSteps,
        emailStep: step,
        delayDays: Math.floor(totalHours / 24),
        delayHours: totalHours % 24,
        currentStep: step.step_order,
        completed: false,
      };
    }

    if (step.type === "delay") {
      offsetMs +=
        ((step.delay_days || 0) * 24 + (step.delay_hours || 0)) * 60 * 60 * 1000;
      continue;
    }

    if (isTaskStepType(step.type)) {
      taskSteps.push({ step, offsetMs });
      continue;
    }

    // condition (or anything unrecognised) — stop, park the enrollment on it.
    return {
      taskSteps,
      emailStep: null,
      delayDays: 0,
      delayHours: 0,
      currentStep: step.step_order,
      completed: false,
    };
  }

  return {
    taskSteps,
    emailStep: null,
    delayDays: 0,
    delayHours: 0,
    currentStep: lastOrder + 1,
    completed: true,
  };
}
