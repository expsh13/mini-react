# 第4章: UIを「中断できる」とはどういうことか — Fiberの概念

## 4.1 ブラウザの16msフレームバジェット

ブラウザは1秒間に60回画面を更新しようとする（60fps）。1フレームは約16.7ms。この間にJavaScriptの実行・スタイル計算・レイアウト・描画をすべて終わらせなければならない。

JavaScriptの実行が16msを超えると、フレームが落ちる。フレームが落ちると、アニメーションがカクつき、インタラクションが遅延する。

**問題**：再帰レンダラはJavaScriptの実行を1つのコールスタックで一気に行うため、大きなツリーでは16msを超えてしまう。

**解決策**：処理を小さな単位に分割して、フレームの合間にそれぞれ実行する。

## 4.2 Fiberとは何か

**Fiber**はReact 16で導入されたデータ構造で、1つのコンポーネントに対応する「作業単位」だ。

再帰レンダラは「今どこにいるか」をコールスタック（暗黙の状態）に保持していた。Fiberはそれをヒープ上のオブジェクト（明示的な状態）に移した。

```
再帰レンダラ:           Fiberアーキテクチャ:
callStack:             ヒープ上のオブジェクト:
  render(A)             Fiber A ←→ Fiber B
    render(B)             ↑
      render(C)         Fiber C
        ...

止められない            いつでも中断・再開できる
```

## 4.3 Fiberの全フィールド

```typescript
// src/types.ts

type Fiber = {
  // ① Fiberの種類
  tag: WorkTag  // FunctionComponent=0, HostRoot=3, HostComponent=5, HostText=6

  // ② このFiberが表すコンポーネント
  type: string | Function | symbol | null
  //   'div', 'span'  → HostComponent
  //   () => JSX      → FunctionComponent
  //   Fragment symbol → Fragment
  //   null           → HostRoot

  // ③ reconciliation用のkey
  key: string | null

  // ④ props（2つある理由は後述）
  pendingProps: Props   // beginWork開始時にセット（これから処理するprops）
  memoizedProps: Props  // completeWork完了時に確定（前回の確定済みprops）

  // ⑤ DOMノードへの参照
  stateNode: HTMLElement | Text | FiberRoot | null
  //   HostComponent  → HTMLElement
  //   HostText       → Text
  //   HostRoot       → FiberRoot
  //   FunctionComponent → null

  // ⑥ ツリー構造（3つのポインタ）
  return: Fiber | null   // 処理完了後に戻る先（parentではない）
  child: Fiber | null    // 最初の子
  sibling: Fiber | null  // 次の兄弟

  // ⑦ ダブルバッファリング
  alternate: Fiber | null

  // ⑧ 変更フラグ
  flags: Flags  // Placement=1, Update=2, Deletion=4, Passive=8
  // ※ ビット値は教育用に簡略化。本番ReactではPlacement=2, Update=4, Passive=256等
  //   ビット位置が異なり、DeletionはChildDeletionとして親Fiberに設定される。
  subtreeFlags: Flags  // 子孫のflagsをBitORで集約（変更なしサブツリーのスキップに使用）

  // ⑨ 兄弟間でのインデックス（reconciliationのlastPlacedIndex計算で使用 → Ch05）
  index: number

  // ⑩ Hooksの状態（→ Ch07で詳説）
  memoizedState: Hook | null    // Hookリンクリストの先頭（→ Ch07で詳説）
  updateQueue: FunctionComponentUpdateQueue | null  // Effectリンクリスト（→ Ch08で詳説）
}
```

### `return` vs `parent`

なぜ `parent` と呼ばないか。**コールスタックの「return先」**というセマンティクスを保持するためだ。

「処理が完了したら、どのFiberに処理を戻すか」という意味合いがある。FunctionComponent の処理が完了したら、その親（HostComponent）に処理が戻る。これはまさにコールスタックの動きと同じだ。

### `pendingProps` vs `memoizedProps`

```
beginWork開始時:
  fiber.pendingProps = 新しいprops（これから使う）

completeWork完了時:
  fiber.memoizedProps = fiber.pendingProps（確定した）
```

この2つがあることで「前回のpropsと今回のpropsを比較して、変更がなければスキップ（bailout）する」最適化が可能になる。

### `tag`（WorkTag）

なぜ `typeof type === 'string'` でHostComponentを判別しないか？

```typescript
// NG: 毎回typeof比較が必要
if (typeof fiber.type === 'string') { /* HostComponent */ }

// OK: 整数比較は高速
if (fiber.tag === HostComponent) { /* HostComponent */ }
```

WorkTagは整数定数で、型判別を高速に行える。特に `HostText`（テキストノード）は `type` が `null` になるため、`tag` で判別する必要がある。

## 4.4 ツリー構造：child/sibling/returnポインタ

次のコンポーネントツリーを例に、Fiberのポインタ構造を追ってみよう。

