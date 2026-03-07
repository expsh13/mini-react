import type { VNode, Props } from './types'

// Fragment シンボル（<></> や <Fragment> で使われる）
export const Fragment: unique symbol = Symbol('MiniReact.Fragment')

/**
 * JSX を React elements（VNode）に変換する関数
 *
 * JSX:   <div className="foo">Hello</div>
 * 変換後: createElement('div', { className: 'foo' }, 'Hello')
 *
 * tsconfig.json の jsxFactory: "MiniReact.createElement" によって
 * JSX がこの関数の呼び出しに変換される。
 *
 * 注: "Virtual DOM" という用語は使用しない。
 * React 公式が推奨する「React elements」という用語を使う。
 */
export function createElement(
  type: string | Function | null | typeof Fragment,
  props: Props | null,
  ...children: (VNode | string | number | boolean | null | undefined)[]
): VNode {
  // 子要素を正規化:
  // - boolean / null / undefined は無視（条件付きレンダリングのため）
  // - 文字列・数値はそのまま保持（HostText として後でFiberに変換）
  const normalizedChildren = children
    .flat()
    .filter((child) => child !== null && child !== undefined && child !== false && child !== true)
    .map((child) => child as VNode | string | number)

  // keyはpropsから取り出してVNodeの専用フィールドへ
  const { key = null, ...restProps } = props ?? {}

  return {
    type,
    key: key !== null ? String(key) : null,
    props: {
      ...restProps,
      children: normalizedChildren,
    },
  }
}
