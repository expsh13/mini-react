import { createElement, Fragment } from '../src/createElement'

describe('createElement (Chapter 2)', () => {
  test('基本的なDOM要素のVNodeを生成する', () => {
    const vnode = createElement('div', { className: 'foo' }, 'Hello')
    expect(vnode.type).toBe('div')
    expect(vnode.key).toBeNull()
    expect(vnode.props.className).toBe('foo')
    expect(vnode.props.children).toEqual(['Hello'])
  })

  test('propsがnullでも動作する', () => {
    const vnode = createElement('span', null)
    expect(vnode.type).toBe('span')
    expect(vnode.props.children).toEqual([])
  })

  test('複数の子要素を受け取る', () => {
    const child1 = createElement('span', null, 'A')
    const child2 = createElement('span', null, 'B')
    const vnode = createElement('div', null, child1, child2)
    expect(vnode.props.children).toHaveLength(2)
    expect(vnode.props.children[0]).toEqual(child1)
    expect(vnode.props.children[1]).toEqual(child2)
  })

  test('keyはVNodeの専用フィールドに移動する', () => {
    const vnode = createElement('li', { key: 'item-1', className: 'list' })
    expect(vnode.key).toBe('item-1')
    expect((vnode.props as any).key).toBeUndefined()
    expect(vnode.props.className).toBe('list')
  })

  test('数値のkeyは文字列に変換される', () => {
    const vnode = createElement('li', { key: 42 })
    expect(vnode.key).toBe('42')
  })

  test('null/undefined/boolean の子要素は除外される（条件付きレンダリング）', () => {
    const vnode = createElement('div', null, null, undefined, false, true, 'visible')
    expect(vnode.props.children).toEqual(['visible'])
  })

  test('関数コンポーネントを受け取る', () => {
    const MyComponent = () => createElement('div', null)
    const vnode = createElement(MyComponent, { name: 'test' })
    expect(vnode.type).toBe(MyComponent)
    expect(vnode.props.name).toBe('test')
  })

  test('Fragment シンボルを受け取る', () => {
    const vnode = createElement(Fragment, null, 'A', 'B')
    expect(vnode.type).toBe(Fragment)
    expect(vnode.props.children).toEqual(['A', 'B'])
  })

  test('ネストした子要素（配列の平坦化）', () => {
    // map() は配列を返すため flat() が必要
    const items = ['A', 'B', 'C'].map((text) => createElement('li', { key: text }, text))
    const vnode = createElement('ul', null, ...items)
    expect(vnode.props.children).toHaveLength(3)
  })
})
