import { randomInt } from 'node:crypto';
import { PUBLIC_ID_LENGTH } from './videos.constants';

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// randomInt evita o viés de módulo de randomBytes % 62
export function generatePublicId(): string {
  let id = '';
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}
