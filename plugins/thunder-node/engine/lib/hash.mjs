import { createHash } from 'node:crypto';

/** Short stable content hash (8 hex chars) used for incremental + staleness keys. */
export function shortHash(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 8);
}
