/**
 * Migrate KB articles from old Bolt project CSV into the new kb_articles table.
 *
 * Prerequisites:
 *   1. Run the SQL migration in Supabase SQL editor first:
 *        ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS file_url text;
 *        ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS file_name text;
 *        ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS file_type text;
 *
 *   2. Create a .env.local file in the project root (or set env vars) with:
 *        VITE_SUPABASE_URL=https://your-project.supabase.co
 *        VITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *
 * Run:
 *   node scripts/migrate-kb-articles.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ── Load env vars ─────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf8')
    for (const line of raw.split('\n')) {
      const [key, ...rest] = line.split('=')
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
    }
  }
}
loadEnv()

const url            = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  console.error('❌  Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

console.log('🔍  URL loaded:', url)
console.log('🔍  Key loaded:', serviceRoleKey ? `${serviceRoleKey.slice(0, 12)}…` : '(empty)')

// Quick connectivity check
try {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  })
  console.log('🔍  Connectivity check:', res.status, res.statusText)
} catch (e) {
  console.error('❌  Cannot reach Supabase URL:', e.message)
  process.exit(1)
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

// ── Article data from CSV ─────────────────────────────────────────────────────
// NOTE: File URLs point to the old Supabase project (uxxlhfzwlfpyeqnybvcu).
// If that project is still active the links will work immediately.
// If not, re-upload the PDFs via Learn → admin and update the file_url values.
const articles = [
  {
    id:           '76717bab-e819-474e-bb19-e30d469a8e2d',
    title:        'Logging gameLM Responses',
    category:     'SOPs',
    is_published: false,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1776444241967-epk8rb3fgs6.pdf',
    file_name:    'GameLM_Logging_SOP.pdf',
    file_type:    'application/pdf',
    created_by:   'admin@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-17T16:44:03Z',
    updated_at:   '2026-04-20T20:24:18Z',
  },
  {
    id:           'd666b23a-5dc5-413d-b293-24f0faf7fbc8',
    title:        'HOW TO LOG TICKETS',
    category:     'SOPs',
    is_published: false,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1776716648014-yxw6ustxpkb.docx',
    file_name:    'GameLM_Logging_SOP.docx',
    file_type:    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-20T20:24:08Z',
    updated_at:   '2026-04-20T20:31:06Z',
  },
  {
    id:           '74aac09d-33da-49ae-9be4-a33f0f93a625',
    title:        'How to Log gameLM Responses',
    category:     'SOPs',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1776717364292-00pcrhwny3yu.pdf',
    file_name:    'GameLM_Logging_SOP.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-20T20:36:05Z',
    updated_at:   '2026-04-20T20:36:04Z',
  },
  {
    id:           '1e17105c-f909-4382-8b92-788c67d90c69',
    title:        'No Strings Attached Manual Credit - Supervisor SOP',
    category:     'SOPs',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1776783978037-gjox560y4ju.pdf',
    file_name:    'Welcome_Offer_Manual_Credit_SOP.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-21T15:06:18Z',
    updated_at:   '2026-04-21T15:06:18Z',
  },
  {
    id:           'b507e533-0288-4326-98f8-488f9766ad7a',
    title:        'NATS Account Status Training',
    category:     'Processes',
    is_published: true,
    content:      'This training contains an overview of all NATS account statuses and how to properly handle each.',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1776960031294-q3p6bm8lrj.pdf',
    file_name:    'NATS Account Status Training.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-23T16:00:32Z',
    updated_at:   '2026-04-23T16:00:31Z',
  },
  {
    id:           'ea77630b-dd57-4fcf-9250-c5d64fb51eda',
    title:        'Deposits and Withdrawals - User Journey',
    category:     'General',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1776960185133-382nmmnfbmq.pdf',
    file_name:    'BetSaracen Deposits and Withdrawals Updated.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-23T16:03:05Z',
    updated_at:   '2026-04-23T16:03:05Z',
  },
  {
    id:           '034e3dcb-3c34-4fe2-9a04-a7dabdaa8f2e',
    title:        'Limits Changes Training',
    category:     'Processes',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1776973247895-o81bujrnlac.pdf',
    file_name:    'Limit Changes Training.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-23T19:40:49Z',
    updated_at:   '2026-04-23T19:40:47Z',
  },
  {
    id:           'ede144f4-3fce-430e-a0cd-ef285288845f',
    title:        'BetSaracen Detail Change SOP',
    category:     'SOPs',
    is_published: true,
    content:      'Phone number, address, name, and verification change processes are included within this SOP.',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1777488820642-vx9scm9z3v.pdf',
    file_name:    'BetSaracen Detail Change SOP copy.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-29T18:53:41Z',
    updated_at:   '2026-04-29T18:53:40Z',
  },
  {
    id:           '9f540574-361f-4cd2-a45d-2ae1681bb488',
    title:        'VIP Education Training',
    category:     'General',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1777488965291-t0cw3wst2v.pdf',
    file_name:    'BetSaracen VIP Education Training.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-29T18:56:06Z',
    updated_at:   '2026-04-29T18:56:05Z',
  },
  {
    id:           'bff41e77-7c72-471d-9ebc-9af5f7fe9f10',
    title:        'Zendesk Escalation Workflow',
    category:     'Zendesk',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1777490658692-grjxuik3fyl.pdf',
    file_name:    'Zendesk Escalation Workflow.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-29T19:24:19Z',
    updated_at:   '2026-04-29T19:24:18Z',
  },
  {
    id:           'aff588b2-6299-440e-a564-da25bcc91985',
    title:        'Zendesk Ticket Status Training',
    category:     'Zendesk',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1777490899876-98srriv3c27.pdf',
    file_name:    'Zendesk Ticket Status Training.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-29T19:28:20Z',
    updated_at:   '2026-04-29T19:28:19Z',
  },
  {
    id:           '306ff2b2-40b3-4b46-9164-5d4669d92637',
    title:        'Soft Skills Training',
    category:     'General',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1777491304661-7r0sp7miqsc.pdf',
    file_name:    'Soft Skills Training.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-29T19:35:06Z',
    updated_at:   '2026-04-29T19:35:04Z',
  },
  {
    id:           'a67adcef-7851-4dad-a722-516a81bf7ca6',
    title:        'Document in Ticket Process',
    category:     'Zendesk',
    is_published: true,
    content:      '',
    file_url:     'https://uxxlhfzwlfpyeqnybvcu.supabase.co/storage/v1/object/public/kb-files/1777491518880-hddz4dmsi1.pdf',
    file_name:    'Document in Ticket Process.pdf',
    file_type:    'application/pdf',
    created_by:   'michael.mckenna@conduet.com',
    updated_by:   'michael.mckenna@conduet.com',
    created_at:   '2026-04-29T19:38:39Z',
    updated_at:   '2026-04-29T19:38:38Z',
  },
]

// ── Run migration ─────────────────────────────────────────────────────────────
console.log(`\n📚 Migrating ${articles.length} KB articles…\n`)

const { data, error } = await supabase
  .from('kb_articles')
  .upsert(articles, { onConflict: 'id' })
  .select('id, title, is_published')

if (error) {
  console.error('❌  Migration failed:', error.message)
  console.error('\nHint: Make sure you ran the SQL migration first:\n')
  console.error('  ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS file_url text;')
  console.error('  ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS file_name text;')
  console.error('  ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS file_type text;\n')
  process.exit(1)
}

console.log('✅  Inserted / updated:')
for (const row of (data ?? [])) {
  console.log(`   ${row.is_published ? '🟢' : '⚫'} ${row.title}`)
}

console.log(`\n✨  Done! ${(data ?? []).length} articles in the new DB.`)
console.log('\n⚠️   File URLs still point to the old Supabase project.')
console.log('    If they stop working, re-upload PDFs via Learn → admin and update the file_url values.\n')
