# 第1章: Reactは何を「している」のか

## 1.1 最初に全体像を把握する

コードを書く前に、地図を手に入れよう。

Reactがやっていることを一言で言うと：**「コンポーネントの状態からDOMを作り、状態が変わったらDOMを更新する」**だ。

しかし「どうやって」という部分が重要だ。単純にやれば毎回全部作り直せばいい。Reactがそうしないのは理由がある。

## 1.2 全体アーキテクチャ

本書で実装するコンポーネントの全体像を示す。

```
ユーザーが書くコード
  ↓ JSX (トランスパイル)
createElement() → React elements (VNode)
  ↓
┌─────────────────────────────────────────┐
│            render phase                 │
│  createRoot() / scheduleUpdateOnFiber() │
│    ↓                                    │
│  workLoop (requestIdleCallback)         │
│    ↓                                    │
│  beginWork / completeWork              │
│    ↓                                    │
│  reconcileChildren (差分検出)           │
│    flags: Placement / Update / Deletion │
└─────────────────────────────────────────┘
  ↓ (中断不可)
┌─────────────────────────────────────────┐
│            commit phase                 │
│  Phase 1: Mutation (DOM変更)            │
│    commitDeletion / commitPlacement     │
│    commitUpdate                         │
│  ★ root.current = finishedWork 切替    │
│  Phase 2: Passive Effects              │
│    useEffect cleanup → useEffect run    │
└─────────────────────────────────────────┘
  ↓
DOM更新完了・画面に表示
```

## 1.3 2つのフェーズ

Reactの処理は **render phase** と **commit phase** の2フェーズに分かれている。

### render phase（レンダーフェーズ）

- Fiberツリーを構築・更新する
- 差分（変更が必要な場所）を検出してフラグを立てる
- **中断可能**：処理を途中で止めて、後で再開できる
- DOMには一切触れない（副作用なし）

### commit phase（コミットフェーズ）

- render phaseが検出した差分をDOMに適用する
- **中断不可**：途中で止まると、ユーザーに壊れたUIが見える
- `useEffect` の実行もここで管理する

> **コラム: "3フェーズ"という誤解**
>
> ブログ記事などで「render → reconcile → commit の3フェーズ」と説明されることがある。しかしReact公式ドキュメントでは一貫して **render phase と commit phase の2フェーズ**として説明している。reconciliation（差分検出）は render phase の一部であり、独立したフェーズではない。

## 1.4 Fiberアーキテクチャとは

### 問題：再帰は止められない

React 16以前は「Stack Reconciler」という再帰的な仕組みでレンダリングしていた。コンポーネントのツリーを `render(App)` → `render(Header)` → `render(Nav)` → ... と関数呼び出しを積み重ねながら処理していた。

この方法の致命的な問題は**「途中で止められない」**ことだ。

ブラウザは60fps（1フレーム約16ms）で画面を更新する。JavaScriptがその16msを超えて実行し続けると、画面の更新が待たされてアニメーションがカクつく。コンポーネントが数百個あると、再帰処理全体で16msを超えることは珍しくない。しかし関数の呼び出しが途中まで積み重なったコールスタックは、すべて処理し終わるまで手放せない。

```
【Stack Reconcilerの問題】

render(App)
  render(Header)         ← ここで 5ms 経過
    render(Nav)
      render(MenuItem × 100)   ← 合計で 25ms かかる！
        ...
                         ← しかし止められない
```

### 解決：「どこまでやったか」を記録する

React 16でFiberアーキテクチャに移行した。発想の転換はシンプルだ。

**「処理の途中経過をコールスタック（暗黙）ではなく、ヒープ上のオブジェクト（明示）に保持する」**

**Fiber**はコンポーネント1つに対応するオブジェクトで、「次に何をすべきか」という情報を自分自身が持つ「作業単位」だ。

```
【Fiberアーキテクチャ】

Fiber(App) ──child──▶ Fiber(Header) ──child──▶ Fiber(Nav)
                ▲          │                        │
                └──return──┘         ◀──return──────┘

↑ ヒープ上のオブジェクトなので、
  「Header まで処理した」という状態を保持したまま一時停止できる
```

ポイントは、このリンク構造がコールスタックと同じ「どこにいるか」の情報を持ちつつ、いつでも中断・再開できることだ。処理を止めてブラウザに制御を返し、次のフレームで続きから再開できる。

> Fiberの全フィールドとツリー構造の詳細は**第4章**で実装しながら解説する。

## 1.5 本書の実装範囲

本書が実装する機能：

| 機能 | 章 |
|---|---|
| `createElement` (JSX変換) | 第2章 |
| 再帰レンダラ（歴史的実装） | 第3章 |
| Fiberデータ構造 | 第4章 |
| ワークループ + Reconciliation | 第5章 |
| コミットフェーズ | 第6章 |
| `useState` + `useRef` | 第7章 |
| `useEffect` | 第8章 |
| 統合（ストップウォッチ） | 第9章 |

**意図的に省略する機能：**

- Lanes（優先度）システム
- Concurrent Mode（`startTransition`、`Suspense`）
- `useLayoutEffect`（コラムで解説）
- Context / Portal
- Server Components

省略するのは「難しいから」ではない。Fiberの本質的な仕組みを理解するには不要だからだ。本書を読み終えた後、これらの機能がどう実装されているかは、自分でソースコードを読んで理解できるようになる。

## 1.6 本書の位置づけ：React 18

本書はReact 18の内部実装を対象とする。`createRoot()` を主APIとして実装し、Fiberアーキテクチャの全体像を学ぶ。

- **React 16-17 Legacy Mode**（`ReactDOM.render()`）との違いは第3章で触れる
- **React 19**でもFiberの基盤は同じ。`use()` hookや `ref as prop` などの変更点は第9章で解説する

## 用語集

| 用語 | 意味 |
|---|---|
| React elements | `createElement()` の戻り値。JSXがトランスパイルされた結果 |
| Fiber | 作業単位のオブジェクト。コンポーネント1つに対応 |
| render phase | Fiberツリーを構築・差分検出するフェーズ（中断可能） |
| commit phase | DOMに変更を適用するフェーズ（中断不可） |
| reconciliation | 新旧Fiberツリーを比較して差分を検出すること |
| workInProgress tree | 構築中のFiberツリー |
| current tree | 現在画面に表示されているFiberツリー |
| FiberRoot | `createRoot()` が作るルートオブジェクト |

---

**次章への問い：** JSXはどのようにしてReact elementsに変換されるのか？ `<div className="foo">Hello</div>` の正体を見ていこう。
