export const verdictStates = ["sandbar", "settled", "mountainous", "reef"] as const;
export type VerdictState = (typeof verdictStates)[number];

export const verdictTargetTypes = ["island", "strait"] as const;
export type VerdictTargetType = (typeof verdictTargetTypes)[number];

export const commentTargetTypes = ["island", "strait", "domain"] as const;
export type CommentTargetType = (typeof commentTargetTypes)[number];

export const commentKinds = ["note", "probe_me", "sail_closer", "dispute"] as const;
export type CommentKind = (typeof commentKinds)[number];

export type Domain = { id: number; slug: string; name: string; createdAt: string };

export type Island = {
  id: number;
  domainId: number;
  parentId: number | null;
  slug: string;
  name: string;
  summary: string | null;
  sortOrder: number;
  x: number | null;
  y: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Strait = {
  id: number;
  domainId: number;
  fromIslandId: number;
  toIslandId: number;
  name: string | null;
  summary: string | null;
  createdAt: string;
};

export type Verdict = {
  id: number;
  targetType: VerdictTargetType;
  targetId: number;
  state: VerdictState;
  confidence: number;
  evidence: string;
  rationale: string | null;
  sessionId: number | null;
  createdAt: string;
};

export type Session = {
  id: number;
  domainId: number;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
};

export type Comment = {
  id: number;
  domainId: number;
  targetType: CommentTargetType;
  targetId: number;
  body: string;
  kind: CommentKind;
  readAt: string | null;
  createdAt: string;
};

export type ViewState = { domainId: number; focusIslandId: number | null; version: number };

export const messageRoles = ["you", "judge"] as const;
export type MessageRole = (typeof messageRoles)[number];

export const messageKinds = ["text", "reef_proposal", "system"] as const;
export type MessageKind = (typeof messageKinds)[number];

export type Message = {
  id: number;
  domainId: number;
  islandId: number;
  role: MessageRole;
  kind: MessageKind;
  body: string;
  createdAt: string;
};

export const reefStatuses = ["pending", "confirmed", "disputed"] as const;
export type ReefStatus = (typeof reefStatuses)[number];

/** The JSON body of a `reef_proposal` message. */
export type ReefProposal = {
  target: string;
  claim: string;
  consequence: string;
  evidence: string;
  confidence: number;
  rationale: string;
  status: ReefStatus;
};

export type Landmark = {
  id: number;
  domainId: number;
  islandId: number;
  slug: string;
  name: string;
  sortOrder: number;
  unlockedAt: string | null;
  evidence: string | null;
  messageId: number | null;
  createdAt: string;
};
