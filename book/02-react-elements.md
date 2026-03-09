# 第2章: JSXはなぜ動くのか — createElement の秘密

## 2.1 JSXの正体

第1章の末尾で問いかけた。「JSXはどのようにしてReact elementsに変換されるのか？」

その前に、もう一歩手前の疑問から始めよう。

**JSXはHTMLに見えるが、ブラウザはJSXを理解できない。ではなぜ動くのか？**

答えは単純だ。JSXは実行される前に、ただのJavaScript関数呼び出しに変換されている。JSXは**糖衣構文（シンタックスシュガー）**に過ぎない。

こんなJSXを書いたとき：

```jsx
const element = <div className="greeting">Hello, World!</div>
```

TypeScriptコンパイラ（または Babel）はこれを次のように変換する：

```typescript
const element = MiniReact.createElement('div', { className: 'greeting' }, 'Hello, World!')
```

### なぜJSXが必要か

では逆に、JSXがなければどうなるか。`createElement` を手書きしてUIを記述することになる。1段のネストなら大した違いはない。しかし、実際のUIはネストが深い。

```typescript
// createElement を手書きした場合
const element = MiniReact.createElement('div', { className: 'app' },
  MiniReact.createElement('header', null,
    MiniReact.createElement('nav', null,
      MiniReact.createElement('a', { href: '/' }, 'Home'),
      MiniReact.createElement('a', { href: '/about' }, 'About')
    )
  )
)
```

同じ構造をJSXで書くとこうなる：

```jsx
const element = (
  <div className="app">
    <header>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    </header>
  </div>
)
```

UIの構造が一目で読み取れる。JSXはReactを「宣言的」にしている立役者だ。しかし実行時には、上の `createElement` の連鎖と完全に同じものになる。この変換をトランスパイルと呼ぶ。

### トランスパイルの流れ

JSXからReact elementsが生まれるまでの全体像を示す：

```
① JSX コード
   <div className="greeting">Hello</div>
        │
        ▼  コンパイラ（TypeScript / Babel）が変換
② JavaScript コード
   createElement('div', { className: 'greeting' }, 'Hello')
        │
        ▼  JavaScriptエンジンが実行
③ React element オブジェクト
   { type: 'div', key: null, props: { className: 'greeting', children: ['Hello'] } }
```

①から②はビルド時に起こり、②から③はブラウザでの実行時に起こる。

### tsconfig.json の設定

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

React elements のことを "Virtual DOM" と呼ぶ記事をよく見かける。しかし React 公式ドキュメントは "Virtual DOM" という用語を推奨していない。なぜだろうか。

理由は、**React elementsとDOMの対応関係が1:1ではない**からだ。関数コンポーネントの React element は DOM 要素を生成しない。Fragment も DOM 要素を生成しない。"仮想DOM" という名前は「DOMのコピーがメモリ上にある」という誤解を招く。実際には、React elements は次に画面がどうあるべきかを記述した**ただのデータ**であり、DOMの仮想的なコピーではない。

React elements は `type`、`key`、`props` の3つのフィールドを持つプレーンなオブジェクトだ。これが「ただのオブジェクト」であることには、設計上の重要な意味がある。

- **軽量** — DOMノードとは違い、メソッドもイベントハンドラの登録もない。生成コストが極めて低い
- **比較可能** — プレーンなオブジェクトなので、新旧を比較して差分を検出できる（これが reconciliation の基盤になる）
- **シリアライズ可能** — `JSON.stringify` できる。これはReact Server Componentsがサーバーからクライアントへネットワーク越しにReact elementsを送れる理由でもある

## 2.3 createElement の実装

いよいよ `createElement` を実装する。この関数の責務は、JSXから変換された引数を受け取り、React element オブジェクトを返すことだ。

まず、戻り値の型を定義する：

```typescript
// src/types.ts

type VNode = {
  type: string | Function | null | symbol
  key: string | null
  props: {
    children: (VNode | string | number)[]
    [key: string]: any
  }
}
```

`type` が `string` ならHTMLのホスト要素（`'div'`、`'span'` など）、`Function` なら関数コンポーネント、`symbol` ならFragment（後述）を表す。

