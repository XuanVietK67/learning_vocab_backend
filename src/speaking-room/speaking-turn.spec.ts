import {
  buildTurnMessages,
  ConversationContext,
  parseTurnReply,
} from '@/speaking-room/speaking-turn';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

const ctx: ConversationContext = {
  aiRole: 'barista',
  userRole: 'customer',
  setting: 'A busy café at lunchtime.',
  goal: 'Order a drink and a snack.',
  cefrLevel: ProficiencyLevel.B1,
  selectedWords: ['order', 'recommend'],
};

const validJson = JSON.stringify({
  reply: 'Of course! Would you like anything to eat with that?',
  corrections: [
    {
      user_said: 'I want a coffee',
      better: "I'd like a coffee, please",
      why: 'more polite',
    },
  ],
  used_target_words: ['order'],
});

describe('parseTurnReply', () => {
  it('parses a clean reply with corrections and used words', () => {
    const r = parseTurnReply(validJson);
    expect(r.reply).toContain('Of course');
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0].userSaid).toBe('I want a coffee');
    expect(r.corrections[0].better).toContain("I'd like");
    expect(r.usedTargetWords).toEqual(['order']);
  });

  it('strips ```json fences', () => {
    const r = parseTurnReply('```json\n' + validJson + '\n```');
    expect(r.reply).toContain('Of course');
  });

  it('tolerates surrounding prose', () => {
    const r = parseTurnReply(`Here:\n${validJson}\nDone`);
    expect(r.usedTargetWords).toEqual(['order']);
  });

  it('defaults corrections and used words to empty arrays', () => {
    const r = parseTurnReply(JSON.stringify({ reply: 'Hi there!' }));
    expect(r.corrections).toEqual([]);
    expect(r.usedTargetWords).toEqual([]);
  });

  it('drops corrections missing user_said or better', () => {
    const r = parseTurnReply(
      JSON.stringify({
        reply: 'ok',
        corrections: [
          { user_said: 'x' },
          { better: 'y' },
          { user_said: 'a', better: 'b', why: 'c' },
        ],
      }),
    );
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0]).toEqual({ userSaid: 'a', better: 'b', why: 'c' });
  });

  it('throws when reply is missing', () => {
    expect(() => parseTurnReply(JSON.stringify({ reply: '' }))).toThrow(
      /reply/,
    );
  });

  it('throws on non-JSON', () => {
    expect(() => parseTurnReply('the model refused')).toThrow();
  });
});

describe('buildTurnMessages', () => {
  it('opens with a system turn carrying the scenario, level and JSON shape', () => {
    const msgs = buildTurnMessages(ctx, [], 'Hello');
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('barista');
    expect(msgs[0].content).toContain('B1');
    expect(msgs[0].content.toLowerCase()).toContain('json');
    expect(msgs[0].content).toContain('order, recommend');
  });

  it('maps history into assistant/user roles in order, ending with the new user text', () => {
    const msgs = buildTurnMessages(
      ctx,
      [
        { role: 'ai', text: 'Hi there!' },
        { role: 'user', text: 'A coffee please' },
      ],
      'And a muffin',
    );
    expect(msgs.map((m) => m.role)).toEqual([
      'system',
      'assistant',
      'user',
      'user',
    ]);
    expect(msgs[msgs.length - 1].content).toBe('And a muffin');
  });

  it('omits the target-words rule and uses a generic level when none are set', () => {
    const msgs = buildTurnMessages(
      { ...ctx, cefrLevel: null, selectedWords: [] },
      [],
      'Hi',
    );
    expect(msgs[0].content).not.toContain('Naturally use these target words');
    expect(msgs[0].content).toContain('everyday conversational level');
  });
});
