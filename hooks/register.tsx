import { atom, read, update } from 'claude-code'
import type { Register, SessionMeasureInput } from 'claude-code'

import type { Figures, Limit, SharedLimits } from '../types'

// Change the tag when Figures' fields change: it declines what an earlier
// version stored, which outlives a reload.
const figures = atom({ plugin: 'usage-meter', key: 'figures' } as const, null, {
  shape: 'figures-2',
})

const TICK_MS = 60_000
const LIMITS_KEY = 'limits'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// A reading younger than this is current enough to go unlabelled.
const STALE_MS = 5 * MINUTE

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

function isLimit(value: unknown): value is Limit | null {
  if (value === null) {
    return true
  }

  const limit = value as Limit | undefined

  return (
    typeof limit === 'object' &&
    typeof limit.percent === 'number' &&
    (limit.resetsAt === null || typeof limit.resetsAt === 'number')
  )
}

function isSharedLimits(value: unknown): value is SharedLimits {
  const shared = value as SharedLimits | null | undefined

  return (
    typeof shared === 'object' &&
    shared !== null &&
    typeof shared.at === 'number' &&
    isLimit(shared.fiveHour) &&
    isLimit(shared.sevenDay)
  )
}

function figuresOf(measured: Measured, now: number, shared: SharedLimits | null): Figures {
  return {
    now,
    limitsAt: shared?.at ?? null,
    fiveHour: shared ? shared.fiveHour : limitOf(measured, 'five_hour'),
    sevenDay: shared ? shared.sevenDay : limitOf(measured, 'seven_day'),
    contextPercent: measured.context.percent ?? null,
    costUsd: measured.cost?.usd ?? null,
  }
}

// Colors follow the whole percent the meter prints, so 69.6, shown as 70%, is
// already yellow.
function levelOf(percent: number) {
  const whole = Math.round(percent)

  if (whole >= 90) {
    return 'high'
  }

  return whole >= 70 ? 'mid' : 'low'
}

function colorOf(percent: number) {
  return { low: 'success', mid: 'warning', high: 'error' }[levelOf(percent)]
}

// Each of these holds at least 3:1 on white and on a dark background.
function hexOf(percent: number) {
  return { low: '#2f9e5f', mid: '#b7791f', high: '#d9483f' }[levelOf(percent)]
}

// r is 100 / 2π, so the ring's length is 100 and a dash of n fills n percent.
// The colors are written out: an Svg draws as an image, out of the theme's reach.
function donutOf(percent: number) {
  const filled = Math.min(100, Math.max(0, percent))
  const ring = 'cx="18" cy="18" r="15.915" fill="none" stroke-width="6"'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">` +
    `<circle ${ring} stroke="#88888899"/>` +
    `<circle ${ring} stroke="${hexOf(percent)}" stroke-dasharray="${filled} 100" ` +
    `transform="rotate(-90 18 18)"/></svg>`
  )
}

// The terminal has no Svg: the nearest quarter, as a glyph. Only 0% reads as
// empty and only 100% as full, so a window near either end doesn't look there.
function glyphOf(percent: number) {
  const whole = Math.round(percent)
  const quarters =
    whole <= 0 ? 0 : whole >= 100 ? 4 : Math.min(3, Math.max(1, Math.round(whole / 25)))

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
      const [usage, now, stored] = await Promise.all([
        $.session.usage(),
        $.clock.now(),
        $.store.get(LIMITS_KEY).catch(() => null),
      ])
      // Whichever session got a response last wrote the store, so it beats this
      // session's own reading, and a new session has a figure before its first.
      const shared = isSharedLimits(stored) ? stored : null
      await update($, figures, () => figuresOf(usage, now, shared))
    }

    const logFailure = (err: unknown) => {
      $.ui.log(`usage-meter: reading usage failed: ${err}`, { to: 'debug' })
    }

    // The minute tick keeps the countdowns moving while the session sits idle.
    // It starts before the first read, so a failed read doesn't leave it unset.
    tick?.cancel()
    tick = $.clock.every(TICK_MS, () => void refresh().catch(logFailure))
    await refresh().catch(logFailure)

    return started
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const own = figuresOf(e, now, null)

    if (own.fiveHour || own.sevenDay) {
      const shared: SharedLimits = { at: now, fiveHour: own.fiveHour, sevenDay: own.sevenDay }
      await update($, figures, () => ({ ...own, limitsAt: now }))
      await $.store.set(LIMITS_KEY, shared).catch((err: unknown) => {
        $.ui.log(`usage-meter: saving limits failed: ${err}`, { to: 'debug' })
      })
    } else {
      // Off a response with no windows, keep what the sessions last shared.
      const stored = await $.store.get(LIMITS_KEY).catch(() => null)
      const shared = isSharedLimits(stored) ? stored : null
      await update($, figures, () => figuresOf(e, now, shared))
    }

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

    const readingAge =
      shown && shown.limitsAt !== null && (shown.fiveHour || shown.sevenDay)
        ? shown.now - shown.limitsAt
        : 0

    return (
      <Box flexWrap="wrap" columnGap={2} alignItems="center">
        {limitMeter('5時間', shown?.fiveHour)}
        {limitMeter('週次', shown?.sevenDay)}
        {readingAge >= STALE_MS && <Text dimColor>({untilOf(readingAge)}前の値)</Text>}
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
