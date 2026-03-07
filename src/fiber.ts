/**
 * 第4章: Fiberデータ構造とファクトリ
 *
 * Fiber は React の「作業単位」。再帰スタックの代わりに
 * child/sibling/return ポインタで木構造を表現することで
 * 処理を中断・再開可能にする。
 *
 * 重要な設計選択:
 * - `return` (親への参照) を `parent` と呼ばない:
 *   「処理が完了したら return する先」というコールスタックの
 *   セマンティクスを保持するため
 * - `stateNode` を `dom` と呼ばない:
 *   React本体と一致。FiberRoot も指せる汎用フィールド
 */

import {
  FunctionComponent,
  HostRoot,
  HostComponent,
  HostText,
  NoFlags,
  type WorkTag,
  type Flags,
  type Fiber,
  type FiberRoot,
  type Props,
} from './types'

/**
 * Fiberノードを作成するファクトリ
 */
export function createFiber(
  tag: WorkTag,
  type: string | Function | symbol | null,
  pendingProps: Props,
  key: string | null = null
): Fiber {
  return {
    tag,
    type,
    key,
    pendingProps,
    memoizedProps: {},
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    alternate: null,
    flags: NoFlags,
    subtreeFlags: NoFlags,
    memoizedState: null,
    updateQueue: null,
    index: 0,
  }
}

/**
 * FiberRoot と root Fiber を作成する
 *
 * FiberRoot と root Fiber は別オブジェクト:
 * - FiberRoot: アプリ全体のルート（createRoot() の結果）
 * - root Fiber: HostRoot タグのFiberノード（Fiberツリーの根）
 *
 * FiberRoot.current → root Fiber（currentツリー）
 * root Fiber.stateNode → FiberRoot
 */
export function createFiberRoot(container: HTMLElement): FiberRoot {
  const root: FiberRoot = {
    container,
    current: null as unknown as Fiber,  // 直後にセットする
    finishedWork: null,
  }

  const rootFiber = createFiber(HostRoot, null, {})
  rootFiber.stateNode = root
  root.current = rootFiber

  return root
}

/**
 * ダブルバッファリング: workInProgress Fiber を作成する
 *
 * current ツリーと workInProgress ツリーを alternate で繋ぐ。
 * commitRoot 後に current ↔ workInProgress が入れ替わる。
 *
 * この仕組みにより:
 * - render phase 中は current ツリーが安定した状態を保つ
 * - commit 後に一瞬で current が切り替わる（UI的にはアトミックな更新）
 */
export function createWorkInProgress(current: Fiber, pendingProps: Props): Fiber {
  let wip = current.alternate

  if (wip === null) {
    // 初回: 新しいFiberを作成してalternateで接続
    wip = createFiber(current.tag, current.type, pendingProps, current.key)
    wip.stateNode = current.stateNode
    wip.alternate = current
    current.alternate = wip
  } else {
    // 2回目以降: 既存のFiberを再利用（メモリ効率化）
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

/**
 * VNode から新しいFiberを作成する（reconciliation用）
 */
export function createFiberFromVNode(
  vnode: { type: any; key: string | null; props: Props },
  index: number
): Fiber {
  const { type, key, props } = vnode

  let tag: WorkTag = FunctionComponent

  if (typeof type === 'string') {
    tag = HostComponent
  } else if (type === null) {
    tag = HostRoot
  }

  const fiber = createFiber(tag, type, props, key)
  fiber.index = index
  return fiber
}

/**
 * テキストノード用のFiberを作成する
 */
export function createFiberFromText(text: string | number, index: number): Fiber {
  const fiber = createFiber(HostText, null, { nodeValue: String(text) })
  fiber.index = index
  return fiber
}
