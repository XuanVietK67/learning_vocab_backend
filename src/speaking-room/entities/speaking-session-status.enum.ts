// Lifecycle of a learner's live speaking-room session (Phase 2).
//   active -> the turn loop is running, more turns may be taken.
//   ended  -> the learner finished; the feedback report is generated/stored.
export enum SpeakingSessionStatus {
  ACTIVE = 'active',
  ENDED = 'ended',
}
