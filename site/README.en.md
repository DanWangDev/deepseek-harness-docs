# DeepSeek Harness Whitepaper (Local Docs Site)

[中文](README.md) | English

A **DeepSeek Harness architecture whitepaper** written in the style of the Claude Code reverse-engineering whitepaper: from the architecture overview, the core loop, the tool system, and context engineering to the safety model and internal mechanics — **9 chapters, 36 pages, bilingual (中文 / English)**, all compiled from the open-source repository source and official docs.

The site ships Mintlify-style theme switching (**dark / light**) and language switching (**中文 / English**); your choice is remembered in the browser's `localStorage`.

## Repository Layout

```text
deepseek-harness-docs/
├── index.html            # site landing page (build output)
├── README.md             # this file (Chinese)
├── README.en.md          # English README
├── nav.json              # site navigation (sections → pages, zh/en titles)
├── assets/
│   └── style.css         # global styles (incl. dark theme)
├── scripts/
│   ├── build.mjs         # build script (zero-dependency, Node 18+)
│   └── verify.mjs        # site gate: pages, links, toggles, en sources
├── src/
│   ├── index.md          # Chinese landing source
│   ├── index.en.md       # English landing source
│   └── docs/             # Chinese sources (36 pages, by section)
│       └── en/           # English sources (36 pages, mirroring the structure)
└── site/                 # build output: a directly deployable static site
    ├── index.html        # Chinese site (root path, URLs unchanged)
    ├── README.md         # README copies for the deployed site
    ├── README.en.md
    ├── en/               # English site (site/en/...)
    └── assets/style.css
```

## Local Browsing (No Server Required)

Double-click `site/index.html` to read it — the site is a **zero-dependency static page** (no CDN, no external requests) and works fully under the `file://` protocol. The English version is at `site/en/index.html`.

## Local Deployment (Pick One)

### Option 1: Python built-in server

```sh
cd deepseek-harness-docs/site
python -m http.server 8000
# open http://127.0.0.1:8000 in your browser
```

### Option 2: Any Node static server

```sh
cd deepseek-harness-docs/site
npx serve .            # or npx http-server .
# open http://127.0.0.1:3000 in your browser
```

### Option 3: PowerShell (Windows, no extra dependency)

```powershell
cd deepseek-harness-docs\site
# Use Python or any static server; PowerShell has no built-in static
# server, so Option 1 or Option 2 is the easiest path.
```

> Tip: double-clicking `site/index.html` already works for browsing; a local server is only needed for a more realistic deployment shape (clean URLs, MIME types).

## Rebuild (After Editing Docs)

```sh
cd deepseek-harness-docs
node scripts/build.mjs          # build both zh + en sites
node scripts/build.mjs zh       # build Chinese only
node scripts/build.mjs en       # build English only
```

The script reads `nav.json` with `src/docs/**/*.md` (Chinese) and `src/docs/en/**/*.md` (English) and generates all HTML under `site/` and `site/en/` (landing page, sidebar navigation, Previous/Next, theme switcher, language switcher). Requires Node 18+, no npm dependencies.

Run `node scripts/verify.mjs` after building to gate pages, internal links, toggles, and EN source completeness.

## Editing Guide

1. **Add a page**: create the Markdown in both `src/docs/<section>/` (Chinese) and `src/docs/en/<section>/` (English), then append `{ "file": "<path>", "title": "<zh title>", "titleEn": "<en title>" }` to the matching `items` array in `nav.json`, and rebuild
2. **Edit content**: edit `src/docs/**/*.md` and `src/docs/en/**/*.md` directly and rebuild; Markdown links (ending in `.md`) are converted to relative `.html` at build time — the two trees mirror each other, so link targets stay identical
3. **Change styling**: edit `assets/style.css` (including the `[data-theme="dark"]` variables); a rebuild copies it to `site/assets/` and `site/en/assets/`
4. **Deploy**: commit and push the `main` branch; GitHub Actions automatically publishes `site/` to GitHub Pages (`.github/workflows/deploy-pages.yml`)

## Writing Conventions (Following the Reference Site)

- Every page opens with a `> ` lead blockquote that summarizes it in one sentence
- Heavy use of comparison tables, ASCII flow diagrams, and source-level type/event names; terminology follows the official [glossary](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/glossary.zh.md)
- All mechanism descriptions are grounded in the repository source (`packages/`, `docs/`); the project is in developer preview, so individual details may drift with versions

## License

This documentation is compiled from the MIT-licensed open-source repository [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), for learning and internal reference only.
