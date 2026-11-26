import type { SocketLike } from '../game/gameSocket'

type Listener = (event: { data: unknown }) => void

/** Test double for the browser WebSocket: records traffic, simulates the server. */
export class FakeWebSocket implements SocketLike {
  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly sent: unknown[] = []
  closed = false
  private readonly listeners: Record<string, Listener[]> = {}

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  static get latest(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1)
    if (!socket) throw new Error('No socket was created')
    return socket
  }

  addEventListener(type: string, listener: Listener): void {
    ;(this.listeners[type] ??= []).push(listener)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.emit('close')
  }

  simulateOpen(): void {
    this.emit('open')
  }

  simulateMessage(message: object): void {
    this.emit('message', JSON.stringify(message))
  }

  simulateServerClose(): void {
    this.close()
  }

  private emit(type: string, data?: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener({ data })
  }
}
