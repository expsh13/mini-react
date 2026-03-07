/**
 * 第5章: ワークループと Reconciliation
 *
 * このモジュールが mini-react の心臓部。
 * render phase（差分検出）の全実装を含む。
 *
 * 重要な設計選択（PLAN.md §5章）:
 * 1. スケジューリング: requestIdleCallback（教育目的の近似）
 *    - 本番React は MessageChannel + shouldYield() を使用
 *    - requestIdleCallback は Safariサポート不足・スケジューラ制御不可のため React 本体では却下
 *    - 本書では「Fiberが中断可能な構造であること」を理解するための教育用近似として使用
 *
 * 2. effectList vs subtreeFlags:
 *    - React 17以前: effectList（副作用あるFiber全体のリンクリスト）
 *    - React 17以降: subtreeFlags（各FiberにBitORで子孫フラグを集約）
 *    - 本書: 教育目的でシンプルなサブツリートラバーサルを採用（この旨を明記）
 *
 * 3. reconcileChildren:
 *    - keyのみ照合（インデックスフォールバックなし）← 省略を明記
 *    - lastPlacedIndex の概念を実装で示す
 */

import {
  FunctionComponent,
  HostRoot,
  HostComponent,
  HostText,
  NoFlags,
  Placement,
  Update,
  Deletion,
  type Fiber,
  type FiberRoot,
  type VNode,
} from './types'
import { createFiber, createFiberRoot, createWorkInProgress } from './fiber'
import { createDOMElement, createTextNode } from './dom/domOperations'
import { prepareToRenderHooks } from './hooksDispatcher'
import { Fragment } from './createElement'

// ============================================================
// モジュールレベルの状態
// ============================================================

/** 次に処理すべきFiber（render phaseの進行状態） */
let nextUnitOfWork: Fiber | null = null

/** 進行中のworkInProgressルート */
let wipRoot: Fiber | null = null

/** コミット済みの現在のルート */
let currentRoot: Fiber | null = null

/** 削除対象のFiber一覧（commitRootに渡す） */
export let deletions: Fiber[] = []

// ============================================================
// Public API
// ============================================================

/**
 * createRoot: FiberRootを作成し、render()メソッドを持つオブジェクトを返す
 */
export function createRoot(container: HTMLElement) {
  const root = createFiberRoot(container)
  return {
    render(vnode: VNode) {
      scheduleUpdateOnFiber(root.current, vnode)
    },
  }
}

/**
 * 状態更新をスケジュールする
 * useState の dispatch からも呼ばれる
 */
export function scheduleUpdateOnFiber(fiber: Fiber, vnode?: VNode): void {
  const root = getRoot(fiber)
  if (!root) return

  // workInProgressルートを準備
  wipRoot = createWorkInProgress(root.current, root.current.pendingProps)
  if (vnode) {
    // 初回レンダリング: vnodeをpendingPropsとして設定
    wipRoot.pendingProps = { children: [vnode] }
  }
  wipRoot.alternate = root.current
  deletions = []

  nextUnitOfWork = wipRoot
  requestIdleCallback(workLoop)
}

// ============================================================
// ワークループ
// ============================================================

/**
 * requestIdleCallback のコールバック
 * 時間がある間は処理を続け、なくなったら中断する。
 *
 * 注: requestIdleCallback は「真の中断・再開」ではない。
 * 本番React は shouldYield() で5ms単位のタイムスライスを実現する。
 * 本書ではFiberの構造理解に集中するため、この近似を使用する。
 */
function workLoop(deadline: IdleDeadline): void {
  let shouldYield = false

  while (nextUnitOfWork !== null && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork)
    shouldYield = deadline.timeRemaining() < 1
  }

  // すべての作業が完了したらコミット
  if (nextUnitOfWork === null && wipRoot !== null) {
    // 循環参照を避けるために動的importではなく直接require
    const { commitRoot } = require('./commit')
    commitRoot(wipRoot, deletions)
    currentRoot = wipRoot
    wipRoot = null
  }
}

// ============================================================
// render phase: performUnitOfWork → beginWork → completeWork
// ============================================================

/**
 * 1つの作業単位を処理し、次の作業単位を返す
 *
 * DFS（深さ優先探索）の順序で Fiber を処理:
 * 1. beginWork: 現在のFiberを処理（子を作成）
 * 2. completeWork: 子がなければ完了処理（DOM作成）
 * 3. 次のFiber: child → sibling → return の順で探索
 */
