# Themes: named looks the user picks

**Date:** 2026-09-07
**Status:** implemented (plan: `docs/superpowers/plans/2026-09-07-themes.md`)
**Builds on:** Contour (`2026-09-05-contour-design.md`), code blocks (`2026-09-05-code-blocks-design.md`), keyboard (`2026-09-05-keyboard-design.md`), the board (`2026-09-06-board-design.md`)

## Why

Victor asked for theme switching when the code-block colours were put behind `--code-*` variables, and again on 2026-09-07 after the board landed: "don't follow the system, just based on user selection, and default our dark … not like light mode dark mode, more like a theme that can later extended." The page has one look, the Contour night palette, and its colours live in three places: the stylesheet's tokens, a constant in `draw.js` for the canvas, and hard-coded mermaid theme variables. A theme is a registry entry plus one block of tokens; everything else reads tokens.

## Decisions

| Question | Decision |
|---|---|
| What a theme is | A named set of the page's colour tokens. Not light/dark: a registry that grows by one CSS block and one entry. |
| Default | The current look, named `night`. A browser with no stored choice shows it. |
| The system setting | Ignored. `prefers-color-scheme` is never read. |
| Where the choice lives | `localStorage` under the key `theme`, per browser, across domains (like the pane width). Never in the database; the judge and the CLI know nothing about themes. |
| Second theme now | `chart`, "Paper chart": a cream chart ground with ink coast lines. It proves every token is wired and it is the picture the product is named after. |
| Picking | A Theme section at the bottom of the outline's domain menu, and the key `t` cycles themes anywhere (dead in text fields). |
| First paint | A three-line inline script in the page head stamps the stored id on `<html>` before the stylesheet paints. No flash. |

## Tokens

`src/web/styles.css` keeps the night values on `:root` and adds `:root[data-theme="chart"]` with the same set. A theme block must define every root token whose value is a literal colour; tokens whose root value is `var(…)` (the chrome aliases `--water`, `--sand`, `--land`, `--ridge`, and the code slots that alias) follow automatically and a theme may still override them. `--outline-w` and `--pane-w` are sizes, not theme.

The twenty-one literal colours outside `:root` become tokens first, so a theme can reach them:

| new token | night value | replaces |
|---|---|---|
| `--text-2` | `rgba(255, 255, 255, .78)` | the open island's name in the outline |
| `--on-land` | `#10283A` | text on the grass chip |
| `--shadow` | `rgba(0, 0, 0, .45)` | the cta card, the keys card, the board sheet |
| `--shadow-soft` | `rgba(0, 0, 0, .35)` | the pane, the pane's focus shadow, the board toggle |
| `--shadow-deep` | `rgba(0, 0, 0, .5)` | the domain menu, the peek |
| `--scrim` | `rgba(0, 0, 0, .28)` | the board scrim |
| `--lamp-tint` | `rgba(245, 194, 66, .12)` | selected rows in the outline and the menu |
| `--lamp-ring` | `rgba(245, 194, 66, .55)` | the board editor's inset ring |
| `--lamp-pulse` | `rgba(245, 194, 66, .8)` | the landmark pulse start (its end becomes `transparent`) |
| `--reef-tint` | `rgba(217, 71, 58, .35)` | the editor's error border |

The dotted underline under a question (`rgba(255, 255, 255, .45)`) becomes `var(--line-03)`, which already holds that value.

The canvas reads seven tokens: `--sea`, `--line-1`, `--lamp`, `--reef`, `--sand-fill`, `--grass`, `--snow`. They must stay six-digit hex in every theme, because `draw.js` derives alphas from them.

### Paper chart, first pass

Tuned on screen after the build; the structure is the deliverable, the numbers are a starting point.

```css
:root[data-theme="chart"] {
  --sea: #EFE6D2; --line-1: #24405E; --line-07: rgba(36, 64, 94, .7); --line-03: rgba(36, 64, 94, .45);
  --lamp: #B8861B; --reef: #B8392E; --sand-fill: #D2AE55; --grass: #4E8A45; --snow: #FFFFFF;
  --text: rgba(20, 32, 48, .92); --muted: rgba(20, 32, 48, .62); --text-2: rgba(20, 32, 48, .8);
  --panel: #F8F3E7; --panel-2: #E4D9C0; --line: rgba(36, 64, 94, .18); --open: rgba(36, 64, 94, .45);
  --on-land: #FFFFFF;
  --shadow: rgba(60, 45, 20, .22); --shadow-soft: rgba(60, 45, 20, .16); --shadow-deep: rgba(60, 45, 20, .28);
  --scrim: rgba(60, 45, 20, .18);
  --lamp-tint: rgba(184, 134, 27, .14); --lamp-ring: rgba(184, 134, 27, .55); --lamp-pulse: rgba(184, 134, 27, .7);
  --reef-tint: rgba(184, 57, 46, .3);
  --code-keyword: #8A5F0E; --code-string: #7A6420; --code-type: #24405E;
}
```

## The registry

`src/web/theme-model.js`, pure:

