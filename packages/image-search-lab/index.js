#!/usr/bin/env node
'use strict';

const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_LIMIT = 10;
const DEFAULT_OUT_DIR = path.join(process.cwd(), 'tmp', 'image-search-lab');
const USER_AGENT = 'me.txt image-search-lab/0.1';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function usage() {
  return [
    'Usage:',
    '  node index.js search --query "pikachu" --input-file /path/to/data-uri.txt [--limit 10]',
    '',
    'Options:',
    '  --query <text>        Text query used to discover candidate images.',
    '  --input <value>       Data URI or image file path.',
    '  --input-file <path>   File containing a data URI, or a raw image file.',
    '  --provider <name>     ddg or brave. Default: ddg.',
    '  --candidates <path>   JSON file with candidate objects or URLs.',
    '  --out <dir>           Output directory. Default: tmp/image-search-lab.',
    '  --limit <number>      Max candidates. Default: 10.',
    '  --no-score            Skip downloading and perceptual hash scoring.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    command: 'search',
    provider: 'ddg',
    limit: DEFAULT_LIMIT,
    out: DEFAULT_OUT_DIR,
    score: true,
  };

  const rest = argv.slice(2);
  if (rest[0] && !rest[0].startsWith('--')) {
    args.command = rest.shift();
  }

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--no-score') {
      args.score = false;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = rest[++i];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    args[key] = value;
  }

  args.limit = parseInt(args.limit, 10) || DEFAULT_LIMIT;
  return args;
}

function parseDataUri(value) {
  const match = String(value).trim().match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return null;

  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const buffer = isBase64
    ? Buffer.from(payload.replace(/\s+/g, ''), 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');

  return { mime, buffer };
}

function extensionForMime(mime, fallback = '.bin') {
  const normalized = String(mime || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('gif')) return '.gif';
  return fallback;
}

async function readImageInput(args) {
  const input = args.inputFile || args.input;
  if (!input) {
    throw new Error('Provide --input or --input-file');
  }

  if (input === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return imageFromTextOrBuffer(Buffer.concat(chunks), 'stdin');
  }

  if (String(input).startsWith('data:')) {
    const parsed = parseDataUri(input);
    if (!parsed) throw new Error('Invalid data URI');
    return parsed;
  }

  const stat = await fs.stat(input).catch(() => null);
  if (!stat) {
    throw new Error(`Input file not found: ${input}`);
  }
  const data = await fs.readFile(input);
  return imageFromTextOrBuffer(data, input);
}

function imageFromTextOrBuffer(data, sourceName) {
  const asText = data.toString('utf8').trim();
  if (asText.startsWith('data:')) {
    const parsed = parseDataUri(asText);
    if (!parsed) throw new Error(`Invalid data URI in ${sourceName}`);
    return parsed;
  }

  return {
    mime: sniffMime(data),
    buffer: data,
  };
}

function sniffMime(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) return 'image/png';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

async function writeQueryImage(image, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const ext = extensionForMime(image.mime, '.jpg');
  const file = path.join(outDir, `query${ext}`);
  await fs.writeFile(file, image.buffer);
  return file;
}

async function discoverCandidates(args) {
  if (args.candidates) {
    const raw = JSON.parse(await fs.readFile(args.candidates, 'utf8'));
    return normalizeCandidateList(raw).slice(0, args.limit);
  }

  if (!args.query) {
    throw new Error('Provide --query unless --candidates is used');
  }

  if (args.provider === 'brave') {
    return searchBrave(args.query, args.limit);
  }
  if (args.provider === 'ddg') {
    return searchDuckDuckGo(args.query, args.limit);
  }

  throw new Error(`Unknown provider: ${args.provider}`);
}

function normalizeCandidateList(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    if (typeof item === 'string') {
      return {
        rank: index + 1,
        title: '',
        pageUrl: '',
        imageUrl: item,
        thumbnailUrl: item,
        source: 'manual',
      };
    }
    return {
      rank: item.rank || index + 1,
      title: item.title || item.name || '',
      pageUrl: item.pageUrl || item.url || item.hostPageUrl || '',
      imageUrl: item.imageUrl || item.image || item.contentUrl || item.thumbnailUrl || '',
      thumbnailUrl: item.thumbnailUrl || item.thumbnail || item.imageUrl || item.image || '',
      width: item.width || null,
      height: item.height || null,
      source: item.source || 'manual',
    };
  }).filter(item => item.imageUrl || item.thumbnailUrl);
}

async function fetchText(url, headers = {}) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`GET ${url} failed: ${resp.status}`);
  return resp.text();
}

async function searchDuckDuckGo(query, limit) {
  const q = encodeURIComponent(query);
  const html = await fetchText(`https://duckduckgo.com/?q=${q}&iax=images&ia=images`, {
    'User-Agent': 'Mozilla/5.0 me.txt image-search-lab',
  });
  const token =
    /vqd=["']?([^"'&\s]+)["']?/.exec(html)?.[1] ||
    /"vqd":"([^"]+)"/.exec(html)?.[1];
  if (!token) {
    throw new Error('DuckDuckGo image token not found');
  }

  const jsonText = await fetchText(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${encodeURIComponent(token)}&f=,,,&p=1`,
    {
      Referer: `https://duckduckgo.com/?q=${q}&iax=images&ia=images`,
      'User-Agent': 'Mozilla/5.0 me.txt image-search-lab',
    }
  );
  const data = JSON.parse(jsonText);
  return normalizeCandidateList((data.results || []).map((result, index) => ({
    rank: index + 1,
    title: result.title,
    pageUrl: result.url,
    imageUrl: result.image,
    thumbnailUrl: result.thumbnail,
    width: result.width,
    height: result.height,
    source: result.source || 'duckduckgo',
  }))).slice(0, limit);
}

