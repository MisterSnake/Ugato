import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { FakeResizeObserver } from './FakeResizeObserver'

globalThis.ResizeObserver = FakeResizeObserver

// Vitest globals are disabled, so Testing Library cannot register this itself.
afterEach(() => {
  cleanup()
  FakeResizeObserver.instances = []
})
