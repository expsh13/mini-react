/**
 * 第7章: useState の実装
 *
 * マウント時（mountState）と更新時（updateState）で
 * 全く異なるコードパスを通る。
 *
 * 重要な概念:
 * - pending 循環リンクリスト: update が積み重なる仕組み
 * - Render phase bailout: 同じ値なら子の再レンダリングをスキップ
 * - Eager bailout: dispatch時点で値が変わらなければスケジュールすら行わない
 *   （本書では省略。省略していることを明記）
 *
 * UpdateQueue.lastRenderedState について:
 * - 本番Reactでは eager bailout（dispatchSetState内でObject.is比較）に使用
 * - 本書ではeager bailoutを省略するが、型定義には含めて本番との対応を示す
 */

import type { Fiber, Hook, Update, UpdateQueue } from '../types'
import {
  mountWorkInProgressHook,
  updateWorkInProgressHook,
  currentlyRenderingFiber,
  registerDispatchers,
} from '../hooksDispatcher'
import { scheduleUpdateOnFiber } from '../workLoop'
import { mountEffect, updateEffect } from './useEffect'
import { mountRef, updateRef } from './useRef'

// ============================================================
// マウント時
// ============================================================

export function mountState<S>(
  initialState: S | (() => S)
): [S, (action: S | ((s: S) => S)) => void] {
  const hook = mountWorkInProgressHook()

  // 初期値が関数なら実行する（lazy initialization）
  const state = typeof initialState === 'function'
    ? (initialState as () => S)()
    : initialState

  hook.memoizedState = state
  hook.baseState = state

  const queue: UpdateQueue = {
    pending: null,
    dispatch: null,
    lastRenderedState: state,
  }
  hook.queue = queue

  const dispatch = createDispatch(currentlyRenderingFiber!, queue)
  queue.dispatch = dispatch

  return [state, dispatch]
}

// ============================================================
// 更新時
// ============================================================

export function updateState<S>(
  _initialState: S | (() => S)
): [S, (action: S | ((s: S) => S)) => void] {
  const hook = updateWorkInProgressHook()
  const queue = hook.queue!

  // pending キューの update を全て適用する
  let newState = hook.baseState
  let update = queue.pending

  if (update !== null) {
    // 循環リンクリストを先頭から処理する
    const first = update.next!  // pending は末尾なので .next が先頭
    let current: Update | null = first

    do {
      const action = current!.action
      newState = typeof action === 'function'
        ? (action as (s: S) => S)(newState as S)
        : (action as S)
      current = current!.next
    } while (current !== null && current !== first)

    // 処理したので pending をクリア
    queue.pending = null
  }

  hook.memoizedState = newState
  hook.baseState = newState
  queue.lastRenderedState = newState

  return [newState as S, queue.dispatch!]
}

// ============================================================
// dispatch 関数の作成
// ============================================================

/**
 * setState に相当する dispatch 関数を作成する
 *
 * 注: 本書では Eager bailout（dispatch時点でのObject.is比較）を省略する。
 * 本番Reactでは queue.lastRenderedState と比較してスケジューリング自体を
 * スキップする最適化があるが、本書は render phase bailout のみ実装する。
 */
function createDispatch<S>(
  fiber: Fiber,
  queue: UpdateQueue
): (action: S | ((s: S) => S)) => void {
  return function dispatch(action: S | ((s: S) => S)) {
    const update: Update = {
      action,
      next: null,
    }

    // 循環リンクリストに追加する
    // pending は「最後に追加されたupdate」を指し、
    // pending.next が「最初のupdate」（先頭）になる
    if (queue.pending === null) {
      update.next = update  // 最初の要素: 自分自身を指す
    } else {
      update.next = queue.pending.next  // 新要素の next = 旧先頭
      queue.pending.next = update       // 旧末尾の next = 新要素
    }
    queue.pending = update  // pending は常に末尾を指す

    // 再レンダリングをスケジュール
    scheduleUpdateOnFiber(fiber)
  }
}

// ============================================================
// Dispatcher の登録
// ============================================================

// useState, useEffect, useRef をまとめてDispatcherとして登録
// この形で初期化することで循環依存を解決する
registerDispatchers(
  {
    useState: mountState,
    useEffect: mountEffect,
    useRef: mountRef,
  },
  {
    useState: updateState,
    useEffect: updateEffect,
    useRef: updateRef,
  }
)
