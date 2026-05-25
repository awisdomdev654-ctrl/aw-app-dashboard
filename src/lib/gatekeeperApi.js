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
      data?.error?.message ??
      data?.error ??
      (typeof data?.error === 'object' ? JSON.stringify(data.error) : null) ??
      `Request failed (${response.status})`
    throw new Error(
      typeof message === 'string' ? message : `Request failed (${response.status})`,
    )
  }

  return data
}

export async function fetchHealth() {
  return request('/api/health')
}

export async function fetchMetrics() {
  return request('/api/metrics')
}

export async function fetchStems() {
  const data = await request('/api/stems')
  return data.stems ?? []
}

export async function fetchAudit(limit = 50) {
  const data = await request(`/api/audit?limit=${limit}`)
  return data.events ?? []
}

export async function runSecurityScan() {
  return request('/api/automation/scan')
}

export async function uploadStemDirect(file, { title, owner }) {
  const presign = await request('/api/upload/presign', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      title,
      owner,
      ...ACTOR,
    }),
  })

  let uploadedToS3 = false
  if (presign.uploadUrl) {
    const put = await fetch(presign.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-amz-server-side-encryption': 'AES256',
      },
    })
    if (!put.ok) {
      throw new Error(`S3 upload failed (${put.status})`)
    }
    uploadedToS3 = true
  }

  const complete = await request('/api/upload/complete', {
    method: 'POST',
    body: JSON.stringify({
      stemId: presign.stemId,
      sizeBytes: file.size,
      ...ACTOR,
    }),
  })

  return {
    stemId: presign.stemId,
    mockCloud: Boolean(presign.mockCloud),
    uploadedToS3,
    complete,
  }
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
