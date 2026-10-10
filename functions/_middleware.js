const previewPath = /^\/preview\/?$/

function unauthorized() {
  return new Response('Private preview', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Room V2 preview", charset="UTF-8"',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  })
}

function validPassword(authorization, password) {
  if (!authorization?.startsWith('Basic ') || !password) return false
  try {
    const decoded = atob(authorization.slice(6))
    return decoded === `tester:${password}`
  } catch {
    return false
  }
}

export function onRequest(context) {
  const pathname = new URL(context.request.url).pathname
  if (!previewPath.test(pathname)) return context.next()
  if (!context.env.PREVIEW_PASSWORD) return new Response('Preview unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  if (!validPassword(context.request.headers.get('Authorization'), context.env.PREVIEW_PASSWORD)) return unauthorized()
  return context.next()
}
