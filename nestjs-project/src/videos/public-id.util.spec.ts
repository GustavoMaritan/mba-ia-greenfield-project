import { generatePublicId } from './public-id.util';

describe('generatePublicId', () => {
  it('should generate 11 base62 characters', () => {
    expect(generatePublicId()).toMatch(/^[A-Za-z0-9]{11}$/);
  });

  it('should not repeat across 10k calls', () => {
    const ids = new Set(Array.from({ length: 10_000 }, generatePublicId));

    expect(ids.size).toBe(10_000);
  });
});
