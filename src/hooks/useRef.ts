/**
 * 第7章: useRef の実装
 *
 * useRef は useState と同じ Hook リンクリストの仕組みを使う最小の実装例。
 *
 * なぜ re-render を起こさないか:
 * - dispatch 関数を呼ばないため scheduleUpdateOnFiber が呼ばれない
 * - { current: T } オブジェクトへの書き込みは React が関知しない
 *
 * なぜ参照が安定しているか:
 * - mountRef: 新しいオブジェクトを作ってHookリンクリストに保存
 * - updateRef: 同じオブジェクトをリンクリストから取り出して返す
 *
 * useRef と useState が「同じリンクリストの仕組みを共有している」ことを示す例:
 * - どちらも mountWorkInProgressHook / updateWorkInProgressHook を使う
 * - 違いは queue（更新機構）があるかどうかだけ
 */

import {
  mountWorkInProgressHook,
  updateWorkInProgressHook,
} from '../hooksDispatcher'

// ============================================================
// マウント時
// ============================================================

export function mountRef<T>(initialValue: T): { current: T } {
  const hook = mountWorkInProgressHook()

  // { current: T } オブジェクトをHookのmemoizedStateに保存
  const ref = { current: initialValue }
  hook.memoizedState = ref

  return ref
}

// ============================================================
// 更新時
// ============================================================

export function updateRef<T>(_initialValue: T): { current: T } {
  const hook = updateWorkInProgressHook()

  // 同じオブジェクト参照を返す（これが「参照の安定性」の実装）
  return hook.memoizedState as { current: T }
}
