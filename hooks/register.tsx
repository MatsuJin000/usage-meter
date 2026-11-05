import { atom, read, update } from 'claude-code'
import type { Register, SessionMeasureInput } from 'claude-code'

import type { Figures, Limit } from '../types'

// Change the tag when Figures' fields change: it declines what an earlier
// version stored, which outlives a reload.
const figures = atom({ plugin: 'usage-meter', key: 'figures' } as const, null, {
  shape: 'figures-1',
})

const TICK_MS = 60_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type Measured = Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>

function limitOf(measured: Measured, kind: string): Limit | null {
  const found = measured.rateLimits.find(one => one.kind === kind)

  if (!found) {
    return null
  }

  const resetsAt = found.resetsAt ? Date.parse(found.resetsAt) : NaN

  return {
    percent: found.percentUsed,
    resetsAt: Number.isNaN(resetsAt) ? null : resetsAt,
  }
}

function figuresOf(measured: Measured, now: number): Figures {
  return {
    now,
    fiveHour: limitOf(measured, 'five_hour'),
    sevenDay: limitOf(measured, 'seven_day'),
    contextPercent: measured.context.percent ?? null,
    costUsd: measured.cost?.usd ?? null,
  }
}

function colorOf(percent: number) {
  if (percent >= 90) {
    return 'error'
  }

  return percent >= 70 ? 'warning' : 'success'
}

function hexOf(percent: number) {
  if (percent >= 90) {
    return '#e5534b'
  }

  return percent >= 70 ? '#d9a03f' : '#3fa46a'
}

// r is 100 / 2π, so the ring's length is 100 and a dash of n fills n percent.
// The colors are written out: an Svg draws as an image, out of the theme's reach.
function donutOf(percent: number) {
  const filled = Math.min(100, Math.max(0, percent))
  const ring = 'cx="18" cy="18" r="15.915" fill="none" stroke-width="6"'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">` +
    `<circle ${ring} stroke="#8888884d"/>` +
    `<circle ${ring} stroke="${hexOf(percent)}" stroke-dasharray="${filled} 100" ` +
    `transform="rotate(-90 18 18)"/></svg>`
  )
}

// The terminal has no Svg: the nearest quarter, as a glyph.
function glyphOf(percent: number) {
  const quarters = Math.round(Math.min(100, Math.max(0, percent)) / 25)

  return ['○', '◔', '◑', '◕', '●'][quarters] ?? '○'
}

function untilOf(ms: number) {
  if (ms >= DAY) {
    return `${Math.floor(ms / DAY)}d${Math.floor((ms % DAY) / HOUR)}h`
  }

  if (ms >= HOUR) {
    return `${Math.floor(ms / HOUR)}h${Math.floor((ms % HOUR) / MINUTE)}m`
  }

  return `${Math.max(1, Math.ceil(ms / MINUTE))}m`
}

export const register: Register = on => {
  let tick: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const refresh = async () => {
      const [usage, now] = await Promise.all([$.session.usage(), $.clock.now()])
      await update($, figures, () => figuresOf(usage, now))
    }

    await refresh()
    // The minute tick keeps the countdowns moving while the session sits idle.
    tick?.cancel()
    tick = $.clock.every(TICK_MS, () => void refresh().catch(() => {}))

    return started
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, figures, () => figuresOf(e, now))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const shown = await read($, figures)
    const isDesktop = e.surface === 'desktop'
    const direction = isDesktop ? 'column' : 'row'

    const pie = (label: string, percent: number) => {
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)

        return (
          <Svg
            source={donutOf(percent)}
            alt={`${label} ${Math.round(percent)}%`}
            width={30}
            height={30}
          />
        )
      }

      return <Text color={colorOf(percent)}>{glyphOf(percent)}</Text>
    }

    const meter = (label: string, percent: number | null, until: string | null) => (
      <Box flexShrink={0} columnGap={1} alignItems="center">
        {percent !== null && isDesktop && pie(label, percent)}
        <Box flexDirection={direction} columnGap={1}>
          <Text dimColor>{label}</Text>
          {percent === null ? (
            <Text dimColor>—</Text>
          ) : (
            <Box columnGap={1}>
              {!isDesktop && pie(label, percent)}
              <Text color={colorOf(percent)}>{Math.round(percent)}%</Text>
              {until !== null && <Text dimColor>あと{until}</Text>}
            </Box>
          )}
        </Box>
      </Box>
    )

    const limitMeter = (label: string, limit: Limit | null | undefined) => {
      if (!limit) {
        return meter(label, null, null)
      }

      const left = limit.resetsAt === null ? null : limit.resetsAt - (shown?.now ?? 0)

      // A window past its reset has started over; the reading is the old one's.
      return left !== null && left <= 0
        ? meter(label, 0, null)
        : meter(label, limit.percent, left === null ? null : untilOf(left))
    }

    return (
      <Box flexWrap="wrap" columnGap={2} alignItems="center">
        {limitMeter('5時間', shown?.fiveHour)}
        {limitMeter('週次', shown?.sevenDay)}
        {meter('コンテキスト', shown?.contextPercent ?? null, null)}
        <Box flexShrink={0} flexDirection={direction} columnGap={1}>
          <Text dimColor>費用</Text>
          {typeof shown?.costUsd === 'number' ? (
            <Text>${shown.costUsd.toFixed(2)}</Text>
          ) : (
            <Text dimColor>—</Text>
          )}
        </Box>
      </Box>
    )
  })
}
