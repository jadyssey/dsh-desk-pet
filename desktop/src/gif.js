// GIF loading + decoding via gifuct-js (battle-tested GIF89a decoder).
// Produces a list of full-size RGBA frames ready for canvas rendering.

import { parseGIF, decompressFrames } from 'gifuct-js';

export async function loadGif(url) {
  if (cache.has(url)) return cache.get(url);
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const gif = parseGIF(buf);
  const rawFrames = decompressFrames(gif, true);

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  // Composite each frame onto a full canvas-size RGBA buffer.
  const frames = [];
  let prevCanvas = new Uint8ClampedArray(width * height * 4);

  for (const f of rawFrames) {
    const canvas = new Uint8ClampedArray(prevCanvas); // start from previous
    const { dims, patch, disposalType } = f;
    const { width: fw, height: fh, left, top } = dims;

    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const src = (y * fw + x) * 4;
        const dx = left + x;
        const dy = top + y;
        if (dx >= width || dy >= height) continue;
        const dst = (dy * width + dx) * 4;
        const a = patch[src + 3];
        if (a === 0) continue; // transparent: keep existing
        canvas[dst] = patch[src];
        canvas[dst + 1] = patch[src + 1];
        canvas[dst + 2] = patch[src + 2];
        canvas[dst + 3] = a;
      }
    }

    frames.push({ data: canvas, delay: f.delay || 100, width, height });

    // Apply disposal for the NEXT frame's base — on a copy, never on the
    // array we just pushed (mutating it would erase the frame we emitted).
    if (disposalType === 2) {
      prevCanvas = new Uint8ClampedArray(canvas);
      // restore to background: clear the frame rect
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const dx = left + x;
          const dy = top + y;
          if (dx >= width || dy >= height) continue;
          const dst = (dy * width + dx) * 4;
          prevCanvas[dst] = 0; prevCanvas[dst + 1] = 0; prevCanvas[dst + 2] = 0; prevCanvas[dst + 3] = 0;
        }
      }
    } else {
      prevCanvas = canvas;
    }
  }

  const total = frames.reduce((s, f) => s + f.delay, 0);
  const result = { width, height, frames, total };
  cache.set(url, result);
  return result;
}

const cache = new Map();
