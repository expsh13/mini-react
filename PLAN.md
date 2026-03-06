# ミニReact本 最終実装プラン（エージェントチームレビュー済み）

## Context

対象: React・TypeScript を理解済みの中級者。Reactの内部実装を自作することで仕組みを理解したい。
方針: 最小限の実装・最大限の全体像理解。世に公開するため技術的正確性を最優先。
**対象Reactバージョン**: React 18ベース（`createRoot()` を主APIとして使用。Lanesなしの簡略版Concurrent Mode基盤）。React 19でもFiberの基盤は同じ。

---

## 技術的に正確な用語・概念

| 使用する用語 | 避ける誤った表現 | 理由 |
|---|---|---|
| React elements | Virtual DOM | React公式は"Virtual DOM"を推奨しない |
| render phase / commit phase | render / reconcile / commit（3つ） | Reactの公式は2フェーズ |
| fiber tree（連結リスト構造の木） | "linked list"のみ | 正確にはchild/sibling/returnポインタによる木構造 |
| MessageChannel（本番React） | requestIdleCallback | Reactは後者を使用しない（Safariサポート不足・スケジューラ制御不可のため却下。本書では教育用として使用） |
| `flags`（ビットフラグ） | `effectTag`（単一値） | 複数エフェクトを同時表現するため |
| `return`（Fiberフィールド） | `parent` | 「コールスタックのreturn先」というセマンティクスが重要 |
| `stateNode` | `dom` | React本体と一致、FiberRootも指せる |
| `tag`（WorkTag） | `type`による種類判別 | HostText/HostComponentの明確な区別 |

---

## ディレクトリ構成（修正版）

```
mini-react/
├── package.json
├── tsconfig.json
├── jest.config.ts
├── jest.setup.ts          ★ requestIdleCallbackモックをここで定義
├── README.md
│
├── src/
│   ├── index.ts              # パブリックAPI（namespace exportで MiniReact.createElement）
│   ├── types.ts              # 共有型定義（下記参照）
│   ├── createElement.ts      # 第2章: JSX → React elements
│   ├── render.ts             # 第3章: 再帰レンダラ（暫定実装・歴史的Legacy APIとして位置づけ）
│   ├── fiber.ts              # 第4章: Fiberデータ構造とファクトリ
│   ├── workLoop.ts           # 第5章: reconcileChildren含む全ワークループ（Fragment対応）
│   ├── commit.ts             # 第6章: コミットフェーズ（2サブフェーズ）
│   ├── hooksDispatcher.ts    # 第7章: currentlyRenderingFiber、Dispatcher切り替え
│   ├── hooks/
│   │   ├── useState.ts       # 第7章: renderフェーズのstate管理（mount/update分岐）
│   │   ├── useRef.ts         # 第7章: ★必須追加。リンクリストの仕組みを最小コストで示す
│   │   └── useEffect.ts      # 第8章: ペイント後の副作用管理
│   └── dom/
│       └── domOperations.ts  # DOMヘルパー（イベント委譲含む）★必須
│
├── tests/
│   ├── createElement.test.ts
│   ├── render.test.ts
│   ├── workLoop.test.ts
│   ├── commit.test.ts
│   ├── useState.test.ts
│   └── useEffect.test.ts
│
└── book/
    ├── 00-preface.md
    ├── 01-introduction.md
    ├── 02-react-elements.md      # （"Virtual DOM"ではなく"React elements"）
    ├── 03-naive-rendering.md
    ├── 04-fiber-concept.md       # ★ 第4章を2章に分割（概念と実装）
    ├── 05-workloop.md            # ★ 新設: ワークループ + reconciliation
    ├── 06-commit.md
    ├── 07-usestate.md
    ├── 08-useeffect.md
    └── 09-putting-it-together.md
```

---

## 型定義（修正版）

