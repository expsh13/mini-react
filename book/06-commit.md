# 第6章: 画面は一気に変わらなければならない — commitフェーズ

## 6.1 なぜcommitフェーズは中断できないか

render phaseは中断できる。でもcommit phaseは中断してはいけない。

理由はシンプルだ：**ユーザーに壊れた画面を見せないため**。

例えば、3つのDOMを更新する途中で中断したらどうなるか？

```
1. button の text を更新 ← ここまで完了
2. input の value を更新 ← 中断！
3. div の class を更新   ← 未実行
```

画面には「一部だけ更新された中途半端なUI」が表示される。これはユーザー体験として最悪だ。

render phaseはDOMに触れないため、中断しても問題ない。workInProgress treeはメモリ上にあるだけで、ユーザーには見えない。

## 6.2 2サブフェーズの構造

```
commitRoot(wipRoot)
│
├── Phase 1: Mutation（DOM変更）← 中断不可
│   ├── commitDeletion(deletions)
│   │     └── 子孫のuseEffectクリーンアップも実行（メモリリーク防止）
│   ├── commitPlacement(fiber)   ← 新規DOMの挿入
│   └── commitUpdate(fiber)      ← 属性・テキストの更新
│
├── ★ root.current = finishedWork（Mutation後）
│
└── Phase 2: Passive Effects（useEffect、非同期・ペイント後）
    ├── commitHookEffectListUnmount（クリーンアップを先に全実行）
    └── commitHookEffectListMount（新しいエフェクトを実行）
```

**本書での省略：**

本物のReactには Layout Phase（useLayoutEffect、ペイント前・同期実行）もあるが、本書では実装しない。コラムで解説する。

## 6.3 root.current の切り替えタイミング

```typescript
export function commitRoot(wipRoot: Fiber, deletions: Fiber[]): void {
  const root = wipRoot.stateNode as FiberRoot

  // Phase 1: Mutation
  deletions.forEach((fiber) => commitDeletion(fiber))
  commitMutationEffects(wipRoot)

  // ★ ここで切り替え（Mutation後・Passive前）
  root.current = wipRoot

  // Phase 2: Passive Effects（非同期）
  schedulePassiveEffects(wipRoot)
}
```

なぜ Mutation後・Passive前か？

- **Mutation前に切り替えたら**：`commitDeletion` 内で `current` を参照したときに、まだ古いDOMが `current` にある状態と新しいDOMが `current` にある状態が混在する
- **Passive後に切り替えたら**：`useEffect` のクリーンアップ内で `current` を参照すると、まだ古いFiberツリーを見ることになる

## 6.4 commitPlacement — DOMの挿入

```typescript
function commitPlacement(fiber: Fiber): void {
  const parentDOM = getHostParent(fiber)  // 親DOMを探す
  if (!parentDOM) return

  const dom = getHostDOM(fiber)           // このFiberのDOM
  if (!dom) return

  // 挿入位置を正確に制御するため、次のホスト兄弟の前に挿入
  const before = getHostSibling(fiber)
  if (before) {
    parentDOM.insertBefore(dom, before)
  } else {
    parentDOM.appendChild(dom)
  }
}
```

**FunctionComponentとFragmentの処理：**

FunctionComponentとFragmentはDOMを持たない。そのため：
- `getHostParent()` は `return` ポインタを辿ってHostComponent/HostRootを探す
- `getHostDOM()` は子のDOMを探す

これがなぜ pre-order（親→子）でコミットする必要があるかの理由でもある。post-order（子→親）にすると、兄弟要素の挿入順が逆になってしまう。

## 6.5 commitDeletion — 子孫のクリーンアップ

