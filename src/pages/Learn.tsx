import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

interface KBArticle {
  id: string
  title: string
  content: string
  category: string
  is_published: boolean
  created_by: string
  updated_by: string
  updated_at: string
  file_url:  string | null
  file_name: string | null
  file_type: string | null
}

type View = 'list' | 'create' | 'edit' | 'read'

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  General:   { bg: 'rgba(8,145,178,0.1)',   color: '#0e7490' },
  Processes: { bg: 'rgba(206,164,255,0.18)', color: '#6b21a8' },
  SOPs:      { bg: 'rgba(22,101,52,0.1)',   color: '#166534' },
  Zendesk:   { bg: 'rgba(243,156,18,0.12)', color: '#b45309' },
}

const CATEGORIES = ['General', 'Processes', 'SOPs', 'Zendesk']

function catStyle(cat: string): { bg: string; color: string } {
  return CATEGORY_COLORS[cat] ?? { bg: 'rgba(0,0,0,0.07)', color: '#58595B' }
}

function fileTypeLabel(fileType: string | null): string | null {
  if (!fileType) return null
  if (fileType.includes('pdf')) return 'PDF'
  if (fileType.includes('wordprocessingml') || fileType.includes('docx')) return 'DOCX'
  if (fileType.includes('spreadsheetml') || fileType.includes('xlsx')) return 'XLSX'
  if (fileType.includes('presentationml') || fileType.includes('pptx')) return 'PPTX'
  return 'FILE'
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
  padding: '9px 12px', fontSize: 13, color: '#000',
  outline: 'none', transition: 'border-color 0.15s', background: '#fff', width: '100%',
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000', display: 'block', marginBottom: 6,
}

const primaryBtn: React.CSSProperties = {
  background: '#000', color: '#fff',
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
  padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'opacity 0.15s',
}

const secondaryBtn: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#58595B',
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
  padding: '9px 18px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
}

