/**
 * 第3章: 再帰レンダラ（暫定実装）
 *
 * これは「Fiberアーキテクチャが存在しない世界のReact」を体験するための実装。
 * 再帰的にDOMを構築するため、深いツリーでは主スレッドがブロックされる。
 *
 * 歴史的位置づけ:
 * - React 16未満はこのような再帰的reconcilerだった（Stack Reconciler）
 * - React 16以降はFiberアーキテクチャに移行（Fiber Reconciler）
 * - この実装の限界を体感することで、Fiberが必要な理由を理解する
 *
 * 注: ReactDOM.render() とは異なる独自実装。
 * 実際の ReactDOM.render() は React 18で非推奨、React 19で廃止。
 */

import type { VNode } from './types'
import { createDOMElement, createTextNode, applyProps } from './dom/domOperations'
import { Fragment } from './createElement'

/**
 * VNodeツリーを再帰的にDOMに変換してコンテナに追加する
 *
 * 限界:
 * - 一度開始すると中断できない（コールスタックが深くなるほど顕著）
 * - 大きなツリーでは16msフレームを超えてUIがフリーズする
 * - 差分検出がない（毎回全体を再構築）
 */
export function render(vnode: VNode | string | number, container: HTMLElement): void {
  container.innerHTML = ''
  const dom = createDOM(vnode)
  if (dom) {
    container.appendChild(dom)
  }
}

function createDOM(vnode: VNode | string | number): HTMLElement | Text | DocumentFragment | null {
  // テキストノード
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return createTextNode(vnode)
  }

  // null チェック
  if (!vnode || vnode.type === null) {
    return null
  }

  // Fragment: DOM要素を作らず子を直接返す
  if (vnode.type === Fragment) {
    const fragment = document.createDocumentFragment()
    const children = vnode.props.children || []
    children.forEach((child) => {
      const childDOM = createDOM(child)
      if (childDOM) fragment.appendChild(childDOM)
    })
    return fragment
  }

  // 関数コンポーネント: 実行して再帰
  if (typeof vnode.type === 'function') {
    const result = vnode.type(vnode.props)
    return result ? createDOM(result) : null
  }

  // DOM要素
  const dom = createDOMElement(vnode.type as string, vnode.props)

  // 子要素を再帰的に構築（ここが中断できないポイント）
  const children = vnode.props.children || []
  children.forEach((child) => {
    const childDOM = createDOM(child)
    if (childDOM) dom.appendChild(childDOM)
  })

  return dom
}
