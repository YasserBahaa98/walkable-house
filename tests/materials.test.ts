import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boxUV } from '../src/view3d/materials';

describe('boxUV', () => {
  it('maps every face of a box to its size in metres', () => {
    const geo = boxUV(new THREE.BoxGeometry(2, 1, 0.5));
    const uv = geo.getAttribute('uv');
    const nor = geo.getAttribute('normal');
    const span = (axis: 'y' | 'z') => {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        const n = axis === 'y' ? nor.getY(i) : nor.getZ(i);
        if (Math.abs(n) < 0.9) continue;
        min = Math.min(min, uv.getX(i)); max = Math.max(max, uv.getX(i));
      }
      return max - min;
    };
    // Top/bottom faces use X × Z and front/back X × Y: both span the 2 m width.
    expect(span('y')).toBeCloseTo(2);
    expect(span('z')).toBeCloseTo(2);
  });

  it('keeps the same texture scale on boxes of different sizes', () => {
    const small = boxUV(new THREE.BoxGeometry(0.5, 0.5, 0.5)).getAttribute('uv');
    const big = boxUV(new THREE.BoxGeometry(4, 4, 4)).getAttribute('uv');
    const range = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < a.count; i++) { min = Math.min(min, a.getX(i)); max = Math.max(max, a.getX(i)); }
      return max - min;
    };
    expect(range(big) / range(small)).toBeCloseTo(8);
  });
});
