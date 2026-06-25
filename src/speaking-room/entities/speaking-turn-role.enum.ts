// Who produced a turn in the conversation transcript.
//   ai   -> the AI partner (VoxCPM would speak this in Phase 2c/2d).
//   user -> the learner (from a typed message or, later, STT transcript).
export enum SpeakingTurnRole {
  AI = 'ai',
  USER = 'user',
}
