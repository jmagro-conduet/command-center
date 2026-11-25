// Run: node --test scripts/strategy-import.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSql, mapUsers } from './strategy-import.mjs'

const docs = [
  { collection: 'plans', doc_id: '2026-H2', data: { period: "H2 '26", pillars: [] } },
  { collection: 'checkins', doc_id: 'adhoc-1', data: { note: "it's fine", savedBy: 'u_TestUser00000000001', quote: 'a $ b' } },
  { collection: 'actions', doc_id: 'a1', data: { updates: [{ by: 'u_TestUser00000000001', text: 'x' }, { by: 'u_other0000000000000001', text: 'y' }] } },
]

test('mapUsers replaces known ids with emails and unknown ids with null, anywhere in the tree', () => {
  const out = mapUsers(docs[2].data, { u_TestUser00000000001: 'simon.doukas@raphie.com' })
  assert.equal(out.updates[0].by, 'simon.doukas@raphie.com'); assert.equal(out.updates[1].by, null)
  assert.equal(mapUsers('plain text', {}), 'plain text')
  assert.equal(mapUsers({ n: 5, b: true, z: null }, {}).n, 5)
})

test('buildSql: one transaction, escaped, non-destructive by default', () => {
  const sql = buildSql(docs, { u_TestUser00000000001: 'simon.doukas@raphie.com' }, { now: '2026-11-24T00:00:00Z' })
  assert.match(sql, /^-- Strategy import/m); assert.match(sql, /\nbegin;\n/); assert.match(sql, /\ncommit;\n$/)
  assert.match(sql, /on conflict \(collection, doc_id\) do nothing;/)
  assert.doesNotMatch(sql, /do update|delete|truncate|drop /i)
  assert.match(sql, /\('plans', '2026-H2', \$j\$/)
  assert.ok(sql.includes("it's fine"))                         // inside $j$ quoting, apostrophes need no escaping
  assert.ok(sql.includes('simon.doukas@raphie.com')); assert.ok(!sql.includes('u_TestUser00000000001'))
  // every JSON block parses back
  const blocks = [...sql.matchAll(/\$j\$(.*?)\$j\$::jsonb/gs)].map(m => JSON.parse(m[1]))
  assert.equal(blocks.length, 3); assert.equal(blocks[1].quote, 'a $ b')
})

test('buildSql: --overwrite updates; refuses an export with no plan; refuses the quoting marker', () => {
  assert.match(buildSql(docs, {}, { overwrite: true }), /do update set data = excluded\.data/)
  assert.throws(() => buildSql([docs[1]]), /no plans/)
  assert.throws(() => buildSql([docs[0], { collection: 'checkins', doc_id: 'x', data: { note: 'evil $j$ ; drop table x; --' } }]), /marker/)
})
