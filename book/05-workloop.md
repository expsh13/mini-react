# 第5章: 差分を検出し、ツリーを更新する — ワークループとReconciliation

## 5.1 ワークループの全体像

render phaseのエントリーポイントは `scheduleUpdateOnFiber()` だ。

```
scheduleUpdateOnFiber()
  ↓
requestIdleCallback(workLoop)
  ↓
workLoop(deadline)
  ├── performUnitOfWork(fiber) × n回
  │     ├── beginWork(fiber)    → 子Fiberを作成
  │     └── completeWork(fiber) → DOMノードを作成
  └── 完了したら commitRoot() を呼ぶ
```

## 5.2 requestIdleCallback について

本書ではスケジューリングに `requestIdleCallback` を使用する。

```typescript
function scheduleUpdateOnFiber(fiber: Fiber): void {
  // ... WIPツリーを準備 ...
  requestIdleCallback(workLoop)
}

function workLoop(deadline: IdleDeadline): void {
  let shouldYield = false
  while (nextUnitOfWork !== null && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork)
    shouldYield = deadline.timeRemaining() < 1
  }
  if (nextUnitOfWork === null && wipRoot !== null) {
    commitRoot(wipRoot, deletions)
  }
}
```

**ただし重要な注意点：**

`requestIdleCallback` は「暇なときに実行」であり、真の中断・再開ではない。Reactチームが却下した理由：
- **タイムスライスの不適合**：idle callbackは最大約50msの遅延で低優先度実行されるため、Reactが必要とする予測可能な約5msタイムスライスに不適
- **Safariのサポート不足**（長期間未実装）
- **スケジューラ制御不可**（いつ実行されるか制御できない）

本番Reactは `MessageChannel` でマクロタスクキューイングし、`shouldYield()` 関数で「残り時間があるか」を判定して中断する（タイムスライスは約5ms）。

本書では「Fiberの構造がなぜ中断可能なのかを理解する」目的で近似実装として使用する。

## 5.3 performUnitOfWork

```typescript
function performUnitOfWork(fiber: Fiber): Fiber | null {
  // 1. beginWork: このFiberの子を作成
  beginWork(fiber)

  // 2. 子があれば子を次の作業単位にする
  if (fiber.child) return fiber.child

  // 3. 子がなければcompleteWorkして次を探す
  let current: Fiber | null = fiber
  while (current) {
    completeWork(current)
    if (current.sibling) return current.sibling
    current = current.return
  }
  return null
}
```

このDFS走査がFiberアーキテクチャの核心だ。スタックの代わりに `child / sibling / return` ポインタを使ってトラバースするため、途中で中断して `nextUnitOfWork` に現在位置を保存し、後で再開できる。

## 5.4 beginWork

```typescript
function beginWork(fiber: Fiber): void {
  switch (fiber.tag) {
    case FunctionComponent:
      updateFunctionComponent(fiber)
      break
    case HostRoot:
      updateHostRoot(fiber)
      break
    case HostComponent:
      updateHostComponent(fiber)
      break
    case HostText:
      break // 子を持たないのでbeginWorkは何もしない
  }
}

function updateFunctionComponent(fiber: Fiber): void {
  if (fiber.type === Fragment) {
    // FragmentはDOMを生成しない
    reconcileChildren(fiber, fiber.pendingProps.children || [])
    return
  }
  // Hooksディスパッチャをセット
  prepareToRenderHooks(fiber)
  // コンポーネント関数を実行
  const children = (fiber.type as Function)(fiber.pendingProps)
  reconcileChildren(fiber, children ? [children] : [])
}
```

## 5.5 reconcileChildren — 差分検出の核心

> **教育的簡略化**: 本番Reactのreconciliationは2パス方式だ。(1) 先頭から順に線形スキャンし、keyまたはインデックスが一致しなくなった時点で中断 (2) 残りをMapに入れて照合する。本書では理解しやすさを優先して、最初からMap照合のみで実装している。

```typescript
function reconcileChildren(wipFiber: Fiber, elements: (VNode | string | number)[]): void {
  // keyによる既存Fiberのマップを構築
  const existingFibers = new Map<string | number, Fiber>()
  let temp = wipFiber.alternate?.child ?? null
  let tempIdx = 0
  while (temp) {
    const key = temp.key !== null ? temp.key : tempIdx
    existingFibers.set(key, temp)
    temp = temp.sibling
    tempIdx++
  }

  let lastPlacedIndex = 0
  // 新しい要素リストをイテレート
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    const matchedFiber = existingFibers.get(getKey(element, i))
    existingFibers.delete(getKey(element, i))

    let newFiber: Fiber

    if (matchedFiber && canReuse(matchedFiber, element)) {
      // 再利用: Update フラグ
      newFiber = reuseFiber(matchedFiber, element)
      if (matchedFiber.index < lastPlacedIndex) {
        newFiber.flags |= Placement  // 移動が必要
      } else {
        lastPlacedIndex = matchedFiber.index
      }
    } else {
      // 新規: Placement フラグ
      newFiber = createFiberFromElement(element, i)
      newFiber.flags |= Placement

      // keyは一致したが型が異なる場合、古いFiberを削除
      if (matchedFiber) {
        deletions.push(matchedFiber)
      }
    }
    // ... ポインタを繋ぐ
  }

> **注意**: 本書の実装では再利用時に常に Update フラグをセットしている。本番 React では `pendingProps` と `memoizedProps` の shallow compare を行い、変更がなければ Update をスキップする（bailout）。これが第4章で解説した `pendingProps` / `memoizedProps` が2つ存在する理由の1つだ。

  // 残った既存Fiberは削除
  existingFibers.forEach((fiber) => {
    deletions.push(fiber)
  })
}
```

