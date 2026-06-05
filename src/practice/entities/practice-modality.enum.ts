// How the user produced the sentence. Scoring is identical for both — this is
// recorded for analytics only. `speaking` means the text is a client-side
// speech-to-text transcript (same path the `pronunciation` question type uses);
// `writing` means the user typed it.
export enum PracticeModality {
  WRITING = 'writing',
  SPEAKING = 'speaking',
}
