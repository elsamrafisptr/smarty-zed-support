// Builds one self-contained CommonJS bundle so the server has zero runtime deps.
const { buildSync } = require('esbuild');
buildSync({
	entryPoints: ['src/server.js'],
	bundle: true,
	platform: 'node',
	target: 'node18',
	format: 'cjs',
	outfile: 'dist/smarty-language-server.js',
	banner: { js: '#!/usr/bin/env node' },
});
console.log('built dist/smarty-language-server.js');
