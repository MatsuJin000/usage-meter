import { expect, mock, test } from 'claude-code/testing'
import type { SessionMeasureInput } from 'claude-code'

const NOW = Date.parse('2026-11-05T00:00:00Z')
const BAND = (surface: 'terminal' | 'desktop', hasSurvey = false) =>
  ({
    plugin: 'usage-meter',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as const

const MEASURED: SessionMeasureInput = {
  context: { window: 200_000, tokens: 90_000, percent: 45 },
  rateLimits: [
    {
      kind: 'five_hour',
      percentUsed: 72.5,
      resetsAt: '2026-11-05T02:10:00Z',
    },
    {
      kind: 'seven_day',
      percentUsed: 12,
      resetsAt: '2026-11-08T04:00:00Z',
    },
  ],
  cost: { usd: 1.234 },
  changed: ['context', 'rateLimits', 'cost'],
}

test('every meter shows its figure, on both surfaces', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure(MEASURED)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(BAND(surface))

    for (const words of [/73%/, /あと2h10m/, /12%/, /あと3d4h/, /45%/, /\$1\.23/]) {
      expect((await ui.find({ type: 'Text', text: words }))?.text).toMatch(words)
    }

    await ui.unmount()
  }
})

test('a window past its reset reads as started over', async ($, on) => {
  on('clock.now', () => ({ value: Date.parse('2026-11-05T03:00:00Z') }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure(MEASURED)

  const ui = await $.ui.mount(BAND('terminal'))

  expect(await ui.find({ type: 'Text', text: /73%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^0%$/ })).toBeDefined()
  await ui.unmount()
})

test('with no reading yet the band still stands, with dashes', async $ => {
  const ui = await $.ui.mount(BAND('desktop'))

  expect((await ui.find({ type: 'Text', text: /5時間/ }))?.text).toBe('5時間')
  expect((await ui.find({ type: 'Text', text: /—/ }))?.text).toBe('—')
  await ui.unmount()
})

test('a survey holding the band keeps the meters out of its way', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount(BAND('terminal', true))

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('each window draws as a ring on the desktop, a glyph in the terminal', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure(MEASURED)

  const desktop = await $.ui.mount(BAND('desktop'))
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  await desktop.unmount()

  const terminal = await $.ui.mount(BAND('terminal'))
  expect((await terminal.find({ type: 'Text', text: /◕/ }))?.text).toBe('◕')
  await terminal.unmount()
})

const atPercent = (percentUsed: number): SessionMeasureInput => ({
  context: { window: 200_000 },
  rateLimits: [{ kind: 'five_hour', percentUsed }],
  changed: ['rateLimits'],
})

const USAGE = { startedAt: NOW, context: { window: 200_000, percent: 45 }, rateLimits: [] }

test('a first read that fails still starts the timer, and the log says so', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const logs: string[] = []
  let reads = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('session.usage', () => {
    reads += 1

    if (reads === 1) {
      throw new Error('no reading')
    }

    return { value: USAGE }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(logs.join()).toContain('reading usage failed')

  await clock.advance(60_000)
  expect(reads).toBe(2)

  const ui = await $.ui.mount(BAND('terminal'))
  expect((await ui.find({ type: 'Text', text: /45%/ }))?.text).toBe('45%')
  await ui.unmount()
})

test('a failed tick is logged and the next one recovers', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const logs: string[] = []
  let reads = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('session.usage', () => {
    reads += 1

    if (reads === 2) {
      throw new Error('no reading')
    }

    return { value: USAGE }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(60_000)
  expect(logs.length).toBe(1)

  await clock.advance(60_000)
  expect(reads).toBe(3)
  expect(logs.length).toBe(1)
})

test('color follows the percent as printed', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  const cases = [
    [69.4, '69%', 'success', '#2f9e5f'],
    [69.6, '70%', 'warning', '#b7791f'],
    [89.4, '89%', 'warning', '#b7791f'],
    [89.6, '90%', 'error', '#d9483f'],
  ] as const

  for (const [percent, printed, color, hex] of cases) {
    await $.session.measure(atPercent(percent))

    const terminal = await $.ui.mount(BAND('terminal'))
    const text = await terminal.find({ type: 'Text', text: new RegExp(`^${printed}$`) })
    expect(text?.props.color).toBe(color)
    await terminal.unmount()

    const desktop = await $.ui.mount(BAND('desktop'))
    const ring = await desktop.find({ type: 'Svg' })
    expect(String(ring?.props.source)).toContain(hex)
    await desktop.unmount()
  }
})

test('only 0% reads as empty and only 100% as full', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  const cases = [
    [0, '○'],
    [1, '◔'],
    [12, '◔'],
    [50, '◑'],
    [88, '◕'],
    [99, '◕'],
    [100, '●'],
    [123, '●'],
  ] as const

  for (const [percent, glyph] of cases) {
    await $.session.measure(atPercent(percent))

    const ui = await $.ui.mount(BAND('terminal'))
    expect((await ui.find({ type: 'Text', text: /^[○◔◑◕●]$/ }))?.text).toBe(glyph)
    await ui.unmount()
  }
})
