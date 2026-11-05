export type Limit = { percent: number; resetsAt: number | null }

export type Figures = {
  now: number
  fiveHour: Limit | null
  sevenDay: Limit | null
  contextPercent: number | null
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { figures: Shaped<Figures | null> }
  }
}
