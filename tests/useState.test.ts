import { vi } from 'vitest'
// Dispatcherを初期化するために hooks/useState.ts を先にインポートする必要がある
import '../src/hooks/useState'
import { createElement } from '../src/createElement'
import { createRoot } from '../src/workLoop'
import { useState, useRef } from '../src/hooksDispatcher'

function act(fn: () => void) {
  fn()
}

describe('useState + useRef (Chapter 7): Hooks実装', () => {
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

  test('useState: 初期値を持つカウンターを表示する', () => {
    let setCount: (n: number | ((n: number) => number)) => void

    function Counter() {
      const [count, sc] = useState(0)
      setCount = sc
      return createElement('div', null, String(count))
    }

    root.render(createElement(Counter as any, null))
    expect(container.textContent).toBe('0')

    act(() => setCount!(1))
    expect(container.textContent).toBe('1')
  })

  test('useState: updater関数（prevState => newState）が動作する', () => {
    let increment: () => void

    function Counter() {
      const [count, setCount] = useState(0)
      increment = () => setCount((c) => c + 1)
      return createElement('div', null, String(count))
    }

    root.render(createElement(Counter as any, null))
    expect(container.textContent).toBe('0')

    act(() => increment!())
    expect(container.textContent).toBe('1')

    act(() => increment!())
    expect(container.textContent).toBe('2')
  })

  test('useState: 複数のuseStateが独立して動作する', () => {
    let setName: (n: string) => void
    let setAge: (n: number) => void

    function Profile() {
      const [name, sn] = useState('Alice')
      const [age, sa] = useState(30)
      setName = sn
      setAge = sa
      return createElement('div', null, `${name}:${age}`)
    }

    root.render(createElement(Profile as any, null))
    expect(container.textContent).toBe('Alice:30')

    act(() => setName!('Bob'))
    expect(container.textContent).toBe('Bob:30')

    act(() => setAge!(31))
    expect(container.textContent).toBe('Bob:31')
  })

  test('useState: lazy initialization（関数で初期値を渡す）', () => {
    const initializer = vi.fn(() => 42)
    let setCount: (n: number) => void

    function Counter() {
      const [count, sc] = useState(initializer)
      setCount = sc
      return createElement('div', null, String(count))
    }

    root.render(createElement(Counter as any, null))
    expect(container.textContent).toBe('42')
    expect(initializer).toHaveBeenCalledTimes(1)

    // 更新時はinitializerを呼ばない
    act(() => setCount!(100))
    expect(initializer).toHaveBeenCalledTimes(1)
  })

  test('useRef: 参照が再レンダリング後も同じオブジェクトを返す', () => {
    const refs: { current: number }[] = []
    let increment: () => void

    function Counter() {
      const [count, setCount] = useState(0)
      const ref = useRef(count)
      refs.push(ref)
      increment = () => setCount((c) => c + 1)
      return createElement('div', null, String(count))
    }

    root.render(createElement(Counter as any, null))
    act(() => increment!())
    act(() => increment!())

    // 同じオブジェクト参照
    expect(refs[0]).toBe(refs[1])
    expect(refs[1]).toBe(refs[2])
  })

  test('useRef: current を変更しても再レンダリングされない', () => {
    let renderCount = 0
    let ref: { current: number }

    function Component() {
      renderCount++
      ref = useRef(0)
      return createElement('div', null, String(renderCount))
    }

    root.render(createElement(Component as any, null))
    expect(renderCount).toBe(1)

    // ref.current を変えても再レンダリングは起きない
    ref!.current = 999
    expect(renderCount).toBe(1)
  })

  test('前回より少ないHook呼び出しでエラーが投げられる', () => {
    let show = true
    let forceUpdate: (v: number) => void

    function BadComponent() {
      const [, fu] = useState(0)
      forceUpdate = fu
      if (show) {
        useState(0)
      }
      return createElement('div', null, 'test')
    }

    root.render(createElement(BadComponent as any, null))

    // 2回目のレンダリングでHook数が減る
    show = false
    expect(() => forceUpdate!(1)).toThrow('Rendered fewer hooks than expected')
  })

  test('クリックで状態が更新される（DOMイベント統合テスト）', () => {
    function Counter() {
      const [count, setCount] = useState(0)
      return createElement('div', null,
        createElement('span', { id: 'count' }, String(count)),
        createElement('button', { id: 'btn', onClick: () => setCount((c) => c + 1) }, '+')
      )
    }

    root.render(createElement(Counter as any, null))
    expect(container.querySelector('#count')?.textContent).toBe('0')

    container.querySelector('#btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(container.querySelector('#count')?.textContent).toBe('1')

    container.querySelector('#btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(container.querySelector('#count')?.textContent).toBe('2')
  })
})
