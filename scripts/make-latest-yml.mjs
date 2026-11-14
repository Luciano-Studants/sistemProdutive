// Rede de segurança: se o electron-builder não gerou o release/latest.yml, cria igual ao dele.
// Uso: node scripts/make-latest-yml.mjs <versão> <arquivo.exe>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const [version, exe] = process.argv.slice(2);
if (!version || !exe) throw new Error('uso: make-latest-yml.mjs <versão> <exe>');
const out = join(dirname(exe), 'latest.yml');
if (existsSync(out)) { console.log('latest.yml já existe'); process.exit(0); }
const sha = createHash('sha512').update(readFileSync(exe)).digest('base64');
const name = basename(exe);
writeFileSync(out, [
  `version: ${version}`,
  'files:',
  `  - url: ${name}`,
  `    sha512: ${sha}`,
  `    size: ${statSync(exe).size}`,
  `path: ${name}`,
  `sha512: ${sha}`,
  `releaseDate: '${new Date().toISOString()}'`,
  ''
].join('\n'));
console.log('latest.yml criado');
