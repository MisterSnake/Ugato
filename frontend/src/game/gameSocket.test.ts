import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeWebSocket } from '../test/FakeWebSocket'
import { createGameSocket } from './gameSocket'
import type { CreateGameRequest, GameSummary } from './types'

const request: CreateGameRequest = {
  username: 'Esteban',
  color: 'red',
  gameName: 'Partida 1',
  maxPlayers: 2,
  boardWidth: 12,
  boardHeight: 10,
}

const game: GameSummary = {
  name: 'Partida 1',
  maxPlayers: 2,
  boardWidth: 12,
  boardHeight: 10,
  players: [{ name: 'Esteban', color: 'red' }],
}

const SOCKET_URL = 'ws://test/api/ws'

function connect() {
  const client = createGameSocket(SOCKET_URL, FakeWebSocket)
  return { client, server: FakeWebSocket.latest }
}

describe('createGameSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })

  it('connects to the given URL', () => {
    expect(connect().server.url).toBe(SOCKET_URL)
  })

  it('sends create_game once the socket opens', () => {
    const { client, server } = connect()

    client.createGame(request)
    expect(server.sent).toEqual([])
    server.simulateOpen()

    expect(server.sent).toEqual([{ type: 'create_game', ...request }])
  })

  it('sends create_game immediately when the socket is already open', () => {
    const { client, server } = connect()
    server.simulateOpen()

    client.createGame(request)

    expect(server.sent).toEqual([{ type: 'create_game', ...request }])
  })

  it('passes game_created to its handlers', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('game_created', handler)

    server.simulateMessage({ type: 'game_created', game })

    expect(handler).toHaveBeenCalledExactlyOnceWith(game)
  })

  it('passes errors to their handlers', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('error', handler)

    server.simulateMessage({
      type: 'error',
      field: 'gameName',
      code: 'name_taken',
    })

    expect(handler).toHaveBeenCalledExactlyOnceWith({
      field: 'gameName',
      code: 'name_taken',
    })
  })

  it('sends cancel_game and reports the close as intentional', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('close', handler)
    server.simulateOpen()

    client.cancel()

    expect(server.sent).toEqual([{ type: 'cancel_game' }])
    expect(server.closed).toBe(true)
    expect(handler).toHaveBeenCalledExactlyOnceWith({ intentional: true })
  })

  it('reports close() as intentional', () => {
    const { client } = connect()
    const handler = vi.fn()
    client.on('close', handler)

    client.close()

    expect(handler).toHaveBeenCalledExactlyOnceWith({ intentional: true })
  })

  it('reports a server-side close as unintentional', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('close', handler)
    server.simulateOpen()

    server.simulateServerClose()

    expect(handler).toHaveBeenCalledExactlyOnceWith({ intentional: false })
  })
})
