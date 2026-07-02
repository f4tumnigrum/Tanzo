import { createContext, useContext } from 'react'

/**
 * Marks whether the enclosing route is the one currently shown. Keep-alive
 * routes stay mounted while hidden; anything that projects UI outside its own
 * subtree (e.g. `AppHeaderContent` portaling into the shell header) must gate
 * on this so hidden routes never leak content into shared chrome.
 *
 * Defaults to `true` so routes that unmount when inactive need no wrapper.
 */
export const RouteActivityContext = createContext(true)

export function useRouteActive(): boolean {
  return useContext(RouteActivityContext)
}
