import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { launchNavigation } from "../../src/web/launch-model.js";

const here = "https://mini.example:4443/?domain=ski&scale=turns";

test("a launch to the app's front, or to the chart already open, only brings the window forward", () => {
  expect(launchNavigation(here, "https://mini.example:4443/")).toBeNull();
  expect(launchNavigation(here, "https://mini.example:4443/?domain=ski")).toBeNull();
  expect(launchNavigation(here, here)).toBeNull();
  expect(launchNavigation(here, "https://elsewhere.example/?domain=x")).toBeNull();
});

test("a launch that names another chart or page goes there", () => {
  expect(launchNavigation(here, "https://mini.example:4443/?domain=sd")).toBe("https://mini.example:4443/?domain=sd");
  expect(launchNavigation(here, "/?domain=ski&scale=edges")).toBe("https://mini.example:4443/?domain=ski&scale=edges");
  expect(launchNavigation(here, "/about")).toBe("https://mini.example:4443/about");
});

test("the manifest asks Chrome to focus the open window, and the page links it", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../src/web/manifest.webmanifest", import.meta.url), "utf8"));
  expect(manifest.launch_handler.client_mode[0]).toBe("focus-existing");
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(readFileSync(new URL("../../src/web/index.html", import.meta.url), "utf8")).toContain('<link rel="manifest" href="/manifest.webmanifest">');
});
