export const NATIVE_CONTROL_REPORT_FRESHNESS_MS = 30 * 60 * 1000

export function nativeControlReportFresh(receipt: { reportedAt: string }, now = Date.now()) {
  const reportedAt = Date.parse(receipt.reportedAt)
  const age = now - reportedAt
  return Number.isFinite(reportedAt) && Number.isFinite(age) && age >= 0 && age <= NATIVE_CONTROL_REPORT_FRESHNESS_MS
}
