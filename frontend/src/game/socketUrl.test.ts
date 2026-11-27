import { describe, expect, it } from 'vitest'
import { gameSocketUrl } from './socketUrl'

const httpsPage = { protocol: 'https:', host: 'game.example' }
const httpPage = { protocol: 'http:', host: 'localhost:5173' }

describe('gameSocketUrl', () => {
  it('returns the configured URL as it is', () => {
    expect(gameSocketUrl('wss://backend.example/api/ws', httpsPage)).toBe(
      'wss://backend.example/api/ws',
    )
  })

  it.each([undefined, ''])(
    'uses wss on the host of an https page when configured as %j',
    (configuredUrl) => {
      expect(gameSocketUrl(configuredUrl, httpsPage)).toBe(
        'wss://game.example/api/ws',
      )
    },
  )

  it('uses ws on the host of an http page', () => {
    expect(gameSocketUrl(undefined, httpPage)).toBe(
      'ws://localhost:5173/api/ws',
    )
  })
})