では実装を見よう。なお、`Fragment` もこのファイルで定義しているが、解説は2.4で行う。

```typescript
// src/createElement.ts

export const Fragment: unique symbol = Symbol('MiniReact.Fragment')  // → 2.4で解説

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

### ステップバイステップ: ネストしたJSXの変換トレース

コードを読んだだけでは `createElement` がどう動くかイメージしにくい。ネストしたJSXが変換される過程を、内側から外側へ追ってみよう。

```jsx
// このJSXが…
<div className="app">
  <h1>Title</h1>
  <p>text</p>
</div>
```

コンパイラはこれを次の `createElement` 呼び出しに変換する：

```typescript
createElement('div', { className: 'app' },
  createElement('h1', null, 'Title'),
  createElement('p', null, 'text')
)
```

JavaScriptは関数の引数を**内側から**評価する。したがって実行順序はこうなる：

```
① createElement('h1', null, 'Title')
   → { type: 'h1', key: null, props: { children: ['Title'] } }

② createElement('p', null, 'text')
   → { type: 'p', key: null, props: { children: ['text'] } }

③ createElement('div', { className: 'app' }, ①の結果, ②の結果)
   → {
       type: 'div',
       key: null,
       props: {
         className: 'app',
         children: [
           { type: 'h1', key: null, props: { children: ['Title'] } },
           { type: 'p',  key: null, props: { children: ['text'] } }
         ]
       }
     }
```

この「内側から外側へ」の評価順序は、JSXの特別な仕組みではない。JavaScriptの関数呼び出しにおける引数評価の順序そのものだ。JSXが「ただの関数呼び出し」であることが、ここにも表れている。

### ポイント解説

**`children` のフィルタリング — なぜ `false` を除外するのか：**

```jsx
{isLoggedIn && <UserGreeting />}
```

このコードは `isLoggedIn` が `false` のとき `false` を子として渡す。`false` を無視しないとテキスト "false" が表示されてしまう。同様に `null`、`undefined`、`true` も除外する。

ただし **`number` は除外しない**。これは意図的な設計だが、有名な落とし穴を生む：

```jsx
{items.length && <ItemList items={items} />}
```

`items` が空配列のとき、`items.length` は `0` だ。`0` は number なのでフィルタリングされず、画面に `0` が表示されてしまう。本物のReactでも同じ挙動であり、`items.length > 0 &&` と書くのが正しいパターンだ。

**`key` の分離 — なぜ `props` に含めてはいけないのか：**

`key` は React が内部で使う特殊なプロパティだ。reconciliation（差分検出）の際に、要素の同一性を判定するために使われる。`createElement` の段階で `props` から取り出して `vnode.key` に移す。

この設計には明確な意図がある。コンポーネント内で `props.key` にアクセスできてはならないのだ。`key` はReactの内部メカニズムであり、コンポーネントのロジックが依存すべきものではない。もし `key` の値が必要なら、別のprop名（例: `id`）で明示的に渡すべきである。

**`flat()` の理由：**

```jsx
<ul>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>
```

`map()` は配列を返すため、`children` は `[[<li/>, <li/>, <li/>]]` のような入れ子になる。`flat()` で平坦化する。

## 2.4 Fragment

Reactコンポーネントは1つのルート要素を返す必要がある。しかし、UIの都合上、不要な `<div>` でラップしたくないケースは多い。たとえばテーブルの行で `<td>` を複数返したいとき、ラッパーの `<div>` を入れるとHTMLとして不正になる。

Fragmentはこの問題を解決する。DOM要素を生成せずに、複数の子要素をグループ化するための仕組みだ。

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

`Fragment` を `unique symbol` として定義している理由は何か。2.3で見たように、`createElement` の `type` が文字列なら「ホスト要素（DOM要素を作る）」、関数なら「コンポーネント」として扱われる。FragmentはどちらでもないDOMノードを作りたくないし、関数でもない。もし文字列 `"Fragment"` で表現すると、reconcilerが `<Fragment>` というDOM要素を作ろうとしてしまう。symbol を使えば、文字列とも関数とも型レベルで明確に区別でき、「DOMを作らない特殊な要素」であることを型システムで保証できる。

```typescript
export const Fragment: unique symbol = Symbol('MiniReact.Fragment')
```

Fragment の children は通常の要素と同じように `createElement` で処理される。違いが現れるのは後の章だ。第4章でFiberツリーを構築する際、Fragment は DOM ノードを持たないため、その children は親の DOM ノードに直接配置される。

## 2.5 動作確認

2.3〜2.4で学んだことを組み合わせて、条件付きレンダリングとFragmentを含む例を試してみよう。

```tsx
import * as MiniReact from './src/index'

