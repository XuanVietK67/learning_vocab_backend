export enum QuestionType {
  // Self-rated study card: front shows the word, the reveal shows
  // meaning / example / audio, and the user grades their own recall. The
  // easiest type and the first exposure for a brand-new word (it replaces
  // a separate ungraded study step).
  FLASHCARD = 'flashcard',
  CLOZE_MCQ = 'cloze_mcq',
  CLOZE_TYPING = 'cloze_typing',
  MEANING_IN_CONTEXT = 'meaning_in_context',
  SENTENCE_BUILD = 'sentence_build',
  SENSE_DISAMBIGUATION = 'sense_disambiguation',
  LISTENING_CLOZE = 'listening_cloze',
}
