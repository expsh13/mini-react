/**
 * 第8章: useEffect の実装
 *
 * useEffect はペイント後に非同期で実行される副作用フック。
 * （useLayoutEffect はコミット中に同期実行 → 本書では省略）
 *
 * 重要な実装ポイント:
 * 1. HookHasEffect フラグ: deps が変化した場合のみセット
 *    → commit phase でこのフラグがあるEffectだけ実行する
 * 2. effect.destroy = null のクリア: StrictMode/HMR の二重実行対策
 * 3. areHookInputsEqual: Object.is での deps 比較
 *    - NaN !== NaN を正しく扱う
 *    - +0 === -0 の問題を正しく扱う
 *    - オブジェクトは参照比較 → 毎回新オブジェクトを渡すと毎回実行される
 */

import type { Effect, FunctionComponentUpdateQueue } from '../types'
import { HookHasEffect, HookPassive } from '../types'
import {
  mountWorkInProgressHook,
  updateWorkInProgressHook,
  currentlyRenderingFiber,
} from '../hooksDispatcher'

// ============================================================
// マウント時
// ============================================================

export function mountEffect(
  create: () => void | (() => void),
  deps?: any[]
): void {
  const hook = mountWorkInProgressHook()

  // マウント時は必ず実行するので HookHasEffect を立てる
  const effect = pushEffect(
    HookPassive | HookHasEffect,
    create,
    null,
    deps ?? null
  )
  hook.memoizedState = effect
}

// ============================================================
// 更新時
// ============================================================

export function updateEffect(
  create: () => void | (() => void),
  deps?: any[]
): void {
  const hook = updateWorkInProgressHook()
  const prevEffect = hook.memoizedState as Effect | null
  const prevDeps = prevEffect?.deps ?? null
  const nextDeps = deps ?? null

  if (prevDeps !== null && areHookInputsEqual(nextDeps, prevDeps)) {
    // deps が変化していない → HookHasEffect を立てない（実行しない）
    const effect = pushEffect(HookPassive, create, prevEffect?.destroy ?? null, nextDeps)
    hook.memoizedState = effect
  } else {
    // deps が変化した（または deps なし）→ HookHasEffect を立てる（実行する）
    const effect = pushEffect(
      HookPassive | HookHasEffect,
      create,
      prevEffect?.destroy ?? null,
      nextDeps
    )
    hook.memoizedState = effect
  }
}

// ============================================================
// Effectリンクリストへの追加
// ============================================================

/**
 * EffectをFiber.updateQueueのリンクリストに追加する
 *
 * Fiber.memoizedState → Hookリンクリスト
 * Fiber.updateQueue  → Effectリンクリスト（別管理）
 *
 * Effectリンクリストは循環リンクリスト（lastEffect.next = firstEffect）
 */
function pushEffect(
  tag: number,
  create: () => void | (() => void),
  destroy: (() => void) | null,
  deps: any[] | null
): Effect {
  const effect: Effect = {
    tag,
    create,
    destroy,
    deps,
    next: null,
  }

  let queue = currentlyRenderingFiber!.updateQueue as FunctionComponentUpdateQueue | null

  if (queue === null) {
    queue = { lastEffect: null }
    currentlyRenderingFiber!.updateQueue = queue
  }

  if (queue.lastEffect === null) {
    // 最初のEffect: 自分自身を指す循環リンクリストを作る
    effect.next = effect
    queue.lastEffect = effect
  } else {
    // 末尾に追加して循環を維持
    const firstEffect = queue.lastEffect.next!
    queue.lastEffect.next = effect
    effect.next = firstEffect
    queue.lastEffect = effect
  }

  return effect
}

// ============================================================
// deps 比較
// ============================================================

/**
 * 依存配列の比較
 *
 * Object.is を使う理由:
 * - NaN === NaN は false だが Object.is(NaN, NaN) は true
 * - +0 === -0 は true だが Object.is(+0, -0) は false
 * これにより「値が変わった」の判定が直感的になる。
 *
 * オブジェクトはあくまで参照比較:
 * - useEffect(() => {}, [obj]) で毎回新しいobjを渡すと毎回実行される
 * - これが「useEffectの無限ループ」の原因になる
 */
export function areHookInputsEqual(
  nextDeps: any[] | null,
  prevDeps: any[] | null
): boolean {
  if (prevDeps === null || nextDeps === null) return false
  if (prevDeps.length !== nextDeps.length) return false

  for (let i = 0; i < prevDeps.length; i++) {
    if (!Object.is(nextDeps[i], prevDeps[i])) {
      return false
    }
  }
  return true
}
