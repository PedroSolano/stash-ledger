import type { StashLedgerApi } from '../../shared/types'

declare global {
  interface Window {
    api: StashLedgerApi
  }
}

export {}
