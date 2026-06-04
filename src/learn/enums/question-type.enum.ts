export enum QuestionType {
  // Self-rated study card: front shows the word, the reveal shows
  // meaning / example / audio, and the user grades their own recall. The
  // easiest type and the first exposure for a brand-new word (it replaces
  // a separate ungraded study step).
  FLASHCARD = 'flashcard',
  CLOZE_MCQ = 'cloze_mcq',
  CLOZE_TYPING = 'cloze_typing',
  MEANING_IN_CONTEXT = 'meaning_in_context',
  SENSE_DISAMBIGUATION = 'sense_disambiguation',
  LISTENING_CLOZE = 'listening_cloze',

  // --- Recognition MCQs (NEW band) ---------------------------------------
  // Show a translation, pick the matching lemma. Mirror of TRANSLATION_FROM_WORD.
  WORD_FROM_TRANSLATION = 'word_from_translation',
  // Show the bare lemma, pick its translation. Like MEANING_IN_CONTEXT but
  // without sentence context (so a touch easier).
  TRANSLATION_FROM_WORD = 'translation_from_word',
  // Play the word's audio, pick the matching lemma.
  LISTENING_CHOICE = 'listening_choice',
  // Show a sense image, pick the matching lemma from four words.
  IMAGE_CHOICE = 'image_choice',

  // --- Recall / production (REVIEW band) ---------------------------------
  // Play the word's audio, type the lemma you heard (dictation).
  DICTATION = 'dictation',
  // Speak the word; the client runs speech-to-text and submits the transcript,
  // which is compared (lenient) against the lemma.
  PRONUNCIATION = 'pronunciation',
}
