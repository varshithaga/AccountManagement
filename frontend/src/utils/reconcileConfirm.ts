/**
 * Deletes (and re-parses) that would remove bank reconciliation matches are refused with
 * HTTP 409 {"error": [...], "requires_confirmation": true} until resent with confirm_unmatch=true.
 * Changes inside a month signed off as reconciled are refused outright with a 400.
 */
type ApiError = { response?: { status?: number; data?: { error?: unknown; requires_confirmation?: boolean; detail?: unknown } } }

/** Runs `run(false)`; if the server asks for confirmation, shows its message and reruns `run(true)`.
 * Resolves false when the user cancels; other errors are rethrown. */
export async function withUnmatchConfirm(run: (confirmUnmatch: boolean) => Promise<unknown>): Promise<boolean> {
  try {
    await run(false)
    return true
  } catch (err) {
    const res = (err as ApiError).response
    if (res?.status !== 409 || !res.data?.requires_confirmation) throw err
    if (!window.confirm(`${apiErrorText(err, 'This removes bank reconciliation matches.')}\n\nContinue?`)) return false
    await run(true)
    return true
  }
}

/** First message of an {"error": [...]} / {"detail": ...} API error, or the fallback. */
export function apiErrorText(err: unknown, fallback: string): string {
  const data = (err as ApiError).response?.data
  const first = data?.error ?? data?.detail
  if (Array.isArray(first) && first.length) return String(first[0])
  if (typeof first === 'string') return first
  return fallback
}

export const confirmParams = (confirmUnmatch: boolean) => (confirmUnmatch ? { confirm_unmatch: true } : {})
