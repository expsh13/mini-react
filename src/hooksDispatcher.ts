/**
 * 第7章: Hooksディスパッチャ
 *
 * React Hooks の核心: 同じ useState(0) が、初回と2回目以降で
 * 全く異なるコードパスを通る。
 *
 * Dispatcher切り替えパターン:
 * - mountDispatcher: 初回レンダリング（Fiberにalternateがない）
 * - updateDispatcher: 2回目以降のレンダリング（alternateがある）
 *
 * 2ポインタパターン:
 * - workInProgressHook: WIPツリーのHookリンクリストを走査
 * - currentHook: currentツリーのHookリンクリストを走査（更新時のみ使用）
 *
 * 依存関係:
 * workLoop.ts → hooksDispatcher.ts ← hooks/useState.ts
 *                                  ← hooks/useEffect.ts
 *                                  ← hooks/useRef.ts
 * （workLoop.ts と hooks/ は直接依存しない → 循環なし）
 */

import type { Fiber, Hook } from './types'

// ============================================================
// グローバル状態
// ============================================================

/** 現在レンダリング中のFiber（HookがどのFiberに属するかを追跡） */
export let currentlyRenderingFiber: Fiber | null = null

/** WIPツリーのHookリンクリストを走査するポインタ */
export let workInProgressHook: Hook | null = null

/** currentツリーのHookリンクリストを走査するポインタ（更新時のみ使用） */
export let currentHook: Hook | null = null

// ============================================================
// Dispatcher パターン
// ============================================================

type Dispatcher = {
  useState: <S>(initialState: S | (() => S)) => [S, (action: S | ((s: S) => S)) => void]
  useEffect: (create: () => void | (() => void), deps?: any[]) => void
  useRef: <T>(initialValue: T) => { current: T }
}

// 実装は hooks/*.ts でインポートされて設定される（循環依存を避けるため）
// この変数は hooks/*.ts から mountState, updateState などが注入される
let _mountDispatcher: Dispatcher | null = null
let _updateDispatcher: Dispatcher | null = null

/** 現在アクティブなDispatcher */
let currentDispatcher: Dispatcher | null = null

/**
 * Dispatcherを登録する（hooks/*.ts から呼ばれる）
 */
export function registerDispatchers(mount: Dispatcher, update: Dispatcher): void {
  _mountDispatcher = mount
  _updateDispatcher = update
}

/**
 * Hookのレンダリング準備
 * workLoop.ts の updateFunctionComponent から呼ばれる。
 */
export function prepareToRenderHooks(fiber: Fiber): void {
  currentlyRenderingFiber = fiber
  // ★ Hookリンクリストのポインタをリセット
  workInProgressHook = null
  currentHook = null

  // ★ Dispatcher切り替えの核心:
  // alternateがある = 前回のrenderが存在する = 更新時
  // alternateがない = 初回render = マウント時
  currentDispatcher = fiber.alternate === null ? _mountDispatcher : _updateDispatcher
}

/**
 * レンダリング後のクリーンアップ
 */
export function finishRenderingHooks(): void {
  currentlyRenderingFiber = null
  workInProgressHook = null
  currentHook = null
}

// ============================================================
// 2ポインタパターン: Hook リンクリストの走査
// ============================================================

/**
 * マウント時: 新しいHookノードを作成してリンクリストに追加する
 *
 * 最初の呼び出し: fiber.memoizedState = hook（リスト先頭）
 * 2回目以降の呼び出し: 前のhook.next = hook（リスト末尾に追加）
 */
export function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    memoizedState: null,
    baseState: null,
    queue: null,
    next: null,
  }

  if (workInProgressHook === null) {
    // 最初のHook: FiberのmemoizedStateとして設定
    currentlyRenderingFiber!.memoizedState = hook
  } else {
    // 後続のHook: リスト末尾に追加
    workInProgressHook.next = hook
  }

  workInProgressHook = hook
  return hook
}

/**
 * 更新時: currentツリーとWIPツリーを同期しながら走査する
 *
 * currentHook でcurrentツリーを進め、
 * workInProgressHook でWIPツリーを進める。
 * 対応するHookを同じ順序で取得するため、
 * 呼び出し順序が変わると値が混在する（Rules of Hooksの根拠）。
 */
export function updateWorkInProgressHook(): Hook {
  // currentHookを進める
  if (currentHook === null) {
    // 最初の呼び出し: currentツリーのmemoizedStateから開始
    const current = currentlyRenderingFiber!.alternate
    currentHook = current ? (current.memoizedState as Hook) : null
  } else {
    currentHook = currentHook.next
  }

  if (!currentHook) {
    throw new Error('Rendered more hooks than during the previous render.')
  }

  // WIP側のHookを作成（currentの値をコピー）
  const newHook: Hook = {
    memoizedState: currentHook.memoizedState,
    baseState: currentHook.baseState,
    queue: currentHook.queue,
    next: null,
  }

  if (workInProgressHook === null) {
    currentlyRenderingFiber!.memoizedState = newHook
  } else {
    workInProgressHook.next = newHook
  }

  workInProgressHook = newHook
  return newHook
}

// ============================================================
// 公開API: ユーザーが呼ぶHook関数
// （実装はDispatcherに委譲）
// ============================================================

export function useState<S>(
  initialState: S | (() => S)
): [S, (action: S | ((s: S) => S)) => void] {
  if (!currentDispatcher) {
    throw new Error('useState must be called inside a function component')
  }
  return currentDispatcher.useState(initialState)
}

export function useEffect(
  create: () => void | (() => void),
  deps?: any[]
): void {
  if (!currentDispatcher) {
    throw new Error('useEffect must be called inside a function component')
  }
  return currentDispatcher.useEffect(create, deps)
}

export function useRef<T>(initialValue: T): { current: T } {
  if (!currentDispatcher) {
    throw new Error('useRef must be called inside a function component')
  }
  return currentDispatcher.useRef(initialValue)
}
