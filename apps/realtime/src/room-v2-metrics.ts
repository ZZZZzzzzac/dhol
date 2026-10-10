/** Durations are measured on the Worker clock only; browser timings stay separate. */
export interface RollServerMetrics {
  requestId: string
  receivedAtMs: number
  queuedAtMs: number
  storedAtMs: number
  broadcastAtMs: number
}

export interface RollCommandMetric {
  requestId: string
  queueMs: number
  storageMs: number
  broadcastMs: number
  serverTotalMs: number
  eventBytes: number
}

export function summarizeRollServerMetrics(metric: RollServerMetrics, eventBytes: number): RollCommandMetric {
  const duration = (end: number, start: number) => Math.max(0, end - start)
  return {
    requestId: metric.requestId,
    queueMs: duration(metric.queuedAtMs, metric.receivedAtMs),
    storageMs: duration(metric.storedAtMs, metric.queuedAtMs),
    broadcastMs: duration(metric.broadcastAtMs, metric.storedAtMs),
    serverTotalMs: duration(metric.broadcastAtMs, metric.receivedAtMs),
    eventBytes,
  }
}
