import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

// jsdom 未实现的浏览器接口
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
// 正式 Card 组件在按下时调用 setPointerCapture
if (!Element.prototype.setPointerCapture) {
  const captured = new WeakSet<Element>()
  Element.prototype.setPointerCapture = function () {
    captured.add(this)
  }
  Element.prototype.releasePointerCapture = function () {
    captured.delete(this)
  }
  Element.prototype.hasPointerCapture = function () {
    return captured.has(this)
  }
}
