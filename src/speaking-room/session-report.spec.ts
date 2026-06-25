import {
  buildReportMessages,
  parseSessionReport,
  ReportContext,
} from '@/speaking-room/session-report';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';

const ctx: ReportContext = {
  aiRole: 'barista',
  userRole: 'customer',
  setting: 'A busy café at lunchtime.',
  goal: 'Order a drink and a snack.',
  cefrLevel: ProficiencyLevel.B1,
  selectedWords: ['order', 'recommend'],
};

const validJson = JSON.stringify({
  summary: 'Great job! You ordered clearly and asked good questions.',
  top_mistakes: [
    { user_said: 'I want', better: "I'd like", why: 'more polite' },
  ],
  target_words_used: ['order'],
  target_words_missed: ['recommend'],
  estimated_level: 'B1',
  what_to_practice_next: ['polite requests', 'asking for recommendations'],
});

describe('parseSessionReport', () => {
  it('parses a full report', () => {
    const r = parseSessionReport(validJson);
    expect(r.summary).toContain('Great job');
    expect(r.topMistakes).toHaveLength(1);
    expect(r.topMistakes[0].better).toContain("I'd like");
    expect(r.targetWordsUsed).toEqual(['order']);
    expect(r.targetWordsMissed).toEqual(['recommend']);
    expect(r.estimatedLevel).toBe(ProficiencyLevel.B1);
    expect(r.whatToPracticeNext).toHaveLength(2);
  });

  it('coerces an invalid/missing level to null', () => {
    const r = parseSessionReport(
      JSON.stringify({ ...JSON.parse(validJson), estimated_level: 'Z9' }),
    );
    expect(r.estimatedLevel).toBeNull();
  });

  it('normalises a lowercase level', () => {
    const r = parseSessionReport(
      JSON.stringify({ ...JSON.parse(validJson), estimated_level: 'c1' }),
    );
    expect(r.estimatedLevel).toBe(ProficiencyLevel.C1);
  });

  it('defaults arrays when fields are absent', () => {
    const r = parseSessionReport(JSON.stringify({ summary: 'Nice work.' }));
    expect(r.topMistakes).toEqual([]);
    expect(r.targetWordsUsed).toEqual([]);
    expect(r.targetWordsMissed).toEqual([]);
    expect(r.whatToPracticeNext).toEqual([]);
    expect(r.estimatedLevel).toBeNull();
  });

  it('throws when summary is missing', () => {
    expect(() => parseSessionReport(JSON.stringify({ summary: '' }))).toThrow(
      /summary/,
    );
  });

  it('throws on non-JSON', () => {
    expect(() => parseSessionReport('no report today')).toThrow();
  });
});

describe('buildReportMessages', () => {
  it('includes the transcript, goal and target words', () => {
    const msgs = buildReportMessages(ctx, [
      { role: 'ai', text: 'Hi there!' },
      { role: 'user', text: 'I want a coffee' },
    ]);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('barista: Hi there!');
    expect(msgs[1].content).toContain('customer: I want a coffee');
    expect(msgs[1].content).toContain('order, recommend');
    expect(msgs[1].content.toLowerCase()).toContain('json');
  });

  it('marks level unspecified and target words none when unset', () => {
    const msgs = buildReportMessages(
      { ...ctx, cefrLevel: null, selectedWords: [] },
      [{ role: 'user', text: 'hello' }],
    );
    expect(msgs[1].content).toContain('unspecified');
    expect(msgs[1].content).toContain('(none set)');
  });
});
