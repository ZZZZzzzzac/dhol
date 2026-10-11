async (page) => {
  const site = 'https://dhol-room-v2-stage8-ui.pages.dev'
  const api = 'https://dhol-room-v2-stage8.gooole-dql.workers.dev'
  const browser = page.context().browser()
  if (!browser) throw new Error('Playwright browser is unavailable')
  const observerContext = await browser.newContext()
  const originContext = page.context()
  const origin = page
  const observer = await observerContext.newPage()
  const parse = event => { try { return JSON.parse(event.response.payloadData) } catch { return null } }
  const percentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
  }
  const summarize = values => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: Math.max(...values) })
  try {
    await origin.locator('.connection-badge[data-status="ready"]').waitFor()
    await observer.goto(site)
    const inviteText = await origin.getByRole('button', { name: /邀请码/ }).innerText()
    const inviteCode = inviteText.match(/[A-Z0-9]{6}/)?.[0]
    if (!inviteCode) throw new Error(`Missing invite code in ${inviteText}`)
    await observer.getByRole('textbox', { name: '你的称呼' }).fill('性能乙')
    await observer.getByRole('textbox', { name: '六位邀请码' }).fill(inviteCode)
    await observer.getByRole('button', { name: '加入房间' }).click()
    await Promise.all([
      origin.getByRole('heading', { name: /\d+ 在线/ }).waitFor(),
      observer.locator('.connection-badge[data-status="ready"]').waitFor(),
    ])

    const networkBaselineMs = await origin.evaluate(async endpoint => {
      const values = []
      for (let index = 0; index < 10; index++) {
        const started = Date.now()
        const response = await fetch(endpoint, { method: 'OPTIONS' })
        if (!response.ok) throw new Error(`baseline ${response.status}`)
        values.push(Date.now() - started)
      }
      return values
    }, `${api}/api/v2/rooms`)

    const originCdp = await originContext.newCDPSession(origin)
    const observerCdp = await observerContext.newCDPSession(observer)
    await Promise.all([originCdp.send('Network.enable'), observerCdp.send('Network.enable')])
    let current = null
    originCdp.on('Network.webSocketFrameSent', event => {
      const message = parse(event)
      if (message?.type === 'dice.roll' && current) {
        current.requestId = message.requestId
        current.sentAt = Date.now()
      }
    })
    originCdp.on('Network.webSocketFrameReceived', event => {
      const message = parse(event)
      if (message?.type === 'dice.rolled' && current && message.requestId === current.requestId) {
        current.originRollId = message.roll.id
        current.originReceivedAt = Date.now()
      }
    })
    observerCdp.on('Network.webSocketFrameReceived', event => {
      const message = parse(event)
      if (message?.type === 'dice.rolled' && current && message.requestId === current.requestId) {
        current.observerRollId = message.roll.id
        current.observerReceivedAt = Date.now()
      }
    })

    const rollOnce = async label => {
      await origin.locator('.dice-roll').waitFor({ state: 'visible' })
      await origin.locator('.dice-roll').evaluate(button => {
        if (button.disabled) throw new Error('roll button disabled before sample')
      })
      const started = Date.now()
      current = { label, started }
      const watchNextRender = target => target.evaluate(() => new Promise(resolve => {
        const history = document.querySelector('.dice-history')
        if (!history) throw new Error('dice history is unavailable')
        const observer = new MutationObserver(() => {
          observer.disconnect()
          resolve()
        })
        observer.observe(history, { childList: true, subtree: true, characterData: true })
      })).then(() => Date.now())
      const originDom = watchNextRender(origin)
      const observerDom = watchNextRender(observer)
      await origin.locator('.dice-roll').click()
      const [originDomAt, observerDomAt] = await Promise.all([originDom, observerDom])
      await origin.locator('.dice-roll').waitFor({ state: 'visible' })
      const deadline = Date.now() + 5000
      while ((!current.requestId || !current.originReceivedAt || !current.observerReceivedAt) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
      const row = {
        label,
        requestId: current.requestId,
        originReceiveMs: Math.round((current.originReceivedAt - started) * 10) / 10,
        observerReceiveMs: Math.round((current.observerReceivedAt - started) * 10) / 10,
        originDomMs: Math.round((originDomAt - started) * 10) / 10,
        observerDomMs: Math.round((observerDomAt - started) * 10) / 10,
        sameRoll: Boolean(current.originRollId) && current.originRollId === current.observerRollId,
      }
      current = null
      if (!row.requestId || !Object.values(row).filter(value => typeof value === 'number').every(Number.isFinite)) throw new Error(`Missing timing: ${JSON.stringify(row)}`)
      return row
    }

    await new Promise(resolve => setTimeout(resolve, 70_000))
    const cold = await rollOnce('idle-first')
    const rows = []
    for (let index = 0; index < 50; index++) rows.push(await rollOnce(`hot-${index + 1}`))
    const failures = rows.filter(row => !row.sameRoll).length
    const dualClientRows = rows.slice(0, 20)
    await Promise.all([originCdp.detach(), observerCdp.detach()])
    return {
      site,
      api,
      samples: rows.length,
      failures,
      cold,
      networkBaseline: summarize(networkBaselineMs),
      originReceive: summarize(rows.map(row => row.originReceiveMs)),
      observerReceive: summarize(rows.map(row => row.observerReceiveMs)),
      originDom: summarize(rows.map(row => row.originDomMs)),
      observerDom: summarize(rows.map(row => row.observerDomMs)),
      maxOriginObserverSkewMs: Math.max(...rows.map(row => Math.abs(row.originReceiveMs - row.observerReceiveMs))),
      dualClientGroups: {
        samples: dualClientRows.length,
        originReceive: summarize(dualClientRows.map(row => row.originReceiveMs)),
        observerReceive: summarize(dualClientRows.map(row => row.observerReceiveMs)),
        mismatches: dualClientRows.filter(row => !row.sameRoll).length,
      },
      rows,
    }
  } finally {
    await observerContext.close()
  }
}
