/** Durations are measured on the Worker clock only; browser timings stay separate. */
export interface RollServerMetrics {
  requestId: string
  receivedAtMs: number
  enqueuedAtMs: number
  dequeuedAtMs: number
  hashedAtMs: number
  transactionStartedAtMs: number
  transactionCommittedAtMs: number
  broadcastAtMs: number
}

export interface RollCommandMetric {
  requestId: string
  preQueueMs: number
  queueMs: number
  hashMs: number
  computeMs: number
  storageMs: number
  broadcastMs: number
  serverTotalMs: number
  eventBytes: number
}

export function summarizeRollServerMetrics(metric: RollServerMetrics, eventBytes: number): RollCommandMetric {
  const duration = (end: number, start: number) => Math.max(0, end - start)
  return {
    requestId: metric.requestId,
    preQueueMs: duration(metric.enqueuedAtMs, metric.receivedAtMs),
    queueMs: duration(metric.dequeuedAtMs, metric.enqueuedAtMs),
    hashMs: duration(metric.hashedAtMs, metric.dequeuedAtMs),
    computeMs: duration(metric.transactionStartedAtMs, metric.hashedAtMs),
    storageMs: duration(metric.transactionCommittedAtMs, metric.transactionStartedAtMs),
    broadcastMs: duration(metric.broadcastAtMs, metric.transactionCommittedAtMs),
    serverTotalMs: duration(metric.broadcastAtMs, metric.receivedAtMs),
    eventBytes,
  }
}
