async (page) => {
  const [origin, observer] = page.context().pages()
  const originCdp = await origin.context().newCDPSession(origin)
  const observerCdp = await observer.context().newCDPSession(observer)
  await Promise.all([originCdp.send('Network.enable'), observerCdp.send('Network.enable')])
  let current = null
  const parse = event => { try { return JSON.parse(event.response.payloadData) } catch { return null } }
  originCdp.on('Network.webSocketFrameSent', event => {
    const message = parse(event)
    if (message?.type === 'dice.roll' && current) { current.requestId = message.requestId; current.sentAt = Date.now() }
  })
  originCdp.on('Network.webSocketFrameReceived', event => {
    const message = parse(event)
    if (message?.type === 'dice.rolled' && current) { current.originRollId = message.payload.roll.id; current.originReceivedAt = Date.now() }
  })
  observerCdp.on('Network.webSocketFrameReceived', event => {
    const message = parse(event)
    if (message?.type === 'dice.rolled' && current) { current.observerRollId = message.payload.roll.id; current.observerReceivedAt = Date.now() }
  })
  const selector = '[role="dialog"] article'
  const rows = []
  for (let i = 0; i < 10; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, 2600))
    const beforeOrigin = await origin.locator(selector).first().evaluate(element => element.textContent)
    const beforeObserver = await observer.locator(selector).first().evaluate(element => element.textContent)
    const originReady = origin.waitForFunction(({ selector, before }) => document.querySelector(selector)?.textContent !== before, { selector, before: beforeOrigin })
    const observerReady = observer.waitForFunction(({ selector, before }) => document.querySelector(selector)?.textContent !== before, { selector, before: beforeObserver })
    current = {}
    const started = Date.now()
    const originDom = originReady.then(() => Date.now())
    const observerDom = observerReady.then(() => Date.now())
    await origin.getByRole('button', { name: '掷出骰子' }).click()
    const [originDomAt, observerDomAt] = await Promise.all([originDom, observerDom])
    const row = {
      requestId: current.requestId,
      sendMs: current.sentAt - started,
      originReceiveMs: current.originReceivedAt - started,
      observerReceiveMs: current.observerReceivedAt - started,
      originDomMs: originDomAt - started,
      observerDomMs: observerDomAt - started,
      sameRoll: current.originRollId === current.observerRollId,
    }
    if (!row.requestId || !Number.isFinite(row.originReceiveMs) || !Number.isFinite(row.observerReceiveMs)) throw new Error('missing WebSocket timing')
    rows.push(row)
    current = null
  }
  await Promise.all([originCdp.detach(), observerCdp.detach()])
  return rows
}
