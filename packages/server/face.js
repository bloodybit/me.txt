const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let faceapi = null;
let canvasLib = null;
let modelsLoaded = false;

const MAX_DESCRIPTOR_IMAGE_EDGE = 1024;

async function initFace() {
  try {
    patchTensorflowNodeUtilCompat();
    faceapi = require('@vladmandic/face-api');
    canvasLib = require('canvas');
    const { Canvas, Image, ImageData } = canvasLib;
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
    await ensureTfBackend();

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

function patchTensorflowNodeUtilCompat() {
  const nodeUtil = require('node:util');
  // tfjs-node 4.22 still imports these removed/deprecated util helpers.
  // Define them before face-api loads tfjs-node so Node 23 can use the native backend.
  if (!nodeUtil.isNullOrUndefined) {
    nodeUtil.isNullOrUndefined = value => value === null || value === undefined;
  }
  nodeUtil.isArray = Array.isArray;
}

async function ensureTfBackend() {
  if (!faceapi || !faceapi.tf) return;

  let base = null;
  let casted = null;
  try {
    await faceapi.tf.ready();
    base = faceapi.tf.tensor1d([1]);
    casted = base.cast('int32');
    casted.dataSync();
  } catch (err) {
    console.warn('[face] TensorFlow native backend unavailable, using CPU backend:', err.message);
    await faceapi.tf.setBackend('cpu');
    await faceapi.tf.ready();
  } finally {
    if (casted) casted.dispose();
    if (base) base.dispose();
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

async function imageBufferToTensor(buffer) {
  const img = await canvasLib.loadImage(buffer);
  if (!img || !img.width || !img.height) return null;

  const scale = Math.min(1, MAX_DESCRIPTOR_IMAGE_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = canvasLib.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  if (!canvas.width || !canvas.height) return null;
  return faceapi.tf.browser.fromPixels(canvas);
}

async function getDescriptors(buffer) {
  if (modelsLoaded && faceapi && canvasLib) {
    if (!isJpegOrPng(buffer)) {
      console.warn('[face] Unsupported image format (not JPEG/PNG), skipping real face detection');
      return [];
    }
    let inputTensor = null;
    try {
      inputTensor = await imageBufferToTensor(buffer);
      if (!inputTensor || !inputTensor.shape[0] || !inputTensor.shape[1]) {
        console.warn('[face] Decoded image has zero dimensions, skipping real face detection');
        return [];
      }
      const detections = await faceapi
        .detectAllFaces(inputTensor)
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (detections && detections.length > 0) {
        return detections.map(detection => Array.from(detection.descriptor));
      }
      console.warn('[face] No face detected');
      return [];
    } catch (err) {
      console.warn('[face] Detection failed:', err.message);
      return [];
    } finally {
      if (inputTensor) inputTensor.dispose();
    }
  }
  return [mockDescriptor(buffer)];
}

async function getDescriptor(buffer) {
  const descriptors = await getDescriptors(buffer);
  return descriptors[0] || mockDescriptor(buffer);
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

function matchDescriptors(queries, stored, threshold = 0.6) {
  let best = null;
  queries.forEach((query, index) => {
    const match = matchDescriptor(query, stored, -Infinity);
    if (match && (!best || match.confidence > best.confidence)) {
      best = { ...match, descriptor_index: index };
    }
  });
  if (!best || best.confidence < threshold) return null;
  return best;
}

module.exports = {
  initFace,
  getDescriptor,
  getDescriptors,
  matchDescriptor,
  matchDescriptors,
  cosineSimilarity,
};
