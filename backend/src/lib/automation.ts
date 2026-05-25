import { spawn } from 'child_process'
import path from 'path'

function automationDir(): string {
  return path.resolve(process.cwd(), '../automation')
}

export class AutomationError extends Error {
  constructor(
    message: string,
    public readonly stderr = '',
    public readonly exitCode: number | null = null,
  ) {
    super(message)
    this.name = 'AutomationError'
  }
}

export async function runAutomationTask(
  task: string,
  args: string[] = [],
): Promise<Record<string, unknown>> {
  const cwd = automationDir()
  const python = process.env.GATEKEEPER_PYTHON ?? 'python3'
  const baseUrl =
    process.env.GATEKEEPER_BASE_URL ??
    process.env.NEXT_PUBLIC_GATEKEEPER_URL ??
    'http://127.0.0.1:3000'

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(python, ['-m', 'gatekeeper.tasks', task, ...args], {
      cwd,
      env: {
        ...process.env,
        PYTHONPATH: cwd,
        GATEKEEPER_BASE_URL: baseUrl,
        GATEKEEPER_ACTOR_ID:
          process.env.GATEKEEPER_ACTOR_ID ?? 'dashboard-automation',
        GATEKEEPER_ACTOR_LABEL:
          process.env.GATEKEEPER_ACTOR_LABEL ?? 'Gatekeeper Dashboard',
      },
    })

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      reject(
        new AutomationError(
          `Failed to start Python automation: ${err.message}`,
          stderr,
        ),
      )
    })

    proc.on('close', (code) => {
      const trimmed = stdout.trim()
      if (!trimmed) {
        reject(
          new AutomationError(
            stderr.trim() ||
              `Automation task "${task}" produced no output (exit ${code})`,
            stderr,
            code,
          ),
        )
        return
      }

      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        if (code !== 0 && parsed.error) {
          reject(new AutomationError(String(parsed.error), stderr, code))
          return
        }
        if (code !== 0) {
          reject(
            new AutomationError(
              String(parsed.error ?? `Automation exited with code ${code}`),
              stderr,
              code,
            ),
          )
          return
        }
        resolve(parsed)
      } catch {
        reject(
          new AutomationError(
            `Invalid JSON from automation: ${trimmed.slice(0, 200)}`,
            stderr,
            code,
          ),
        )
      }
    })
  })
}
