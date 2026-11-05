export type Limit = { percent: number; resetsAt: number | null }

// The account's windows as the last session to get a response read them, kept in
// $.store so every session of the account can show them.
export type SharedLimits = {
  at: number
  fiveHour: Limit | null
  sevenDay: Limit | null
}

export type Figures = {
  now: number
  limitsAt: number | null
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
