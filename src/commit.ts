/**
 * 第6章: コミットフェーズ
 *
 * render phase が差分を計算したら、commit phase でDOMに適用する。
 * commit phase は割り込み不可（中断したらユーザーに中途半端な状態が見える）。
 *
 * 2サブフェーズ:
 * 1. Mutation Phase: DOM変更（挿入・更新・削除）
 * 2. Passive Effects Phase: useEffect の実行（非同期・ペイント後）
 *
 * 本書での省略:
 * - Layout Phase（useLayoutEffect）は実装しない。
 *   コラムで「DOM計測に必要な同期エフェクト」として解説。
 *
 * root.current の切り替えタイミング:
 * - Mutation後・Passive前（本番Reactと同じ）
 * - Layout Phase 内で current === finishedWork が必要なため
 */

import {
  FunctionComponent,
  HostRoot,
  HostComponent,
  HostText,
  Placement,
  Update,
  Deletion,
  Passive,
  HookHasEffect,
  HookPassive,
  NoFlags,
  type Fiber,
  type FiberRoot,
  type Effect,
  type FunctionComponentUpdateQueue,
} from './types'
import { updateProps } from './dom/domOperations'
import { setCurrentRoot } from './workLoop'

// ============================================================
// Public API
// ============================================================

/**
 * commitRoot: WIPツリーをDOMに反映する
 *
 * 呼び出し元: workLoop.ts の workLoop() 関数
 */
export function commitRoot(wipRoot: Fiber, deletions: Fiber[]): void {
  const root = wipRoot.stateNode as FiberRoot

  // Phase 1: Mutation（DOM変更）
  // 削除を先に処理する（insertBeforeが正しく動作するため）
  deletions.forEach((fiber) => commitDeletion(fiber))
  commitMutationEffects(wipRoot)

  // ★ root.current の切り替え（Mutation後・Passive前）
  // これ以降は finishedWork が current になる
  root.current = wipRoot

  // workLoop の currentRoot も更新
  setCurrentRoot(wipRoot)

  // Phase 2: Passive Effects（useEffect、非同期・ペイント後）
  // MessageChannel を使ってペイント後に実行
  // （本番Reactと同じ方式: setTimeout(0) より遅延が少ない）
  schedulePassiveEffects(wipRoot)
}

// ============================================================
// Phase 1: Mutation
// ============================================================

function commitMutationEffects(fiber: Fiber): void {
  // DFSで全Fiberを処理
  let current: Fiber | null = fiber

  // 子→兄弟→親の順で処理するため、再帰的に呼ぶ
  commitMutationEffectsOnFiber(fiber)
}

function commitMutationEffectsOnFiber(fiber: Fiber): void {
  // このFiberのフラグを先に処理（pre-order: 親→子の順でDOMに挿入）
  // post-order にすると兄弟要素の順序が逆になるため pre-order が必要
  if (fiber.flags & Placement) {
    commitPlacement(fiber)
  }
  if (fiber.flags & Update) {
    commitUpdate(fiber)
  }
  // Deletion は commitRoot の deletions配列から処理済み

  // 子→兄弟の順で再帰
  if (fiber.child) {
    commitMutationEffectsOnFiber(fiber.child)
  }
  if (fiber.sibling) {
    commitMutationEffectsOnFiber(fiber.sibling)
  }
}

/**
 * commitPlacement: 新しいDOMノードを挿入する
 *
 * FunctionComponent / Fragment はDOM要素を持たないため、
 * 子のDOMを親に挿入する必要がある。
 */
function commitPlacement(fiber: Fiber): void {
  const parentDOM = getHostParent(fiber)
  if (!parentDOM) return

  const dom = getHostDOM(fiber)
  if (!dom) return

  // 挿入位置: 次のホスト兄弟の前に挿入（位置を正確に制御）
  const before = getHostSibling(fiber)
  if (before) {
    parentDOM.insertBefore(dom, before)
  } else {
    parentDOM.appendChild(dom)
  }
}

/**
 * commitUpdate: 既存DOMノードの属性を更新する
 */
function commitUpdate(fiber: Fiber): void {
  if (fiber.tag === HostText) {
    const dom = fiber.stateNode as Text
    const newText = fiber.pendingProps.nodeValue
    if (dom.nodeValue !== newText) {
      dom.nodeValue = newText
    }
    fiber.memoizedProps = fiber.pendingProps
    return
  }

  if (fiber.tag === HostComponent && fiber.stateNode instanceof HTMLElement) {
    updateProps(
      fiber.stateNode,
      fiber.alternate?.memoizedProps ?? {},
      fiber.pendingProps
    )
    fiber.memoizedProps = fiber.pendingProps
  }
}

/**
 * commitDeletion: DOMノードを削除する
 *
 * 子孫の useEffect クリーンアップも実行する（メモリリーク防止）。
 */
function commitDeletion(fiber: Fiber): void {
  // まず子孫の useEffect クリーンアップを実行
  commitNestedUnmounts(fiber)

  // DOMを削除
  const dom = getHostDOM(fiber)
  if (dom && dom.parentNode) {
    dom.parentNode.removeChild(dom)
  }
}

