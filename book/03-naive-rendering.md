# 第3章: まず動かしてみる、そして壊れる

## 3.1 最もシンプルなアプローチ

React elementsをDOMに変換する最も直感的な方法は、再帰だ。

```typescript
function createDOM(vnode: VNode | string | number): HTMLElement | Text | null {
  // テキストノード
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return document.createTextNode(String(vnode))
  }

  // DOM要素: 作って属性を設定して子を再帰的に追加
  const dom = document.createElement(vnode.type as string)
  applyProps(dom, vnode.props)

  vnode.props.children.forEach((child) => {
    const childDOM = createDOM(child)
    if (childDOM) dom.appendChild(childDOM)
  })

  return dom
}
```

これで動く。しかし問題がある。

## 3.2 イベント委譲

DOMのイベントハンドリングには2つのアプローチがある。

**直接バインド（ナイーブな方法）：**
```typescript
dom.addEventListener('click', handler)
```

**イベント委譲（Reactの方法）：**
すべてのイベントをrootに委譲する。

```typescript
// dom/domOperations.ts

export function applyProps(dom: HTMLElement, props: Props): void {
  Object.keys(props).forEach((key) => {
    if (key === 'children') return

    if (key.startsWith('on')) {
      // onClick → 'click'
      const eventType = key.slice(2).toLowerCase()
      dom.addEventListener(eventType, props[key])
    } else if (key === 'className') {
      dom.setAttribute('class', props[key])
    } else {
      dom.setAttribute(key, String(props[key]))
    }
  })
}
```

本書では簡略化のため直接バインドを使用するが、実際のReactはすべてのイベントをrootコンテナに委譲している。これが `e.stopPropagation()` が期待通りに動かないケースの原因になることがある。

> **コラム: Reactのイベント委譲**
>
> React 17以前はすべてのイベントを `document` に委譲していた。React 17以降はrootコンテナ（`createRoot()` に渡したDOM要素）に委譲するように変更された。これにより複数のReactアプリを同じページに共存させやすくなった。

## 3.3 歴史的文脈：ReactDOM.render()

React 16-17には `ReactDOM.render()` というAPIがあった：

```typescript
// React 17 以前のAPI（現在は非推奨・React 19で廃止）
ReactDOM.render(<App />, document.getElementById('root'))
```

このAPIはReact 18で非推奨になり、React 19で廃止された。理由はConcurrent Modeと相容れないからだ。`ReactDOM.render()` は同期レンダリングを前提としており、render phaseの中断・再開ができない。

本書の再帰レンダラは `ReactDOM.render()` の実装ではなく、「Fiberアーキテクチャが存在しなかった時代のアプローチ」として位置づける。

## 3.4 失敗デモ：主スレッドのブロック

再帰レンダラの本質的な限界を体験してみよう。

```typescript
// 1万個の要素を作る
function createLargeTree(depth: number): VNode {
  if (depth === 0) return createElement('div', null, 'leaf')
  return createElement('div', null,
    createLargeTree(depth - 1),
    createLargeTree(depth - 1)
  )
}

// これを render するとブラウザがフリーズする
render(createLargeTree(13), container)  // 2^13 = 8192個のノード
```

なぜフリーズするか？JavaScriptはシングルスレッドで動く。再帰関数が実行中は、イベントループが止まる。ユーザーのクリックも、アニメーションのフレーム更新も、すべてが待たされる。

ブラウザは16ms（60fps）ごとにフレームを描画しようとする。再帰が16msを超えると、フレームが落ちてUIがカクつく。さらに長くなれば完全にフリーズしたように見える。

## 3.5 なぜ再帰では中断できないか

```
callStack:
  render(root)
    createDOM(div)           ← ここで止められない
      createDOM(div.child1)
        createDOM(div.child1.child1)
          ...深くなる一方
```

コールスタックは「今どこにいるか」を保持しているが、**途中で止めることができない**。一度 `render()` を呼んだら、最後まで実行しきらなければならない。

これがFiberが必要な理由だ。再帰スタックの代わりに、「今どこにいるか」をヒープ上のオブジェクト（Fiber）に保存すれば、いつでも中断してイベントループに制御を返せる。

## 3.6 実装の確認

```typescript
// 第3章の実装範囲
import { render } from './src/render'
import { createElement } from './src/createElement'

const container = document.getElementById('root')!

render(
  createElement('ul', null,
    createElement('li', null, 'Item 1'),
    createElement('li', null, 'Item 2'),
    createElement('li', null, 'Item 3')
  ),
  container
)
// → <ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>
```

## まとめ

**解決できたこと：**
- React elementsからDOMを生成できるようになった
- イベントハンドラを登録できる

**まだ解決できていないこと：**
- 大きなツリーで主スレッドがブロックされる
- 差分検出がない（毎回全体を再構築）
- 状態管理ができない（useStateが使えない）

---

**次章への問い：** 処理を「中断できる」とはどういうことか？そのために必要なデータ構造は何か？
