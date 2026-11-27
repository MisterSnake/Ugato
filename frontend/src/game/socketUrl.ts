/**
 * The WebSocket URL of the game. Without a configured one, it is on the page's
 * own host: in development, Vite proxies /api to the backend.
 */
export function gameSocketUrl(
  configuredUrl: string | undefined,
  location: Pick<Location, 'protocol' | 'host'>,
): string {
  if (configuredUrl) return configuredUrl
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${location.host}/api/ws`
}
