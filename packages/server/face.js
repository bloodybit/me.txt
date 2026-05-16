const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let faceapi = null;
let canvasLib = null;
let modelsLoaded = false;

async function initFace() {
  try {
    faceapi = require('@vladmandic/face-api');
    canvasLib = require('canvas');
    const { Canvas, Image, ImageData } = canvasLib;
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

    const modelDir = path.join(__dirname, 'models');
    const hasManifest = fs.existsSync(modelDir) &&
      fs.readdirSync(modelDir).some(f => f.includes('manifest'));

    if (!hasManifest) {
      console.warn('[face] No model weights in', modelDir);
      console.warn('[face] Falling back to deterministic mock descriptors.');
      console.warn('[face] Download weights from https://github.com/vladmandic/face-api/tree/master/model to enable real matching.');
      return false;
    }

    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);
    modelsLoaded = true;
    console.log('[face] face-api.js models loaded from', modelDir);
    return true;
  } catch (err) {
    console.warn('[face] face-api.js unavailable, using mock descriptors:', err.message);
    return false;
  }
}

function mockDescriptor(buffer) {
  const hash = crypto.createHash('sha512').update(buffer).digest();
  const vec = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    vec[i] = (hash[i % hash.length] / 255) * 2 - 1;
  }
  let norm = 0;
  for (let i = 0; i < 128; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 128; i++) vec[i] /= norm;
  return Array.from(vec);
}

function isJpegOrPng(buf) {
  if (!buf || buf.length < 8) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return jpeg || png;
}

async function getDescriptor(buffer) {
  if (modelsLoaded && faceapi && canvasLib) {
    if (!isJpegOrPng(buffer)) {
      console.warn('[face] Unsupported image format (not JPEG/PNG), falling back to mock');
      return mockDescriptor(buffer);
    }
    try {
      const img = await canvasLib.loadImage(buffer);
      if (!img || !img.width || !img.height) {
        console.warn('[face] Decoded image has zero dimensions, falling back to mock');
        return mockDescriptor(buffer);
      }
      // Re-render through a fresh canvas with explicit dimensions. node-canvas
      // on macOS can decode some JPEGs into an Image with width/height getters
      // set but a zero-sized backing buffer, which crashes face-api's
      // tf.fromPixels from a sync callback that escapes try/catch. A freshly
      // allocated canvas guarantees fromPixels sees a buffer of known size.
      const canvas = canvasLib.createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      if (!canvas.width || !canvas.height) {
        console.warn('[face] Re-rendered canvas has zero dimensions, falling back to mock');
        return mockDescriptor(buffer);
      }
      const detection = await faceapi
        .detectSingleFace(canvas)
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (detection && detection.descriptor) {
        return Array.from(detection.descriptor);
      }
      console.warn('[face] No face detected, falling back to mock descriptor');
    } catch (err) {
      console.warn('[face] Detection failed, falling back to mock:', err.message);
    }
  }
  return mockDescriptor(buffer);
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function matchDescriptor(query, stored, threshold = 0.6) {
  let best = null;
  for (const entry of stored) {
    const sim = cosineSimilarity(query, entry.descriptor);
    if (!best || sim > best.confidence) {
      best = { profile_id: entry.profile_id, confidence: sim };
    }
  }
  if (!best || best.confidence < threshold) return null;
  return best;
}

module.exports = {
  initFace,
  getDescriptor,
  matchDescriptor,
  cosineSimilarity,
};
