/*
 * smarty-language-server
 * ----------------------
 * A minimal, dependency-free LSP server for Smarty templates that ports the
 * formatter from the smarty-vscode-support VS Code extension:
 *
 *   - `BeautifySmarty.beautify()`  (client/src/language/beautify.ts)
 *   - the vendored js-beautify fork (client/src/js-beautify) -> `html_beautify`
 *
 * It speaks the Language Server Protocol over stdio (Content-Length framing)
 * and implements: full-document tracking (openClose + FULL change sync),
 * `textDocument/formatting` / `textDocument/rangeFormatting`, and
 * `textDocument/completion` for Smarty tag names.
 *
 * Formatting options arrive in `initialize.params.initializationOptions`
 * (either as `initializationOptions.config` or the object itself), so the Zed
 * extension can pass defaults without any custom LSP methods.
 *
 * stdout is the LSP channel; nothing is logged to stdout.
 */
'use strict';

// The vendored js-beautify fork. Bundled by esbuild at build time.
const beautify = require('../js-beautify/js').html;

// Smarty tag/modifier names for completions, generated from the VS Code
// extension's snippets.json (see make-completions.js). Bundled in at build time.
const SMARTY_TAGS = require('../data/smarty-tags.json');

// Defaults mirror VS Code's html.format.* defaults.
const DEFAULT_CONFIG = {
	indentInnerHtml: true,
	maxPreserveNewLines: 2,
	preserveNewLines: 10,
	wrapLineLength: 0,
	wrapAttributes: 'auto',
	endWithNewline: true,
};

const config = Object.assign({}, DEFAULT_CONFIG);

/** @type {Map<string, string>} uri -> latest full text */
const docs = new Map();
let shutdownRequested = false;

/* ------------------------------------------------------------------ *
 * Smarty formatting (ported verbatim from beautify.ts)
 * ------------------------------------------------------------------ */

