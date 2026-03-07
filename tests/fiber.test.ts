import {
  createFiber,
  createFiberRoot,
  createWorkInProgress,
  createFiberFromVNode,
  createFiberFromText,
} from '../src/fiber'
import {
  FunctionComponent,
  HostRoot,
  HostComponent,
  HostText,
  NoFlags,
} from '../src/types'

describe('fiber (Chapter 4): Fiberデータ構造', () => {
  describe('createFiber', () => {
    test('基本的なFiberノードを作成する', () => {
      const fiber = createFiber(HostComponent, 'div', { className: 'foo' })
      expect(fiber.tag).toBe(HostComponent)
      expect(fiber.type).toBe('div')
      expect(fiber.pendingProps).toEqual({ className: 'foo' })
      expect(fiber.key).toBeNull()
      expect(fiber.flags).toBe(NoFlags)
    })

    test('keyを持つFiberを作成できる', () => {
      const fiber = createFiber(HostComponent, 'li', {}, 'item-1')
      expect(fiber.key).toBe('item-1')
    })

    test('初期状態ではポインタがすべてnull', () => {
      const fiber = createFiber(FunctionComponent, () => null, {})
      expect(fiber.return).toBeNull()
      expect(fiber.child).toBeNull()
      expect(fiber.sibling).toBeNull()
      expect(fiber.alternate).toBeNull()
      expect(fiber.stateNode).toBeNull()
      expect(fiber.memoizedState).toBeNull()
      expect(fiber.updateQueue).toBeNull()
    })
  })

  describe('createFiberRoot', () => {
    test('FiberRoot と root Fiber が別オブジェクトで、互いを参照する', () => {
      const container = document.createElement('div')
      const root = createFiberRoot(container)

      expect(root.container).toBe(container)
      expect(root.current).toBeDefined()
      expect(root.current.tag).toBe(HostRoot)
      expect(root.current.stateNode).toBe(root)  // root Fiber → FiberRoot
      expect(root.finishedWork).toBeNull()
    })
  })

  describe('createWorkInProgress (ダブルバッファリング)', () => {
    test('初回呼び出し: alternate を作成して接続する', () => {
      const container = document.createElement('div')
      const root = createFiberRoot(container)
      const current = root.current

      const wip = createWorkInProgress(current, {})

      expect(wip.alternate).toBe(current)
      expect(current.alternate).toBe(wip)
      expect(wip).not.toBe(current)
    })

    test('2回目の呼び出し: 既存のFiberを再利用する', () => {
      const container = document.createElement('div')
      const root = createFiberRoot(container)
      const current = root.current

      const wip1 = createWorkInProgress(current, {})
      const wip2 = createWorkInProgress(current, { newProp: true })

      // 同じオブジェクトが再利用される
      expect(wip1).toBe(wip2)
      expect(wip2.pendingProps).toEqual({ newProp: true })
    })

    test('WIPはcurrentのmemoizedStateを引き継ぐ', () => {
      const container = document.createElement('div')
      const root = createFiberRoot(container)
      const current = root.current
      current.memoizedState = { value: 42 } as any

      const wip = createWorkInProgress(current, {})
      expect(wip.memoizedState).toEqual({ value: 42 })
    })
  })

  describe('child/sibling/return ポインタ構造', () => {
    test('手動でFiberツリーを構築できる', () => {
      // div
      //   └── span (child)
      //         └── text (child)
      //   └── p (sibling of span)
      const div = createFiber(HostComponent, 'div', {})
      const span = createFiber(HostComponent, 'span', {})
      const text = createFiber(HostText, null, { nodeValue: 'hello' })
      const p = createFiber(HostComponent, 'p', {})

      div.child = span
      span.return = div
      span.child = text
      text.return = span
      span.sibling = p
      p.return = div

      expect(div.child).toBe(span)
      expect(span.return).toBe(div)
      expect(span.sibling).toBe(p)
      expect(p.return).toBe(div)
    })
  })

  describe('createFiberFromVNode', () => {
    test('文字列typeからHostComponent Fiberを作成する', () => {
      const fiber = createFiberFromVNode({ type: 'div', key: null, props: {} }, 0)
      expect(fiber.tag).toBe(HostComponent)
      expect(fiber.type).toBe('div')
    })

    test('関数typeからFunctionComponent Fiberを作成する', () => {
      const fn = () => null
      const fiber = createFiberFromVNode({ type: fn, key: 'k', props: { x: 1 } }, 2)
      expect(fiber.tag).toBe(FunctionComponent)
      expect(fiber.key).toBe('k')
      expect(fiber.index).toBe(2)
    })
  })

  describe('createFiberFromText', () => {
    test('テキストFiberを作成する', () => {
      const fiber = createFiberFromText('hello', 0)
      expect(fiber.tag).toBe(HostText)
      expect(fiber.pendingProps.nodeValue).toBe('hello')
    })

    test('数値はstringに変換される', () => {
      const fiber = createFiberFromText(42, 1)
      expect(fiber.pendingProps.nodeValue).toBe('42')
    })
  })
})