### lastPlacedIndex の概念

keyが重要な理由はここにある。`[A,B,C,D] → [D,A,B,C]` の並び替えを考えよう。

**keyなし（インデックスベース）の場合：**

```
旧: A(0) B(1) C(2) D(3)
新: D(0) A(1) B(2) C(3)

インデックスで照合すると:
  0番目: A → D （型が違えば削除して新規作成）
  1番目: B → A （同様）
  ...全部作り直し
```

**keyありの場合：**

```
旧: A(key=a,idx=0) B(key=b,idx=1) C(key=c,idx=2) D(key=d,idx=3)
新: D A B C

処理:
  D(key=d, 旧idx=3): lastPlacedIndex=0, 3>=0 → 移動不要, lastPlacedIndex=3
  A(key=a, 旧idx=0): lastPlacedIndex=3, 0<3  → 移動が必要(Placement)
  B(key=b, 旧idx=1): lastPlacedIndex=3, 1<3  → 移動が必要(Placement)
  C(key=c, 旧idx=2): lastPlacedIndex=3, 2<3  → 移動が必要(Placement)
```

トレース表にまとめると、各ステップの判定が明確になる:

| ステップ | 要素 | key | 旧index | lastPlacedIndex | 判定 | フラグ | 更新後 |
|---------|------|-----|---------|----------------|------|--------|--------|
| 1 | D | d | 3 | 0 | 3 >= 0 | なし | 3 |
| 2 | A | a | 0 | 3 | 0 < 3 | Placement | 3 |
| 3 | B | b | 1 | 3 | 1 < 3 | Placement | 3 |
| 4 | C | c | 2 | 3 | 2 < 3 | Placement | 3 |

「Dを前に動かす」ではなく「A,B,CをDの後ろに動かす」という判断になる。DOMの操作回数は同じだが、Dの既存DOMノードを再利用できる。

### 本書の設計選択

**keyがある場合はkeyで照合し、ない場合はインデックスをkeyとして使用：**

本番Reactと同様に、keyが指定されている場合はkeyで照合し、keyがない場合はインデックスをkeyとして使用する。これにより、keyなしの要素でも位置ベースでの照合が可能になる。

**effectList vs subtreeFlags：**

React 17以前は `effectList`（副作用あるFiber全体のリンクリスト）をたどる方式だった。React 18以降は `subtreeFlags`（各FiberにBitORで子孫フラグを集約）に移行し、変更なしのサブツリーをスキップできるようになった。本書は教育目的でシンプルなサブツリートラバーサルを採用する。

## 5.6 バッチ更新のスコープ

本書の実装は「偶発的バッチ」だ。`requestIdleCallback` のコールバック1回の中で複数の `setState` が発生した場合、それらはまとめて処理される。

これはReact 18の Automatic Batching とは異なる：

```typescript
// React 18: createRoot使用時、全コンテキストで自動バッチ
setTimeout(() => {
  setCount(c => c + 1)  // これらは
  setFlag(f => !f)      // 1回のレンダリングにまとめられる（React 18）
}, 1000)
```

本番ReactはSchedulerとの統合により、`ensureRootIsScheduled` の再利用でバッチを実現している。

## まとめ

**解決できたこと：**
- requestIdleCallbackでフレームを跨いだ処理ができる
- key照合で効率的な差分検出ができる
- lastPlacedIndexでDOMの再利用を最大化できる

**まだ解決できていないこと：**
- render phaseで検出した差分をDOMに適用する方法

### 演習問題

**Q**: `[A, B, C]` → `[C, A]` の並び替えで、reconciliation はどのような差分を出力するか？各要素にkey `a`, `b`, `c` が付いているとして、lastPlacedIndex の変化を追ってみよう。

ヒント: C(旧idx=2) → lastPlacedIndex=2、A(旧idx=0) → 0 < 2 なので Placement。B は existingFibers に残るので Deletion。

---

**次章への問い：** `flags` で検出した差分を、どう安全にDOMに反映するか？なぜこのフェーズは中断できないのか？