function performUnitOfWork(fiber: Fiber): Fiber | null {
  beginWork(fiber)

  // 子があれば次の作業単位は子
  if (fiber.child) {
    return fiber.child
  }

  // 子がなければcompleteWorkして兄弟か親を返す
  let current: Fiber | null = fiber
  while (current !== null) {
    completeWork(current)

    if (current.sibling) {
      return current.sibling
    }
    current = current.return
  }

  return null
}

/**
 * beginWork: Fiberの種類に応じて子Fiberを構築する
 * この時点ではDOMは一切変更しない（render phaseはpure）
 */
function beginWork(fiber: Fiber): void {
  switch (fiber.tag) {
    case FunctionComponent:
      updateFunctionComponent(fiber)
      break
    case HostRoot:
      updateHostRoot(fiber)
      break
    case HostComponent:
      updateHostComponent(fiber)
      break
    case HostText:
      // テキストノードは子を持たないのでbeginWorkでは何もしない
      break
  }
}

function updateFunctionComponent(fiber: Fiber): void {
  // Fragment はDOM要素を持たず、子をそのまま親に渡すだけ
  if (fiber.type === Fragment) {
    const children = fiber.pendingProps.children || []
    reconcileChildren(fiber, children)
    return
  }

  // Hooksディスパッチャをセット（useState等がこのFiberに紐付けられる）
  prepareToRenderHooks(fiber)

  const fn = fiber.type as Function
  const children = fn(fiber.pendingProps)
  reconcileChildren(fiber, children ? [children] : [])
}

function updateHostRoot(fiber: Fiber): void {
  const children = fiber.pendingProps.children || []
  reconcileChildren(fiber, children)
}

function updateHostComponent(fiber: Fiber): void {
  const children = fiber.pendingProps.children || []
  reconcileChildren(fiber, children)
}

/**
 * completeWork: DOMノードを作成または更新する
 * beginWorkで構築したFiberに対してstateNode（DOM）を設定する
 */
function completeWork(fiber: Fiber): void {
  switch (fiber.tag) {
    case HostComponent: {
      if (fiber.stateNode) {
        // 更新時: DOM属性の更新はcommit phaseで行う
        // （このフェーズではstateNodeが存在するかだけ確認）
      } else {
        // 初回: DOMノードを作成
        const dom = createDOMElement(fiber.type as string, fiber.pendingProps)
        fiber.stateNode = dom
      }
      fiber.memoizedProps = fiber.pendingProps
      break
    }
    case HostText: {
      if (!fiber.stateNode) {
        const text = createTextNode(fiber.pendingProps.nodeValue)
        fiber.stateNode = text
      }
      fiber.memoizedProps = fiber.pendingProps
      break
    }
    case HostRoot:
    case FunctionComponent:
      break
  }

  // subtreeFlags の集約（教育版: 子のflagsをORで集約）
  let child = fiber.child
  while (child) {
    fiber.subtreeFlags |= child.subtreeFlags | child.flags
    child = child.sibling
  }
}

// ============================================================
// Reconciliation: 差分検出アルゴリズム
// ============================================================

/**
 * reconcileChildren: 子Fiberのツリーを構築・更新する
 *
 * この関数が「差分検出」の中心。
 * - 初回レンダリング: 全子要素に Placement フラグ
 * - 更新時:
 *   - keyが一致 → Update フラグ
 *   - 新規要素 → Placement フラグ
 *   - 消えた要素 → Deletion フラグ（deletions配列に追加）
 *
 * 本書の設計選択:
 * - keyのみ照合（インデックスフォールバックなし）
 *   → keyなし時の挙動は第5章で説明する
 * - lastPlacedIndex の概念を実装して示す
 */
