// requestIdleCallback mock for Jest (jsdom doesn't support it)
// In tests, this runs synchronously (unlike real browser behavior).
// We explain this difference in Chapter 5.
global.requestIdleCallback = (cb: IdleRequestCallback): number => {
  cb({ timeRemaining: () => 50, didTimeout: false } as IdleDeadline)
  return 0
}

global.cancelIdleCallback = (_handle: number): void => {}

// MessageChannel mock for Jest (jsdom doesn't support it)
// Approximates post-paint scheduling via setTimeout(0).
if (typeof MessageChannel === 'undefined') {
  class MockMessageChannel {
    port1: { onmessage: ((e: any) => void) | null } = { onmessage: null }
    port2 = {
      postMessage: (_msg: any) => {
        const self = this
        setTimeout(() => {
          if (self.port1.onmessage) {
            self.port1.onmessage({ data: _msg })
          }
        }, 0)
      },
    }
  }
  ;(global as any).MessageChannel = MockMessageChannel
}
