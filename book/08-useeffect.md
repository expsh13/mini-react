# 第8章: レンダーの「後」に何が起きるか — useEffectの本質

## 8.1 useEffect と useLayoutEffect の違い

```
レンダリングのタイムライン:

render phase      commit phase      ペイント
  ↓               ↓                  ↓
[差分検出] → [Mutation] → [Layout] → [Paint] → [Passive]
                              ↑                     ↑
                     useLayoutEffect           useEffect
                     （同期・ペイント前）      （非同期・ペイント後）
```

**useLayoutEffect（本書では省略）：**
- commitの Mutation phase 直後、ペイント前に同期実行
- DOM計測（`getBoundingClientRect()`）が正確
- 重い処理をするとペイントが遅延する

**useEffect（本書で実装）：**
- ペイント後に非同期実行
- ユーザーにちらつきを見せない
- I/O、タイマー、APIコールに適している

## 8.2 HookHasEffect フラグ

useEffect の最重要実装ポイントは `HookHasEffect` フラグだ。

```typescript
const HookNoFlags   = 0b000  // 0
const HookHasEffect = 0b001  // 1: 今回実行すべきエフェクト
const HookPassive   = 0b100  // 4: useEffect（PassiveEffect）

// Effectオブジェクト
type Effect = {
  tag: number   // HookPassive | HookHasEffect（実行する）
                // HookPassive のみ（スキップ）
  create: () => void | (() => void)
  destroy: (() => void) | null
  deps: any[] | null
  next: Effect | null
}
```

`HookHasEffect` がない Effect は commit phase でスキップされる。これにより、deps が変わっていないエフェクトは実行されない。

## 8.3 mountEffect と updateEffect

```typescript
// hooks/useEffect.ts

export function mountEffect(create, deps?) {
  const hook = mountWorkInProgressHook()
  // マウント時は必ず実行 → HookHasEffect を立てる
  const effect = pushEffect(HookPassive | HookHasEffect, create, null, deps ?? null)
  hook.memoizedState = effect
}

export function updateEffect(create, deps?) {
  const hook = updateWorkInProgressHook()
  const prevEffect = hook.memoizedState as Effect
  const prevDeps = prevEffect?.deps ?? null
  const nextDeps = deps ?? null

  if (prevDeps !== null && areHookInputsEqual(nextDeps, prevDeps)) {
    // deps変化なし → HookHasEffect を立てない（実行しない）
    const effect = pushEffect(HookPassive, create, prevEffect?.destroy ?? null, nextDeps)
    hook.memoizedState = effect
  } else {
    // deps変化あり（または deps なし）→ HookHasEffect を立てる
    const effect = pushEffect(
      HookPassive | HookHasEffect,
      create,
      prevEffect?.destroy ?? null,
      nextDeps
    )
    hook.memoizedState = effect
  }
}
```

## 8.4 Effectリンクリスト

EffectはFiber.updateQueueに循環リンクリストとして格納される。Hookリンクリスト（Fiber.memoizedState）とは別管理だ。

```
Fiber.memoizedState → Hook1 → Hook2 → null
                       ↓
                     (useEffect Hook)
Fiber.updateQueue  → { lastEffect: → Effect3 }
                                       ↓ next
                                    Effect1 → Effect2 → Effect3（循環）
```

```typescript
function pushEffect(tag, create, destroy, deps): Effect {
  const effect: Effect = { tag, create, destroy, deps, next: null }

  let queue = currentlyRenderingFiber!.updateQueue
  if (queue === null) {
    queue = { lastEffect: null }
    currentlyRenderingFiber!.updateQueue = queue
  }

  if (queue.lastEffect === null) {
    effect.next = effect  // 自己ループ
    queue.lastEffect = effect
  } else {
    const firstEffect = queue.lastEffect.next!
    queue.lastEffect.next = effect
    effect.next = firstEffect
    queue.lastEffect = effect  // 末尾を更新
  }
  return effect
}
```

## 8.5 deps 比較：Object.is を使う理由

```typescript
export function areHookInputsEqual(nextDeps, prevDeps): boolean {
  if (prevDeps === null || nextDeps === null) return false
  if (prevDeps.length !== nextDeps.length) return false

  for (let i = 0; i < prevDeps.length; i++) {
    if (!Object.is(nextDeps[i], prevDeps[i])) return false
  }
  return true
}
```

`===` ではなく `Object.is` を使う理由：

```typescript
NaN === NaN   // false（❌ deps変化なしと判定してしまう）
Object.is(NaN, NaN)  // true（✓ 正しく「変化なし」と判定）

+0 === -0     // true（❌ 同じと判定してしまう）
Object.is(+0, -0)    // false（✓ 正しく「変化あり」と判定）
```

