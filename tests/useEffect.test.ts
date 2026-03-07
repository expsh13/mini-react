// Dispatcherを初期化するために hooks/useState.ts を先にインポートする必要がある
import '../src/hooks/useState'
import { createElement } from '../src/createElement'
import { createRoot } from '../src/workLoop'
import { useState, useEffect } from '../src/hooksDispatcher'

// MessageChannel を使った非同期のPassive Effectsをフラッシュするヘルパー
function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('useEffect (Chapter 8): 副作用フック', () => {
  let container: HTMLElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  test('マウント時にエフェクトが実行される', async () => {
    const effect = jest.fn()

    function Component() {
      useEffect(effect, [])
      return createElement('div', null)
    }

    root.render(createElement(Component as any, null))
    await flushEffects()

    expect(effect).toHaveBeenCalledTimes(1)
  })

  test('アンマウント時にクリーンアップが実行される', async () => {
    const cleanup = jest.fn()
    const effect = jest.fn(() => cleanup)
    let setVisible: (v: boolean) => void

    function Wrapper() {
      const [visible, sv] = useState(true)
      setVisible = sv
      return visible ? createElement(Child as any, null) : null
    }

    function Child() {
      useEffect(effect, [])
      return createElement('div', null, 'child')
    }

    root.render(createElement(Wrapper as any, null))
    await flushEffects()
    expect(effect).toHaveBeenCalledTimes(1)
    expect(cleanup).not.toHaveBeenCalled()

    setVisible!(false)
    await flushEffects()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  test('depsが変化した場合のみ再実行される', async () => {
    const effect = jest.fn()
    let setDep: (n: number) => void

    function Component() {
      const [dep, sd] = useState(0)
      setDep = sd
      useEffect(effect, [dep])
      return createElement('div', null, String(dep))
    }

    root.render(createElement(Component as any, null))
    await flushEffects()
    expect(effect).toHaveBeenCalledTimes(1)

    // deps変化 → 再実行
    setDep!(1)
    await flushEffects()
    expect(effect).toHaveBeenCalledTimes(2)

    // deps変化なし → 再実行しない
    setDep!(1)
    await flushEffects()
    expect(effect).toHaveBeenCalledTimes(2)
  })

  test('依存配列なし: 毎回のレンダリングで実行される', async () => {
    const effect = jest.fn()
    let setCount: (n: number | ((n: number) => number)) => void

    function Component() {
      const [count, sc] = useState(0)
      setCount = sc
      useEffect(effect)  // deps なし
      return createElement('div', null, String(count))
    }

    root.render(createElement(Component as any, null))
    await flushEffects()
    expect(effect).toHaveBeenCalledTimes(1)

    setCount!((c) => c + 1)
    await flushEffects()
    expect(effect).toHaveBeenCalledTimes(2)
  })

  test('クリーンアップは次のエフェクト実行前に呼ばれる', async () => {
    const callOrder: string[] = []
    let setCount: (n: number | ((n: number) => number)) => void

    function Component() {
      const [count, sc] = useState(0)
      setCount = sc
      useEffect(() => {
        callOrder.push(`effect:${count}`)
        return () => callOrder.push(`cleanup:${count}`)
      }, [count])
      return createElement('div', null, String(count))
    }

    root.render(createElement(Component as any, null))
    await flushEffects()
    expect(callOrder).toEqual(['effect:0'])

    setCount!((c) => c + 1)
    await flushEffects()
    expect(callOrder).toEqual(['effect:0', 'cleanup:0', 'effect:1'])
  })

  test('Object.is: NaN の deps 変化を正しく検出する', async () => {
    const effect = jest.fn()
    let setVal: (v: number) => void

    function Component() {
      const [val, sv] = useState(NaN)
      setVal = sv
      useEffect(effect, [val])
      return createElement('div', null)
    }

    root.render(createElement(Component as any, null))
    await flushEffects()
    expect(effect).toHaveBeenCalledTimes(1)

    // NaN → NaN: Object.is(NaN, NaN) = true → 変化なし → 実行しない
    setVal!(NaN)
    await flushEffects()
    expect(effect).toHaveBeenCalledTimes(1)
  })

  test('複数のuseEffectが独立して動作する', async () => {
    const effect1 = jest.fn()
    const effect2 = jest.fn()

    function Component() {
      useEffect(effect1, [])
      useEffect(effect2, [])
      return createElement('div', null)
    }

    root.render(createElement(Component as any, null))
    await flushEffects()

    expect(effect1).toHaveBeenCalledTimes(1)
    expect(effect2).toHaveBeenCalledTimes(1)
  })
})