export default function Learn() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [articles, setArticles] = useState<KBArticle[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('All')
  const [search, setSearch]     = useState('')
  const [view, setView]         = useState<View>('list')
  const [editTarget, setEditTarget] = useState<KBArticle | null>(null)
  const [readTarget, setReadTarget] = useState<KBArticle | null>(null)
  const [saving, setSaving]     = useState(false)

  // form
  const [formTitle,    setFormTitle]    = useState('')
  const [formCat,      setFormCat]      = useState('General')
  const [formBody,     setFormBody]     = useState('')
  const [formFileUrl,  setFormFileUrl]  = useState('')
  const [formFileName, setFormFileName] = useState('')
  const [formFileType, setFormFileType] = useState('')

  useEffect(() => { loadArticles() }, [])

  async function loadArticles() {
    setLoading(true)
    let q = supabase
      .from('kb_articles')
      .select('id, title, content, category, is_published, created_by, updated_by, updated_at, file_url, file_name, file_type')
      .order('updated_at', { ascending: false })
    if (!isAdmin) q = (q as any).eq('is_published', true)
    const { data } = await q
    setArticles(data ?? [])
    setLoading(false)
  }

  function openCreate() {
    setEditTarget(null)
    setFormTitle(''); setFormCat('General'); setFormBody('')
    setFormFileUrl(''); setFormFileName(''); setFormFileType('')
    setView('create')
  }

  function openEdit(a: KBArticle) {
    setEditTarget(a)
    setFormTitle(a.title); setFormCat(a.category); setFormBody(a.content)
    setFormFileUrl(a.file_url ?? ''); setFormFileName(a.file_name ?? ''); setFormFileType(a.file_type ?? '')
    setView('edit')
  }

  async function handleSave(publish: boolean) {
    if (!user || !formTitle.trim()) return
    setSaving(true)

    // Derive file_type from URL if not manually set
    let resolvedFileType = formFileType.trim()
    if (!resolvedFileType && formFileUrl.trim()) {
      const lower = formFileUrl.toLowerCase()
      if (lower.endsWith('.pdf')) resolvedFileType = 'application/pdf'
      else if (lower.endsWith('.docx')) resolvedFileType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }

    const payload = {
      title:        formTitle.trim(),
      category:     formCat,
      content:      formBody,
      is_published: publish,
      updated_by:   user.email,
      updated_at:   new Date().toISOString(),
      file_url:     formFileUrl.trim()  || null,
      file_name:    formFileName.trim() || null,
      file_type:    resolvedFileType    || null,
    }
    if (editTarget) {
      const { error } = await supabase.from('kb_articles').update(payload).eq('id', editTarget.id)
      if (error) { alert(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('kb_articles').insert([{ ...payload, created_by: user.email }])
      if (error) { alert(error.message); setSaving(false); return }
    }
    setSaving(false)
    setView('list')
    loadArticles()
  }

  async function handleTogglePublish(a: KBArticle) {
    await supabase.from('kb_articles').update({ is_published: !a.is_published }).eq('id', a.id)
    setArticles(as => as.map(x => x.id === a.id ? { ...x, is_published: !x.is_published } : x))
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this article? This cannot be undone.')) return
    await supabase.from('kb_articles').delete().eq('id', id)
    setArticles(as => as.filter(a => a.id !== id))
  }

  const categories = ['All', ...Array.from(new Set(articles.map(a => a.category))).sort()]

  const filtered = articles.filter(a => {
    if (filter !== 'All' && a.category !== filter) return false
    if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const groupedCats = Array.from(new Set(filtered.map(a => a.category))).sort()

  // ── Read view ────────────────────────────────────────────────────────────────
  if (view === 'read' && readTarget) {
    const ftLabel = fileTypeLabel(readTarget.file_type)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <button onClick={() => { setView('list'); setReadTarget(null) }} style={{ ...secondaryBtn, marginBottom: 12 }}>
              ← Back to Learn
            </button>
            <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
              {readTarget.title}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <span style={{
                fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '3px 9px', borderRadius: 100,
                background: catStyle(readTarget.category).bg, color: catStyle(readTarget.category).color,
              }}>{readTarget.category}</span>
              {ftLabel && (
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                  padding: '3px 9px', borderRadius: 100,
                  background: 'rgba(0,0,0,0.06)', color: '#58595B',
                }}>{ftLabel}</span>
              )}
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#aaa' }}>
                Updated {new Date(readTarget.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {readTarget.file_url && (
              <a
                href={readTarget.file_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  ...primaryBtn,
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                {ftLabel === 'PDF' ? 'Open PDF' : ftLabel ? `Open ${ftLabel}` : 'Open file'}
              </a>
            )}
            {isAdmin && (
              <button onClick={() => { openEdit(readTarget) }} style={secondaryBtn}>Edit article</button>
            )}
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 28 }}>
          {readTarget.file_url && !readTarget.content && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 14, padding: '32px 0', color: '#58595B',
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#CEA4FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', margin: 0 }}>
                This article is a {ftLabel ?? 'file'} attachment.
              </p>
              <a
                href={readTarget.file_url}
                target="_blank"
                rel="noreferrer"
                style={{ ...primaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Open {readTarget.file_name ?? (ftLabel ? `${ftLabel} file` : 'file')}
              </a>
            </div>
          )}
          {readTarget.content && (
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#000', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {readTarget.content}
            </div>
          )}
          {!readTarget.file_url && !readTarget.content && (
            <em style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#aaa' }}>No content yet.</em>
          )}
        </div>
      </div>
    )
  }

  // ── Create / Edit view ───────────────────────────────────────────────────────
  if (view === 'create' || view === 'edit') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
              {view === 'edit' ? 'Edit article' : 'New article'}
            </h1>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
              SOPs, guides, and resources for the team
            </p>
          </div>
          <button onClick={() => setView('list')} style={secondaryBtn}>← Back to Learn</button>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 14 }}>
            <div>
              <label style={labelStyle}>Title</label>
              <input
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="e.g. How to Handle Chargebacks"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select
                value={formCat}
                onChange={e => setFormCat(e.target.value)}
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
              >
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* File attachment section */}
          <div style={{
            border: '1.5px dashed rgba(206,164,255,0.5)', borderRadius: 10, padding: 16,
            background: 'rgba(206,164,255,0.04)', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: '#9B59D0', margin: 0, letterSpacing: '0.04em' }}>
              📎 FILE ATTACHMENT (optional)
            </p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', margin: 0 }}>
              Upload the file to Supabase Storage (Learn → admin) and paste the public URL below.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>File URL</label>
                <input
                  value={formFileUrl}
                  onChange={e => setFormFileUrl(e.target.value)}
                  placeholder="https://your-project.supabase.co/storage/v1/object/public/…"
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>
              <div>
                <label style={labelStyle}>Display file name</label>
                <input
                  value={formFileName}
                  onChange={e => setFormFileName(e.target.value)}
                  placeholder="e.g. SOP_Chargebacks.pdf"
                  style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
                />
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Article content <span style={{ fontWeight: 400, color: '#aaa' }}>(optional if file attached)</span></label>
            <textarea
              value={formBody}
              onChange={e => setFormBody(e.target.value)}
              placeholder="Write your article here…"
              rows={10}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.7, minHeight: 200 }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setView('list')} style={secondaryBtn}>Cancel</button>
            <button
              onClick={() => handleSave(false)}
              disabled={!formTitle || saving}
              style={{ ...secondaryBtn, opacity: formTitle && !saving ? 1 : 0.4 }}
            >
              Save as draft
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={!formTitle || saving}
              style={{ ...primaryBtn, opacity: formTitle && !saving ? 1 : 0.4, cursor: formTitle && !saving ? 'pointer' : 'default' }}
            >
              {saving ? 'Saving…' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>Learn</h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
            SOPs, guides, and resources for the team
          </p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} style={primaryBtn}>+ New article</button>
        )}
      </div>

      {/* Search + category filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 260 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8" stroke="#aaa" strokeWidth="1.7"/>
            <path d="M21 21l-4.35-4.35" stroke="#aaa" strokeWidth="1.7" strokeLinecap="round"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search articles…"
            style={{ ...inputStyle, paddingLeft: 32 }}
            onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {categories.map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
              padding: '7px 14px', borderRadius: 100, cursor: 'pointer',
              background: filter === f ? '#000' : '#fff',
              color: filter === f ? '#fff' : '#58595B',
              border: filter === f ? '1.5px solid #000' : '1.5px solid rgba(0,0,0,0.12)',
              transition: 'all 0.15s',
            }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>Loading…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid rgba(0,0,0,0.09)', padding: 48, textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>No articles found</p>
        </div>
      ) : (
        groupedCats.map(cat => (
          <div key={cat}>
            <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 16, fontWeight: 600, color: '#000', marginBottom: 12 }}>{cat}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {filtered.filter(a => a.category === cat).map(article => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  isAdmin={isAdmin}
                  onRead={() => { setReadTarget(article); setView('read') }}
                  onEdit={() => openEdit(article)}
                  onDelete={() => handleDelete(article.id)}
                  onToggle={() => handleTogglePublish(article)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function ArticleCard({ article, isAdmin, onRead, onEdit, onDelete, onToggle }: {
  article: KBArticle; isAdmin: boolean
  onRead: () => void; onEdit: () => void; onDelete: () => void; onToggle: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const cs = catStyle(article.category)
  const ftLabel = fileTypeLabel(article.file_type)
  const preview = article.content
    ? article.content.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').replace(/\*/g, '').trim().slice(0, 120)
    : ''

  return (
    <div
      onClick={onRead}
      style={{
        background: '#fff', borderRadius: 14,
        border: '1.5px solid rgba(0,0,0,0.09)', padding: 18,
        display: 'flex', flexDirection: 'column', gap: 10,
        cursor: 'pointer', position: 'relative', transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(206,164,255,0.5)'
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(206,164,255,0.12)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.09)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700,
            padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em',
            background: cs.bg, color: cs.color,
          }}>{article.category}</span>
          {ftLabel && (
            <span style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700,
              padding: '3px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.06em',
              background: 'rgba(0,0,0,0.06)', color: '#58595B',
            }}>{ftLabel}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isAdmin && (
            <span style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600,
              padding: '3px 8px', borderRadius: 100,
              background: article.is_published ? 'rgba(22,101,52,0.09)' : 'rgba(0,0,0,0.06)',
              color: article.is_published ? '#166534' : '#58595B',
            }}>
              {article.is_published ? 'Published' : 'Draft'}
            </span>
          )}
          {isAdmin && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
                style={{
                  width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#aaa', fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >⋯</button>
              {menuOpen && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute', right: 0, top: 28, zIndex: 10,
                    background: '#fff', borderRadius: 10,
                    border: '1.5px solid rgba(0,0,0,0.09)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                    minWidth: 140, overflow: 'hidden',
                  }}
                >
                  {[
                    { label: 'Edit', action: onEdit, danger: false },
                    { label: article.is_published ? 'Unpublish' : 'Publish', action: onToggle, danger: false },
                    { label: 'Delete', action: onDelete, danger: true },
                  ].map(item => (
                    <button key={item.label} onClick={() => { item.action(); setMenuOpen(false) }} style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                      fontFamily: 'Inter, sans-serif', fontSize: 13,
                      color: item.danger ? '#e53e3e' : '#000',
                      background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.1s',
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = item.danger ? 'rgba(229,62,62,0.06)' : 'rgba(0,0,0,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >{item.label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <p style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: '#000', lineHeight: 1.4 }}>
        {article.title}
      </p>

      {preview ? (
        <p style={{
          fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B', lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {preview}{article.content.length > 120 ? '…' : ''}
        </p>
      ) : article.file_name ? (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#9B59D0', lineHeight: 1.5 }}>
          📄 {article.file_name}
        </p>
      ) : null}

      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#aaa', marginTop: 'auto' }}>
        Updated {new Date(article.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </p>
    </div>
  )
}
