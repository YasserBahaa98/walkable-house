import { describe, expect, it } from 'vitest';
import { hex } from '../src/view2d/colors';

describe('theme colour parsing', () => {
  it('accepts the forms browsers and minifiers produce', () => {
    expect(hex('#fff')).toEqual([255, 255, 255]);
    expect(hex(' #37352f ')).toEqual([55, 53, 47]);
    expect(hex('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(hex('rgba(1 2 3 / 50%)')).toEqual([1, 2, 3]);
    expect(hex('nonsense')).toEqual([128, 128, 128]);
  });
});