```typescript
// src/types.ts

// WorkTag: Fiberの種類を判別する定数
const FunctionComponent = 2  // ★ React本体と一致（0は誤り）
const HostRoot          = 3  // createRootで作られるルート
const HostComponent     = 5  // div, span などDOM要素
const HostText          = 6  // テキストノード

// ビットフラグ設計（単一値ではなく複数エフェクトを同時表現可能）
const Placement  = 0b00001  // 1
const Update     = 0b00010  // 2
const Deletion   = 0b00100  // 4
const Passive    = 0b01000  // 8  ← useEffect用
type Flags = number

// ★ FiberRoot と root Fiber は別オブジェクト（重要な設計）
// FiberRoot.current → current ツリーの root Fiber
type FiberRoot = {
  container: HTMLElement        // マウント先のDOM
  current: Fiber                // currentツリーのrootファイバー
  finishedWork: Fiber | null    // commitを待つ完成済みWIPルート
}

type Fiber = {
  tag: number              // ★ WorkTag（FunctionComponent/HostComponent/HostText/HostRoot）
  type: string | Function | null
  key: string | null       // reconciliation用
  pendingProps: Props      // ★ beginWork開始時にセット（処理しようとしているprops）
  memoizedProps: Props     // ★ completeWork完了時にpendingPropsから昇格（前回の確定props）
  stateNode: HTMLElement | Text | FiberRoot | null  // ★ domではなくstateNode（React本体と一致）
  return: Fiber | null     // ★ parentは使わない。「処理完了後に戻る先」というセマンティクス
  child: Fiber | null
  sibling: Fiber | null
  alternate: Fiber | null  // ダブルバッファリング用
  flags: Flags             // ★ effectTagからflagsに変更（ビットフラグ）
  memoizedState: Hook | null  // ★ フックのリンクリストの先頭（配列ではない）
  updateQueue: FunctionComponentUpdateQueue | null  // ★ Effectリンクリスト
}

// ★ Hookはリンクリスト構造（配列ではない）
// これがRules of Hooksの技術的根拠になる
type Hook = {
  memoizedState: any         // useState: state値、useEffect: Effectオブジェクト
  baseState: any             // ★ 本書では memoizedState と同値だが省略しない（本番Reactとの対応性のため）
  // 本番Reactでは優先度スキップ時の再計算起点として baseState が必要。本書はLanes省略のため常に memoizedState === baseState
  queue: UpdateQueue | null  // ★ UpdateQueueを別型に分離
  next: Hook | null          // ★ 次のHookへのポインタ（リンクリストの核心）
}

// ★ UpdateQueueは教育目的の簡略版
// 本番Reactでは lastRenderedReducer/lastRenderedState（eager bailout用）も持つ
type UpdateQueue = {
  pending: Update | null  // ★ 実際は循環リンクリスト（最後のupdateが先頭を指す）
  dispatch: ((action: any) => void) | null
  lastRenderedState: any  // ★ eager bailout用（dispatchSetState内でObject.is比較）
}

// ★ HookEffectタグ（ビットフラグ）
// HookHasEffect がないと Effect がスキップされる（depsが変化した場合のみセット）
const HookNoFlags   = 0b000
const HookHasEffect = 0b001  // 今回実行すべきエフェクトに立てる（depsが変化した場合のみ）
const HookLayout    = 0b010  // useLayoutEffect（本書実装では省略、コラムで説明）
const HookPassive   = 0b100  // useEffect
// Effect.tag の組み合わせ例:
//   HookPassive | HookHasEffect → 実行すべきuseEffect
//   HookPassive（HookHasEffectなし）→ depsが同一、スキップ

type Effect = {
  tag: number              // ★ HookHasEffect | HookPassive などビットフラグ
  create: () => void | (() => void)
  destroy: (() => void) | null    // ★ クリーンアップ関数の保持場所
  deps: any[] | null
  next: Effect | null
}

// ★ Effectリンクリストは Fiber.updateQueue に格納（Hook リンクリストとは別）
// Fiber.memoizedState → Hookリンクリスト
// Fiber.updateQueue  → Effectリンクリスト（FunctionComponentのみ）
```

---

## workLoop.ts の主要関数（修正版）

```typescript
// 必須関数一覧
performUnitOfWork(fiber: Fiber): Fiber | null
beginWork(fiber: Fiber): void
  ├── updateFunctionComponent(fiber)  ★ setCurrentlyRenderingFiberを呼ぶ
  └── updateHostComponent(fiber)      ★ type===nullのrootファイバー特別処理
completeWork(fiber: Fiber): void
reconcileChildren(wipFiber: Fiber, elements: VNode[])  ★ 中心アルゴリズム
  ├── 新規ファイバー生成（Placement フラグ）
  ├── 既存ファイバー更新（Update フラグ）
  │   └── key による照合 → なければインデックスベース（keyの必要性を体感）
  └── 不要ファイバー削除（Deletionをdeletions[]に追加）

// モジュールレベルの状態
let nextUnitOfWork: Fiber | null = null
let wipRoot: Fiber | null = null
let currentRoot: Fiber | null = null
let deletions: Fiber[] = []   // 削除対象をここで管理
```

