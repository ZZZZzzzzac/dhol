#!/usr/bin/env node

// A preflight is safe to run against production: it does not create a room or send a character.
const endpoints = [
  'https://dhol-realtime.gooole-dql.workers.dev',
  'https://screenol.pages.dev',
]
const origins = ['https://dhsheet.top', 'https://daggerheart.cn']
const path = '/api/v2/rooms/ABC123/characters'
let failures = 0

for (const endpoint of endpoints) {
  for (const origin of origins) {
    const url = new URL(path, endpoint)
    try {
      const response = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,idempotency-key',
        },
        signal: AbortSignal.timeout(15_000),
      })
      const allowOrigin = response.headers.get('access-control-allow-origin')
      const methods = (response.headers.get('access-control-allow-methods') ?? '')
        .split(',').map(value => value.trim().toLowerCase())
      const headers = (response.headers.get('access-control-allow-headers') ?? '')
        .split(',').map(value => value.trim().toLowerCase())
      const valid = response.status === 204
        && allowOrigin === origin
        && methods.includes('post')
        && methods.includes('options')
        && headers.includes('content-type')
        && headers.includes('idempotency-key')
      if (!valid) {
        failures++
        console.error(`FAIL ${url} Origin: ${origin} — status ${response.status}, allow-origin ${allowOrigin}, methods ${methods}, headers ${headers}`)
      } else {
        console.log(`PASS ${url} Origin: ${origin}`)
      }
    } catch (error) {
      failures++
      console.error(`FAIL ${url} Origin: ${origin} — ${error}`)
    }
  }
}

if (failures) process.exitCode = 1
