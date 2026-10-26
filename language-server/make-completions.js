// Generates data/smarty-tags.json from the VS Code extension's snippets.json,
// so Smarty-tag completions match the original extension's tag list exactly.
//
// Run: node make-completions.js   (writes data/smarty-tags.json)
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../smarty-vscode-support/snippets/snippets.json');
const OUT = path.join(__dirname, 'data/smarty-tags.json');

const snippets = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const tags = [];
for (const [name, s] of Object.entries(snippets)) {
	tags.push({
		label: s.prefix != null ? s.prefix : name,
		name,
		detail: (s.description || '').trim(),
	});
}

// de-duplicate by label, keep first
const seen = new Set();
const out = [];
for (const t of tags) {
	if (seen.has(t.label)) continue;
	seen.add(t.label);
	out.push(t);
}
out.sort((a, b) => a.label.localeCompare(b.label));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${out.length} tags -> ${path.relative(__dirname, OUT)}`);
