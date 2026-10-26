# Smarty for Zed

A Zed extension providing [Smarty](https://www.smarty.net/) template language
support: HTML-aware syntax highlighting for Smarty tags, comments, variables
and other constructs, plus **formatting** and **tag completions** via a small
language server.

This is a port of the [`smarty-vscode-support`](../smarty-vscode-support) VS
Code extension to Zed's tree-sitter based language support.

## Features

- **Syntax highlighting** for Smarty tags (`{...}` and `{{...}}`), variables
  (`$var`), strings, numbers, operators, keywords and comments (`{* ... *}`),
  together with the surrounding HTML.
- **HTML-aware parsing** — Smarty inside `<script>`/`<style>` is *not*
  highlighted as Smarty (script/style bodies stay opaque), so JavaScript object
  literals and CSS rules are never mistaken for template tags.
- **Language injections** — `<script>` bodies are highlighted as JavaScript and
  `<style>` bodies as CSS.
- **Bracket matching** for HTML tags and Smarty delimiters.
- **Automatic indentation** for HTML elements.
- **Outline / symbol view** for HTML elements.
- **Comment toggling** with `{* ... *}` block comments.
- **Formatting** (F10 / *Format Document*) — indents HTML and Smarty block
  tags (`{if}`, `{foreach}`, …) and reflows multi-tag lines, ported
  verbatim from the VS Code extension's `BeautifySmarty` + its vendored
  js-beautify fork.
- **Completions** for the 50 Smarty tags and modifiers (`{if}`,
  `{foreach}`, `date_format`, …) — offered while you're typing inside an
  open `{…}` tag, sourced from the same tag list as the VS Code extension's
  snippets.

## Not yet included

The VS Code extension also ships **hover** and **document links** (for
Smarty's `{include file="…::"}` / `{extends "…::"}` references) through a
forked `vscode-html-languageservice` language server
([`smarty-vscode-support/server`](../smarty-vscode-support/server)). That
service is built with VS Code's custom gulp toolchain against the fork and is
not published to npm, so it cannot be dropped into Zed as-is. That is the one
genuinely remaining follow-up.

**Formatting and completions were portable**, though: they depend only on the
vendored js-beautify fork, the `BeautifySmarty` post-processor, and the tag
list from `snippets.json` — all standalone. So this extension bundles a
minimal, dependency-free LSP (`language-server/`) that serves both over stdio,
launched by Zed with `node_binary_path()`.

## Installation (development)

1. Install Rust and the WebAssembly target:
   ```sh
   rustup target add wasm32-wasip1
   ```
2. In Zed, open the command palette and run **`zed: install dev extension`**.
3. Select this `smarty-zed-support` directory.
4. Open any `.tpl` file.

Zed builds the extension Rust crate and clones and compiles the grammar from
[tree-sitter-smarty](https://github.com/elsamrafisptr/tree-sitter-smarty) at the
commit pinned in `extension.toml`. On first use, the extension downloads the
language server from this repo's GitHub release `v<version>` (matching
`version` in `Cargo.toml` / `extension.toml`) into its work directory, and
reuses it after that, also offline.

> **Releasing a version.** Bump `version` in both `Cargo.toml` and
> `extension.toml`, then build, test and upload the server under the same tag:
> ```sh
> cd language-server
> npm install
> npm run build     # -> dist/smarty-language-server.js
> npm test          # LSP round-trip with assertions; non-zero exit on failure
> gh release create v0.1.0 dist/smarty-language-server.js --title v0.1.0 --notes "..."
> ```

> **Pre-commit hook.** Commits that stage a hand-written file over 5,000 tokens
> (bytes / 4) are blocked, with instructions on how to split it. Enable it once
> per clone, and run its tests with:
> ```sh
> git config core.hooksPath .githooks
> sh scripts/test-pre-commit.sh
> ```
> Lockfiles, bundles and vendored code are exempt by being marked
> `linguist-generated` / `linguist-vendored` in `.gitattributes`.

> **Changing the grammar.** Edit and push
> [tree-sitter-smarty](https://github.com/elsamrafisptr/tree-sitter-smarty)
> (regenerate and commit `src/parser.c`), then set `commit` under
> `[grammars.smarty]` in `extension.toml` to the new commit SHA.

## Layout

```
smarty-zed-support/
├── extension.toml          # extension + grammar registration
├── Cargo.toml              # Rust extension crate
├── src/lib.rs              # zed::Extension impl
├── languages/smarty/
│   ├── config.toml         # language metadata (name, suffixes, comments)
│   ├── highlights.scm      # syntax highlighting
│   ├── brackets.scm        # bracket matching
│   ├── indents.scm         # auto-indentation
│   ├── outline.scm         # symbol outline
│   └── injections.scm      # JS/CSS injection in script/style
├── language-server/        # the formatting + completions LSP (Node, zero runtime deps)
│   ├── src/server.js       # LSP over stdio + ported BeautifySmarty
│   ├── data/smarty-tags.json  # completion list, generated from snippets.json
│   └── js-beautify/        # vendored js-beautify fork (formatter core)
├── .githooks/pre-commit    # blocks hand-written files over 5,000 tokens
└── scripts/test-pre-commit.sh
```

## The grammar

The grammar lives in its own repo,
[tree-sitter-smarty](https://github.com/elsamrafisptr/tree-sitter-smarty). Its
README explains the Smarty nodes and how to regenerate the parser. To check
the query files here against it, clone it next to this repo and run:

```sh
cd tree-sitter-smarty
npx tree-sitter query ../smarty-zed-support/languages/smarty/highlights.scm corpus/basic.smarty
```

## The language server

`language-server/` is a minimal, dependency-free LSP server written in Node.
It speaks LSP over stdio (`Content-Length` framing), tracks the full document
on `didOpen`/`didChange`, and implements `textDocument/formatting`,
`textDocument/rangeFormatting`, and `textDocument/completion`. The formatter
is a verbatim port of the VS Code extension's `BeautifySmarty` (which wraps the
vendored js-beautify fork); the completion list is generated from its
`snippets.json` (`make-completions.js` -> `data/smarty-tags.json`).

Formatting options default to the VS Code `html.format.*` values and can be
overridden through `initializationOptions.config`, for example in Zed's
`settings.json` under `lsp.smarty-language-server.initialization_options`.

`src/lib.rs` downloads the bundle from the GitHub release matching the
extension version (Zed's publishing rules forbid bundling a language server)
and launches it with Zed's Node runtime (`node_binary_path()`).

To exercise it standalone (no Zed required):

```sh
cd language-server
npm test
```

## License

MIT, see [LICENSE](LICENSE). The formatter and tag list are ported from
[smarty-vscode-support](https://github.com/aswinkumar863/smarty-vscode-support)
(MIT, Aswin Kumar). The formatter core is `js-beautify` (MIT, Einar Lielmanis,
Liam Newman and contributors), vendored under `language-server/js-beautify/`.