```jsx
<div>
  <h1>Title</h1>
  <p>Content</p>
</div>
```

**ステップ1: 最初の状態**

```
[div]
```

**ステップ2: div の child を接続**

```
[div]
  ↓ child
[h1]
```

**ステップ3: h1 の sibling（p）を接続**

```
[div]
  ↓ child
[h1] → [p]
  sibling
```

**ステップ4: return ポインタを設定**

```
[div]
  ↓ child
[h1] →sibling→ [p]
 ↑                ↑
 return           return
 └────────────────┘
       (どちらも div を指す)
```

**DFSトラバースの順序：**

```
1. div（beginWork）
2. h1（beginWork）
3. h1（completeWork）← 子がないのでcompleteへ
4. p（beginWork）    ← h1のsibling
5. p（completeWork）← 子がないのでcompleteへ
6. div（completeWork）← returnを辿ってdivへ
```

## 4.5 FiberRoot と root Fiber

重要な設計：**FiberRoot と root Fiber は別オブジェクト**だ。

```
createRoot(container) が作るもの:

FiberRoot {              root Fiber {
  container: <div>,        tag: HostRoot,
  current: → ─────────→   stateNode: → ←── FiberRoot
  finishedWork: null     }
}
```

`FiberRoot.current` → current ツリーの root Fiber
`root Fiber.stateNode` → FiberRoot（ループ）

この設計により、`createRoot()` を複数回呼んで複数のReactアプリを同一ページで動かすことができる。

## 4.6 ダブルバッファリング

Reactはツリーを2つ保持する。

```
current tree         workInProgress tree
（画面に表示中）      （構築中）

Fiber A ←alternate→ Fiber A'
  ↓ child               ↓ child
Fiber B ←alternate→ Fiber B'
```

render phase は workInProgress tree を構築する。commit phase が完了したら `root.current = wipRoot` で current が入れ替わる。

このため：
- render phase中は current tree が安定した状態を保つ
- commit は「一瞬で」current が切り替わる（アトミックな更新）

## 4.7 実装

```typescript
// src/fiber.ts

export function createFiber(tag, type, pendingProps, key = null): Fiber {
  return {
    tag, type, key,
    pendingProps,
    memoizedProps: {},
    stateNode: null,
    return: null, child: null, sibling: null,
    alternate: null,
    flags: NoFlags, subtreeFlags: NoFlags,
    memoizedState: null, updateQueue: null,
    index: 0,
  }
}

// ダブルバッファリング: workInProgress Fiber を作成
export function createWorkInProgress(current: Fiber, pendingProps: Props): Fiber {
  let wip = current.alternate
  if (wip === null) {
    // 初回: 新規作成してalternateで接続
    wip = createFiber(current.tag, current.type, pendingProps, current.key)
    wip.stateNode = current.stateNode
    wip.alternate = current
    current.alternate = wip
  } else {
    // 2回目以降: 再利用（メモリ効率化）
    wip.pendingProps = pendingProps
    wip.type = current.type
    wip.flags = NoFlags
    wip.subtreeFlags = NoFlags
    wip.child = null
    wip.updateQueue = null
  }
  // currentの情報を引き継ぐ
  wip.memoizedProps = current.memoizedProps
  wip.memoizedState = current.memoizedState
  wip.index = current.index
  return wip
}
```

## 4.8 章末デモ

```typescript
import { createFiberRoot } from './src/fiber'
import { HostComponent, HostText } from './src/types'

const root = createFiberRoot(document.getElementById('root')!)

// 手動でFiberツリーを構築してトラバース
const div = createFiber(HostComponent, 'div', {})
const text = createFiber(HostText, null, { nodeValue: 'Hello' })

div.child = text
text.return = div

// DFSトラバース
let node: Fiber | null = div
while (node) {
  console.log(`visit: ${node.type ?? 'text'}`)
  if (node.child) { node = node.child; continue }
  while (node) {
    console.log(`complete: ${node.type ?? 'text'}`)
    if (node.sibling) { node = node.sibling; break }
    node = node.return
  }
}
// visit: div
// visit: text
// complete: text
// complete: div
```

## まとめ

**解決できたこと：**
- 処理を中断・再開可能なデータ構造（Fiber）を定義した
- ダブルバッファリングの仕組みを実装した

**まだ解決できていないこと：**
- ワークループ（実際に中断しながらFiberを処理する仕組み）
- reconciliation（差分検出）

### 演習問題

**Q**: 以下のFiberツリーを手動で構築し、DFSトラバースの順序（beginWork/completeWorkの呼び出し順）を予測してみよう。

```jsx
<div>
  <p>Hello</p>
  <span>World</span>
</div>
```

ヒント: `div → p → "Hello" → "Hello"(complete) → p(complete) → span → "World" → ...` の順で進む。

---

**次章への問い：** このFiberツリーを実際に走査して、差分を検出するにはどうすればいいか？