---

## commit.ts の構造（正確版）

commitは2サブフェーズに分ける：

```
commitRoot(wipRoot)
├── Phase 1: Mutation（DOM変更）
│   ├── useLayoutEffect クリーンアップ（★本物はここで実行）
│   ├── commitDeletion(deletions)  ★ deletions配列から削除
│   │   └── 子孫のuseEffectクリーンアップも実行（メモリリーク防止）
│   ├── commitPlacement(fiber)
│   └── commitUpdate(fiber)       ★ テキストノード更新も含む
├── ★ ここで root.current = finishedWork に切り替え
│   └── 【重要】Mutation後・Layout前（"Passive前"は不正確）
├── Phase 2: Layout（同期・ペイント前）★本書では実装省略
│   └── useLayoutEffect 新effect（コラムで説明）
└── Phase 3: Passive Effects（非同期、ペイント後）
    ├── commitHookEffectListUnmount（useEffectクリーンアップ実行）
    └── commitHookEffectListMount（新しいuseEffect実行）
```

注: 本書の実装では Layout フェーズを省略し `useEffect`（Passive）のみ実装する。`useLayoutEffect` はコラムで「Layout フェーズで同期実行される別のエフェクト」として解説。
注: `root.current` の切り替えは **Mutation後・Layout前** が正確（Layout Phase 内で `current === finishedWork` が必要なため）。

---

## hooksDispatcher.ts の設計（循環依存を防ぐ・Dispatcher切り替え対応版）

```typescript
// hooksDispatcher.ts（workLoop.tsに依存しない設計）
export let currentlyRenderingFiber: Fiber | null = null
export let workInProgressHook: Hook | null = null
export let currentHook: Hook | null = null  // ★ 更新時にcurrentツリーを走査するポインタ

// ★ Dispatcherオブジェクト切り替えパターン（React本体と同じ設計）
// isMount フラグより正確で、useStateの呼び出しが別の関数にルーティングされる様子を示せる
type Dispatcher = {
  useState: <S>(initialState: S | (() => S)) => [S, (action: S | ((s: S) => S)) => void]
  useEffect: (create: () => void | (() => void), deps?: any[]) => void
  useRef: <T>(initialValue: T) => { current: T }
}

// マウント時Dispatcher（初回レンダリング）
const mountDispatcher: Dispatcher = {
  useState: mountState,    // 新規Hookノード作成 → リストに追加
  useEffect: mountEffect,
  useRef: mountRef,
}

// 更新時Dispatcher（2回目以降のレンダリング）
const updateDispatcher: Dispatcher = {
  useState: updateState,   // currentツリーのHookを参照しながらWIPを更新
  useEffect: updateEffect,
  useRef: updateRef,
}

let currentDispatcher: Dispatcher | null = null

export function prepareToRenderHooks(fiber: Fiber) {
  currentlyRenderingFiber = fiber
  workInProgressHook = null
  currentHook = null
  // ★ alternateがある（前のrenderが存在する）= 更新時
  currentDispatcher = fiber.alternate === null ? mountDispatcher : updateDispatcher
}

// ユーザーが呼ぶ useState はDispatcherに委譲
export function useState<S>(initialState: S) {
  return currentDispatcher!.useState(initialState)
}

// ★ 2ポインタパターンの核心
function mountWorkInProgressHook(): Hook {
  const hook: Hook = { memoizedState: null, queue: null, next: null }
  if (workInProgressHook === null) {
    currentlyRenderingFiber!.memoizedState = workInProgressHook = hook
  } else {
    workInProgressHook = workInProgressHook.next = hook  // リスト末尾に追加
  }
  return workInProgressHook
}

function updateWorkInProgressHook(): Hook {
  // currentHook でcurrentツリーを走査
  currentHook = currentHook === null
    ? (currentlyRenderingFiber!.alternate!.memoizedState as Hook)
    : currentHook.next!
  // WIP側も同様に進める（省略）
  return workInProgressHook!
}

// 依存関係: workLoop.ts → hooksDispatcher.ts ← hooks/useState.ts
//                                              ← hooks/useEffect.ts
// workLoop.ts と hooks/ は hooksDispatcher.ts を通じて連携（循環なし）
```

