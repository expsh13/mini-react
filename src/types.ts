// ============================================================
// WorkTag: Fiberの種類を判別する定数
// React本体の ReactWorkTags.js と同じ値を使用
// ============================================================
export const FunctionComponent = 0  // 関数コンポーネント
export const HostRoot          = 3  // createRoot() で作られるルート
export const HostComponent     = 5  // div, span などDOM要素
export const HostText          = 6  // テキストノード
export type WorkTag = 0 | 3 | 5 | 6

// ============================================================
// Flags: ビットフラグ設計
// 単一値ではなく複数エフェクトを同時表現可能（OR演算で組み合わせ）
// ============================================================
export const NoFlags   = 0b00000  // 0
export const Placement = 0b00001  // 1: DOMへの挿入
export const Update    = 0b00010  // 2: DOMの更新
export const Deletion  = 0b00100  // 4: DOMの削除
export const Passive   = 0b01000  // 8: useEffect用
export type Flags = number

// ============================================================
// Hook Effect フラグ
// HookHasEffect がなければエフェクトはスキップされる
// ============================================================
export const HookNoFlags   = 0b000  // 0
export const HookHasEffect = 0b001  // 1: 今回実行すべきエフェクト（depsが変化した場合のみセット）
export const HookLayout    = 0b010  // 2: useLayoutEffect（本書では省略、コラムで解説）
export const HookPassive   = 0b100  // 4: useEffect

// ============================================================
// FiberRoot と root Fiber は別オブジェクト（重要な設計）
// FiberRoot.current → currentツリーの root Fiber
// ============================================================
export type FiberRoot = {
  container: HTMLElement        // マウント先のDOM（createRoot(container) の引数）
  current: Fiber                // currentツリーのrootファイバー
  finishedWork: Fiber | null    // commitを待つ完成済みWIPルート
}

// ============================================================
// Fiber: React のコアデータ構造
// ============================================================
export type Props = { [key: string]: any }

export type Fiber = {
  tag: WorkTag                 // Fiberの種類（FunctionComponent/HostComponent/HostText/HostRoot）
  type: string | Function | symbol | null  // div/span/関数コンポーネント/Fragment(symbol)/null(HostRoot)
  key: string | null           // reconciliation用のkey

  pendingProps: Props          // beginWork開始時にセット（これから処理するprops）
  memoizedProps: Props         // completeWork完了時にpendingPropsから昇格（確定済みprops）

  // stateNode: React本体と一致した命名。domではない
  // - HostComponent: HTMLElement
  // - HostText: Text
  // - HostRoot: FiberRoot
  // - FunctionComponent: null
  stateNode: HTMLElement | Text | FiberRoot | null

  // ツリー構造: child/sibling/returnポインタによる木構造
  // returnは「処理完了後に戻る先」というセマンティクス（コールスタックのreturnに対応）
  return: Fiber | null
  child: Fiber | null
  sibling: Fiber | null

  alternate: Fiber | null      // ダブルバッファリング用（current ↔ workInProgress）

  flags: Flags                 // ビットフラグ（effectTagではなくflags）
  subtreeFlags: Flags          // 子孫のflagsをBitORで集約（本書では簡略版サブツリートラバーサルを採用）

  // memoizedState: Hookのリンクリストの先頭
  // 配列ではなくリンクリスト → これがRules of Hooksの技術的根拠
  memoizedState: Hook | null

  // updateQueue: Effectリンクリスト（FunctionComponentのみ使用）
  // memoizedState（Hookリンクリスト）とは別管理
  updateQueue: FunctionComponentUpdateQueue | null

  index: number                // 兄弟間でのインデックス（lastPlacedIndex計算用）
}

// ============================================================
// Hook: リンクリスト構造（配列ではない）
// これがRules of Hooksの技術的根拠：
// 条件分岐でHookを呼ぶとリストの対応がズレて値が混在する
// ============================================================
export type Hook = {
  memoizedState: any           // useState: state値、useEffect: Effectオブジェクト、useRef: {current: T}
  baseState: any               // 本書ではmemoizedStateと同値。本番ReactではLanes省略のため常に同値
                               // （本番ReactではLanesスキップ時の再計算起点として使用）
  queue: UpdateQueue | null    // useState用のUpdateQueue
  next: Hook | null            // 次のHookへのポインタ（リンクリストの核心）
}

// ============================================================
// UpdateQueue: 状態更新のキュー
// ============================================================
export type UpdateQueue = {
  pending: Update | null       // 循環リンクリスト（最後のupdateが先頭を指す）
  dispatch: ((action: any) => void) | null
  lastRenderedState: any       // eager bailout用（dispatchSetState内でObject.is比較）
}

export type Update = {
  action: any                  // 新しいstate、または (prevState) => newState
  next: Update | null          // 循環リンクリスト
}

// ============================================================
// Effect: useEffectのデータ
// ============================================================
export type Effect = {
  tag: number                  // HookHasEffect | HookPassive などビットフラグの組み合わせ
  create: () => void | (() => void)  // エフェクト本体
  destroy: (() => void) | null       // クリーンアップ関数（前回のcreateの戻り値）
  deps: any[] | null           // 依存配列
  next: Effect | null          // Effectリンクリスト
}

// Effectリンクリストのコンテナ（Fiber.updateQueueに格納）
export type FunctionComponentUpdateQueue = {
  lastEffect: Effect | null    // Effectリンクリストの末尾（循環リスト）
}

// ============================================================
// VNode: createElement の戻り値
// React では「React element」と呼ぶ（Virtual DOMとは言わない）
// ============================================================
export type VNode = {
  type: string | Function | null | symbol  // symbol: Fragmentの場合
  key: string | null
  props: Props & { children: (VNode | string | number)[] }
}