**オブジェクトをdepsに入れると無限ループになる理由：**

```typescript
function Component() {
  useEffect(() => {
    fetch('/api/data')
  }, [{ id: 1 }])  // ← 毎回新しいオブジェクトが作られる
}
```

`{ id: 1 }` は毎回のレンダリングで新しいオブジェクトが作られる。`Object.is({ id: 1 }, { id: 1 })` は `false`（参照比較）。よってdepsが「変化した」と判定され、エフェクトが実行 → stateが更新 → 再レンダリング → 無限ループ。

## 8.6 effect.destroy = null のクリア

```typescript
export function commitHookEffectListUnmount(flags, fiber) {
  // ...
  do {
    if ((effect.tag & flags) === flags) {
      if (effect.destroy) {
        const destroy = effect.destroy
        effect.destroy = null  // ★ 必ずクリア
        destroy()
      }
    }
    effect = effect.next!
  } while (effect !== firstEffect)
}
```

なぜクリアが必要か？

React Strict Mode（開発時）では、`mount → cleanup → mount` の順で二重実行される。クリアしないと、同じ `destroy` 関数が2回実行されてしまう。また HMR（Hot Module Replacement）でも同様の問題が起きる。

## 8.7 React 18: Strict Modeのuse効果二重実行

React 17まで: Strict Modeは `render` と `useLayoutEffect` のみ二重実行。

React 18から: **`useEffect` も** 二重実行される。

```
mount → cleanup → mount
  ↑            ↑
1回目のマウント  2回目のマウント（本番の動作を模倣）
```

目的：cleanupが正しく実装されているかを開発時に強制チェックする。

```typescript
useEffect(() => {
  const timer = setInterval(tick, 1000)
  return () => clearInterval(timer)  // cleanupが正しければ二重実行でも問題なし
}, [])
```

二重実行で問題が起きるなら、cleanupの実装にバグがある。

## 8.8 実行タイムラインの実例

```typescript
function Child() {
  useEffect(() => {
    console.log('effect:0')
    return () => console.log('cleanup:0')
  }, [count])  // count=0
}
```

**count が 0 → 1 に変化したとき：**

```
1. render phase: updateEffect 実行
   → effect.tag = HookPassive | HookHasEffect（deps変化あり）

2. commit phase Mutation: DOMを更新

3. ペイント（ブラウザが画面を描画）

4. Passive Effects（MessageChannel経由）:
   a. commitPassiveUnmountEffects: cleanup:0 を実行
   b. commitPassiveMountEffects:   effect:1 を実行（新しいcreate）
```

## 8.9 タイマーストップウォッチ

```typescript
import { useState, useEffect, useRef } from './src/hooksDispatcher'

function Stopwatch() {
  const [time, setTime] = useState(0)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (running) {
      const timer = setInterval(() => setTime(t => t + 1), 1000)
      return () => clearInterval(timer)  // cleanup: タイマーを止める
    }
  }, [running])

  return createElement('div', null,
    createElement('p', null, `${time}s`),
    createElement('button', { onClick: () => setRunning(r => !r) },
      running ? 'Stop' : 'Start'
    )
  )
}
```

**Startボタンを押したとき：**
1. `setRunning(true)` → 再レンダリング
2. `running` が変化 → `HookHasEffect` フラグが立つ
3. Passive Effects: `setInterval` を開始

**Stopボタンを押したとき：**
1. `setRunning(false)` → 再レンダリング
2. cleanup（`clearInterval`）実行 → 新しいエフェクト実行（runningが false なので何もしない）

> **コラム: useLayoutEffect — DOM計測とちらつきを防ぐ**
>
> Tooltipコンポーネントを作るとき、Tooltipが画面端に近い場合は位置を調整したい。
>
> ```typescript
> function Tooltip({ children }) {
>   const ref = useRef(null)
>   const [pos, setPos] = useState({ top: 0 })
>
>   useLayoutEffect(() => {
>     // ペイント前にDOMを計測して位置を修正
>     const rect = ref.current.getBoundingClientRect()
>     if (rect.bottom > window.innerHeight) {
>       setPos({ top: -rect.height })
>     }
>   }, [])
>
>   return <div ref={ref} style={pos}>{children}</div>
> }
> ```
>
> `useEffect` を使うと「元の位置でペイント → 計測 → 再ペイント」でちらつく。
> `useLayoutEffect` を使うと「計測 → ペイント（修正済み）」でちらつかない。

## まとめ

**解決できたこと：**
- deps比較で必要なときだけエフェクトを実行できる
- クリーンアップを正しいタイミングで実行できる
- MessageChannelでペイント後に非同期実行できる

---

**次章への問い：** 全機能を組み合わせてアプリを作り、処理の全体フローをトレースしよう。
