# 第7章: なぜHooksには「ルール」があるのか — useState・useRefの実装から学ぶ

## 7.1 クラスコンポーネントの問題

Hooks登場以前、状態管理はクラスコンポーネントで行っていた。

```javascript
class Counter extends React.Component {
  constructor(props) {
    super(props)
    this.state = { count: 0 }
  }
  render() {
    return (
      <button onClick={() => this.setState({ count: this.state.count + 1 })}>
        {this.state.count}
      </button>
    )
  }
}
```

`this` への依存、ライフサイクルメソッドへのロジック分散、テストの難しさ。Hooksはこれらの問題を解決するために生まれた。

しかし、「なぜ条件分岐の中でHooksを使ってはいけないのか？」その技術的根拠を説明できる人は少ない。実装すれば、自然にわかる。

## 7.2 currentlyRenderingFiber: なぜグローバルが必要か

`useState` はどのコンポーネントの状態を管理しているかをどうやって知るか？

```typescript
// 答え: グローバルポインタ
export let currentlyRenderingFiber: Fiber | null = null
```

関数コンポーネントが実行される直前に、このグローバルを現在のFiberにセットする。

```typescript
function updateFunctionComponent(fiber: Fiber): void {
  prepareToRenderHooks(fiber)  // currentlyRenderingFiber = fiber をセット
  const children = (fiber.type as Function)(fiber.pendingProps)
  // ...
}
```

コンポーネント関数内で `useState` を呼ぶと、このグローバルを通じて「どのFiberのHookか」がわかる。

## 7.3 Dispatcher切り替えパターン

同じ `useState(0)` を呼んでも、初回レンダリングと2回目以降のレンダリングでは全く異なるコードパスを通る。

```typescript
// hooksDispatcher.ts

const mountDispatcher: Dispatcher = {
  useState: mountState,   // 初回: 新規Hookノードを作成
  useEffect: mountEffect,
  useRef: mountRef,
}

const updateDispatcher: Dispatcher = {
  useState: updateState,  // 更新時: 既存Hookノードから値を読む
  useEffect: updateEffect,
  useRef: updateRef,
}

export function prepareToRenderHooks(fiber: Fiber): void {
  currentlyRenderingFiber = fiber
  workInProgressHook = null
  currentHook = null

  // ★ ここが核心: alternateがあれば更新時、なければ初回
  currentDispatcher = fiber.alternate === null ? mountDispatcher : updateDispatcher
}
```

ユーザーが呼ぶ `useState` は Dispatcher に委譲するだけだ：

```typescript
export function useState(initialState) {
  return currentDispatcher.useState(initialState)
}
```

「同じ関数名なのに、初回と2回目で全く別のコードが走る」——これがHooksの設計の驚きだ。

## 7.4 Hookリンクリストの構造

Hookは**配列ではなくリンクリスト**で管理される。これがRules of Hooksの技術的根拠だ。

```typescript
type Hook = {
  memoizedState: any      // useStateならstate値、useRefなら{current: T}
  baseState: any
  queue: UpdateQueue | null
  next: Hook | null       // 次のHookへのポインタ
}
```

コンポーネントが `useState` を2回呼ぶと：

**マウント時（リスト構築）：**

```
useState(0):
  hook1 = { memoizedState: 0, next: null }
  fiber.memoizedState = hook1
  workInProgressHook = hook1

useState('hello'):
  hook2 = { memoizedState: 'hello', next: null }
  hook1.next = hook2
  workInProgressHook = hook2

結果: fiber.memoizedState → hook1 → hook2 → null
```

**更新時（リストを同順で走査）：**

```
useState(0):
  currentHook = fiber.alternate.memoizedState  ← hook1（count=1に更新済み）
  workInProgressHook = WIPの新hook1
  return [1, dispatch]

useState('hello'):
  currentHook = currentHook.next               ← hook2
  workInProgressHook = WIPの新hook2
  return ['hello', dispatch]
```

## 7.5 条件分岐でHookを呼ぶと何が起きるか

```typescript
function BadComponent({ show }) {
  if (show) {
    const [count, setCount] = useState(0)   // 条件により呼ばれたり呼ばれなかったり
  }
  const [name, setName] = useState('')
}
```

**初回レンダリング（show=true）：**
```
fiber.memoizedState → Hook(count=0) → Hook(name='') → null
```

**2回目のレンダリング（show=false）：**
```
currentHook = Hook(count=0)  ← 期待: countのHook
name の useState を呼ぶ:
  currentHook = currentHook.next = Hook(name='')  ← 期待通り
```

一見問題なさそう。しかし：

**3回目のレンダリング（show=true）：**
```
countのuseStateを呼ぶ:
  currentHook = fiber.alternate.memoizedState = Hook(count=0)
  return [0, dispatch]  ← 正しい

nameのuseStateを呼ぶ:
  currentHook = currentHook.next = Hook(name='')
  return ['', dispatch]  ← 正しい

でも2回目のWIPリストは:
  Hook(count=0) → null（nameのHookがない！）
```

**4回目（show=false）：**
```
nameのuseStateを呼ぶ（countはスキップ）:
  currentHook = fiber.alternate.memoizedState = Hook(count=0)
  return [0, dispatch]  ← ❌ nameを期待したのにcountの値が返る！
```

