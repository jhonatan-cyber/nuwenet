import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { uuidv7 } from '../../apps/api/dist/common/uuid.js';

test('uuidv7: formato, versionado, unicidad y orden temporal', () => {
  const a = uuidv7(1000), b = uuidv7(2000);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(b, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b, 'mismo instante ordenado por tiempo');
  const set = new Set(Array.from({ length: 1000 }, () => uuidv7()));
  assert.equal(set.size, 1000);
});
