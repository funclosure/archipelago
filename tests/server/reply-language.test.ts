// The context's last line when the reader's latest message is clearly in another language than their page.
import { test, expect } from "bun:test";
import { messageScript, renderReplyLanguage } from "../../src/server/judge/context.ts";
import type { Message } from "../../src/core/types.ts";

const said = (body: string, role: Message["role"] = "you"): Message =>
  ({ id: 1, domainId: 1, islandId: 1, role, kind: "text", body, mode: "judge", model: null, createdAt: "" }) as Message;

test("messageScript reads a clear sign only", () => {
  expect(messageScript("Invalidation never matters if the TTL is long enough.")).toBe("latin");
  expect(messageScript("快取雪崩是很多請求同時 miss 同一個熱門 key，全部打到資料庫。")).toBe("cjk");
  expect(messageScript("LRU")).toBeNull(); // a technical term
  expect(messageScript("好")).toBeNull(); // too short to say
  expect(messageScript("Look at `快取雪崩快取雪崩` here please")).toBe("latin"); // code is not prose
});

test("renderReplyLanguage speaks only when the message and the page differ", () => {
  const english = [said("快取是什麼？", "judge"), said("Invalidation never matters if the TTL is long enough.")];
  expect(renderReplyLanguage("zh-TW", english).join("\n")).toContain("is not in Chinese: write this reply in its language");
  expect(renderReplyLanguage("en", english)).toEqual([]);
  expect(renderReplyLanguage("en", [said("快取雪崩是很多請求同時打到資料庫。")]).join("\n")).toContain("is in Chinese: write this reply in Chinese");
  expect(renderReplyLanguage("zh-TW", [said("快取雪崩是很多請求同時打到資料庫。")])).toEqual([]);
  // No reader message, an image alone, or no page language: nothing to say.
  expect(renderReplyLanguage("zh-TW", [said("Hello there friend", "judge")])).toEqual([]);
  expect(renderReplyLanguage("zh-TW", [said("")])).toEqual([]);
  expect(renderReplyLanguage(null, english)).toEqual([]);
});
