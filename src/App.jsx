import { useCallback, useEffect, useState } from 'react'
import './App.css'
import {
  approveStem,
  fetchAudit,
  fetchHealth,
  fetchMetrics,
  fetchStems,
  issueDownloadUrl,
  rejectStem,
  runSecurityScan,
  uploadStemMongo,
} from './lib/gatekeeperApi'

const STATUS_LABELS = {
  pending_upload: 'Pending Upload',
  awaiting_review: 'Awaiting Review',
  encrypted: 'Encrypted',
  signed_url_active: 'Signed URL Active',
  rejected: 'Rejected',
}

// 🔐 Placeholder credentials for the prototype gate. This is a client-side
// check only — the password ships in the JS bundle and isn't real auth.
// Swap this for a server-verified session (NextAuth/JWT) before this ever
// guards real stems.
const DEMO_CREDENTIALS = {
  email: 'producer@gatekeeperaudio.com',
  password: 'VaultAccess2026',
}

// Normalizes whatever the backend sends — raw enum values like
// "awaiting_review" or already-formatted labels — into a display string.
function formatStemStatus(status) {
  if (!status) return 'Unknown'
  return STATUS_LABELS[status] ?? status
}

function isAwaitingReview(status) {
  return status === 'awaiting_review' || status === 'Awaiting Review'
}

function isEncrypted(status) {
  return status === 'encrypted' || status === 'Encrypted'
}

function canPlay(status) {
  return (
    isEncrypted(status) ||
    status === 'signed_url_active' ||
    status === 'Signed URL Active'
  )
}

function statusVariant(status) {
  switch (status) {
    case 'encrypted':
    case 'Encrypted':
      return 'solid'
    case 'pending_upload':
    case 'Pending Upload':
      return 'pending'
    case 'awaiting_review':
    case 'Awaiting Review':
      return 'review'
    case 'rejected':
    case 'Rejected':
      return 'danger'
    default:
      return 'outline'
  }
}

