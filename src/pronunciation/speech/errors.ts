// Typed errors thrown by the low-level speech pipeline (transcoder / Azure
// client). The service layer catches these and maps them to HTTP responses so
// the modules here stay framework-agnostic.

export class AudioDecodeError extends Error {
  constructor(message = 'could not decode the uploaded audio') {
    super(message);
    this.name = 'AudioDecodeError';
  }
}

export class AudioTooLongError extends Error {
  constructor(public readonly maxSeconds: number) {
    super(`audio exceeds the ${maxSeconds}s limit`);
    this.name = 'AudioTooLongError';
  }
}

export class NoSpeechDetectedError extends Error {
  constructor(message = 'no speech detected in the recording') {
    super(message);
    this.name = 'NoSpeechDetectedError';
  }
}

export class SpeechServiceError extends Error {
  constructor(message = 'pronunciation scoring failed') {
    super(message);
    this.name = 'SpeechServiceError';
  }
}
