import { createElement, Fragment } from '../src/createElement'
import { createRoot } from '../src/workLoop'

// jest.setup.ts で requestIdleCallback がモックされているため
// workLoop はテストで同期的に実行される

describe('workLoop (Chapter 5): ワークループとReconciliation', () => {
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

  test('シンプルなDOM要素をレンダリングする', () => {
    root.render(createElement('div', { id: 'app' }, 'Hello'))
    expect(container.querySelector('#app')?.textContent).toBe('Hello')
  })

  test('ネストした要素をレンダリングする', () => {
    root.render(
      createElement('ul', null,
        createElement('li', null, 'Item 1'),
        createElement('li', null, 'Item 2'),
        createElement('li', null, 'Item 3')
      )
    )
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect(items[1].textContent).toBe('Item 2')
  })

  test('関数コンポーネントをレンダリングする', () => {
    function Greeting({ name }: { name: string }) {
      return createElement('h1', null, `Hello, ${name}!`)
    }
    root.render(createElement(Greeting as any, { name: 'World' }))
    expect(container.querySelector('h1')?.textContent).toBe('Hello, World!')
  })

  test('Fragment をレンダリングする', () => {
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
  })

  test('要素を更新する（DOM再利用）', () => {
    root.render(createElement('div', { id: 'app' }, 'First'))
    const firstDiv = container.querySelector('#app')

    root.render(createElement('div', { id: 'app' }, 'Second'))
    const secondDiv = container.querySelector('#app')

    // テキストが更新される
    expect(secondDiv?.textContent).toBe('Second')
  })

  test('子要素の追加', () => {
    root.render(
      createElement('ul', null,
        createElement('li', { key: 'a' }, 'A')
      )
    )
    expect(container.querySelectorAll('li')).toHaveLength(1)

    root.render(
      createElement('ul', null,
        createElement('li', { key: 'a' }, 'A'),
        createElement('li', { key: 'b' }, 'B')
      )
    )
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  test('子要素の削除', () => {
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
  })

  test('keyによる要素の並び替え', () => {
    root.render(
      createElement('ul', null,
        createElement('li', { key: 'a' }, 'A'),
        createElement('li', { key: 'b' }, 'B'),
        createElement('li', { key: 'c' }, 'C')
      )
    )

    root.render(
      createElement('ul', null,
        createElement('li', { key: 'c' }, 'C'),
        createElement('li', { key: 'a' }, 'A'),
        createElement('li', { key: 'b' }, 'B')
      )
    )

    const items = container.querySelectorAll('li')
    expect(items[0].textContent).toBe('C')
    expect(items[1].textContent).toBe('A')
    expect(items[2].textContent).toBe('B')
  })

  test('className が正しく設定される', () => {
    root.render(createElement('div', { className: 'container active' }))
    expect(container.firstElementChild?.getAttribute('class')).toBe('container active')
  })
})