async function searchBrave(query, limit) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('Set BRAVE_SEARCH_API_KEY for --provider brave');

  const url = new URL('https://api.search.brave.com/res/v1/images/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(limit, 20)));

  const text = await fetchText(url.toString(), {
    Accept: 'application/json',
    'X-Subscription-Token': key,
  });
  const data = JSON.parse(text);
  return normalizeCandidateList((data.results || []).map((result, index) => ({
    rank: index + 1,
    title: result.title,
    pageUrl: result.url,
    imageUrl: result.properties && result.properties.url,
    thumbnailUrl: result.thumbnail && result.thumbnail.src,
    width: result.properties && result.properties.width,
    height: result.properties && result.properties.height,
    source: 'brave',
  }))).slice(0, limit);
}

async function findConvertBinary() {
  if (process.env.IMAGE_SEARCH_CONVERT_BIN) return process.env.IMAGE_SEARCH_CONVERT_BIN;
  for (const candidate of ['convert', '/opt/homebrew/bin/convert', '/usr/local/bin/convert']) {
    try {
      await execFileAsync(candidate, ['-version'], { timeout: 5000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function computeAverageHash(file, convertBin) {
  if (!convertBin) return null;
  const { stdout } = await execFileAsync(
    convertBin,
    [file, '-auto-orient', '-alpha', 'off', '-resize', '8x8!', '-colorspace', 'Gray', '-depth', '8', 'gray:-'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024, timeout: 15000 }
  );

  const bytes = Buffer.from(stdout).subarray(0, 64);
  if (bytes.length < 64) {
    throw new Error(`Could not compute hash for ${file}`);
  }
  const average = bytes.reduce((sum, value) => sum + value, 0) / bytes.length;
  return Array.from(bytes, value => value >= average ? '1' : '0').join('');
}

function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}

function similarityFromHashes(a, b) {
  const distance = hammingDistance(a, b);
  if (distance == null) return null;
  return Number((1 - distance / a.length).toFixed(4));
}

async function downloadCandidateImage(candidate, index, outDir) {
  const url = candidate.thumbnailUrl || candidate.imageUrl;
  if (!url) throw new Error('Candidate has no image URL');

  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);

  const contentLength = Number(resp.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${contentLength} bytes`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large: ${buffer.length} bytes`);
  }

  const mime = resp.headers.get('content-type') || sniffMime(buffer);
  const ext = extensionForMime(mime, extensionForMime(sniffMime(buffer), '.img'));
  const file = path.join(outDir, `candidate-${String(index + 1).padStart(2, '0')}${ext}`);
  await fs.writeFile(file, buffer);
  return file;
}

async function scoreCandidates(candidates, queryHash, outDir, convertBin) {
  const candidateDir = path.join(outDir, 'candidates');
  await fs.mkdir(candidateDir, { recursive: true });

  const results = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const result = { ...candidate, localFile: null, hash: null, similarity: null, error: null };
    try {
      const file = await downloadCandidateImage(candidate, i, candidateDir);
      result.localFile = file;
      if (queryHash && convertBin) {
        result.hash = await computeAverageHash(file, convertBin);
        result.similarity = similarityFromHashes(queryHash, result.hash);
      }
    } catch (err) {
      result.error = err.message;
    }
    results.push(result);
  }

  return results.sort((a, b) => {
    if (a.similarity == null && b.similarity == null) return a.rank - b.rank;
    if (a.similarity == null) return 1;
    if (b.similarity == null) return -1;
    return b.similarity - a.similarity;
  });
}

async function searchImage(options) {
  const args = {
    command: 'search',
    provider: 'ddg',
    limit: DEFAULT_LIMIT,
    out: DEFAULT_OUT_DIR,
    score: true,
    ...options,
  };

  const image = await readImageInput(args);
  const outDir = path.resolve(args.out);
  const queryFile = await writeQueryImage(image, outDir);
  const candidates = await discoverCandidates(args);

  let convertBin = null;
  let queryHash = null;
  let scoringError = null;
  if (args.score) {
    convertBin = await findConvertBinary();
    if (convertBin) {
      try {
        queryHash = await computeAverageHash(queryFile, convertBin);
      } catch (err) {
        scoringError = err.message;
        convertBin = null;
      }
    }
  }

  const results = args.score
    ? await scoreCandidates(candidates, queryHash, outDir, convertBin)
    : candidates;

  return {
    query: args.query || null,
    provider: args.candidates ? 'manual' : args.provider,
    queryFile,
    scoring: {
      enabled: args.score,
      convertBin,
      queryHash,
      method: convertBin ? 'average-hash-8x8' : null,
      error: scoringError,
    },
    results,
  };
}

async function runSearch(args) {
  const summary = await searchImage(args);

  const outputFile = path.join(path.resolve(args.out), 'results.json');
  await fs.writeFile(outputFile, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify({
    outputFile,
    queryFile,
    provider: summary.provider,
    candidates: results.length,
    scored: results.filter(result => result.similarity != null).length,
    top: results.slice(0, 5).map(result => ({
      title: result.title,
      pageUrl: result.pageUrl,
      imageUrl: result.imageUrl,
      similarity: result.similarity,
      error: result.error,
    })),
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.command === 'help') {
    console.log(usage());
    return;
  }
  if (args.command !== 'search') {
    throw new Error(`Unknown command: ${args.command}`);
  }
  await runSearch(args);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    console.error('');
    console.error(usage());
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  parseDataUri,
  extensionForMime,
  sniffMime,
  normalizeCandidateList,
  hammingDistance,
  similarityFromHashes,
  searchDuckDuckGo,
  searchBrave,
  computeAverageHash,
  searchImage,
};
