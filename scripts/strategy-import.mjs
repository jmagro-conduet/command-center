/**
 * Turn an export of the original OKR Tracker artifact into SQL for public.strategy_docs.
 *
 * The export is a folder with one sub-folder per collection and one JSON file per
 * document (plans/, sessions/, checkins/, actions/, dods/, config/, optionally proposals/).
 * It holds confidential business data, so keep it outside git. Nothing is written to a
 * database here: this prints (or writes) a SQL file you review and then run yourself:
 *
 *   node scripts/strategy-import.mjs "<export folder>" --out strategy-import.sql \
 *        --user u_AbC...=simon.doukas@raphie.com
 *   npx supabase db query --remote --file strategy-import.sql --project-ref <ref>
 *
 * Options
 *   --out <file>        write the SQL there instead of stdout
 *   --user <id>=<mail>  map an artifact user id (u_...) to an email; repeatable. Ids with
 *                       no mapping become null (the history simply omits "by <name>").
 *   --overwrite         update documents that already exist (default: leave them alone, so
 *                       re-running never clobbers edits made in Raphie Hub)
 *
 * Needs supabase/migrations/20261124_strategy.sql applied first.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const COLLECTIONS = ['plans', 'config', 'sessions', 'checkins', 'actions', 'dods', 'proposals']
const USER_ID = /^u_[A-Za-z0-9]{10,}$/

// Replace artifact user ids (anywhere in a document) with emails, or null when unknown.
export function mapUsers(value, users) {
  if (typeof value === 'string') return USER_ID.test(value) ? (users[value] ?? null) : value
  if (Array.isArray(value)) return value.map(v => mapUsers(v, users))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapUsers(v, users)]))
  return value
}

export function readExport(dir) {
  const docs = []
  for (const collection of COLLECTIONS) {
    const d = path.join(dir, collection)
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.json')).sort()) {
      const data = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))
      delete data.id
      docs.push({ collection, doc_id: f.slice(0, -5), data })
    }
  }
  return docs
}

const q = s => "'" + String(s).replace(/'/g, "''") + "'"

export function buildSql(docs, users = {}, { overwrite = false, now = new Date().toISOString() } = {}) {
  const missing = docs.filter(d => d.collection === 'plans').length === 0
  if (missing) throw new Error('The export has no plans/ documents. Is this the right folder?')
  const rows = docs.map(d => {
    const json = JSON.stringify(mapUsers(d.data, users))
    if (json.includes('$j$')) throw new Error(`Document ${d.collection}/${d.doc_id} contains the quoting marker $j$.`)
    return `  (${q(d.collection)}, ${q(d.doc_id)}, $j$${json}$j$::jsonb, ${q(now)}, 'import from OKR Tracker artifact')`
  })
  const conflict = overwrite
    ? 'do update set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by'
    : 'do nothing'
  return [
    '-- Strategy import from the OKR Tracker artifact. Review, then run once.',
    `-- ${docs.length} documents: ${COLLECTIONS.map(c => `${docs.filter(d => d.collection === c).length} ${c}`).join(', ')}.`,
    overwrite ? '-- Existing documents WILL be overwritten (--overwrite).' : '-- Existing documents are left untouched (re-running is safe).',
    'begin;',
    'insert into public.strategy_docs (collection, doc_id, data, updated_at, updated_by) values',
    rows.join(',\n'),
    `on conflict (collection, doc_id) ${conflict};`,
    'commit;', '',
  ].join('\n')
}

// ---- CLI
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2)
  const dir = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--user')
  const opt = name => { const out = []; args.forEach((a, i) => { if (a === name && args[i + 1]) out.push(args[i + 1]) }); return out }
  if (!dir) { console.error('Usage: node scripts/strategy-import.mjs <export folder> [--out file] [--user u_id=email] [--overwrite]'); process.exit(1) }
  const users = Object.fromEntries(opt('--user').map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)] }))
  const docs = readExport(dir)
  const sql = buildSql(docs, users, { overwrite: args.includes('--overwrite') })
  const unmapped = new Set((JSON.stringify(docs).match(/u_[A-Za-z0-9]{10,}/g) || []).filter(id => !users[id]))
  const out = opt('--out')[0]
  if (out) fs.writeFileSync(out, sql, 'utf8'); else process.stdout.write(sql)
  console.error(`${docs.length} documents${out ? ' -> ' + out : ''}.` + (unmapped.size ? ` Unmapped user ids (will be null): ${[...unmapped].join(', ')}` : ''))
}
