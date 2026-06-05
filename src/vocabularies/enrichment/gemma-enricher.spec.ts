import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { PartOfSpeech } from '@/vocabularies/entities/part-of-speech.enum';
import {
  buildExamplesPrompt,
  parseExamplesResponse,
  parseScratchResponse,
} from '@/vocabularies/enrichment/gemma-enricher';

describe('buildExamplesPrompt', () => {
  it('numbers the senses and embeds lemma/POS/language', () => {
    const prompt = buildExamplesPrompt({
      lemma: 'run',
      partOfSpeech: 'verb',
      language: 'en',
      senses: [{ definition: 'move quickly' }, { definition: 'operate' }],
    });
    expect(prompt).toContain('"run"');
    expect(prompt).toContain('verb');
    expect(prompt).toContain('1. move quickly');
    expect(prompt).toContain('2. operate');
    expect(prompt).toContain('exactly 2 item(s)');
  });
});

describe('parseExamplesResponse', () => {
  const valid = JSON.stringify({
    cefr: 'B1',
    senses: [
      { gloss: 'move fast', examples: ['I run daily.', 'She runs home.'] },
      { gloss: 'operate', examples: ['He runs a shop.', 'They run it well.'] },
    ],
  });

  it('parses a clean response aligned to the expected count', () => {
    const r = parseExamplesResponse(valid, 2);
    expect(r.cefr).toBe(ProficiencyLevel.B1);
    expect(r.senses).toHaveLength(2);
    expect(r.senses[0].gloss).toBe('move fast');
    expect(r.senses[0].examples).toHaveLength(2);
  });

  it('strips ```json fences', () => {
    const r = parseExamplesResponse('```json\n' + valid + '\n```', 2);
    expect(r.senses).toHaveLength(2);
  });

  it('throws when a sense has fewer than 2 examples', () => {
    const bad = JSON.stringify({
      cefr: 'A2',
      senses: [{ gloss: 'x', examples: ['only one'] }],
    });
    expect(() => parseExamplesResponse(bad, 1)).toThrow(/fewer than 2/);
  });

  it('throws on an invalid CEFR', () => {
    const bad = JSON.stringify({
      cefr: 'Z9',
      senses: [{ gloss: 'x', examples: ['a', 'b'] }],
    });
    expect(() => parseExamplesResponse(bad, 1)).toThrow(/cefr/);
  });

  it('throws when fewer senses than expected are returned', () => {
    expect(() => parseExamplesResponse(valid, 3)).toThrow(/expected 3/);
  });
});

describe('parseScratchResponse', () => {
  const valid = JSON.stringify({
    cefr: 'B2',
    partsOfSpeech: [
      {
        partOfSpeech: 'noun',
        senses: [
          {
            gloss: 'a race',
            definition: 'an act of running',
            examples: ['The run was hard.', 'A morning run helps.'],
          },
        ],
      },
      {
        partOfSpeech: 'determiner', // not modelled -> skipped
        senses: [{ gloss: 'x', definition: 'y', examples: ['a', 'b'] }],
      },
    ],
  });

  it('maps POS groups and drops unmodelled parts of speech', () => {
    const groups = parseScratchResponse(valid);
    expect(groups).toHaveLength(1);
    expect(groups[0].partOfSpeech).toBe(PartOfSpeech.NOUN);
    expect(groups[0].cefr).toBe(ProficiencyLevel.B2);
    expect(groups[0].senses[0].definition).toBe('an act of running');
  });

  it('drops senses missing a definition or with fewer than 2 examples', () => {
    const groups = parseScratchResponse(
      JSON.stringify({
        cefr: 'A1',
        partsOfSpeech: [
          {
            partOfSpeech: 'noun',
            senses: [
              { gloss: 'g', definition: '', examples: ['a', 'b'] },
              { gloss: 'g', definition: 'd', examples: ['only one'] },
            ],
          },
        ],
      }),
    );
    expect(groups).toHaveLength(0);
  });
});
