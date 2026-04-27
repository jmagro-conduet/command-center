export default function Learn() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontFamily: 'Manrope, sans-serif', fontSize: 24, fontWeight: 600, color: '#000' }}>
          Learn
        </h1>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#58595B', marginTop: 4 }}>
          Knowledge base and training resources for CS agents
        </p>
      </div>
      <div style={{
        background: '#fff', borderRadius: 16,
        border: '1.5px solid rgba(0,0,0,0.09)', padding: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
          No articles yet
        </p>
      </div>
    </div>
  )
}
