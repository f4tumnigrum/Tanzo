import { createContext, useContext } from 'react'

export const RouteActivityContext = createContext(true)

export function useRouteActive(): boolean {
  return useContext(RouteActivityContext)
}
