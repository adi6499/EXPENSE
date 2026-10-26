// Serves the website on http://localhost:5190 for testing, with the same headers Vercel adds
// (read from vercel.json), so the security policy is tested locally too.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(join(project, 'vercel.json'), 'utf8'));
const root = join(project, config.outputDirectory) + sep;
const port = Number(process.env.PORT) || 5190;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

function headersFor(urlPath) {
  const out = {};
  for (const rule of config.headers || []) {
    const matches = rule.source === '/(.*)' || rule.source === urlPath;
    if (matches) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://x').pathname;
  const path = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const file = join(root, path || 'index.html');
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...headersFor(urlPath),
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Expenses dev server: http://localhost:${port}`));