> **第7章での教育的ポイント**: Dispatcherオブジェクトの切り替えにより、同じ `useState(0)` が `mountState` / `updateState` に別々にルーティングされる様子を示す。「同じ関数名なのに初回と2回目で全く別のコードが走る」という驚きがRulesの根拠になる。

---

## JSX設定（正確版）

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react",                           ★ この行が必須（プランに未記載）
    "jsxFactory": "MiniReact.createElement"
  }
}
```

各 `.tsx` ファイルでは **namespace import が必須**：

```typescript
import * as MiniReact from './index'   // ✓ 正しい
// import { createElement } from './index'  // ✗ MiniReactが未定義になる
```

---

## テスト設定（requestIdleCallbackモック）

```typescript
// jest.setup.ts（jest.config.tsで setupFilesAfterFramework に登録）
global.requestIdleCallback = (cb: IdleRequestCallback) => {
  cb({ timeRemaining: () => 50, didTimeout: false } as IdleDeadline)
  return 0
}
global.cancelIdleCallback = () => {}
// 注: テストでは同期実行になる（本番動作とは異なる）ことを書籍内で説明
```

---

## 章構成（9章）★ 4章を2章に分割

> 全体ナラティブ: 「壊れたものを作り、構造で直し、使えるものに仕上げる」3幕構造
> - 序盤（第1-3章）: 「動くが壊れている」
> - 中盤（第4-6章）: 「構造で解決する」
> - 終盤（第7-8章）: 「使えるものに仕上げる」

### 第1章: Reactは何を「している」のか
- まえがきで答える3つの問い: なぜ内部を知るのか / この本の独自性 / 読了後の変化
- **全体アーキテクチャマップ**（図）: 本書で実装する全コンポーネントの俯瞰図
- **2フェーズ**（render phase・commit phase）を最初に提示
- **★ React バージョンの位置づけ宣言（必須）**: 「本書はReact 18の内部実装を対象とする。`createRoot()` を主APIとして実装し、Fiberアーキテクチャの全体像を学ぶ。Concurrent ModeのフルサポートにはLanes（優先度）システムが必要だが、それは省略する。本書のFiber実装はReact 19でも同じ基盤の上に成り立っている」
- 本書が実装する機能と意図的に省略する機能を明示
- **章末**: 「500行でどこまで作れるか？まず動かすところから始めよう」

### 第2章: JSXはなぜ動くのか — createElement の秘密
`createElement.ts`, `types.ts`
- 「React elements」（"Virtual DOM"ではない）— 初出で「本書でVirtual DOMを使わない理由」を明示
- JSXトランスパイルの仕組み（`className` / `htmlFor` が存在する理由もここで触れる）
- `createElement` の実装
- **章末デモ**: `createElement` でHTMLを生成してconsole出力
- **章末**: 「要素を作れた。では画面にどう描くか？」

### 第3章: まず動かしてみる、そして壊れる
`render.ts`, `dom/domOperations.ts`（イベント委譲含む）
- **「Reactがまだ存在しなかった頃のアプローチ」として位置づけ**（Legacy `ReactDOM.render()` ではなく「再帰レンダラという素朴な発想」）
- DOM生成 + `onClick`等のイベント委譲（useStateのため必須）
- **失敗デモ**: 深いツリーで主スレッドがブロックされる様子を実際にブラウザで確認
- **`ReactDOM.render()` への言及（歴史的文脈）**: React 16-17のLegacy APIとして触れ、React 18で非推奨・React 19で廃止になった理由（Concurrent Modeと相容れない）を1段落で説明
- **章末デモ**: 再帰レンダラで静的なリストをDOMに描画
- **章末**: 「フレームを跨げない。どうすれば中断できるようになるのか？」（答えを明かさない）

### 第4章: UIを「中断できる」とはどういうことか — Fiberの概念
`fiber.ts`
- ブラウザの16msフレームバジェットの説明
- **なぜ再帰スタックでは中断できないか**（図解）
- **Fiber型の全フィールド解説**:
  - `tag`（WorkTag）: Fiberの種類。`typeof type === 'string'` より明確な判別
  - `return` vs `parent`: 「処理が完了したら *return* する先」というセマンティクス。コールスタックをFiberに写像した設計
  - `pendingProps` vs `memoizedProps`: beginWorkで使う予定のprops vs completeWorkで確定したprops。bailout最適化の基盤
  - `stateNode`: DOM要素（HostComponent）/ null（FunctionComponent）/ FiberRoot（HostRoot）
  - `updateQueue`: Effectリンクリスト（HookリンクリストのmemoizedStateとは別管理）
- **図解（必須）**: `child / sibling / return` ポインタのステップバイステップ図を3枚以上
- **`FiberRoot` と root `Fiber` の分離**（図）: `FiberRoot.current` → current ツリーの root Fiber
- current ツリー / workInProgress ツリー の双ツリー構造（図）
- **Fiberノードだけ実装**（ワークループはまだ書かない）
- **章末デモ**: FiberノードをconsoleでDFSトラバースする様子を確認
- **章末**: 「データ構造は整った。では実際にこれで何ができるか？」

### 第5章: 差分を検出し、ツリーを更新する — ワークループとReconciliation
`workLoop.ts`
- beginWork / completeWork の二段階処理
- **`reconcileChildren`**: Fiberツリー構築・差分検出の中心アルゴリズム
  - `key` による照合 → なければインデックスベース → **keyなし時の破綻を実装で体感**
  - `Object.is` ではなく参照比較での差分検出（ここでimmutabilityの必要性が見える）
  - **★ Fragment対応（必須）**: `tag === Fragment` のFiberはDOM要素を生成せず子を直接親に接続。`<></>` が使えないと現代のReactコードが書けない
  - **keyのみ照合（インデックスフォールバックなし）**: 省略を明記
  - **★ `lastPlacedIndex` の概念説明（必須）**: keyがDOMの再利用を増やす理由の核心
    - `[A,B,C,D] → [D,A,B,C]` 並び替え時に「Dを前に動かす」ではなく「A,B,Cを3回後ろに動かす」になる理由
    - keyなし実装の限界を示すことでkeyの価値を実感させる
- `deletions` 配列の役割（本書ではグローバル管理で簡略化。本物は各Fiberが自分の `deletions[]` と `ChildDeletion` フラグを持つ）
- **★ `effectList` vs `subtreeFlags` の選択を明示（必須）**:
  - React 16以前: `effectList`（副作用あるFiber全体のリンクリスト）
  - **React 17で廃止**・`subtreeFlags`を導入（各FiberがBitORで子のフラグを集約、変更なしサブツリーをスキップ）
  - React 18以降も `subtreeFlags` を継続使用（変更なし）
  - 本書は教育目的でシンプルなサブツリートラバーサルを採用し、その旨を明記
- **`requestIdleCallback` のスケジューリング**: 教育目的の近似実装として使用するが、概念的限界を正直に説明
  - `requestIdleCallback` は「暇なときに実行」であり、真の中断・再開（`shouldYield()`ベース）ではない
  - Reactチームが却下した理由: Safariでのサポート不足・スケジューラ制御不可（「約20fps」という数値は根拠が曖昧なため使用しない）
  - 本番Reactは `MessageChannel` でマクロタスクキューイングし、`shouldYield()` で中断判定する（タイムスライスは約5msだが入力イベント有無等で動的に変動）
  - 「完全なConcurrent Modeではないが、Fiberの構造がなぜ中断可能かを理解するには十分」
- **バッチ更新のスコープを明示（重要）**: 本書の実装は「偶発的バッチ」（requestIdleCallbackコールバック1回の中でまとめて処理）であり、Reactの本物のバッチ（Schedulerとの統合による `ensureRootIsScheduled` の再利用）とは異なることを明記
- **章末デモ**: `setTimeout(0)` でworkLoopを中断できることを体感
- **章末**: 「更新すべき差分はわかった。ではDOMをどう安全に変更するか？」

### 第6章: 画面は一気に変わらなければならない — commitフェーズ
`commit.ts`
- render phaseとcommit phaseの分離（**なぜcommitは割り込み不可か**: 部分更新をユーザーに見せないため）
- **2サブフェーズ**: Mutation（DOM変更）→ Passive Effects（useEffect）
- `deletions` 配列からのDOM削除（**子孫のクリーンアップも実行する**理由）
- `current = wipRoot` の切り替えタイミング（Mutation後・Passive前の理由）
- テキストノード更新の特別処理
- **イベント委譲**: Reactはすべてのイベントをrootに委譲する — `e.stopPropagation()` が効かないケースの解説
- **章末デモ**: ボタンクリックでDOMが更新される最小カウンター（useState前のシンプル版）
- **章末**: 「DOMを安全に更新できた。では状態はどこに持てばいいのか？」

### 第7章: なぜHooksには「ルール」があるのか — useState・useRefの実装から学ぶ
`hooksDispatcher.ts`, `hooks/useState.ts`, `hooks/useRef.ts`
- クラスコンポーネントの `this.setState` との比較（なぜHooksが生まれたか）
- `currentlyRenderingFiber` グローバルポインタ（なぜグローバルが必要か）
- **★ Dispatcher切り替えの核心（新規）**:
  - `isMount` フラグにより `useState` がマウント時（`mountState`）と更新時（`updateState`）で全く異なるコードパスを通ることを実装
  - `workInProgressHook`（wipツリー走査）と `currentHook`（currentツリー走査）の2ポインタ設計
  - 「同じ `useState(0)` が初回と2回目以降で別の関数を呼ぶ」という驚きがRulesの根拠になる
- **Hooksリンクリストのステップ実行演習**: `useState` を2回呼んだ場合のリスト構築を図で追う
  - マウント時（リスト構築: `mountWorkInProgressHook`）→ 更新時（同順序で走査: `updateWorkInProgressHook`）
  - **条件分岐内で呼んだ場合の破綻を実際にデバッガで追う演習（必須）**: リストの対応がズレて値が混在する様子を示す
- **★ `useRef` の実装（必須・最小コスト）**:
  - `mountRef`: `{ current: initialValue }` を作ってHookリンクリストに追加するだけ
  - `updateRef`: リンクリストから同じオブジェクトを返すだけ
  - 「なぜrefは再レンダリングを起こさないか」「なぜ参照が安定しているか」が実装から明確になる
  - useStateとuseRefが同じリンクリストの仕組みを共有していることを示す
- `Object.is` による同値比較でのbailout（同じ値をsetしても再レンダリングされない理由）
  - **Eager bailout**（dispatch時、スケジューリングすら行わない最安コスト）: `lastRenderedState` と比較
  - **Render phase bailout**（updateReducer内）: 新stateと旧stateを比較して子のre-renderをスキップ
  - 本書では簡略化のためEager bailoutを省略。「省略していること」を明記した上でrender phase bailoutのみ実装
- 更新キュー（pending循環リンクリスト）とre-renderのトリガー
  - `reconcileChildren` の key照合について: **keyのみ照合（インデックスフォールバックなし）** の方が教育的に正直
  - インデックスフォールバックは key混在時に意味が破壊される。「省略していること」を明記
- **★ React 18: Automatic Batchingの説明**:
  - React 17まで: `setTimeout`・`Promise.then` 内の複数 `setState` はバッチされず複数回レンダリングされた
  - React 18: `createRoot` 使用時、すべてのコンテキストで自動的にバッチされる
  - ただし `flushSync()` で明示的にバッチを破壊して同期レンダリングを強制可能
  - 本書の実装（Legacy Mode相当）での動作と比較して説明
- **Strict Modeの二重実行**: ワークインプログレスツリーを2回作ることでpure functionを検証する仕組み
- **コラム**: `useState` と `useReducer` の内部的等価性 — `useState` は `useReducer` の特殊ケースであることを示す（次の探求への入口）
- **章末デモ**: useState が動く最小カウンター
- **章末**: 「状態を持てた。では外の世界（タイマー、APIなど）とはどうつなぐか？」

### 第8章: レンダーの「後」に何が起きるか — useEffectの本質
`hooks/useEffect.ts`
- **useEffect = 非同期（ペイント後）**、useLayoutEffect = 同期（コミット中）の違い（図解）
- 第6章のPassive Effectsサブフェーズとの接続
- 依存配列の比較（`areHookInputsEqual` の実装）
  - **`Object.is` を使う理由**: `NaN !== NaN` / `+0 === -0` の問題
  - **オブジェクトをdepsに入れると無限ループになる理由**を実装レベルで体得
- クリーンアップの実行タイミング（次のエフェクト実行前 / アンマウント時）
  - **`effect.destroy = null` のクリアが必須**: クリアしないとStrictModeの二重実行やHMRで二重実行バグが起きる
  - アンマウント時: `deletions` 配列から子孫をたどり `commitHookEffectListUnmount` を呼ぶ
- **★ useEffect のスケジューリング実装**:
  - `setTimeout(0)` は4ms最小遅延があり実際のReactと動作差が出る
  - **`MessageChannel`** を使う（本番Reactと同じ、ペイント後のマクロタスクで0遅延）
  - ```typescript
    const channel = new MessageChannel()
    channel.port1.onmessage = () => flushPassiveEffects()
    // commitRoot後に: channel.port2.postMessage(null)
    ```
- **★ React 18: Strict ModeのuseEffect二重実行（重要な変更点）**:
  - React 17まで: Strict ModeはrenderとuseLayoutEffectのみ二重実行
  - React 18から: **useEffectも** 「mount → cleanup → mount」の順で二重実行される
  - 目的: cleanupを正しく実装しているかを開発時に強制チェック
  - 本書での説明: 「実装したcleanupが正しければ二重実行でも問題は起きない。問題が出るなら実装にバグがある」
- **★ Effect の `HookHasEffect` フラグ**: depsが変化した場合のみ `HookHasEffect` を立て、commitフェーズでこのフラグがあるEffectだけ実行する仕組みを実装
- **コラム**: `useLayoutEffect` — DOM計測とちらつきを防ぐ同期エフェクト
- **章末デモ**: useEffectでタイマーが動くストップウォッチ

### 第9章: すべてをつなぐ
- **ストップウォッチアプリ**をミニReactで実装（全機能を使用）
  - useState（時間の状態管理）
  - useEffect（setIntervalの副作用とクリーンアップ）
  - 複数コンポーネント（Display / Controls の分離）
  - 条件付きレンダリング（動作中/停止中の表示切り替え）
  - 頻繁な更新 → Fiberの差分検出が活きる
- 1回の「スタート」ボタンクリックから全体の流れをトレース
- **本物のReactソースコードとの対応表**: 本書の実装が公式のどのファイルに対応するか
  - `react/packages/react-reconciler/src/ReactFiber.ts` など
  - 「次に読む資料」ロードマップ
- **★ 本書の `createRoot()` と本物React 18の差分**:
  - 本書: `createRoot()` 実装済み・Automatic Batching（偶発的）・Lanesなし
  - 本物: Lanes（優先度）システム・Scheduler連携・`startTransition`・Suspense完全対応
  - **差分の本質**: Fiberの構造は同じ。Lanesフィールドを追加し、スケジューラが優先度付きキューを管理することでConcurrent Modeが成立する
- **★ React 19 の新機能との接続**:
  - `use()` hook: PromiseをFiber内でアンラップ（Suspenseと連動）。本書のhooks linked listが基盤
  - `useActionState` / `useFormStatus` / `useOptimistic`: Transitions + Server Actionsの上位抽象
  - `ref` as prop: React 19で正式サポート。`forwardRef` は廃止ではなく**非推奨**（後方互換性のため残存）。Fiberのrefフィールドをpropsとして扱う（本書の実装に近い形）
  - Server Components: Fiber はClient Componentのみ担当。RSC PayloadのHydrationは別概念（コラム）
- **★ React Compilerの位置づけ**:
  - React Compilerは `useMemo`/`useCallback`/`React.memo` の手動最適化を自動化する
  - 「Compilerが何を最適化しているかを理解するには、本書で学んだFiberの再レンダリングの仕組みが基盤になる」
- **意図的に省略した機能の解説**:
  - Portal / Context
  - 本番Reactのスケジューラ（MessageChannel + Lanes）
  - ダブルバッファリング（alternate pointer）の完全実装
  - Concurrent features（Transitions・Suspense）

---

## コラム一覧

| コラム | 配置章 | 内容 |
|---|---|---|
| `useLayoutEffect` | 第8章 | コミット中同期実行 / DOM計測のちらつき防止 |
| React DevTools でFiberツリーを見る | 第4章 | 実装したFiberを可視化 |
| `useState` と `useReducer` の内部的等価性 | 第7章 | `useState` は `useReducer` の特殊ケース |
| Server Components との関係 | 第9章 | FiberはClient Componentのみ担当、RSC PayloadとのHydrationは別概念 |
| `useMemo` / `useCallback` の内部実装 | 第9章 | useRefと同じリンクリスト、`[value, deps]` のペアを保存するだけ |

> **注1**: Concurrent Mode との差分は**本文（第9章）** で扱う。コラム扱いでは不足。
> **注2**: Server Componentsの説明は「本書の実装はClient Componentのみに対応する」という事実の明記として必須（1〜2段落）。

---

## 用語統一ルール

| 正しい表記 | 避ける表記 | 備考 |
|---|---|---|
| React element | Reactエレメント / 仮想DOM | 初出で「Virtual DOMを使わない理由」を明示 |
| render phase | レンダー / レンダリング | フェーズ名は英語+phaseで統一 |
| commit phase | コミット | Gitのcommitと区別を初出で明示 |
| Fiberノード | Fiber / ファイバー | データ構造を指す場合は「Fiberノード」 |
| Fiberアーキテクチャ | Fiber | 仕組み全体を指す場合 |
| `flags`（ビットフラグ） | effectTag | |
| `createRoot()` | `ReactDOM.render()` / `render()` | 本書はReact 18ベース。Legacy APIは第3章で歴史的文脈のみで言及 |
| React 18ベース（Lanesなし） | React 16-17 Legacy Mode | 本書の位置づけ |

**用語集**: 第1章末または巻末に設ける（読者がいつでも参照できるよう）

---

## 章末の必須要素（テンプレート）

各章は以下の3要素で締める：
1. **「何が解決されたか」の要約**（1段落）— 実装したコードで何が可能になったか
2. **「何がまだ解決されていないか」**（2〜3行）— 次章への問いとして機能させる
3. **「深く知りたい人へ」**（任意）— 公式ソース（`react/packages/` 等）への参照

---

## 図解ポリシー

本書で必要な図は約19種類。以下の3カテゴリに分けてツールを使い分ける。

| カテゴリ | ツール | 用途例 |
|---|---|---|
| フロー・処理順序 | **Mermaid** (`flowchart` / `sequenceDiagram` / `timeline`) | WorkLoopの流れ、commitフェーズのサブフェーズ、useEffect/useLayoutEffectのタイミング |
| ツリー・ポインタ構造（段階説明） | **ASCII art**（コードブロック内） | Fiberの child/sibling/return ポインタ、Hooksリンクリストの構築過程 |
| 概念・対比・全体像 | **Excalidraw → SVGエクスポート** | current/workInProgressの双ツリー、全体アーキテクチャマップ、JSXトランスパイル比較 |

### 各ツールの使い分け理由

- **Mermaid**: GitHubのMarkdownでそのまま表示。フロー・シーケンスに強い。ポインタ図は矢印が増えると読みにくくなるため使わない
- **ASCII art**: 依存関係ゼロ、どの環境でも壊れない。「段階的に矢印を追加していく」説明（Fiberポインタ図など）に特に有効
- **Excalidraw → SVG**: 手書き風で親しみやすく、自由なレイアウトが必要な概念図に最適。VS Code拡張で編集可能、SVGをMarkdownに `![](fig.svg)` で埋め込む

### 図が必須の箇所（5か所）

1. 第1章: 全体アーキテクチャマップ（Excalidraw）
2. 第4章: Fiberの child/sibling/return ポインタ 段階図 × 3枚以上（ASCII art）
3. 第4章: current / workInProgress 双ツリー（Excalidraw）
4. 第7章: Hooksリンクリストのマウント時 vs 更新時（ASCII art）
5. 第8章: useEffect（ペイント後）vs useLayoutEffect（コミット中）タイムライン（Mermaid timeline）

---

## テスト対応表（更新版）

```bash
npm test             # 全テスト
npm run test:ch02    # 章ごと個別実行
```

| 章 | テスト内容 |
|---|---|
| 2 (createElement) | VNodeオブジェクト構造の検証 |
| 3 (render) | jsdom: innerHTML検証 + イベント委譲 |
| 4 (fiber) | Fiberノードのリンクリスト構造の検証 |
| 5 (workLoop) | jsdom: MutationObserver + reconcileChildren + key照合 + Fragment |
| 6 (commit) | jsdom: DOM変更・削除・テキスト更新・flags確認 |
| 7 (useState+useRef) | カウンター: クリック → re-render + bailout（同値無視）+ useRef参照安定性 |
| 8 (useEffect) | マウント/アンマウント時のコールバック・クリーンアップ・deps比較・HookHasEffectフラグ |
| 9 (統合) | ストップウォッチのE2E（Fragment・useState・useEffect・useRef全使用） |
