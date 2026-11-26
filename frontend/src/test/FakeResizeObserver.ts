/** Test double for ResizeObserver, which jsdom does not have. */
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  private readonly callback: ResizeObserverCallback
  private readonly targets = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  /** Report a new size to everything being observed. */
  static resize(width: number, height: number): void {
    for (const observer of FakeResizeObserver.instances) {
      const entries = [...observer.targets].map(
        (target) =>
          ({ target, contentRect: { width, height } }) as ResizeObserverEntry,
      )
      if (entries.length > 0) {
        observer.callback(entries, observer as unknown as ResizeObserver)
      }
    }
  }

  observe(target: Element): void {
    this.targets.add(target)
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
  }
}