リンクリストの対応がズレて、値が混在する。これがRules of Hooksの理由だ。**Hooksは常に同じ順序で呼ばれなければならない。**

## 7.6 useState の実装

```typescript
// hooks/useState.ts

export function mountState(initialState) {
  const hook = mountWorkInProgressHook()

  const state = typeof initialState === 'function' ? initialState() : initialState
  hook.memoizedState = state
  hook.baseState = state

  const queue: UpdateQueue = {
    pending: null,
    dispatch: null,
    lastRenderedState: state,
  }
  hook.queue = queue

  const dispatch = createDispatch(currentlyRenderingFiber!, queue)
  queue.dispatch = dispatch

  return [state, dispatch]
}

export function updateState(initialState) {
  const hook = updateWorkInProgressHook()
  const queue = hook.queue!

  // pending循環リンクリストを処理
  let newState = hook.baseState
  if (queue.pending !== null) {
    const first = queue.pending.next!  // pendingは末尾なので.nextが先頭
    let update = first
    do {
      newState = typeof update.action === 'function'
        ? update.action(newState)
        : update.action
      update = update.next!
    } while (update !== first)
    queue.pending = null
  }

  hook.memoizedState = newState
  return [newState, queue.dispatch!]
}
```

**pending 循環リンクリスト：**

複数の `setState` が連続して呼ばれた場合、それらをキューに積む。末尾を `pending` とし、末尾の `next` が先頭を指す循環構造にすることで、O(1)で末尾に追加できる。

```
dispatch(1) → pending: [1]（自己ループ）
dispatch(2) → pending: [1→2→1]（末尾に追加、末尾を更新）
```

## 7.7 Bailout（同じ値なら再レンダリングをスキップ）

```typescript
function createDispatch(fiber, queue) {
  return function dispatch(action) {
    // ... updateを循環リンクリストに追加 ...

    // 本番Reactには Eager bailout がある:
    // const newState = queue.lastRenderedReducer(queue.lastRenderedState, action)
    // if (Object.is(newState, queue.lastRenderedState)) return  // スケジュールすらしない
    //
    // 本書では Eager bailout を省略。render phase bailout のみ実装。

    scheduleUpdateOnFiber(fiber)
  }
}
```

`Object.is` による同値比較でbailoutする設計（render phase bailout）は `updateState` 内に組み込む余地があるが、本書では説明の単純化のため省略している。

## 7.8 useRef の実装

```typescript
// hooks/useRef.ts

export function mountRef(initialValue) {
  const hook = mountWorkInProgressHook()
  const ref = { current: initialValue }
  hook.memoizedState = ref
  return ref
}

export function updateRef(initialValue) {
  const hook = updateWorkInProgressHook()
  return hook.memoizedState  // 同じオブジェクトを返す
}
```

**なぜ re-render を起こさないか：**
- `dispatch` 関数を呼ばない → `scheduleUpdateOnFiber` が実行されない
- `ref.current = newValue` はただのオブジェクトへの代入で、Reactは関知しない

**なぜ参照が安定しているか：**
- `mountRef` でオブジェクトを作成してHookリンクリストに保存
- `updateRef` は同じオブジェクトをリンクリストから取り出して返す

**useState と useRef が同じリンクリストを共有：**

```
Fiber.memoizedState → Hook(useState) → Hook(useRef) → Hook(useState) → null
```

違いは `queue` があるかどうかだけ。useRef は `queue: null`、updateQueueを持たない。

## 7.9 React 18: Automatic Batching

React 17まで：

```typescript
setTimeout(() => {
  setCount(c => c + 1)  // 1回レンダリング
  setFlag(f => !f)      // もう1回レンダリング（合計2回）
}, 0)
```

React 18 (`createRoot` 使用時)：

```typescript
setTimeout(() => {
  setCount(c => c + 1)  // まとめて
  setFlag(f => !f)      // 1回のレンダリング（Automatic Batching）
}, 0)
```

本書の実装は Legacy Mode に相当するため、Automatic Batching はない。ただし `requestIdleCallback` のコールバック内では偶発的にバッチされることがある。

> **コラム: useState と useReducer の内部的等価性**
>
> `useState` は `useReducer` の特殊ケースだ。
>
> ```typescript
> // useState は useReducer のこういう使い方と同じ
> const [state, dispatch] = useReducer(
>   (state, action) => typeof action === 'function' ? action(state) : action,
>   initialState
> )
> ```
>
> 本番Reactの実装でも、`mountState` は内部で `mountReducer` を呼んでいる。
> `useReducer` を実装するには `updateState` の reducer部分を汎用化するだけだ。

## まとめ

**解決できたこと：**
- Hookリンクリストの構造が理解できた
- Dispatcher切り替えで init/update を分岐できた
- Rules of Hooksの技術的根拠が実装からわかった
- `useRef` がなぜ参照安定・再レンダリングなしかがわかった

**まだ解決できていないこと：**
- タイマーやAPIなど「外の世界」との接続（useEffect）

---

**次章への問い：** `useEffect` はなぜ「レンダーの後」に実行されるのか？クリーンアップはいつ実行されるのか？
