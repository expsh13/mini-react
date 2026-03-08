# 第9章: すべてをつなぐ

## 9.1 ストップウォッチアプリ

本章では、これまで実装した全機能を組み合わせてストップウォッチアプリを作る。

```typescript
import * as MiniReact from './src/index'

// ① 表示コンポーネント
function Display({ time }: { time: number }) {
  return MiniReact.createElement('span', { id: 'time' }, `${time}s`)
}

// ② コントロールコンポーネント（Fragment使用）
function Controls({ running, onStart, onStop, onReset }) {
  return MiniReact.createElement(MiniReact.Fragment, null,
    running
      ? MiniReact.createElement('button', { onClick: onStop }, 'Stop')
      : MiniReact.createElement('button', { onClick: onStart }, 'Start'),
    MiniReact.createElement('button', { onClick: onReset }, 'Reset')
  )
}

// ③ メインコンポーネント
function Stopwatch() {
  const [time, setTime] = MiniReact.useState(0)
  const [running, setRunning] = MiniReact.useState(false)
  const intervalRef = MiniReact.useRef<ReturnType<typeof setInterval> | null>(null)

  MiniReact.useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setTime(t => t + 1)
      }, 1000)
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [running])

  return MiniReact.createElement('div', null,
    MiniReact.createElement(Display, { time }),
    MiniReact.createElement(Controls, {
      running,
      onStart: () => setRunning(true),
      onStop:  () => setRunning(false),
      onReset: () => { setRunning(false); setTime(0) },
    })
  )
}

const root = MiniReact.createRoot(document.getElementById('root')!)
root.render(MiniReact.createElement(Stopwatch, null))
```

## 9.2 「Startボタン」クリックから全体をトレース

`Start` ボタンをクリックしたとき、何が起きるか。全体のフローを追ってみよう。

### ① イベント発火

```
ユーザーがStartをクリック
  → button の click イベントが発火
  → onStart = () => setRunning(true) が呼ばれる
```

### ② dispatch → scheduleUpdateOnFiber

```typescript
// hooks/useState.ts
function createDispatch(fiber, queue) {
  return function dispatch(action) {
    // update を循環リンクリストに追加
    const update = { action: true, next: null }
    // ... pending リストに追加 ...

    // 再レンダリングをスケジュール
    scheduleUpdateOnFiber(fiber)  // ← Stopwatch Fiberを起点にルートを探す
  }
}
```

### ③ workLoop が起動

```typescript
// workLoop.ts
function scheduleUpdateOnFiber(fiber) {
  const root = getRoot(fiber)           // FiberRoot を取得
  wipRoot = createWorkInProgress(root.current, ...)  // WIPツリーを準備
  nextUnitOfWork = wipRoot
  requestIdleCallback(workLoop)
}
```

### ④ render phase: beginWork / completeWork

```
HostRoot (beginWork)
  └── Stopwatch (FunctionComponent, beginWork)
        ↓ prepareToRenderHooks: currentDispatcher = updateDispatcher
        ↓ Stopwatch() 関数を実行
            useState(0) → updateState → queue.pending = null → time = 0
            useState(false) → updateState → queue.pending を処理 → running = true
```

実際には `updateState` が `queue.pending` を処理する：

```typescript
// queue.pending = { action: true, next: (self) }
let newState = hook.baseState  // false
const first = queue.pending.next  // action: true
newState = first.action  // → true
hook.memoizedState = true
```

### ⑤ reconcileChildren で差分検出

```
前回: Stop ボタン（なし）、Start ボタン（あり）
今回: Stop ボタン（あり）、Start ボタン（なし）

差分:
  - Start ボタン: Deletion フラグ
  - Stop ボタン: Placement フラグ
```

### ⑥ completeWork でDOM準備

新しいStop ボタンのDOM要素を `document.createElement('button')` で作成し、`fiber.stateNode` にセット。

### ⑦ commit phase

```
Phase 1: Mutation
  commitDeletion: Start ボタンのDOMを削除
  commitPlacement: Stop ボタンのDOMを挿入

root.current = wipRoot（WIPがcurrentになる）

Phase 2: Passive Effects（MessageChannel経由・ペイント後）
  useEffect([running]) の deps が変化（false → true）
    → HookHasEffect フラグあり → エフェクトを実行
    → setInterval が開始
```

### ⑧ setInterval が動き始める

1秒ごとに `setTime(t => t + 1)` が呼ばれる。これは再び `dispatch → scheduleUpdateOnFiber → workLoop → commit` のサイクルを繰り返す。

## 9.3 本書の実装と本物Reactの対応表

| 本書のファイル | 本物のReact（packages/react-reconciler/src/） |
|---|---|
| `src/types.ts` | `ReactFiber.js`, `ReactWorkTags.js`, `ReactFiberFlags.js` |
| `src/createElement.ts` | `packages/react/src/ReactElement.js` |
| `src/fiber.ts` | `ReactFiber.js` |
| `src/workLoop.ts` | `ReactFiberWorkLoop.js`, `ReactFiberBeginWork.js`, `ReactFiberCompleteWork.js`, `ReactFiberNewContext.js` |
| `src/commit.ts` | `ReactFiberCommitWork.js` |
| `src/hooksDispatcher.ts` | `ReactFiberHooks.js`（`ReactCurrentDispatcher`） |
| `src/hooks/useState.ts` | `ReactFiberHooks.js`（`mountState`, `updateState`） |
| `src/hooks/useEffect.ts` | `ReactFiberHooks.js`（`mountEffect`, `updateEffect`） |

