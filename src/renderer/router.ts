import { createRouter, createHashHistory } from '@tanstack/react-router'
import { routeTree } from './routes/__root'

const hashHistory = createHashHistory()

export const router = createRouter({
  routeTree,
  history: hashHistory
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
