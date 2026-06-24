// Lifecycle of an admin-authored speaking-room scenario.
//   draft     — being authored; not yet usable by learners
//   published — live, reusable by learners (Phase 2)
//   retired   — soft-deleted; hidden from new sessions, kept for references
export enum ScenarioStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  RETIRED = 'retired',
}
