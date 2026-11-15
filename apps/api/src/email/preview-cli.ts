/**
 * Writes every email LASUATOS can send to HTML and text files, plus an index
 * page, so the templates can be reviewed in a browser:
 *
 *   pnpm --filter @lasuatos/api email:preview [output directory]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { escapeHtml } from './design.js';
import { emailSamples } from './samples.js';

const outputDirectory = resolve(process.argv[2] ?? 'email-previews');
const publicAppUrl = process.env.PUBLIC_APP_URL ?? 'https://lasuatos.vercel.app';
const samples = emailSamples(publicAppUrl);

await mkdir(outputDirectory, { recursive: true });
await Promise.all(samples.flatMap((sample) => [
  writeFile(resolve(outputDirectory, `${sample.id}.html`), sample.message.html),
  writeFile(resolve(outputDirectory, `${sample.id}.txt`), `Subject: ${sample.message.subject}\n\n${sample.message.text}\n`),
]));

const groups = [...new Set(samples.map((sample) => sample.group))];
const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LASUATOS emails</title>
<style>body{margin:0;padding:32px;font:15px/1.5 system-ui,sans-serif;background:#f2f3ee;color:#10202e}h1{margin:0 0 4px}p{color:#64717a;margin:0 0 24px}h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#87661f;margin:28px 0 10px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px;max-width:760px}li a{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;border:1px solid #e3e7e5;border-radius:12px;background:#fff;color:inherit;text-decoration:none}li a:hover{border-color:#153b5b}small{color:#64717a}</style></head>
<body><h1>LASUATOS emails</h1><p>${samples.length} emails, rendered with sample data. Each also has a plain-text version (.txt).</p>
${groups.map((group) => `<h2>${escapeHtml(group)}</h2><ul>${samples.filter((sample) => sample.group === group).map((sample) => `<li><a href="${sample.id}.html"><span>${escapeHtml(sample.title)}</span><small>${escapeHtml(sample.message.subject)}</small></a></li>`).join('')}</ul>`).join('')}
</body></html>`;
await writeFile(resolve(outputDirectory, 'index.html'), index);
console.log(`Wrote ${samples.length} emails to ${outputDirectory}`);