## 9.4 本書の実装と本物Reactの差分

### 本書が省略したもの

**Lanes（優先度）システム：**

本物のReactは各更新に「優先度（Lane）」を付与する。高優先度の更新（ユーザーインタラクション）は低優先度の更新（バックグラウンドデータ更新）より先に処理される。

差分の本質：**Fiberの構造は同じ**。`Fiber.lanes` と `Fiber.childLanes` フィールドを追加し、スケジューラが優先度付きキューを管理することでConcurrent Modeが成立する。

**本物のスケジューラ：**

```
本書: requestIdleCallback（近似）
本物: MessageChannel + shouldYield() + expirationTime計算
```

`shouldYield()` は現在時刻と「この更新のデッドライン」を比較して中断判定する。

**subtreeFlags の最適化：**

```
本書: 全サブツリーをトラバース
本物: subtreeFlags で子孫にflagsがなければサブツリーをスキップ
```

## 9.5 React 19 の新機能との接続

本書のコードはReact 19の新機能の基盤でもある。

**`use()` hook：**

PromiseをFiber内でアンラップする。`Suspense` と連動して、Promiseが解決するまでFiberをサスペンドする。本書のHookリンクリストが基盤。

**`ref` as prop（React 19正式サポート）：**

React 19では `forwardRef` なしで `ref` をpropsとして受け取れる（forwardRefは将来的に非推奨になる見込み）。本書の実装では `ref` をpropsの1つとして扱っており、この変更に近い形だ。

**React Compiler：**

`useMemo` / `useCallback` / `React.memo` の手動最適化を自動化するコンパイラ。「Compilerが何を最適化しているかを理解するには、本書で学んだFiberの再レンダリングの仕組みが基盤になる。」

**Server Components：**

FiberはClient Componentのみ担当する。Server ComponentはRSC Payload（JSONベースのフォーマット）としてサーバーから送られ、クライアントでHydrationされる。これはFiberとは別の仕組みで、本書の実装の範囲外だ。

## 9.6 意図的に省略した機能

| 機能 | なぜ省略したか |
|---|---|
| Lanes（優先度） | Fiberの本質理解には不要。追加はフィールド追加とスケジューラ変更のみ |
| Context | Fiberのprops伝達の拡張。理解はできるが実装がそれだけで章1つ分 |
| Portal | `ReactDOM.createPortal()` 別DOMへのレンダリング。commitDeletionの変更のみ |
| `useLayoutEffect` | コラムで解説。実装は commitの直後に同期実行するだけ |
| `useMemo` / `useCallback` | `useRef` と同じリンクリスト。`[value, deps]` のペアを保存するだけ |

> **コラム: `useMemo` と `useCallback` の実装**
>
> `useMemo` と `useCallback` は `useRef` とまったく同じ仕組みを使う。
>
> ```typescript
> function mountMemo(factory, deps) {
>   const hook = mountWorkInProgressHook()
>   const value = factory()
>   hook.memoizedState = [value, deps]  // [値, deps] のペアを保存
>   return value
> }
>
> function updateMemo(factory, deps) {
>   const hook = updateWorkInProgressHook()
>   const [prevValue, prevDeps] = hook.memoizedState
>   if (areHookInputsEqual(deps, prevDeps)) return prevValue  // deps変化なし
>   const value = factory()
>   hook.memoizedState = [value, deps]
>   return value
> }
> ```
>
> `useCallback(fn, deps)` は `useMemo(() => fn, deps)` と等価だ。

## 9.7 次に読む資料

本書を読み終えた後、本物のReactソースコードを読む準備ができている。

**まず読むべきファイル（packages/react-reconciler/src/）：**

1. `ReactWorkTags.js` — WorkTag定数（本書と同じ数値）
2. `ReactFiberFlags.js` — Flags定数（Placement, Update, Deletion）
3. `ReactFiber.js` — `createFiber()` 関数
4. `ReactFiberHooks.js` — 全Hookの実装（6000行！）
5. `ReactFiberWorkLoop.js` — ワークループの全実装

**読むコツ：**

- 最初は `console.log` を仕込んで実際の動きを確認する
- Lanesの部分（優先度）は最初は読み飛ばしてOK
- `DEV` ブロック（開発環境のみのコード）も最初はスキップ

---

## 最後に

約800行のコードでReact 18の核心を実装した。

`useState` が条件分岐内で使えない理由、`useEffect` のクリーンアップが次のエフェクト実行前に呼ばれる理由、`useRef` がなぜ再レンダリングを起こさないか——すべて実装から自然に導かれた。

本物のReactは数万行のコードからできているが、その核心にあるアイデアはシンプルだ。

- Fiberはコールスタックをヒープに移したもの
- reconciliationはkeyによるリスト照合
- Hooksはリンクリストに保存された状態

この本を読んで、Reactがブラックボックスではなくなったなら、目的は達成された。