const LITERALS = {
	strings: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/,
	smartyComment: /{\*[\s\S]*?\*}/,
	htmlComment: /<!--[\s\S]*?-->/,
	cssComment: /\/\*[\s\S]*?\*\//,
	scriptTemplate: /<script .*?type=['"]text\/template['"].*?>[\s\S]*?<\/script>/,
};

const TAGS = {
	start: new Set(['block', 'capture', 'for', 'foreach', 'function', 'if', 'literal', 'section', 'setfilter', 'strip', 'while']),
	middle: new Set(['else', 'elseif', 'foreachelse']),
	end: new Set(['block', 'capture', 'for', 'foreach', 'function', 'if', 'literal', 'section', 'setfilter', 'strip', 'while']),
};

function formatSmarty(docText, options) {
	const embeddedRegExp = /(<(?:script|style)[\s\S]*?>)([\s\S]*?)(<\/(?:script|style)>)/g;
	const smartyRegExp = /^(?:\t| )*(.*{{?[^}\n\s]}?.*)$/gm;

	// escape smarty literals inside <script>/<style> so js-beautify leaves them alone
	let isEscaped = false;
	docText = docText.replace(embeddedRegExp, (match, start, content, end) => {
		if (!content.trim()) {
			return match;
		}
		isEscaped = true;
		return start + content.replace(smartyRegExp, '/* beautify ignore:start */$1/* beautify ignore:end */') + end;
	});

	const beautifyConfig = {
		indent_size: options.tabSize,
		indent_with_tabs: !options.insertSpaces,
		indent_handlebars: false,
		indent_inner_html: config.indentInnerHtml,
		max_preserve_newlines: config.maxPreserveNewLines,
		preserve_newlines: config.preserveNewLines,
		wrap_line_length: config.wrapLineLength,
		wrap_attributes: config.wrapAttributes,
		brace_style: 'collapse,preserve-inline',
		jslint_happy: false,
		indent_empty_lines: true,
		html: {
			end_with_newline: config.endWithNewline,
			js: { end_with_newline: false },
			css: { end_with_newline: false },
		},
		templating: ['smarty'],
	};

	let formatted = beautify(docText, beautifyConfig);

	// split into lines, keeping literal strings/comments intact
	const literalPattern = Object.values(LITERALS).map((r) => r.source).join('|');
	const linkPattern = new RegExp(`${literalPattern}|(?<linebreak>\\r?\\n)|(?<end>$)`, 'gm');

	let start;
	const lines = [];
	let match;
	while ((match = linkPattern.exec(formatted))) {
		if (match.groups.linebreak !== undefined) {
			lines.push(formatted.substring(start + (match.groups.linebreak.length || 0), match.index));
			start = match.index;
		} else if (match.groups.end !== undefined) {
			lines.push(formatted.substring(start, formatted.length).trimStart());
			break;
		}
	}

	const indentChar = beautifyConfig.indent_with_tabs ? '\t' : ' '.repeat(beautifyConfig.indent_size);
	const region = /{{?(\/?)(\w+).*?}}?/g;

	const startedRegions = [];
	let i = 0;
	while (i < lines.length) {
		let line = lines[i];

		// detect smarty tags on this line
		let repeat = startedRegions.length;

		const startMatch = [];
		const middleMatch = [];
		const endMatch = [];

		let m;
		while ((m = region.exec(line))) {
			const [fullmatch, close, tag] = m;
			if (!close && TAGS.start.has(tag)) {
				startMatch.push(fullmatch, tag);
			} else if (!close && TAGS.middle.has(tag)) {
				middleMatch.push(fullmatch, tag);
			} else if (close && TAGS.end.has(tag)) {
				endMatch.push(fullmatch, tag);
			}
		}

		if (startMatch.length) {
			startedRegions.push(startMatch[0]);
		} else if (middleMatch.length) {
			repeat--;
		} else if (endMatch.length) {
			startedRegions.pop();
			repeat--;
		}

		// indent smarty block
		if (startMatch[1] && startMatch[1] === endMatch[1]) {
			startedRegions.pop();
		} else if (startMatch.length + middleMatch.length + endMatch.length > 2) {
			let iter = 0;
			const spaces = line.replace(/^([ \t]+).*/s, '$1');
			const newLines = line.replace(region, (matchStr) => (iter++ ? '\n' + spaces : '') + matchStr).split('\n');
			lines.splice(i, 1, ...newLines);
		}

		lines[i] = indentChar.repeat(Math.max(0, repeat)) + lines[i];
		i += 1;
	}

	formatted = lines.join('\n').replace(/^[ \t]+$/gm, '');

	// unescape smarty literals in script/style
	if (isEscaped) {
		formatted = formatted.replace(/\/\*\s+beautify\s+ignore:(start|end)\s+\*\//g, '');
	}

	return formatted;
}

/* ------------------------------------------------------------------ *
 * LSP over stdio
 * ------------------------------------------------------------------ */

function send(msg) {
	const json = JSON.stringify(msg);
	const body = Buffer.from(json, 'utf8');
	process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body]));
}

function respond(id, result) {
	return { jsonrpc: '2.0', id, result };
}

function documentEnd(text) {
	const lines = text.split('\n');
	return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function charToOffset(text, position) {
	let offset = 0;
	for (let i = 0; i < position.line; i++) {
		const nl = text.indexOf('\n', offset);
		if (nl === -1) {
			return text.length;
		}
		offset = nl + 1;
	}
	const nl = text.indexOf('\n', offset);
	const lineEnd = nl === -1 ? text.length : nl;
	return Math.min(offset + position.character, lineEnd);
}

/**
 * If the cursor sits inside an open Smarty tag on the current line
 * (`{` / `{{` with no closing `}` before the cursor), return the character
 * offset of the opening brace. Otherwise null.
 */
function findTagOpen(text, position) {
	const cur = charToOffset(text, position);
	const lineStart = text.lastIndexOf('\n', cur - 1) + 1;
	const before = text.slice(lineStart, cur);
	const open = before.lastIndexOf('{');
	if (open === -1) {
		return null;
	}
	if (before.indexOf('}', open + 1) !== -1) {
		return null;
	}
	return lineStart + open;
}

function offsetToPos(text, offset) {
	let line = 0;
	let col = 0;
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text[i] === '\n') {
			line++;
			col = 0;
		} else {
			col++;
		}
	}
	return { line, character: col };
}

/**
 * Offer Smarty tag completions when the cursor is inside an open tag.
 * The typed word after the `{` filters the candidates; the textEdit replaces
 * just that word, so any braces Zed has already auto-closed are preserved.
 */
