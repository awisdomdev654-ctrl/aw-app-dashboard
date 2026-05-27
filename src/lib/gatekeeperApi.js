const API_BASE = import.meta.env.VITE_GATEKEEPER_API_URL ?? ''

const ACTOR = {
  actorId: 'dashboard',
  actorLabel: 'Gatekeeper Dashboard',
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  })

  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const message =
      (typeof data?.error === 'string' && data.error) ||
      (typeof data?.error?.message === 'string' && data.error.message) ||
      (data?.error && typeof data.error === 'object'
        ? JSON.stringify(data.error)
        : null) ||
      `Request failed (${response.status})`
    throw new Error(message)
  }

  return data
}

export async function fetchMetrics() {
  return request('/api/metrics')
}

export async function fetchStems() {
  const data = await request('/api/stems')
  return data?.stems ?? []
}

export async function fetchAudit(limit = 50) {
  const data = await request(`/api/audit?limit=${limit}`)
  return data?.events ?? []
}

export async function uploadStemPipeline(file, { title, owner, format = 'flac' }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', title)
  formData.append('owner', owner)
  formData.append('format', format)

  return request('/api/automation/pipeline', {
    method: 'POST',
    body: formData,
  })
}

export async function issueDownloadUrl(stemId) {
  return request('/api/download/presign', {
    method: 'POST',
    body: JSON.stringify({ stemId, ...ACTOR }),
  })
}

