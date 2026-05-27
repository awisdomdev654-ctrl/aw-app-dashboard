import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  fetchAudit,
  fetchMetrics,
  fetchStems,
  issueDownloadUrl,
  uploadStemPipeline,
} from './lib/gatekeeperApi'

function statusClass(status) {
  if (status === 'Encrypted') return 'status status-encrypted'
  if (status === 'Awaiting Review') return 'status status-review'
  if (status === 'Signed URL Active') return 'status status-active'
  return 'status'
}

function auditLine(event) {
  const time = new Date(event.createdAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

  if (event.action === 'download_presign_issued') {
    return { time, message: 'Signed URL issued to Mix Engineer (expires in 10 mins)' }
  }
  if (event.action === 'upload_completed') {
    return { time, message: `Producer uploaded "${event.resourceId ?? 'New Stem'}"` }
  }
  if (event.action === 'security_scan_completed' && event.detail?.ok) {
    return { time, message: 'Security scan passed on latest frontend build' }
  }
  if (event.action === 'automation_pipeline_completed') {
    return { time, message: `New version tagged for "${event.detail?.title ?? 'Stem'}"` }
  }
  return { time, message: event.action }
}

function App() {
  const [metrics, setMetrics] = useState(null)
  const [stems, setStems] = useState([])
  const [events, setEvents] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([fetchMetrics(), fetchStems(), fetchAudit(6)])
      .then(([m, s, a]) => {
        if (!alive) return
        setMetrics(m)
        setStems(s)
        setEvents(a)
      })
      .catch(() => {
        // Keep UI clean like the mock; silent failure in demo mode.
      })
    return () => {
      alive = false
    }
  }, [])

  const cards = useMemo(() => {
    if (!metrics) {
      return [
        { title: 'Active Sessions', value: '—', detail: '—' },
        { title: 'Encrypted Stems', value: '—', detail: '—' },
        { title: 'Pending Reviews', value: '—', detail: '—' },
        { title: 'Audit Events (24h)', value: '—', detail: '—' },
      ]
    }
    return [
      {
        title: 'Active Sessions',
        value: String(metrics.activeSessions),
        detail: `${metrics.highPrioritySessions} high-priority sessions in progress`,
      },
      {
        title: 'Encrypted Stems',
        value: String(metrics.encryptedStems),
        detail: 'All protected in secure object storage',
      },
      {
        title: 'Pending Reviews',
        value: String(metrics.pendingReviews),
        detail: `${metrics.awaitingProducer} awaiting producer approval`,
      },
      {
        title: 'Audit Events (24h)',
        value: String(metrics.auditEvents24h),
        detail: 'No suspicious activity detected',
      },
    ]
  }, [metrics])

  const uploadInputId = 'upload-input'

  const onPickFile = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      await uploadStemPipeline(file, {
        title: file.name.replace(/\.[^.]+$/, ''),
        owner: 'A&R Team',
        format: 'flac',
      })
      const [m, s, a] = await Promise.all([fetchMetrics(), fetchStems(), fetchAudit(6)])
      setMetrics(m)
      setStems(s)
      setEvents(a)
    } finally {
      setBusy(false)
    }
  }

  const onGetUrl = async (stemId) => {
    setBusy(true)
    try {
      const presign = await issueDownloadUrl(stemId)
      if (presign?.downloadUrl) {
        window.open(presign.downloadUrl, '_blank', 'noopener,noreferrer')
      }
      const [m, s, a] = await Promise.all([fetchMetrics(), fetchStems(), fetchAudit(6)])
      setMetrics(m)
      setStems(s)
      setEvents(a)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">GATEKEEPER AUDIO</p>
          <h1>Secure Stem Vault Dashboard</h1>
          <p className="subtitle">
            Frontend prototype for secure collaboration on unreleased music projects.
          </p>
        </div>
        <div className="security-pill" role="status">
          AES-256 at Rest · Signed URLs: 10m
        </div>
      </header>

      <section className="metrics-grid" aria-label="Key metrics">
        {cards.map((metric) => (
          <article key={metric.title} className="metric-card">
            <p>{metric.title}</p>
            <h2>{metric.value}</h2>
            <span>{metric.detail}</span>
          </article>
        ))}
      </section>

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Stem Upload Queue</h2>
            <div>
              <input
                id={uploadInputId}
                className="file-input"
                type="file"
                accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg"
                disabled={busy}
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => document.getElementById(uploadInputId)?.click()}
              >
                Upload New Stem
              </button>
            </div>
          </div>

          <ul className="stem-list">
            {stems.slice(0, 3).map((stem) => (
              <li key={stem.id}>
                <div>
                  <h3>{stem.title}</h3>
                  <p>
                    {stem.id} · Owner: {stem.owner}
                  </p>
                </div>
                <button
                  type="button"
                  className={statusClass(stem.status)}
                  disabled={busy || stem.status !== 'Encrypted'}
                  onClick={() => onGetUrl(stem.id)}
                >
                  {stem.status}
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Recent Audit Activity</h2>
          </div>
          <ul className="audit-list">
            {events.slice(0, 4).map((event) => {
              const line = auditLine(event)
              return (
                <li key={event.id ?? `${event.createdAt}-${event.action}`}>
                  <strong>{line.time}</strong> — {line.message}
                </li>
              )
            })}
          </ul>
          <div className="panel-footer">
            <button type="button" disabled={busy}>
              View Full Audit Trail
            </button>
          </div>
        </article>
      </section>
    </div>
  )
}

export default App

 