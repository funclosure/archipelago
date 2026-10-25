export const verdictStates = ["sandbar", "settled", "mountainous", "reef"] as const;
export type VerdictState = (typeof verdictStates)[number];

export const verdictTargetTypes = ["island", "strait"] as const;
export type VerdictTargetType = (typeof verdictTargetTypes)[number];

export const commentTargetTypes = ["island", "strait", "domain"] as const;
export type CommentTargetType = (typeof commentTargetTypes)[number];

export const commentKinds = ["note", "probe_me", "sail_closer", "dispute"] as const;
export type CommentKind = (typeof commentKinds)[number];

/**
 * `description`: the reader's own words on what they want to chart and why; null when they gave none.
 * `provisional`: 1 while the name is the page's placeholder taken from the description, until a sketch names it.
 */
export type Domain = { id: number; slug: string; name: string; description: string | null; provisional: 0 | 1; createdAt: string };

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
  harbour: 0 | 1;
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

export const messageRoles = ["you", "judge", "mentor", "cartographer"] as const;
export type MessageRole = (typeof messageRoles)[number];

/** Each island has two threads, the judge's and the mentor's, and each scale one cartographer's; a message lives in exactly one. */
export const messageModes = ["judge", "mentor", "cartographer"] as const;
export type MessageMode = (typeof messageModes)[number];
/** The modes whose threads belong to an island. */
export const islandModes = ["judge", "mentor"] as const;
export type IslandMode = (typeof islandModes)[number];

export const messageKinds = ["text", "reef_proposal", "system"] as const;
export type MessageKind = (typeof messageKinds)[number];

export type Message = {
  id: number;
  domainId: number;
  /** Null only in a cartographer thread at the domain's top scale. */
  islandId: number | null;
  role: MessageRole;
  kind: MessageKind;
  body: string;
  mode: MessageMode;
  /** The model that wrote a persona's reply; null for the reader, system lines, the stub, and older replies. */
  model: string | null;
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

export type Ask = {
  id: number;
  domainId: number;
  islandId: number;
  messageId: number | null;
  question: string;
  options: string[];
  picked: string | null;
  pickedAt: string | null;
  createdAt: string;
};

/** A persona's "sail to" another island, riding on the reply that carries it. `island` is the target as the page needs it. */
export type Pointer = {
  id: number;
  islandId: number;
  messageId: number | null;
  island: { slug: string; name: string; scale: string | null };
  why: string;
  question: string | null;
  createdAt: string;
};

export const boardKinds = ["diagram", "note", "code"] as const;
export type BoardKind = (typeof boardKinds)[number];

/** The code tags the page can colour (mirrored by LANGS in src/web/code-model.js; keep the two lists identical). */
export const codeLangs = ["swift", "objective-c", "kotlin", "typescript", "tsx", "javascript", "json", "bash", "python", "sql", "yaml", "html"] as const;
export type CodeLang = (typeof codeLangs)[number];

/** One card on an island's board. `title` is "" when the card has none (the reader's never do); `lang` is set only on code cards. The author never changes. */
export type BoardCard = {
  id: number;
  domainId: number;
  islandId: number;
  kind: BoardKind;
  title: string;
  body: string;
  lang: string | null;
  author: MessageRole;
  createdAt: string;
  updatedAt: string;
};

export const looseEndKinds = ["confused", "asked", "later"] as const;
export type LooseEndKind = (typeof looseEndKinds)[number];

/** Something the reader found confusing, asked and left open, or means to come back to, on one island. Open while `closedAt` is null. */
export type LooseEnd = {
  id: number;
  domainId: number;
  islandId: number;
  landmarkId: number | null;
  kind: LooseEndKind;
  note: string;
  evidence: string;
  messageId: number | null;
  author: "judge" | "mentor";
  closedAt: string | null;
  closedBy: "judge" | "mentor" | "you" | null;
  closedEvidence: string | null;
  createdAt: string;
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
  /** Explored with the mentor: the reader engaged it in their own words. Never lit, never a state. */
  exploredAt: string | null;
  exploredEvidence: string | null;
  exploredMessageId: number | null;
  /** The words a reply uses for it, so the page can mark them; null when none were given. */
  terms: string[] | null;
  createdAt: string;
};

/** The one learner row: what the reader says about themselves, read by the mentor in every domain. */
/** `language`: the page's language (`UI_LANGUAGES`), null until one is chosen or reported. */
export type Learner = { note: string; language: string | null; updatedAt: string };

export const sketchStatuses = ["pending", "approved", "discarded", "superseded"] as const;
export type SketchStatus = (typeof sketchStatuses)[number];

/** What the cartographer proposes at one scale: new islands, straits, a harbour, and fixes to islands already there. */
export type SketchBody = {
  islands: { slug: string; name: string; summary: string; landmarks: { slug: string; name: string; terms?: string[] }[] }[];
  straits: { from: string; to: string; name?: string }[];
  harbour?: string;
  /** The domain's name: only in a top-scale sketch of a provisionally named domain. */
  name?: string;
  /** The domain's slug to go with `name`, when the name has no ASCII of its own. */
  slug?: string;
  updates: { slug: string; name?: string; summary?: string }[];
  /** Seas the cartographer suggests, each over the islands it groups; approving writes them without a position. */
  seas: { name: string; islands: string[] }[];
};

/** A name the reader wrote on the water at one scale (`parentIslandId` null = the top), at a world position. */
/**
 * A name on the water at one scale. `x`/`y` are null for a sea a sketch suggested that the page has not placed yet;
 * until then `anchor` holds the islands it was suggested for, and the page sets the name over them.
 */
export type Sea = { id: number; domainId: number; parentIslandId: number | null; name: string; x: number | null; y: number | null; anchor: string[] | null; createdAt: string; updatedAt: string };

export type Sketch = {
  id: number;
  domainId: number;
  /** The scale: null is the domain's top scale. */
  parentIslandId: number | null;
  body: SketchBody;
  status: SketchStatus;
  messageId: number | null;
  createdAt: string;
  decidedAt: string | null;
};
