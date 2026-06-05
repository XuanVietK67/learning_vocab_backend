// Lifecycle of an async scoring attempt:
//   pending → enqueued, awaiting the Gemma judge worker
//   scored  → the worker stored a rubric
//   failed  → the worker exhausted its retries (bad JSON, provider error)
export enum ScoringStatus {
  PENDING = 'pending',
  SCORED = 'scored',
  FAILED = 'failed',
}