```typescript
function commitDeletion(fiber: Fiber): void {
  // ① 子孫のuseEffectクリーンアップを先に実行
  commitNestedUnmounts(fiber)

  // ② DOMを削除
  const dom = getHostDOM(fiber)
  if (dom && dom.parentNode) {
    dom.parentNode.removeChild(dom)
  }
}

function commitNestedUnmounts(fiber: Fiber): void {
  // FunctionComponentのuseEffectクリーンアップ
  commitHookEffectListUnmount(HookPassive, fiber)

  if (fiber.child) commitNestedUnmounts(fiber.child)
  if (fiber.sibling) commitNestedUnmounts(fiber.sibling)
}
```

なぜ子孫のクリーンアップが必要か？

```jsx
function Parent() {
  return <Child />
}

function Child() {
  useEffect(() => {
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)  // ← このクリーンアップが必要
  }, [])
  return <div>child</div>
}
```

`Parent` が削除されたとき、`Child` の `useEffect` クリーンアップも実行しないと、`setInterval` が残り続けてメモリリークになる。

## 6.6 useEffect のスケジューリング：MessageChannel

```typescript
function schedulePassiveEffects(wipRoot: Fiber): void {
  // MessageChannel を使ってペイント後にuseEffectを実行
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    flushPassiveEffects(wipRoot)
  }
  channel.port2.postMessage(null)
}
```

なぜ `setTimeout(0)` ではなく `MessageChannel` か？

`setTimeout(0)` は最小4msの遅延がある（HTML仕様で規定）。`MessageChannel` は遅延なしでマクロタスクキューに積める。これにより、ブラウザが画面を描画した直後（ペイント後）に `useEffect` が実行される。

本番Reactもこの方式を使っている。

## 6.7 Passive Effects の実行順序

```typescript
function flushPassiveEffects(fiber: Fiber): void {
  // ① まず全クリーンアップを実行（新旧の順序問題を避けるため）
  commitPassiveUnmountEffects(fiber)
  // ② その後で全エフェクトを実行
  commitPassiveMountEffects(fiber)
}
```

なぜクリーンアップを先に全部実行するか？

```
コンポーネントA: useEffect cleanup → useEffect
コンポーネントB: useEffect cleanup → useEffect
```

もし A の cleanup → A の effect → B の cleanup → B の effect という順で実行すると、A のエフェクトが B のクリーンアップより先に実行されてしまう。先に全クリーンアップを実行することで、エフェクト実行時点では全コンポーネントがクリーンな状態になる。

## 6.8 最小カウンターデモ

```typescript
// useState実装前のシンプル版
import { createRoot } from './src/workLoop'
import { createElement } from './src/createElement'

let count = 0
const root = createRoot(document.getElementById('root')!)

function App() {
  return createElement('div', null,
    createElement('p', null, String(count)),
    createElement('button', {
      onClick: () => {
        count++
        root.render(createElement(App as any, null))
      }
    }, '+')
  )
}

root.render(createElement(App as any, null))
```

ボタンをクリックするたびに `root.render()` を呼んでいる。Fiberの差分検出により、変更のあった `p` のテキストのみが更新される。

> **コラム: useLayoutEffect**
>
> `useLayoutEffect` は commit phase の Mutation 直後（ペイント前）に**同期で**実行される。
>
> 用途: DOMの計測（要素の高さなど）後にDOMを変更する場合。`useEffect` だとペイント後のため、ちらつきが起きる。
>
> ```typescript
> useLayoutEffect(() => {
>   const height = ref.current.getBoundingClientRect().height
>   // この変更はペイント前に反映される
>   setHeight(height)
> }, [])
> ```
>
> 本書では実装しないが、commit phaseのコードに追加するのはシンプルだ。
> `commitMutationEffects` の直後、`root.current = wipRoot` の後に実行する。

## まとめ

**解決できたこと：**
- render phaseで検出した差分を安全にDOMに適用できる
- useEffectをペイント後に非同期実行できる

**まだ解決できていないこと：**
- コンポーネントが状態を持てない（useStateがない）

---

**次章への問い：** 状態管理のために `useState` が必要だ。しかし「条件分岐の中でHooksを使えない」のはなぜか？その技術的根拠を実装から理解しよう。
