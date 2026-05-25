import { logAuditEvent } from '@/lib/audit'
import { AutomationError, runAutomationTask } from '@/lib/automation'
import { corsHeaders, jsonResponse } from '@/lib/cors'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const result = await runAutomationTask('scan-api')

    await logAuditEvent({
      actorLabel: 'Gatekeeper Dashboard',
      action: 'security_scan_completed',
      resourceType: 'system',
      detail: {
        ok: result.ok,
        findingCount: result.findingCount,
      },
    })

    return jsonResponse({
      ...result,
      suspiciousActivity:
        typeof result.findingCount === 'number' && result.findingCount > 0
          ? !result.ok
          : false,
    })
  } catch (err) {
    const message =
      err instanceof AutomationError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Automation scan failed'

    return jsonResponse(
      {
        ok: false,
        error: message,
        findings: [],
        findingCount: 0,
        suspiciousActivity: true,
      },
      { status: 503 },
    )
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}
