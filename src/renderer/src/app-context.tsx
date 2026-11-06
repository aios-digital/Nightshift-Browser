import { createContext, useContext } from 'react'
import type { NsApi } from '../../preload/api'
import type { LayoutSync } from './bridge/layout-sync'
import type { RootStoreInstance } from './store/root-store'

export type AppContextValue = { store: RootStoreInstance; api: NsApi; layoutSync: LayoutSync }

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('AppContext is missing')
  return value
}
