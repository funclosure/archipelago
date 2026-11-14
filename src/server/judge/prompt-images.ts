// The reader's images in a persona's turn: which of a thread's images the persona sees whole (the newest
// IMAGES_IN_VIEW still there), the line the replay writes for each, and the thread prompt cut into text and image
// parts at those lines. Vendor-neutral: each adapter turns the parts into its own content blocks. No Bun or Node
// call, so the hosted build runs it in the worker.
import type { Database } from "../../core/sql.ts";
import { IMAGES_IN_VIEW, toBase64, type ImageType } from "../../core/images.ts";
import { imagesByMessage, readImage, type ImageRef } from "../../core/repositories/imageRepository.ts";
import type { Message } from "../../core/types.ts";

/** An image on a thread message, and whether this turn shows it to the persona. */
export type ThreadImage = ImageRef & { shown: boolean };
/** A thread message as a persona's context holds it: with its images, when it has any. */
export type ThreadMessage = Message & { images?: ThreadImage[] };
/** An image the persona sees this turn, as base64. */
export type PromptImage = { id: number; mediaType: ImageType; data: string };
/** The thread prompt, cut where each shown image goes. */
export type PromptPart = { type: "text"; text: string } | { type: "image"; mediaType: ImageType; data: string };

/**
 * The thread's messages with their images, and the bytes of the ones this turn shows: the newest `IMAGES_IN_VIEW`
 * the reader has not removed, across the whole thread. Older ones stay in the replay as a line, so a long thread
 * costs the same per turn.
 */
export function threadWithImages(db: Database, domainId: number, thread: Message[]): { thread: ThreadMessage[]; images: PromptImage[] } {
  const byMessage = imagesByMessage(db, domainId);
  const inThread = thread.flatMap((m) => (byMessage.get(m.id) ?? []).filter((i) => !i.removed).map((i) => i.id));
  const shown = new Set(inThread.slice(-IMAGES_IN_VIEW));
  const images = [...shown].map((id) => {
    const stored = readImage(db, domainId, id);
    return { id, mediaType: stored.mediaType, data: toBase64(stored.bytes) };
  });
  return {
    thread: thread.map((m) => {
      const refs = byMessage.get(m.id);
      return refs ? { ...m, images: refs.map((i) => ({ ...i, shown: shown.has(i.id) })) } : m;
    }),
    images,
  };
}

/** The replay's line for one image, at column 0 so a reader's own text can never write one. */
export function imageLine(image: ThreadImage): string {
  if (image.removed) return `[image #${image.id}, removed by the reader]`;
  return image.shown ? `[image #${image.id}]` : `[image #${image.id}, shown earlier; not shown again]`;
}

const SHOWN = /^\[image #(\d+)\]$/;

/**
 * The thread prompt as parts: each line `[image #12]` whose image this turn shows becomes that image, right where the
 * reader attached it; everything else stays text. Only a whole line at column 0 counts: the replay indents every
 * continuation line of a message, so no message can forge one.
 */
export function promptParts(prompt: string, images: readonly PromptImage[] = []): PromptPart[] {
  if (images.length === 0) return [{ type: "text", text: prompt }];
  const byId = new Map(images.map((i) => [i.id, i]));
  const parts: PromptPart[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length) parts.push({ type: "text", text: text.join("\n") });
    text = [];
  };
  for (const line of prompt.split("\n")) {
    const id = SHOWN.exec(line)?.[1];
    const image = id === undefined ? undefined : byId.get(Number(id));
    if (!image) {
      text.push(line);
      continue;
    }
    text.push(line); // the marker stays, so the persona can name the image it is looking at
    flush();
    parts.push({ type: "image", mediaType: image.mediaType, data: image.data });
  }
  flush();
  return parts;
}

/** A Claude content block, as the Messages API and the Agent SDK both take it. */
export type ClaudeBlock = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: ImageType; data: string } };

/** The thread as a Claude user message's content: a string when it is text alone, else text and image blocks in order. */
export function claudeContent(parts: readonly PromptPart[]): string | ClaudeBlock[] {
  return onlyText(parts) ?? parts.map((p): ClaudeBlock => (p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } }));
}

/** The prompt as plain text, when no image is in it (a vendor that takes a string as content). */
export const onlyText = (parts: readonly PromptPart[]): string | null => (parts.every((p) => p.type === "text") ? parts.map((p) => p.text).join("\n") : null);
