import { vi } from 'vitest'
// Dispatcherを初期化するために hooks/useState.ts を先にインポートする必要がある
import '../src/hooks/useState'
import { createElement, Fragment } from '../src/createElement'
import { createRoot } from '../src/workLoop'
import { useState, useEffect } from '../src/hooksDispatcher'

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('commit (Chapter 6): コミットフェーズ', () => {
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

  test('DOM要素の挿入（Placement）', () => {
    root.render(createElement('h1', null, 'Hello'))
    expect(container.querySelector('h1')?.textContent).toBe('Hello')
  })

  test('テキストノードの更新', () => {
    root.render(createElement('p', null, 'First'))
    expect(container.querySelector('p')?.textContent).toBe('First')

    root.render(createElement('p', null, 'Second'))
    expect(container.querySelector('p')?.textContent).toBe('Second')
  })

  test('DOM属性の更新（Update）', () => {
    root.render(createElement('div', { id: 'a', className: 'old' }))
    expect(container.querySelector('#a')?.getAttribute('class')).toBe('old')

    root.render(createElement('div', { id: 'a', className: 'new' }))
    expect(container.querySelector('#a')?.getAttribute('class')).toBe('new')
  })

  test('DOM要素の削除（Deletion）', () => {
    root.render(
      createElement('ul', null,
        createElement('li', { key: 'a' }, 'A'),
        createElement('li', { key: 'b' }, 'B')
      )
    )
    expect(container.querySelectorAll('li')).toHaveLength(2)

    root.render(
      createElement('ul', null,
        createElement('li', { key: 'a' }, 'A')
      )
    )
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.querySelector('li')?.textContent).toBe('A')
  })

  test('イベントハンドラを更新できる', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    root.render(createElement('button', { onClick: handler1 }, 'Click'))
    container.querySelector('button')!.click()
    expect(handler1).toHaveBeenCalledTimes(1)

    root.render(createElement('button', { onClick: handler2 }, 'Click'))
    container.querySelector('button')!.click()
    expect(handler1).toHaveBeenCalledTimes(1)  // 古いハンドラは呼ばれない
    expect(handler2).toHaveBeenCalledTimes(1)  // 新しいハンドラが呼ばれる
  })

  test('Fragment内の要素を正しく配置する', () => {
    root.render(
      createElement('div', null,
        createElement(Fragment, null,
          createElement('span', null, 'A'),
          createElement('span', null, 'B')
        )
      )
    )
    const spans = container.querySelectorAll('span')
    expect(spans).toHaveLength(2)
    expect(spans[0].textContent).toBe('A')
    expect(spans[1].textContent).toBe('B')
  })

  test('要素を別のタイプに置き換える', () => {
    root.render(createElement('div', null, 'Content'))
    expect(container.querySelector('div')).toBeTruthy()
    expect(container.querySelector('span')).toBeNull()

    root.render(createElement('span', null, 'Content'))
    expect(container.querySelector('div')).toBeNull()
    expect(container.querySelector('span')).toBeTruthy()
  })

  test('commitDeletionで兄弟ノードのエフェクトがクリーンアップされない', async () => {
    const cleanupA = vi.fn()
    const cleanupB = vi.fn()
    let setVisible: (v: boolean) => void

    function Parent() {
      const [visible, sv] = useState(true)
      setVisible = sv
      return createElement('div', null,
        visible ? createElement(ChildA as any, { key: 'a' }) : null,
        createElement(ChildB as any, { key: 'b' })
      )
    }

    function ChildA() {
      useEffect(() => cleanupA, [])
      return createElement('span', null, 'A')
    }

    function ChildB() {
      useEffect(() => cleanupB, [])
      return createElement('span', null, 'B')
    }

    root.render(createElement(Parent as any, null))
    await flushEffects()

    // ChildAを削除
    setVisible!(false)
    await flushEffects()

    // ChildAのクリーンアップは実行される
    expect(cleanupA).toHaveBeenCalledTimes(1)
    // ChildBのクリーンアップは実行されない（兄弟なので削除対象外）
    expect(cleanupB).not.toHaveBeenCalled()
  })

  test('FunctionComponent兄弟のgetHostSibling', () => {
    function FC() {
      return createElement('span', null, 'fc')
    }

    root.render(
      createElement('div', null,
        createElement(FC as any, null),
        createElement('p', null, 'sibling')
      )
    )

    const div = container.querySelector('div')!
    expect(div.children[0].tagName).toBe('SPAN')
    expect(div.children[1].tagName).toBe('P')
  })

  test('ネストしたFunctionComponentのgetHostSibling', () => {
    function Inner() {
      return createElement('em', null, 'inner')
    }

    function Outer() {
      return createElement(Inner as any, null)
    }

    root.render(
      createElement('div', null,
        createElement(Outer as any, null),
        createElement('b', null, 'bold')
      )
    )

    const div = container.querySelector('div')!
    expect(div.children[0].tagName).toBe('EM')
    expect(div.children[1].tagName).toBe('B')
  })
})
