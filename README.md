# mini-react

React 18 の内部実装を自作して学ぶ教育用ライブラリ。

React・TypeScript を理解済みの中級者を対象に、Fiber アーキテクチャの全体像を最小限のコードで実装します。

## セットアップ

```bash
npm install
```

## テスト実行

```bash
npm test              # 全テスト
npm run test:ch02     # 第2章: createElement
npm run test:ch03     # 第3章: 再帰レンダラ
npm run test:ch04     # 第4章: Fiber データ構造
npm run test:ch05     # 第5章: ワークループ + Reconciliation
npm run test:ch06     # 第6章: コミットフェーズ
npm run test:ch07     # 第7章: useState + useRef
npm run test:ch08     # 第8章: useEffect
npm run test:ch09     # 第9章: 統合テスト（ストップウォッチ）
npm run typecheck     # TypeScript 型チェック
```

## ディレクトリ構成

```
src/
├── index.ts              # パブリック API
├── types.ts              # 共有型定義
├── createElement.ts      # JSX → React elements
├── render.ts             # 再帰レンダラ（第3章・歴史的実装）
├── fiber.ts              # Fiber データ構造
├── workLoop.ts           # ワークループ + Reconciliation
├── commit.ts             # コミットフェーズ
├── hooksDispatcher.ts    # Hooks ディスパッチャ
├── hooks/
│   ├── useState.ts
│   ├── useRef.ts
│   └── useEffect.ts
└── dom/
    └── domOperations.ts  # DOM ヘルパー

book/                     # 各章の解説（Markdown）
tests/                    # 章ごとのテスト
```

## 実装範囲

| 機能 | 実装 |
|---|---|
| `createElement` / JSX | ✅ |
| `createRoot` | ✅ |
| Fiber アーキテクチャ | ✅ |
| render phase（差分検出） | ✅ |
| commit phase（DOM反映） | ✅ |
| Fragment | ✅ |
| `useState` | ✅ |
| `useRef` | ✅ |
| `useEffect` | ✅ |
| Lanes（優先度） | ❌ 省略 |
| Concurrent Mode | ❌ 省略 |
| `useLayoutEffect` | ❌ 省略（コラムで解説） |
| Context / Portal | ❌ 省略 |

## 対象 React バージョン

React 18 ベース。`createRoot()` を主 API として実装し、Fiber アーキテクチャの全体像を学びます。Concurrent Mode のフルサポートには Lanes（優先度）システムが必要ですが、本実装では省略しています。React 19 でも Fiber の基盤は同じです。
