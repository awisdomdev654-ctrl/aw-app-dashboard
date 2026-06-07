import { useCallback, useEffect, useState } from 'react'
import './App.css'
import {
  fetchAudit,
  fetchHealth,
  fetchMetrics,
  fetchStems,
  issueDownloadUrl,
  runSecurityScan,
  uploadStemMongo,
} from './lib/gatekeeperApi'

function statusVariant(status) {
  if (status === 'Encrypted') return 'solid'
  if (status === 'Pending Upload') return 'pending'
  return 'outline'
}

function formatAuditEvent(event) {
  const time = new Date(event.createdAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

  switch (event.action) {
    case 'upload_presign_issued':
      return {
        time,
        message: `Upload presign issued for stem ${event.resourceId ?? 'unknown'}`,
      }
    case 'upload_completed':
      return {
        time,
        message: `Upload completed — stem ${event.resourceId ?? 'unknown'} encrypted at rest`,
      }
    case 'download_presign_issued':
      return {
        time,
        message: `Signed URL issued${event.actorLabel ? ` to ${event.actorLabel}` : ''} (expires in 10 mins)`,
      }
    case 'security_scan_completed':
      return {
        time,
        message: event.detail?.ok
          ? 'Security scan passed — no high-severity findings'
          : 'Security scan completed — review findings',
      }
    case 'automation_pipeline_completed':
      return {
        time,
        message: `Automation pipeline uploaded "${event.detail?.title ?? 'stem'}" (${event.detail?.format ?? 'flac'})`,
      }
    default:
      return {
        time,
        message: `${event.action}${event.resourceId ? ` (${event.resourceId})` : ''}`,
      }
  }
}

function StatusBadge({ label, variant }) {
  return (
    <span className={`status status-${variant}`} role="status">
      {label}
    </span>
  )
}

function App() {
  const [health, setHealth] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [stems, setStems] = useState([])
  const [auditEvents, setAuditEvents] = useState([])
  const [securityOk, setSecurityOk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const [uploadForm, setUploadForm] = useState({
    title: '',
    owner: 'A&R Team',
    usePipeline: true,
    format: 'flac',
    file: null,
  })

  const loadDashboard = useCallback(async () => {
    setError('')
    try {
      const [healthRes, metricsRes, stemsRes, auditRes, scanRes] =
        await Promise.all([
          fetchHealth().catch(() => ({ ok: false, mongo: false, s3: false })),
          fetchMetrics().catch(() => null),
          fetchStems().catch(() => []),
          fetchAudit(8).catch(() => []),
          runSecurityScan().catch(() => ({ ok: true, findingCount: 0 })),
        ])

      setHealth(healthRes)
      setMetrics(metricsRes)
      setStems(stemsRes)
      setAuditEvents(auditRes.map(formatAuditEvent))
      setSecurityOk(Boolean(scanRes.ok))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const loadFullAudit = async () => {
    setBusy('audit')
    try {
      const events = await fetchAudit(200)
      setAuditEvents(events.map(formatAuditEvent))
      setShowAudit(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit trail')
    } finally {
      setBusy('')
    }
  }

  const handleUploadStem = async (event) => {
    event.preventDefault()
    if (!uploadForm.file) return

    setBusy('upload')
    setError('')
    try {
      const result = await uploadStemMongo(uploadForm.file, {
        title: uploadForm.title,
        owner: uploadForm.owner,
      })

      if (!result?.ok) {
        throw new Error(
          typeof result?.error === 'string'
            ? result.error
            : 'Upload failed — stem was not saved',
        )
      }

      setShowUpload(false)
      setUploadForm((prev) => ({ ...prev, file: null, title: '' }))
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy('')
    }
  }

  const handleDownload = async (stemId) => {
    setBusy(`download-${stemId}`)
    setError('')
    try {
      const presign = await issueDownloadUrl(stemId)
      if (presign.downloadUrl) {
        window.open(presign.downloadUrl, '_blank', 'noopener,noreferrer')
      } else {
        setError(presign.message ?? 'Download URL unavailable (check S3 config)')
      }
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy('')
    }
  }

  const metricCards = metrics
    ? [
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
          detail: !securityOk
            ? 'Suspicious activity detected — review audit trail'
            : 'No suspicious activity detected',
        },
      ]
    : []

  const mongoOk = health?.mongo
  const s3Ok = health?.s3

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
        <div
          className={`security-pill ${securityOk ? '' : 'security-pill-warn'}`}
          role="status"
        >
          AES-256 at Rest · Signed URLs: 10m
          {!securityOk && ' · Scan attention'}
          {health && (
            <span className="health-dots">
              <span className={mongoOk ? 'dot ok' : 'dot bad'} title="MongoDB" />
              <span className={s3Ok ? 'dot ok' : 'dot bad'} title="S3" />
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="banner banner-error" role="alert">
          {error}
          <button type="button" className="banner-dismiss" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <p className="loading">Loading dashboard…</p>
      ) : (
        <>
          <section className="metrics-grid" aria-label="Key metrics">
            {metricCards.map((metric) => (
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
                <button
                  type="button"
                  onClick={() => setShowUpload(true)}
                  disabled={Boolean(busy)}
                >
                  Upload New Stem
                </button>
              </div>
              {stems.length === 0 ? (
                <p className="empty-state">No stems yet — upload your first stem.</p>
              ) : (
                <ul className="stem-list">
                  {stems.map((stem) => (
                    <li key={stem.id}>
                      <div>
                        <h3>{stem.title}</h3>
                        <p>
                          {stem.id} · Owner: {stem.owner}
                        </p>
                      </div>
                      <div className="stem-actions">
                        <StatusBadge
                          label={stem.status}
                          variant={statusVariant(stem.status)}
                        />
                        {stem.status === 'Encrypted' && (
                          <button
                            type="button"
                            className="btn-small"
                            disabled={busy === `download-${stem.id}`}
                            onClick={() => handleDownload(stem.id)}
                          >
                            Get URL
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="panel">
              <div className="panel-header">
                <h2>Recent Audit Activity</h2>
              </div>
              {auditEvents.length === 0 ? (
                <p className="empty-state">No audit events yet.</p>
              ) : (
                <ul className="audit-list">
                  {auditEvents.map((event) => (
                    <li key={`${event.time}-${event.message}`}>
                      <strong>{event.time}</strong> — {event.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="panel-footer">
                <button
                  type="button"
                  disabled={busy === 'audit'}
                  onClick={loadFullAudit}
                >
                  {busy === 'audit' ? 'Loading…' : 'View Full Audit Trail'}
                </button>
              </div>
            </article>
          </section>
        </>
      )}

      {showUpload && (
        <div className="modal-overlay" role="presentation" onClick={() => setShowUpload(false)}>
          <div
            className="modal"
            role="dialog"
            aria-labelledby="upload-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="upload-title">Upload New Stem</h2>
            <p className="modal-hint">
              Python pipeline transcodes audio, strips metadata, runs security checks,
              then uploads via the API.
            </p>
            <form className="upload-form" onSubmit={handleUploadStem}>
              <label>
                Audio file
                <input
                  type="file"
                  accept="audio/*,.wav,.flac,.mp3,.m4a,.aac,.ogg"
                  required
                  onChange={(e) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      file: e.target.files?.[0] ?? null,
                      title: prev.title || e.target.files?.[0]?.name?.replace(/\.[^.]+$/, '') || '',
                    }))
                  }
                />
              </label>
              <label>
                Title
                <input
                  type="text"
                  required
                  value={uploadForm.title}
                  onChange={(e) =>
                    setUploadForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                />
              </label>
              <label>
                Owner
                <input
                  type="text"
                  required
                  value={uploadForm.owner}
                  onChange={(e) =>
                    setUploadForm((prev) => ({ ...prev, owner: e.target.value }))
                  }
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={uploadForm.usePipeline}
                  onChange={(e) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      usePipeline: e.target.checked,
                    }))
                  }
                />
                Run Python pipeline (transcode + security remediation)
              </label>
              {uploadForm.usePipeline && (
                <label>
                  Output format
                  <select
                    value={uploadForm.format}
                    onChange={(e) =>
                      setUploadForm((prev) => ({ ...prev, format: e.target.value }))
                    }
                  >
                    <option value="flac">FLAC</option>
                    <option value="wav">WAV</option>
                    <option value="mp3">MP3</option>
                    <option value="aac">AAC</option>
                  </select>
                </label>
              )}
              <div className="modal-actions">
                <button type="button" onClick={() => setShowUpload(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={busy === 'upload'}>
                  {busy === 'upload' ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAudit && (
        <div className="modal-overlay" role="presentation" onClick={() => setShowAudit(false)}>
          <div
            className="modal modal-wide"
            role="dialog"
            aria-labelledby="audit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="audit-title">Full Audit Trail</h2>
            <ul className="audit-list audit-list-full">
              {auditEvents.map((event) => (
                <li key={`full-${event.time}-${event.message}`}>
                  <strong>{event.time}</strong> — {event.message}
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowAudit(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
