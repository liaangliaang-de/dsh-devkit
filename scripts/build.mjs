import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';
mkdirSync('lib', { recursive: true });
for (const file of readdirSync('src')) if (file.endsWith('.js')) copyFileSync(`src/${file}`, `lib/${file}`);
console.log('Built ESM host plugin and managed browser adapter.');
