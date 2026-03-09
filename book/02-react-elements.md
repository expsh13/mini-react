# 第2章: JSXはなぜ動くのか — createElement の秘密

## 2.1 JSXはただの糖衣構文

こんなJSXを書いたとき、実際には何が起きているか。

```jsx
const element = <div className="greeting">Hello, World!</div>
```

TypeScriptコンパイラ（または Babel）はこれを次のように変換する：

```typescript
const element = MiniReact.createElement('div', { className: 'greeting' }, 'Hello, World!')
```

`tsconfig.json` の設定がこの変換を制御している：

```json
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "MiniReact.createElement"
  }
}
```

`jsxFactory` に指定した関数が、全てのJSXタグの変換先になる。

> **なぜ `import * as MiniReact from './index'` が必要か**
>
> `jsxFactory: "MiniReact.createElement"` という設定では、変換後のコードが `MiniReact.createElement(...)` という形になる。`MiniReact` という名前空間が必要なため、named import ではなく namespace import が必須だ。
>
> ```typescript
> import * as MiniReact from './index'   // ✓ 正しい
> import { createElement } from './index' // ✗ MiniReact が未定義になる
> ```

> **コラム: Classic Transform vs Automatic Transform**
>
> ここで使っている `"jsx": "react"` は **Classic Transform** と呼ばれる方式で、React 16以前からある変換だ。
> React 17 では **Automatic Transform**（`"jsx": "react-jsx"`）が導入された。
>
> |  | Classic (`react`) | Automatic (`react-jsx`) |
> |---|---|---|
> | 導入 | 〜React 16 | React 17〜 |
> | 変換先 | `React.createElement(...)` | `jsx()` / `jsxs()` from `react/jsx-runtime` |
> | import | 各ファイルに `import React` が必要 | 自動でimportされる（不要） |
> | childrenの渡し方 | 可変長引数 `(...children)` | `props.children` にまとめる |
>
> ```jsx
> // 同じJSX
> <div className="foo">Hello</div>
>
> // Classic 変換後
> React.createElement('div', { className: 'foo' }, 'Hello')
>
> // Automatic 変換後（react/jsx-runtime が自動でimportされる）
> import { jsx as _jsx } from 'react/jsx-runtime'
> _jsx('div', { className: 'foo', children: 'Hello' })
> ```
>
> mini-react では意図的に Classic を使っている。理由は：
> 1. **わかりやすさ** — JSXが関数呼び出しに変わるという概念が直感的に理解できる
> 2. **実装の単純さ** — Automatic には別途 `react/jsx-runtime` の実装（`jsx`・`jsxs`・`jsxDEV`）が必要になる
> 3. **カスタマイズのしやすさ** — `jsxFactory` 1行で任意の関数に向けられる
>
> 現代のReactアプリでは Automatic が標準だが、「JSXが何に変換されるか」を学ぶには Classic の方が透明性が高い。

## 2.2 "Virtual DOM" とは言わない

React elements のことを "Virtual DOM" と呼ぶ記事をよく見かける。しかし React 公式ドキュメントは "Virtual DOM" という用語を推奨していない。

React elements は単なる **プレーンなJavaScriptオブジェクト**だ。DOMではないし、仮想でもない。次の状態を記述したデータに過ぎない。

```typescript
// 型名の VNode は慣例的な略称（Virtual Node）。
// 概念としては React element が正式名称。
type VNode = {
  type: string | Function | null | symbol
  key: string | null
  props: {
    children: (VNode | string | number)[]
    [key: string]: any
  }
}
```

## 2.3 createElement の実装

```typescript
// src/createElement.ts

export const Fragment: unique symbol = Symbol('MiniReact.Fragment')

export function createElement(
  type: string | Function | null | typeof Fragment,
  props: Props | null,
  ...children: (VNode | string | number | boolean | null | undefined)[]
): VNode {
  // boolean / null / undefined は除外（条件付きレンダリングのため）
  const normalizedChildren = children
    .flat()
    .filter((child) => child !== null && child !== undefined && child !== false && child !== true)
    .map((child) => child as VNode | string | number)

  // key は props から取り出して専用フィールドへ
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
```

### ポイント解説

**`children` のフィルタリング：**

```jsx
{isLoggedIn && <UserGreeting />}
```

このコードは `isLoggedIn` が `false` のとき `false` を子として渡す。`false` を無視しないとテキスト "false" が表示されてしまう。

**`key` の分離：**

`key` は React が内部で使う特殊なプロパティだ。`props.key` としてコンポーネントに渡されることはない。`createElement` の段階で `props` から取り出して `vnode.key` に移す。

**`flat()` の理由：**

```jsx
<ul>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>
```

`map()` は配列を返すため、`children` は `[[<li/>, <li/>, <li/>]]` のような入れ子になる。`flat()` で平坦化する。

## 2.4 Fragment

`<></>` は `React.Fragment` へのシンタックスシュガーだ。Fragment はDOM要素を生成せず、複数の子要素をグループ化するためだけに使う。

```tsx
// JSX
<>
  <span>A</span>
  <span>B</span>
</>

// トランスパイル後
MiniReact.createElement(MiniReact.Fragment, null,
  MiniReact.createElement('span', null, 'A'),
  MiniReact.createElement('span', null, 'B')
)
```

`Fragment` を `unique symbol` として定義することで、文字列やFunctionと型レベルで区別できる。

## 2.5 動作確認

```typescript
import * as MiniReact from './src/index'

const element = MiniReact.createElement('div', { className: 'greeting' },
  MiniReact.createElement('h1', null, 'Hello'),
  MiniReact.createElement('p', null, 'This is a paragraph')
)

console.log(JSON.stringify(element, null, 2))
```

出力：

```json
{
  "type": "div",
  "key": null,
  "props": {
    "className": "greeting",
    "children": [
      {
        "type": "h1",
        "key": null,
        "props": { "children": ["Hello"] }
      },
      {
        "type": "p",
        "key": null,
        "props": { "children": ["This is a paragraph"] }
      }
    ]
  }
}
```

React elements は単なるオブジェクトだ。軽量で、シリアライズ可能で、Server Componentsでネットワーク越しに送れる理由がわかる。

## まとめ

- JSXは `createElement()` 呼び出しに変換される（`jsxFactory` 設定による）
- React elements は "Virtual DOM" ではなく、ただのJavaScriptオブジェクト
- `key` はpropsから分離して管理される（reconciliationで使う）
- `Fragment` はシンボルで表現される

### 演習問題

**Q**: `createElement('div', { key: 0 })` を呼んだとき、`key` の値はどうなるか？`0`（数値）か、`"0"`（文字列）か、`null` か？実際に試して確認してみよう。

---

**次章への問い：** React elementsをDOMに変換するにはどうすればいいか？最もシンプルな実装から始めて、その限界を体感しよう。
