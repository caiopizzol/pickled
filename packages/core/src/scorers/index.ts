export type {
  Answerable,
  Citation,
  CitationScore,
  ScoreInput,
} from "./citation.js";
export { parseCitations, scoreCitations } from "./citation.js";
export {
  formatExistenceNotes,
  verifyExpectedExistence,
} from "./existence.js";
export type { CheckResult, ExpectedDetail } from "./expected.js";
export { formatExpectedNotes, scoreExpected } from "./expected.js";
export type { TrapDetails, TrapHit } from "./traps.js";
export { scoreTraps } from "./traps.js";