```js
export const THEMES = [
  { id: "night", name: "Night", dark: true },
  { id: "chart", name: "Paper chart", dark: false },
];
export const DEFAULT_THEME = "night";
export const PALETTE_TOKENS = { sea: "--sea", line: "--line-1", lamp: "--lamp", reef: "--reef", sand: "--sand-fill", grass: "--grass", snow: "--snow" };
export function storedTheme(raw)            // a known id, else DEFAULT_THEME
export function nextTheme(id)               // the id after this one, wrapping; unknown → the first
export function mermaidVariables(tokens, dark)  // the mermaid themeVariables built from read tokens
```

`mermaidVariables` takes the tokens as a plain object keyed by CSS name (`{ "--sea": "#1B3F5B", … }`) and returns: `darkMode: dark`, `background: --sea`, `primaryColor: --panel-2`, `primaryTextColor: --text`, `primaryBorderColor: --line-03`, `lineColor: --lamp`, `secondaryColor: --panel`, `tertiaryColor: --panel`, `noteBkgColor: --panel-2`, `noteTextColor: --text`, `actorBkg: --panel-2`, `actorBorder: --line-03`, `actorTextColor: --text`, `signalColor: --lamp`, `signalTextColor: --text`, `edgeLabelBackground: --sea`, `fontFamily: "system-ui, sans-serif"`, `fontSize: "13px"`. Mermaid is initialised with `theme: "base"` and these variables, for both themes; the night diagrams must be checked by hand to still look as they do under the `dark` base theme today.

`dark` on an entry is for mermaid's `darkMode` only. It says nothing about following the system.

## Applying

`src/web/theme.js` (DOM):

- `installTheme()` runs first in `app.js`, before the outline and the pane: it applies `storedTheme(localStorage.theme)`.
- `applyTheme(id)`: stamps `document.documentElement.dataset.theme = id`, stores it, reads the tokens the canvas and mermaid need through `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`, calls `setPalette(...)` in `draw.js`, calls `applyMermaidTheme(vars)` in `markdown.js` (re-initialises mermaid and clears the diagram cache), dispatches `new CustomEvent("theme", { detail: { id } })` on `document`, and asks the map for a frame.
- `cycleTheme()`: `applyTheme(nextTheme(currentTheme()))`.
- `currentTheme()`: the stamped id.

`draw.js` keeps `PALETTE` exported with the night values as defaults and gains `setPalette(p)`, which assigns onto it; every draw call already reads `PALETTE.<name>` at draw time.

`markdown.js` gains `applyMermaidTheme(themeVariables)`: `mermaid.initialize` with `theme: "base"` and the variables, then `nodeCache.clear()` and `pending.clear()`; `mermaidInit()` becomes the first call to it with the current variables. Until `applyTheme` has run, diagrams use the night variables read from the stylesheet on first render.

On the `theme` event: `card.js` sets `thread.version = null` and renders, so the log is refetched and rebuilt with fresh diagrams; `board.js` calls `render()`, which rebuilds the cards (an open editor keeps its fields, as it does on every refresh). Code blocks recolour on their own through the code slots. Nothing else on the page holds a rendered colour.

The head script in `index.html`, before the stylesheet link:

```html
<script>try { var t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}</script>
```

An unknown stored id stamps an unknown value, which the stylesheet ignores (night shows), and `installTheme` then normalises it.

## Picking

- **Menu.** The outline's domain menu (`toggleMenu`, the `▾` under the domain name) gains, after the domains, a separator and a `Theme` label, then one item per theme in `THEMES` order with the current one marked `on`, like the domains. Clicking applies the theme and closes the menu. The rail has no menu; the key covers it.
- **Key.** `t` in `keys.js` beside `b`: global, dead in text fields, calls `cycleTheme()`. `keys-model.js` `EVERYWHERE` gains `["t", "theme"]` after `["b", "board"]`.

## Tests

- `tests/web/theme-model.test.js`: `THEMES` ids are unique and the first is `DEFAULT_THEME`; `storedTheme` returns a known id and falls back on `null`, `""`, and `"solarized"`; `nextTheme` walks the list and wraps, unknown → first; `mermaidVariables` maps every listed key from the token object and carries `darkMode`.
- `tests/web/theme-tokens.test.js`: reads `src/web/styles.css`, collects the `--` names declared in the `:root {` block whose value is not `var(…)` and not `--outline-w`/`--pane-w`, and the names in the `:root[data-theme="chart"] {` block; asserts the chart set equals the root literal set (no missing, no strays), and that the seven palette tokens are six-digit hex in both.
- `tests/web/keys-model.test.js`: the cheat sheet's everywhere row lists `t`.
- By hand on the stub, in both themes: the map (open, sandbar, settled, mountainous, reef, harbour anchor, selection halo, lamps), the outline and its menu, the pane with a diagram and a code block, the board with all three kinds and the live code editor, the keys sheet, the cta card; `t` cycles; reload keeps the choice without a flash.

## Docs

`CLAUDE.md` Conventions gains a Themes bullet. This spec's status flips to implemented when merged.

## Out of scope

- Following the system setting. Per-domain themes. A theme editor or user-defined colours.
- Any change to the judge, the protocol, the CLI, or the database.
- Retuning the night palette: it stays exactly as it is.