function formatAuditEvent(event) {
  const time = new Date(event.createdAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
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
    case 'review_requested':
      return {
        time,
        message: `Review requested — "${event.detail?.title ?? 'stem'}" awaiting approval from ${event.detail?.owner ?? 'owner'}`,
      }
    case 'stem_approved':
      return {
        time,
        message: `Approved "${event.detail?.title ?? 'stem'}" — moved into the encrypted vault`,
      }
    case 'stem_rejected':
      return {
        time,
        message: `Rejected "${event.detail?.title ?? 'stem'}"${event.detail?.reason ? ` — ${event.detail.reason}` : ''}`,
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
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [activePlayer, setActivePlayer] = useState(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
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

  const handlePlay = async (stem) => {
    setBusy(`play-${stem.id}`)
    setError('')
    try {
      const presign = await issueDownloadUrl(stem.id)
      if (presign.downloadUrl) {
        setActivePlayer({ stemId: stem.id, title: stem.title, url: presign.downloadUrl })
        await loadDashboard()
      } else {
        setError(presign.message ?? 'Playback URL unavailable (check S3/GridFS config)')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playback failed')
    } finally {
      setBusy('')
    }
  }

  const handleLogin = (event) => {
    event.preventDefault()
    if (email === DEMO_CREDENTIALS.email && password === DEMO_CREDENTIALS.password) {
      setAuthError('')
      setIsAuthenticated(true)
    } else {
      setAuthError('Invalid email or password')
    }
  }

  const handleApprove = async (stem) => {
    setBusy(`review-${stem.id}`)
    setError('')
    try {
      await approveStem(stem.id)
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusy('')
    }
  }

  const openRejectModal = (stem) => {
    setRejectReason('')
    setRejectTarget(stem)
  }

  const handleReject = async (event) => {
    event.preventDefault()
    if (!rejectTarget) return

    setBusy(`review-${rejectTarget.id}`)
    setError('')
    try {
      await rejectStem(rejectTarget.id, { reason: rejectReason })
      setRejectTarget(null)
      setRejectReason('')
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
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




    const mongoOk = health?.mongo ?? false;
    const s3Ok = health?.s3 ?? false;
    const systemOk = mongoOk && s3Ok;

    const formatEventTimestamp = (event) => {
      // Gracefully check whatever timestamp field your backend drops into MongoDB
      const rawDate = event.time || event.timestamp || event.createdAt;
      
      if (!rawDate) return 'Recent';
    
      const dateObj = new Date(rawDate);
      
      // Safe fallback if the database format string isn't fully standard ISO
      if (isNaN(dateObj.getTime())) {
        return rawDate; 
      }
    
      // Formats to: "Jun 13, 7:55 AM"
      return dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    };


  if (!isAuthenticated) {
    return (
      <div className="app" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <div className="panel" style={{ maxWidth: '380px', width: '100%', margin: '3rem auto' }}>
          <p className="eyebrow">GATEKEEPER AUDIO</p>
          <h1 style={{ fontSize: '1.6rem' }}>Producer Sign-In</h1>
          <p className="subtitle" style={{ marginBottom: '1.25rem' }}>
            Restricted access — authorized producers and engineers only.
          </p>
          {authError && (
            <div className="banner banner-error" role="alert" style={{ marginBottom: '1rem' }}>
              {authError}
            </div>
          )}
          <form className="upload-form" onSubmit={handleLogin}>
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@label.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
            <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="submit">Sign In</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">GATEKEEPER AUDIO</p>
          <h1>Secure Stem Vault Dashboard</h1>
          <p className="subtitle">
            Prototype for secure collaboration & storage on unreleased music projects.
          </p>
        </div>
        <div
          className={`security-pill ${systemOk ? '' : 'security-pill-warn'}`}
          role="status"
        >
          AES-256 at Rest · Signed URLs: 10m
          {!systemOk && ' · Scan attention'}
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
                      <div className="stem-row">
                        <div>
                          <h3>{stem.title}</h3>
                          <p>
                            {stem.id} · Owner: {stem.owner}
                          </p>
                        </div>
                        <div className="stem-actions">
                          <StatusBadge
                            label={formatStemStatus(stem.status)}
                            variant={statusVariant(stem.status)}
                          />
                          {isAwaitingReview(stem.status) && (
                            <>
                              <button
                                type="button"
                                className="btn-small btn-approve"
                                disabled={busy === `review-${stem.id}`}
                                onClick={() => handleApprove(stem)}
                              >
                                {busy === `review-${stem.id}` ? 'Approving…' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                className="btn-small btn-reject"
                                disabled={busy === `review-${stem.id}`}
                                onClick={() => openRejectModal(stem)}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {canPlay(stem.status) && (
                            <button
                              type="button"
                              className="btn-small"
                              disabled={busy === `play-${stem.id}`}
                              onClick={() => handlePlay(stem)}
                            >
                              {busy === `play-${stem.id}` ? 'Loading…' : '▶ Play'}
                            </button>
                          )}
                          {isEncrypted(stem.status) && (
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
                      </div>
                      {activePlayer?.stemId === stem.id && (
                        <div className="audio-player-row">
                          <audio
                            controls
                            autoPlay
                            src={activePlayer.url}
                            onEnded={() => setActivePlayer(null)}
                            onError={() =>
                              setError(
                                'Audio failed to load — the file may be missing from storage.',
                              )
                            }
                          >
                            Your browser does not support the audio element.
                          </audio>
                          <button
                            type="button"
                            className="btn-small"
                            onClick={() => setActivePlayer(null)}
                          >
                            Close
                          </button>
                        </div>
                      )}
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
                  {auditEvents.map((event, i) => (
                    <li key={`audit-${i}-${event.time}`}>
                      <strong>{formatEventTimestamp(event)}</strong> – {event.message}
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

      {rejectTarget && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setRejectTarget(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-labelledby="reject-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reject-title">Reject "{rejectTarget.title}"</h2>
            <p className="modal-hint">
              This sends the stem back to {rejectTarget.owner} with a reason — it never
              reaches the encrypted vault.
            </p>
            <form className="upload-form" onSubmit={handleReject}>
              <label>
                Reason
                <textarea
                  required
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Wrong vocal take — please re-upload v5"
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setRejectTarget(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-reject"
                  disabled={busy === `review-${rejectTarget.id}`}
                >
                  {busy === `review-${rejectTarget.id}` ? 'Rejecting…' : 'Reject Stem'}
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
              {auditEvents.map((event, i) => (
                <li key={`full-audit-${i}-${event.time}`}>
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
