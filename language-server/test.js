// Drives the bundled server over real LSP stdio and asserts the results.
// Run: npm test   (after npm run build)
'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const server = spawn(process.execPath, [path.join(__dirname, 'dist/smarty-language-server.js')]);
server.stderr.pipe(process.stderr);
setTimeout(() => { console.error('FAIL: timed out'); process.exit(1); }, 10000).unref();

let buf = Buffer.alloc(0);
const pending = new Map();
server.stdout.on('data', (chunk) => {
	buf = Buffer.concat([buf, chunk]);
	let idx;
	while ((idx = buf.indexOf('\r\n\r\n')) !== -1) {
		const len = Number(/Content-Length:\s*(\d+)/i.exec(buf.slice(0, idx).toString())[1]);
		if (buf.length < idx + 4 + len) break;
		const msg = JSON.parse(buf.slice(idx + 4, idx + 4 + len).toString());
		buf = buf.slice(idx + 4 + len);
		pending.get(msg.id)?.(msg.result);
	}
});

let nextId = 1;
function send(msg) {
	const json = JSON.stringify({ jsonrpc: '2.0', ...msg });
	server.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}
function request(method, params) {
	const id = nextId++;
	return new Promise((resolve) => { pending.set(id, resolve); send({ id, method, params }); });
}

/** Applies one LSP TextEdit to text. */
function apply(text, { range, newText }) {
	const off = ({ line, character }) => text.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0) + character;
	return text.slice(0, off(range.start)) + newText + text.slice(off(range.end));
}

const URI = 'file:///sample.tpl';
const OPTIONS = { tabSize: 4, insertSpaces: true };
const SOURCE = [
	'<div>',
	'{if $items}',
	'{foreach $items as $item}',
	'<li>{$item}</li>',
	'{/foreach}',
	'{else}',
	'<p>none</p>',
	'{/if}',
	'<script>var a = { x: 1 };</script>',
	'</div>',
].join('\n');
const doc = { uri: URI };
const complete = async (text, line, character) => {
	send({ method: 'textDocument/didChange', params: { textDocument: doc, contentChanges: [{ text }] } });
	return (await request('textDocument/completion', { textDocument: doc, position: { line, character } })).map((i) => i.label);
};

(async () => {
	const init = await request('initialize', { capabilities: {} });
	assert.equal(typeof init.capabilities.completionProvider, 'object', 'completionProvider must be CompletionOptions');
	send({ method: 'textDocument/didOpen', params: { textDocument: { ...doc, languageId: 'smarty', version: 1, text: SOURCE } } });

	// full formatting: Smarty blocks nest inside HTML, script braces are not tags
	const [full] = await request('textDocument/formatting', { textDocument: doc, options: OPTIONS });
	const out = apply(SOURCE, full).split('\n');
	assert.ok(out.includes('    {if $items}'), out.join('\n'));
	assert.ok(out.includes('        {foreach $items as $item}'), out.join('\n'));
	assert.ok(out.includes('            <li>{$item}</li>'), out.join('\n'));
	assert.ok(out.includes('    {else}'), out.join('\n'));
	assert.ok(out.some((l) => l.trim() === 'var a = { x: 1 };'), out.join('\n'));

	// range formatting that starts mid-line must not duplicate text
	const [ranged] = await request('textDocument/rangeFormatting', {
		textDocument: doc, options: OPTIONS,
		range: { start: { line: 5, character: 3 }, end: { line: 5, character: 6 } },
	});
	const after = apply(SOURCE, ranged);
	assert.equal(after.split('{else}').length, 2, after);
	assert.ok(!after.includes('{el{'), after);

	// completions: only while typing the tag name
	assert.equal((await complete('{', 0, 1)).length, 50);
	assert.deepEqual(await complete('{if', 0, 3), ['if', 'ifelse']);
	assert.deepEqual(await complete('{/fore', 0, 6), ['/foreach']);
	assert.deepEqual(await complete('<div>', 0, 3), []);
	assert.deepEqual(await complete('{$it', 0, 4), []);
	assert.deepEqual(await complete('{* no', 0, 5), []);
	assert.deepEqual(await complete('{if $a ', 0, 7), []);
	assert.deepEqual(await complete('{if $a}x', 0, 8), []);

	await request('shutdown');
	send({ method: 'exit' });
	console.log('ok: formatting, range formatting, completions');
})().catch((e) => { console.error(e.message); process.exit(1); });
