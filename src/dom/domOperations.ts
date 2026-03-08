import type { Props } from '../types'

// イベント名のプレフィックス
const EVENT_PREFIX = 'on'

/**
 * イベントハンドラのpropか判定する
 * onClick, onChange などは "on" で始まる
 */
export function isEventProp(key: string): boolean {
  return key.startsWith(EVENT_PREFIX)
}

/**
 * 通常のDOM属性か判定する（children と イベントハンドラ以外）
 */
export function isDOMProp(key: string): boolean {
  return key !== 'children' && !isEventProp(key)
}

/**
 * イベント名を取得する（onClick → click）
 */
export function getEventType(key: string): string {
  return key.slice(EVENT_PREFIX.length).toLowerCase()
}

/**
 * DOM要素にpropsを適用する
 * - イベントハンドラの登録
 * - className, style などの属性設定
 */
export function applyProps(dom: HTMLElement, props: Props): void {
  Object.keys(props).forEach((key) => {
    if (key === 'children') return

    if (isEventProp(key)) {
      const eventType = getEventType(key)
      dom.addEventListener(eventType, props[key])
    } else if (key === 'style' && typeof props[key] === 'object') {
      Object.assign(dom.style, props[key])
    } else if (key === 'className') {
      dom.setAttribute('class', props[key])
    } else if (key === 'htmlFor') {
      dom.setAttribute('for', props[key])
    } else if (typeof props[key] === 'boolean') {
      if (props[key]) {
        dom.setAttribute(key, '')
      } else {
        dom.removeAttribute(key)
      }
    } else if (props[key] != null) {
      dom.setAttribute(key, String(props[key]))
    }
  })
}

/**
 * DOM要素のpropsを更新する（差分のみ適用）
 * - 古いイベントハンドラを削除してから新しいものを登録
 * - 変更があった属性のみ更新
 */
export function updateProps(dom: HTMLElement, prevProps: Props, nextProps: Props): void {
  // 古いイベントハンドラを削除
  Object.keys(prevProps).forEach((key) => {
    if (isEventProp(key) && prevProps[key] !== nextProps[key]) {
      const eventType = getEventType(key)
      dom.removeEventListener(eventType, prevProps[key])
    }
  })

  // 削除されたプロパティをクリア
  Object.keys(prevProps).forEach((key) => {
    if (key === 'children') return
    if (!isEventProp(key) && !(key in nextProps)) {
      if (key === 'className') {
        dom.removeAttribute('class')
      } else {
        dom.removeAttribute(key)
      }
    }
  })

  // 新しいpropsを適用
  Object.keys(nextProps).forEach((key) => {
    if (key === 'children') return

    if (isEventProp(key)) {
      if (prevProps[key] !== nextProps[key]) {
        const eventType = getEventType(key)
        dom.addEventListener(eventType, nextProps[key])
      }
    } else if (key === 'style' && typeof nextProps[key] === 'object') {
      // 制限事項: Object.assignは古いstyleプロパティを削除しない。
      // 完全な実装では prevProps.style との差分で個別にクリアする必要がある。
      Object.assign(dom.style, nextProps[key])
    } else if (key === 'className') {
      dom.setAttribute('class', nextProps[key])
    } else if (key === 'htmlFor') {
      dom.setAttribute('for', nextProps[key])
    } else if (typeof nextProps[key] === 'boolean') {
      if (nextProps[key]) {
        dom.setAttribute(key, '')
      } else {
        dom.removeAttribute(key)
      }
    } else if (nextProps[key] != null) {
      if (prevProps[key] !== nextProps[key]) {
        dom.setAttribute(key, String(nextProps[key]))
      }
    }
  })
}

/**
 * DOM要素を作成し、propsを適用する
 */
export function createDOMElement(type: string, props: Props): HTMLElement {
  const dom = document.createElement(type)
  applyProps(dom, props)
  return dom
}

/**
 * テキストノードを作成する
 */
export function createTextNode(text: string | number): Text {
  return document.createTextNode(String(text))
}

/**
 * Fiberに対応するDOMノードの最初の子を挿入できる親DOMを探す
 * FunctionComponent と Fragment はDOM要素を持たないため、
 * returnを辿ってHostComponent/HostRootを探す必要がある
 */
export function getParentDOMNode(fiber: { return: any; stateNode: any; tag: number }): HTMLElement {
  let parent = fiber.return
  while (parent) {
    if (parent.stateNode instanceof HTMLElement) {
      return parent.stateNode
    }
    parent = parent.return
  }
  throw new Error('No parent DOM node found')
}
