import { createElement, Fragment } from '../src/createElement'
import { render } from '../src/render'

describe('render (Chapter 3): 再帰レンダラ', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  test('テキストノードをレンダリングする', () => {
    render(createElement('p', null, 'Hello, World!'), container)
    expect(container.innerHTML).toBe('<p>Hello, World!</p>')
  })

  test('ネストした要素をレンダリングする', () => {
    render(
      createElement('div', { id: 'root' },
        createElement('h1', null, 'Title'),
        createElement('p', null, 'Content')
      ),
      container
    )
    expect(container.querySelector('h1')?.textContent).toBe('Title')
    expect(container.querySelector('p')?.textContent).toBe('Content')
  })

  test('className が class 属性として設定される', () => {
    render(createElement('div', { className: 'foo bar' }), container)
    expect(container.firstElementChild?.getAttribute('class')).toBe('foo bar')
  })

  test('クリックイベントハンドラが動作する', () => {
    const onClick = jest.fn()
    render(createElement('button', { onClick }, 'Click me'), container)
    const button = container.querySelector('button')!
    button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('Fragment をレンダリングする（DOM要素なし）', () => {
    render(
      createElement('div', null,
        createElement(Fragment, null,
          createElement('span', null, 'A'),
          createElement('span', null, 'B')
        )
      ),
      container
    )
    const spans = container.querySelectorAll('span')
    expect(spans).toHaveLength(2)
    expect(spans[0].textContent).toBe('A')
    expect(spans[1].textContent).toBe('B')
  })

  test('関数コンポーネントをレンダリングする', () => {
    function Greeting({ name }: { name: string }) {
      return createElement('p', null, `Hello, ${name}!`)
    }
    render(createElement(Greeting as any, { name: 'React' }), container)
    expect(container.querySelector('p')?.textContent).toBe('Hello, React!')
  })

  test('数値の子要素をテキストとしてレンダリングする', () => {
    render(createElement('span', null, 42), container)
    expect(container.querySelector('span')?.textContent).toBe('42')
  })
})
