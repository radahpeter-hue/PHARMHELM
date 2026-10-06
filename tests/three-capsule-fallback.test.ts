import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/components/ThreeCapsule.tsx', 'utf8');

test('login capsule checks WebGL capability before constructing the renderer', () => {
  assert.match(source, /getContext\('webgl2'\)/);
  assert.match(source, /getContext\('webgl'\)/);
  assert.ok(source.indexOf('supportsWebGL') < source.indexOf('new THREE.WebGLRenderer'));
});

test('renderer failure degrades to a non-WebGL capsule instead of crashing login', () => {
  assert.match(source, /new THREE\.WebGLRenderer/);
  assert.match(source, /catch \{/);
  assert.match(source, /setWebGLUnavailable\(true\)/);
  assert.match(source, /webGLUnavailable &&/);
});

test('successful login still completes navigation when WebGL is unavailable', () => {
  assert.match(source, /if \(!webGLUnavailable \|\| !isLoggingIn\) return/);
  assert.match(source, /onAnimationCompleteRef\.current\?\.\(\)/);
  assert.match(source, /window\.clearTimeout\(timeoutId\)/);
});