function reconcileChildren(
  wipFiber: Fiber,
  elements: (VNode | string | number)[]
): void {
  let oldFiber = wipFiber.alternate?.child ?? null
  let prevSibling: Fiber | null = null
  let index = 0

  // keyによる既存Fiberのマップを構築
  const existingFibers = new Map<string | number, Fiber>()
  let temp = oldFiber
  let tempIdx = 0
  while (temp) {
    const key = temp.key !== null ? temp.key : tempIdx
    existingFibers.set(key, temp)
    temp = temp.sibling
    tempIdx++
  }

  // lastPlacedIndex: DOMの移動コストを最小化するための基準インデックス
  // [A,B,C] → [B,C,A] の場合:
  //   B(old index=1) > lastPlacedIndex=0 → 移動不要、lastPlacedIndex=1
  //   C(old index=2) > lastPlacedIndex=1 → 移動不要、lastPlacedIndex=2
  //   A(old index=0) < lastPlacedIndex=2 → 移動が必要（Placement）
  let lastPlacedIndex = 0

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    const key = (typeof element === 'object' && element !== null && 'key' in element)
      ? (element.key !== null ? element.key : i)
      : i

    const matchedFiber = existingFibers.get(key)
    existingFibers.delete(key)  // 使用済みとしてマーク

    let newFiber: Fiber

    if (matchedFiber && canReuse(matchedFiber, element)) {
      // 既存Fiberを再利用（Update）
      newFiber = reuseFiber(matchedFiber, element)

      if (matchedFiber.index < lastPlacedIndex) {
        // 以前より前の位置にあった → 移動が必要
        newFiber.flags |= Placement
      } else {
        lastPlacedIndex = matchedFiber.index
      }
    } else {
      // 新規作成（Placement）
      newFiber = createFiberFromElement(element, i)
      newFiber.flags |= Placement

      // 古いFiberがあれば削除
      if (matchedFiber) {
        matchedFiber.flags |= Deletion
        deletions.push(matchedFiber)
      }
    }

    newFiber.return = wipFiber
    newFiber.index = i

    if (index === 0) {
      wipFiber.child = newFiber
    } else if (prevSibling) {
      prevSibling.sibling = newFiber
    }

    prevSibling = newFiber
    index++
  }

  // 使われなかった既存Fiberはすべて削除
  existingFibers.forEach((fiber) => {
    fiber.flags |= Deletion
    deletions.push(fiber)
  })
}

/**
 * Fiberを再利用できるか判定する
 * type が同じなら再利用可能（DOMを保持したまま更新する）
 */
function canReuse(fiber: Fiber, element: VNode | string | number): boolean {
  if (typeof element === 'string' || typeof element === 'number') {
    return fiber.tag === HostText
  }
  return fiber.type === (element as VNode).type
}

/**
 * 既存Fiberを新しいpropsで更新するFiberを作成する
 */
function reuseFiber(existing: Fiber, element: VNode | string | number): Fiber {
  const clone = createWorkInProgress(existing, getPropsFromElement(element))
  clone.flags |= Update
  // UpdateフラグをセットしてcommitでDOM属性を更新する
  // ただしPlacementでない場合はDOM移動は不要
  clone.flags &= ~Placement  // Updateのみ（Placementを外す）
  return clone
}

function getPropsFromElement(element: VNode | string | number) {
  if (typeof element === 'string' || typeof element === 'number') {
    return { nodeValue: String(element) }
  }
  return (element as VNode).props
}

/**
 * VNodeから新しいFiberを作成する
 */
function createFiberFromElement(element: VNode | string | number, index: number): Fiber {
  if (typeof element === 'string' || typeof element === 'number') {
    const fiber = createFiber(HostText, null, { nodeValue: String(element) })
    fiber.index = index
    return fiber
  }

  const vnode = element as VNode
  let tag = FunctionComponent

  if (vnode.type === Fragment) {
    // Fragmentは特殊なFunctionComponentとして扱う
    // DOM要素を生成せず、子を直接親に接続する
    const fiber = createFiber(FunctionComponent, Fragment as any, vnode.props, vnode.key)
    fiber.index = index
    return fiber
  }

  if (typeof vnode.type === 'string') {
    tag = HostComponent
  }

  const fiber = createFiber(tag as import('./types').WorkTag, vnode.type as any, vnode.props, vnode.key)
  fiber.index = index
  return fiber
}

/**
 * Fiberからルート（FiberRoot）を探す
 */
function getRoot(fiber: Fiber): FiberRoot | null {
  let node: Fiber | null = fiber
  while (node) {
    if (node.tag === HostRoot) {
      return node.stateNode as FiberRoot
    }
    node = node.return
  }
  return null
}

// 内部状態へのアクセサ（commit.tsから使用）
export function getCurrentRoot(): Fiber | null {
  return currentRoot
}

export function setCurrentRoot(root: Fiber): void {
  currentRoot = root
}

export function setWipRoot(root: Fiber | null): void {
  wipRoot = root
}
