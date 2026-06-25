import {
  buildDraftMessages,
  parseScenarioDraft,
} from '@/speaking-room/scenario-draft';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

const validJson = JSON.stringify({
  title: 'Ordering at a café',
  topic: 'food',
  cefrLevel: 'B1',
  setting: 'A busy café at lunchtime.',
  aiRole: 'barista',
  userRole: 'customer',
  goal: 'Order a drink and a snack, and ask for the price.',
  openingLine: 'Hi there! What can I get for you today?',
  seedPhrases: ["I'd like...", 'How much is...', 'for here or to go'],
  estTurns: 8,
  introVideoScript:
    'You walk into a busy café. The barista looks up and smiles.',
});

describe('parseScenarioDraft', () => {
  it('parses a clean JSON object', () => {
    const d = parseScenarioDraft(validJson);
    expect(d.title).toBe('Ordering at a café');
    expect(d.topic).toBe('food');
    expect(d.cefrLevel).toBe(ProficiencyLevel.B1);
    expect(d.seedPhrases).toHaveLength(3);
    expect(d.estTurns).toBe(8);
    expect(d.introVideoScript).toContain('barista');
  });

  it('strips ```json fences', () => {
    const d = parseScenarioDraft('```json\n' + validJson + '\n```');
    expect(d.title).toBe('Ordering at a café');
  });

  it('tolerates surrounding prose by slicing the {…} span', () => {
    const d = parseScenarioDraft(`Sure! Here you go:\n${validJson}\nEnjoy!`);
    expect(d.topic).toBe('food');
  });

  it('slugifies a messy topic', () => {
    const d = parseScenarioDraft(
      JSON.stringify({ ...JSON.parse(validJson), topic: 'Food & Drink!' }),
    );
    expect(d.topic).toBe('food-drink');
  });

  it('coerces an invalid or missing CEFR to null (any level)', () => {
    const d = parseScenarioDraft(
      JSON.stringify({ ...JSON.parse(validJson), cefrLevel: 'Z9' }),
    );
    expect(d.cefrLevel).toBeNull();
  });

  it('normalises a lowercase CEFR value', () => {
    const d = parseScenarioDraft(
      JSON.stringify({ ...JSON.parse(validJson), cefrLevel: 'c1' }),
    );
    expect(d.cefrLevel).toBe(ProficiencyLevel.C1);
  });

  it('clamps estTurns and defaults seedPhrases to an empty array', () => {
    const d = parseScenarioDraft(
      JSON.stringify({
        ...JSON.parse(validJson),
        estTurns: 999,
        seedPhrases: undefined,
      }),
    );
    expect(d.estTurns).toBe(100);
    expect(d.seedPhrases).toEqual([]);
  });

  it('nulls a blank introVideoScript', () => {
    const d = parseScenarioDraft(
      JSON.stringify({ ...JSON.parse(validJson), introVideoScript: '   ' }),
    );
    expect(d.introVideoScript).toBeNull();
  });

  it('throws on non-JSON', () => {
    expect(() => parseScenarioDraft('the model refused')).toThrow();
  });

  it('throws when a required field is missing', () => {
    expect(() =>
      parseScenarioDraft(
        JSON.stringify({ ...JSON.parse(validJson), openingLine: '' }),
      ),
    ).toThrow(/openingLine/);
  });

  it('throws when the topic is empty after slugifying', () => {
    expect(() =>
      parseScenarioDraft(
        JSON.stringify({ ...JSON.parse(validJson), topic: '!!!' }),
      ),
    ).toThrow(/topic/);
  });
});

describe('buildDraftMessages', () => {
  it('puts the brief in the user turn and uses a system role', () => {
    const msgs = buildDraftMessages({ brief: 'café ordering, B1' });
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('café ordering, B1');
    expect(msgs[1].content.toLowerCase()).toContain('json');
  });

  it('adds hard constraints when cefrLevel and topic are pinned', () => {
    const msgs = buildDraftMessages({
      brief: 'job interview',
      cefrLevel: ProficiencyLevel.B2,
      topic: 'work',
    });
    expect(msgs[1].content).toContain('"B2"');
    expect(msgs[1].content).toContain('"work"');
  });

  it('omits the constraint block when none are pinned', () => {
    const msgs = buildDraftMessages({ brief: 'small talk about the weather' });
    expect(msgs[1].content).not.toContain('Hard constraints');
  });
});
