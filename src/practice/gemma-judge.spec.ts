import { buildJudgePrompt, parseRubric } from '@/practice/gemma-judge';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

const validJson = JSON.stringify({
  overall: 82,
  usesTargetWord: true,
  correctUsage: true,
  criteria: { grammar: 5, wordUsage: 4, naturalness: 4, relevance: 5 },
  cefr: 'B2',
  feedback: 'Good use of the word; natural phrasing.',
  correctedSentence: 'Her fame was ephemeral, fading within a week.',
});

describe('parseRubric', () => {
  it('parses a clean JSON object', () => {
    const r = parseRubric(validJson);
    expect(r.overall).toBe(82);
    expect(r.cefr).toBe(ProficiencyLevel.B2);
    expect(r.criteria.grammar).toBe(5);
    expect(r.usesTargetWord).toBe(true);
    expect(r.correctedSentence).toContain('ephemeral');
  });

  it('strips ```json fences', () => {
    const r = parseRubric('```json\n' + validJson + '\n```');
    expect(r.overall).toBe(82);
    expect(r.cefr).toBe(ProficiencyLevel.B2);
  });

  it('tolerates surrounding prose by slicing the {…} span', () => {
    const r = parseRubric(
      `Here is the result:\n${validJson}\nHope that helps!`,
    );
    expect(r.overall).toBe(82);
  });

  it('clamps out-of-range numbers and rounds them', () => {
    const r = parseRubric(
      JSON.stringify({
        overall: 140,
        usesTargetWord: 1,
        correctUsage: 0,
        criteria: { grammar: 9, wordUsage: -3, naturalness: 4.6, relevance: 3 },
        cefr: 'c1',
        feedback: 'ok',
      }),
    );
    expect(r.overall).toBe(100);
    expect(r.criteria.grammar).toBe(5);
    expect(r.criteria.wordUsage).toBe(0);
    expect(r.criteria.naturalness).toBe(5); // 4.6 rounded
    expect(r.usesTargetWord).toBe(true);
    expect(r.correctUsage).toBe(false);
    expect(r.cefr).toBe(ProficiencyLevel.C1); // lowercase normalised
  });

  it('omits correctedSentence when blank or missing', () => {
    const r = parseRubric(
      JSON.stringify({
        overall: 50,
        usesTargetWord: true,
        correctUsage: true,
        criteria: { grammar: 3, wordUsage: 3, naturalness: 3, relevance: 3 },
        cefr: 'A2',
        feedback: 'fine',
        correctedSentence: '   ',
      }),
    );
    expect(r.correctedSentence).toBeUndefined();
  });

  it('throws on non-JSON', () => {
    expect(() => parseRubric('the model refused to answer')).toThrow();
  });

  it('throws on an invalid CEFR value', () => {
    expect(() =>
      parseRubric(
        JSON.stringify({
          overall: 50,
          usesTargetWord: true,
          correctUsage: true,
          criteria: { grammar: 3, wordUsage: 3, naturalness: 3, relevance: 3 },
          cefr: 'Z9',
          feedback: 'fine',
        }),
      ),
    ).toThrow(/cefr/);
  });

  it('throws on empty feedback', () => {
    expect(() =>
      parseRubric(
        JSON.stringify({
          overall: 50,
          usesTargetWord: true,
          correctUsage: true,
          criteria: { grammar: 3, wordUsage: 3, naturalness: 3, relevance: 3 },
          cefr: 'B1',
          feedback: '',
        }),
      ),
    ).toThrow(/feedback/);
  });
});

describe('buildJudgePrompt', () => {
  it('includes the lemma, glosses, and the sentence', () => {
    const prompt = buildJudgePrompt({
      lemma: 'ephemeral',
      partOfSpeech: 'adjective',
      senseGlosses: ['lasting for a very short time'],
      sentence: 'Her fame was ephemeral.',
    });
    expect(prompt).toContain('ephemeral');
    expect(prompt).toContain('lasting for a very short time');
    expect(prompt).toContain('Her fame was ephemeral.');
    expect(prompt).toContain('adjective');
  });

  it('falls back gracefully when no glosses are available', () => {
    const prompt = buildJudgePrompt({
      lemma: 'ephemeral',
      senseGlosses: [],
      sentence: 'It was ephemeral.',
    });
    expect(prompt).toContain('no glosses available');
  });
});
