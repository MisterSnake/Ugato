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

  it('sends subscribe_lobby once the socket opens', () => {
    const { client, server } = connect()

    client.subscribeLobby()
    expect(server.sent).toEqual([])
    server.simulateOpen()

    expect(server.sent).toEqual([{ type: 'subscribe_lobby' }])
  })

  it('sends subscribe_lobby immediately when the socket is already open', () => {
    const { client, server } = connect()
    server.simulateOpen()

    client.subscribeLobby()

    expect(server.sent).toEqual([{ type: 'subscribe_lobby' }])
  })

  it('passes game_created to its handlers', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('game_created', handler)

    server.simulateMessage({ type: 'game_created', game })

    expect(handler).toHaveBeenCalledExactlyOnceWith(game)
  })

  it('passes games_list to its handlers', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('games_list', handler)

    server.simulateMessage({ type: 'games_list', games: [game] })

    expect(handler).toHaveBeenCalledExactlyOnceWith([game])
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

  it('sends cancel_game and keeps the socket open', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('close', handler)
    server.simulateOpen()

    client.cancel()

    expect(server.sent).toEqual([{ type: 'cancel_game' }])
    expect(server.closed).toBe(false)
    expect(handler).not.toHaveBeenCalled()
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

describe('createGameSocket joining and leaving', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })

  const joinRequest = {
    gameName: 'Partida 1',
    username: 'Ana',
    color: 'blue',
  } as const

  it('sends join_game once the socket opens', () => {
    const { client, server } = connect()

    client.joinGame(joinRequest)
    expect(server.sent).toEqual([])
    server.simulateOpen()

    expect(server.sent).toEqual([{ type: 'join_game', ...joinRequest }])
  })

  it('sends leave_game and keeps the socket open', () => {
    const { client, server } = connect()
    server.simulateOpen()

    client.leave()

    expect(server.sent).toEqual([{ type: 'leave_game' }])
    expect(server.closed).toBe(false)
  })

  it.each(['game_joined', 'game_updated'] as const)(
    'passes %s to its handlers',
    (event) => {
      const { client, server } = connect()
      const handler = vi.fn()
      client.on(event, handler)

      server.simulateMessage({ type: event, game })

      expect(handler).toHaveBeenCalledExactlyOnceWith(game)
    },
  )

  it('passes game_closed to its handlers', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('game_closed', handler)

    server.simulateMessage({ type: 'game_closed' })

    expect(handler).toHaveBeenCalledOnce()
  })

  it('passes a join error to the error handlers', () => {
    const { client, server } = connect()
    const handler = vi.fn()
    client.on('error', handler)

    server.simulateMessage({
      type: 'error',
      field: 'gameName',
      code: 'game_full',
    })

    expect(handler).toHaveBeenCalledExactlyOnceWith({
      field: 'gameName',
      code: 'game_full',
    })
  })
})