function completeSmartyTags(text, position) {
	const open = findTagOpen(text, position);
	if (open === null) {
		return [];
	}
	const cur = charToOffset(text, position);
	const tail = text.slice(open + 1, cur);
	// Only while typing the tag name: not in `{$var`, `{* comment`, or tag arguments.
	if (!/^\/?\w*$/.test(tail)) {
		return [];
	}
	const wordStart = offsetToPos(text, open + 1);
	const prefix = tail.toLowerCase();

	return SMARTY_TAGS.filter((t) => t.label.toLowerCase().startsWith(prefix)).map((t) => ({
		label: t.label,
		kind: 14, // Keyword
		detail: t.detail || undefined,
		textEdit: { range: { start: wordStart, end: position }, newText: t.label },
	}));
}

function handle(msg) {
	const { id, method, params } = msg;

	switch (method) {
		case 'initialize': {
			const io = params && params.initializationOptions;
			if (io) {
				Object.assign(config, io.config ? io.config : io);
			}
			return respond(id, {
				capabilities: {
					textDocumentSync: { openClose: true, change: 1 /* Full */ },
					documentFormattingProvider: true,
					documentRangeFormattingProvider: true,
					completionProvider: { triggerCharacters: ['{', '/'] },
				},
				serverInfo: { name: 'smarty-language-server', version: '0.1.0' },
			});
		}

		case 'initialized':
		case 'textDocument/didChange': {
			if (method === 'textDocument/didChange' && params && Array.isArray(params.contentChanges)) {
				for (const c of params.contentChanges) {
					if (c.range === undefined) {
						docs.set(params.textDocument.uri, c.text);
					}
				}
			}
			return;
		}

		case 'textDocument/didOpen':
			docs.set(params.textDocument.uri, params.textDocument.text);
			return;

		case 'textDocument/didClose':
			docs.delete(params.textDocument.uri);
			return;

		case 'textDocument/formatting': {
			const text = docs.get(params.textDocument.uri);
			if (text === undefined) {
				return respond(id, []);
			}
			const newText = formatSmarty(text, params.options);
			return respond(id, [{ range: { start: { line: 0, character: 0 }, end: documentEnd(text) }, newText }]);
		}

		case 'textDocument/rangeFormatting': {
			const text = docs.get(params.textDocument.uri);
			if (text === undefined) {
				return respond(id, []);
			}
			// Like the VS Code extension: format from the start of the first line, and
			// replace exactly the text that was formatted.
			const start = { line: params.range.start.line, character: 0 };
			const end = params.range.end;
			const sub = text.slice(charToOffset(text, start), charToOffset(text, end));
			return respond(id, [{ range: { start, end }, newText: formatSmarty(sub, params.options) }]);
		}
		case 'textDocument/completion': {
			const text = docs.get(params.textDocument.uri);
			if (text === undefined) {
				return respond(id, []);
			}
			return respond(id, completeSmartyTags(text, params.position));
		}

		case 'shutdown':
			shutdownRequested = true;
			return respond(id, null);

		case 'exit':
			process.exit(shutdownRequested ? 0 : 1);

		default:
			// Unknown request: politely say it's unsupported.
			if (id !== undefined) {
				return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not supported: ${method}` } };
			}
			return;
	}
}

let pending = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
	pending = Buffer.concat([pending, chunk]);
	let idx;
	while ((idx = pending.indexOf('\r\n\r\n')) !== -1) {
		const header = pending.slice(0, idx).toString('utf8');
		const m = /Content-Length:\s*(\d+)/i.exec(header);
		if (!m) {
			pending = pending.slice(idx + 4);
			continue;
		}
		const len = parseInt(m[1], 10);
		const start = idx + 4;
		if (pending.length < start + len) {
			break; // wait for more data
		}
		const body = pending.slice(start, start + len).toString('utf8');
		pending = pending.slice(start + len);
		let msg;
		try {
			msg = JSON.parse(body);
		} catch (e) {
			process.stderr.write(`[smarty-language-server] bad message: ${e.message}\n`);
			continue;
		}
		const res = handle(msg);
		if (res !== undefined && res !== null) {
			send(res);
		}
	}
});