const isLoggedIn = true
const items: string[] = []

const element = (
  <div className="app">
    <h1>Hello</h1>
    {isLoggedIn && <p>Welcome back</p>}
    {items.length && <ul>...</ul>}
    <>
      <span>A</span>
      <span>B</span>
    </>
  </div>
)

console.log(JSON.stringify(element, null, 2))
```

出力されたオブジェクトをツリーとして可視化するとこうなる：

```
element (type: 'div')
├── props.className: 'app'
└── children
    ├── [0] (type: 'h1')
    │   └── children: ['Hello']
    ├── [1] (type: 'p')           ← isLoggedIn が true なので残る
    │   └── children: ['Welcome back']
    ├── [2] 0                      ← items.length が 0（numberなので除外されない！）
    └── [3] (type: Symbol(MiniReact.Fragment))
        └── children
            ├── [0] (type: 'span') → children: ['A']
            └── [1] (type: 'span') → children: ['B']
```

注目すべき点が2つある。

1つ目は `items.length && ...` の結果だ。`items` は空配列なので `items.length` は `0` だ。`0` は number であるため `createElement` のフィルタリングを通過し、children に残ってしまう。画面には `0` が表示される。2.3のポイント解説で触れた落とし穴が、ここで実際に観察できる。

2つ目は Fragment だ。`type` が `Symbol(MiniReact.Fragment)` になっている。文字列ではないため、DOM要素は生成されない。Fragment の children である2つの `<span>` は、最終的に親の `<div>` の直下に配置される。

ここで重要なのは、このツリーは**DOMではない**ということだ。ブラウザ上には何も表示されていない。`createElement` が返すのは「画面がどうあるべきか」を記述したデータに過ぎない。

このツリー構造が、第4章でFiberツリーに変換され、第6章でDOMに反映される。

## まとめ

この章では、JSXの正体を明らかにした。

- JSXは `createElement()` 呼び出しに変換される糖衣構文である
- React elements は "Virtual DOM" ではなく、ただのJavaScriptオブジェクト。軽量で、比較可能で、シリアライズ可能だ
- `key` はpropsから分離して管理される（コンポーネントからアクセスさせない設計意図がある）
- `Fragment` はsymbolで表現され、DOM要素を生成しないグループ化の仕組みである

ここまでの全体像を確認しよう。最終的に、Reactがユーザーのコードを画面に表示するまでには3段階の変換がある：

```
React elements        Fiber              DOM
{ type, props } ──▶ Fiber ノード ──▶ 実際の DOM ノード
   (第2章)           (第4-5章)          (第6章)
```

本章で作ったのは最初の段階だ。`createElement` は「画面をこうしたい」という宣言を、プレーンなオブジェクトのツリーとして表現する。

ただし、次の第3章ではいきなりFiberには進まない。まずはFiberを使わずにReact elementsから直接DOMを生成する素朴な再帰レンダラを実装する。動くものを作ったうえで、その限界を体感してから、第4章でFiberアーキテクチャの必要性を実感する流れだ。

### 演習問題

**Q**: `createElement('div', { key: 0 })` を呼んだとき、`key` の値はどうなるか？`0`（数値）か、`"0"`（文字列）か、`null` か？実際に試して確認してみよう。

---

**次章への問い：** React elementsをDOMに変換するにはどうすればいいか？最もシンプルな実装から始めて、その限界を体感しよう。
