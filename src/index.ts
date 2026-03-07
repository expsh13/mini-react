/**
 * パブリックAPI
 *
 * namespace import が必須:
 *   import * as MiniReact from './index'
 *
 * tsconfig.json の jsxFactory: "MiniReact.createElement" により
 * JSX がこの namespace 経由でアクセスされる。
 * named import では MiniReact が未定義になるため使用不可。
 */

// Hooksのディスパッチャーを初期化するために先にインポート
import './hooks/useState'

export { createElement, Fragment } from './createElement'
export { createRoot } from './workLoop'
export { useState, useEffect, useRef } from './hooksDispatcher'
export type { VNode, Fiber, FiberRoot, Hook, Effect } from './types'
