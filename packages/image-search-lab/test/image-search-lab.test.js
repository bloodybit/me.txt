'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  parseDataUri,
  extensionForMime,
  sniffMime,
  normalizeCandidateList,
  hammingDistance,
  similarityFromHashes,
} = require('../index');

test('parseArgs handles search options', () => {
  const args = parseArgs([
    'node',
    'index.js',
    'search',
    '--query',
    'pikachu',
    '--input-file',
    '/tmp/pika.txt',
    '--limit',
    '3',
    '--no-score',
  ]);

  assert.equal(args.command, 'search');
  assert.equal(args.query, 'pikachu');
  assert.equal(args.inputFile, '/tmp/pika.txt');
  assert.equal(args.limit, 3);
  assert.equal(args.score, false);
});

test('parseDataUri decodes base64 image payloads', () => {
  const parsed = parseDataUri('data:image/jpeg;base64,SGVsbG8=');
  assert.equal(parsed.mime, 'image/jpeg');
  assert.equal(parsed.buffer.toString('utf8'), 'Hello');
});

test('extensionForMime maps common image types', () => {
  assert.equal(extensionForMime('image/jpeg'), '.jpg');
  assert.equal(extensionForMime('image/png'), '.png');
  assert.equal(extensionForMime('image/webp'), '.webp');
  assert.equal(extensionForMime('application/octet-stream'), '.bin');
});

test('sniffMime detects jpeg and png headers', () => {
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])), 'image/png');
});

test('normalizeCandidateList accepts strings and objects', () => {
  const candidates = normalizeCandidateList([
    'https://example.com/a.jpg',
    { title: 'B', url: 'https://example.com/page', image: 'https://example.com/b.jpg' },
  ]);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].imageUrl, 'https://example.com/a.jpg');
  assert.equal(candidates[1].title, 'B');
  assert.equal(candidates[1].pageUrl, 'https://example.com/page');
});

test('hamming distance and similarity work for same-length hashes', () => {
  assert.equal(hammingDistance('1010', '1001'), 2);
  assert.equal(similarityFromHashes('1010', '1001'), 0.5);
  assert.equal(hammingDistance('1010', '10'), null);
});