/**
 * 削除されるFiberツリー内の全useEffectクリーンアップを実行する
 */
function commitNestedUnmounts(fiber: Fiber): void {
  commitHookEffectListUnmount(HookPassive, fiber)

  if (fiber.child) commitNestedUnmounts(fiber.child)
  if (fiber.sibling) commitNestedUnmounts(fiber.sibling)
}

// ============================================================
// Phase 2: Passive Effects (useEffect)
// ============================================================

/**
 * MessageChannel でペイント後に useEffect を実行する
 *
 * setTimeout(0) は4ms最小遅延があるため、本番Reactと同じ
 * MessageChannel を使用する（0遅延でペイント後のマクロタスク）。
 */
function schedulePassiveEffects(wipRoot: Fiber): void {
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    flushPassiveEffects(wipRoot)
  }
  channel.port2.postMessage(null)
}

function flushPassiveEffects(fiber: Fiber): void {
  // まずクリーンアップを全て実行してから新しいエフェクトを実行
  commitPassiveUnmountEffects(fiber)
  commitPassiveMountEffects(fiber)
}

function commitPassiveUnmountEffects(fiber: Fiber): void {
  commitHookEffectListUnmount(HookPassive | HookHasEffect, fiber)
  if (fiber.child) commitPassiveUnmountEffects(fiber.child)
  if (fiber.sibling) commitPassiveUnmountEffects(fiber.sibling)
}

function commitPassiveMountEffects(fiber: Fiber): void {
  commitHookEffectListMount(HookPassive | HookHasEffect, fiber)
  if (fiber.child) commitPassiveMountEffects(fiber.child)
  if (fiber.sibling) commitPassiveMountEffects(fiber.sibling)
}

/**
 * 指定したフラグを持つEffectのクリーンアップを実行する
 */
export function commitHookEffectListUnmount(flags: number, fiber: Fiber): void {
  if (fiber.tag !== FunctionComponent) return
  const queue = fiber.updateQueue as FunctionComponentUpdateQueue | null
  if (!queue || !queue.lastEffect) return

  const firstEffect = queue.lastEffect.next!
  let effect = firstEffect
  do {
    if ((effect.tag & flags) === flags) {
      if (effect.destroy) {
        const destroy = effect.destroy
        // ★ effect.destroy を null にクリアする（StrictMode/HMR対策）
        effect.destroy = null
        destroy()
      }
    }
    effect = effect.next!
  } while (effect !== firstEffect)
}

/**
 * 指定したフラグを持つEffectを実行する
 */
export function commitHookEffectListMount(flags: number, fiber: Fiber): void {
  if (fiber.tag !== FunctionComponent) return
  const queue = fiber.updateQueue as FunctionComponentUpdateQueue | null
  if (!queue || !queue.lastEffect) return

  const firstEffect = queue.lastEffect.next!
  let effect = firstEffect
  do {
    if ((effect.tag & flags) === flags) {
      const destroy = effect.create()
      effect.destroy = typeof destroy === 'function' ? destroy : null
    }
    effect = effect.next!
  } while (effect !== firstEffect)
}

// ============================================================
// DOM探索ヘルパー
// ============================================================

/**
 * Fiberに対応するホスト（DOM）の親ノードを探す
 * FunctionComponent は DOM を持たないため return を辿る
 */
function getHostParent(fiber: Fiber): HTMLElement | null {
  let parent = fiber.return
  while (parent) {
    if (parent.tag === HostComponent && parent.stateNode instanceof HTMLElement) {
      return parent.stateNode
    }
    if (parent.tag === HostRoot) {
      const root = parent.stateNode as FiberRoot
      return root.container
    }
    parent = parent.return
  }
  return null
}

/**
 * FiberのDOMノードを取得する
 * FunctionComponent の場合は最初の子のDOMノードを返す
 */
function getHostDOM(fiber: Fiber): HTMLElement | Text | null {
  if (fiber.tag === HostComponent || fiber.tag === HostText) {
    return fiber.stateNode as HTMLElement | Text
  }

  // FunctionComponent / Fragment: 子のDOMを探す
  let child = fiber.child
  while (child) {
    const dom = getHostDOM(child)
    if (dom) return dom
    child = child.sibling
  }
  return null
}

/**
 * Fiberの次のホスト兄弟を探す（insertBefore の基準点）
 */
function getHostSibling(fiber: Fiber): HTMLElement | Text | null {
  let node: Fiber | null = fiber

  sibling_loop: while (true) {
    // 兄弟がない場合、親に戻って兄弟を探す
    while (node!.sibling === null) {
      if (!node!.return || node!.return.tag === HostRoot || node!.return.tag === HostComponent) {
        return null
      }
      node = node!.return
    }

    node = node!.sibling

    // ホスト以外（FunctionComponent等）は子を探す
    while (node!.tag !== HostComponent && node!.tag !== HostText) {
      if (node!.flags & Placement) {
        // 新規挿入のFiberはDOMがまだ正しい位置にないのでスキップ
        continue sibling_loop
      }
      if (!node!.child) {
        continue sibling_loop
      }
      node = node!.child
    }

    if (!(node!.flags & Placement)) {
      return node!.stateNode as HTMLElement | Text
    }
  }
}
