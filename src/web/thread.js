// Pure helpers for the island thread. No DOM.

/** The parsed body of a reef proposal, or null when the body is not one. */
export function proposalFromBody(body) {
  try {
    const p = JSON.parse(body);
    if (p && typeof p === "object" && typeof p.claim === "string" && typeof p.consequence === "string" && typeof p.status === "string") return p;
    return null;
  } catch {
    return null;
  }
}

const LANDMARK_PREFIX = "landmark lit: ";

/** The landmark name carried by a `landmark lit: <name>` system line, or null. */
export function landmarkFromSystem(body) {
  return typeof body === "string" && body.startsWith(LANDMARK_PREFIX) ? body.slice(LANDMARK_PREFIX.length) : null;
}

/** Stored messages → items the card renders. A proposal that fails to parse renders as plain text. */
export function threadItems(messages) {
  return messages.map((m) => {
    if (m.kind === "system") {
      const name = landmarkFromSystem(m.body);
      if (name) return { id: m.id, role: m.role, kind: "landmark", text: name, proposal: null };
    }
    if (m.kind === "reef_proposal") {
      const proposal = proposalFromBody(m.body);
      if (proposal) return { id: m.id, role: m.role, kind: "reef_proposal", text: "", proposal };
      return { id: m.id, role: m.role, kind: "text", text: m.body, proposal: null };
    }
    return { id: m.id, role: m.role, kind: m.kind, text: m.body, proposal: null };
  });
}

/** Paragraphs of a message: split on blank lines, trimmed, empties dropped. */
export function paragraphs(text) {
  return String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
