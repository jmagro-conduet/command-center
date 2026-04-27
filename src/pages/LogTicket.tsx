export default function LogTicket() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
          Log ticket
        </h1>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1.5px solid rgba(0,0,0,0.09)', paddingBottom: 0 }}>
        <button style={{
          fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
          color: '#9B59D0', padding: '8px 12px', borderBottom: '2px solid #9B59D0',
          background: 'none', marginBottom: -1.5,
        }}>
          New ticket
        </button>
        <button style={{
          fontFamily: 'Inter, sans-serif', fontSize: 14,
          color: '#58595B', padding: '8px 12px',
          background: 'none', borderBottom: '2px solid transparent',
          marginBottom: -1.5,
        }}>
          +
        </button>
      </div>

      {/* Ticket details card */}
      <div style={{
        background: '#fff', borderRadius: 16,
        border: '1.5px solid rgba(0,0,0,0.09)', padding: 24,
      }}>
        <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 17, fontWeight: 600, color: '#000', marginBottom: 20 }}>
          Ticket details
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
              Ticket number <span style={{ color: '#e53e3e' }}>*</span>
            </label>
            <input
              placeholder="e.g. ZD-10482"
              style={{
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
                padding: '10px 12px', fontSize: 13, color: '#000',
                outline: 'none', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
              Contact / ticket category <span style={{ color: '#e53e3e' }}>*</span>
            </label>
            <select
              style={{
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
                padding: '10px 12px', fontSize: 13, color: '#58595B',
                outline: 'none', background: '#fff', transition: 'border-color 0.15s',
                appearance: 'auto',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            >
              <option value="">Select category</option>
              <option>Account</option>
              <option>Payment</option>
              <option>Responsible gaming</option>
              <option>Technical</option>
              <option>Promotions</option>
              <option>Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* gameLM response card */}
      <div style={{
        background: '#fff', borderRadius: 16,
        border: '1.5px solid #CEA4FF', padding: 24,
      }}>
        <h2 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 17, fontWeight: 600, color: '#000', marginBottom: 20 }}>
          Add gameLM response
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
              Customer input <span style={{ color: '#e53e3e' }}>*</span>
            </label>
            <textarea
              placeholder="Paste the original customer message or query…"
              rows={4}
              style={{
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
                padding: '10px 12px', fontSize: 13, color: '#000',
                outline: 'none', resize: 'vertical', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
              Suggested response <span style={{ color: '#e53e3e' }}>*</span>
            </label>
            <textarea
              placeholder="Paste the original gameLM response here…"
              rows={4}
              style={{
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
                padding: '10px 12px', fontSize: 13, color: '#000',
                outline: 'none', resize: 'vertical', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#CEA4FF')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)')}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: '#000' }}>
              Issue type <span style={{ color: '#e53e3e' }}>*</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                { label: 'Good response',   emoji: '👍', value: 'good' },
                { label: 'Hallucination',   emoji: '⚫', value: 'hallucination' },
                { label: 'Partial answer',  emoji: '⬤', value: 'partial' },
                { label: 'Wrong / harmful', emoji: '🚫', value: 'wrong' },
              ].map(opt => (
                <button
                  key={opt.value}
                  style={{
                    border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
                    padding: '14px 8px', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 6, background: '#fff',
                    fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#58595B',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#CEA4FF'
                    e.currentTarget.style.background = 'rgba(206,164,255,0.06)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)'
                    e.currentTarget.style.background = '#fff'
                  }}
                >
                  <span style={{ fontSize: 22 }}>{opt.emoji}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Submit */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={{
          background: '#000', color: '#fff',
          fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500,
          padding: '10px 24px', borderRadius: 10,
          transition: 'opacity 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          Submit ticket
        </button>
      </div>
    </div>
  )
}
