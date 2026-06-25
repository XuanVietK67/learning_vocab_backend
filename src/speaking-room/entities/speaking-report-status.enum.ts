// State of the end-of-session feedback report (one slower LLM call over the full
// transcript). pending until the session is ended; ready once stored; failed if
// the LLM call/parse failed (a GET can retry it).
export enum SpeakingReportStatus {
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
}
