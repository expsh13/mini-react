/**
 * 第9章: 統合テスト — ストップウォッチアプリ
 *
 * useState・useEffect・useRef・Fragment・複数コンポーネントを
 * すべて組み合わせた E2E テスト。
 */

import '../src/hooks/useState'
import { createElement, Fragment } from '../src/createElement'
import { createRoot } from '../src/workLoop'
import { useState, useEffect, useRef } from '../src/hooksDispatcher'

// MessageChannel mock の setTimeout(0) をフラッシュする
// jest.runAllTimers() は setInterval と無限ループになるため使わない
function flushEffects(): void {
  jest.advanceTimersByTime(0)
}

// ============================================================
// ストップウォッチアプリ
// ============================================================

function Display({ time }: { time: number }) {
  return createElement('span', { id: 'time' }, `${time}s`)
}

function Controls({
  running,
  onStart,
  onStop,
  onReset,
}: {
  running: boolean
  onStart: () => void
  onStop: () => void
  onReset: () => void
}) {
  return createElement(Fragment, null,
    running
      ? createElement('button', { id: 'stop', onClick: onStop }, 'Stop')
      : createElement('button', { id: 'start', onClick: onStart }, 'Start'),
    createElement('button', { id: 'reset', onClick: onReset }, 'Reset')
  )
}

function Stopwatch() {
  const [time, setTime] = useState(0)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setTime((t) => t + 1)
      }, 1000)
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [running])

  return createElement('div', { id: 'stopwatch' },
    createElement(Display as any, { time }),
    createElement(Controls as any, {
      running,
      onStart: () => setRunning(true),
      onStop: () => setRunning(false),
      onReset: () => { setRunning(false); setTime(0) },
    })
  )
}

// ============================================================
// テスト
// ============================================================

describe('integration (Chapter 9): ストップウォッチ E2E', () => {
  let container: HTMLElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    jest.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(createElement(Stopwatch as any, null))
  })

  afterEach(() => {
    jest.useRealTimers()
    document.body.removeChild(container)
  })

  test('初期表示: 時間0・停止状態', () => {
    flushEffects()
    expect(container.querySelector('#time')?.textContent).toBe('0s')
    expect(container.querySelector('#start')).toBeTruthy()
    expect(container.querySelector('#stop')).toBeNull()
  })

  test('Start ボタンで動作状態になる', () => {
    flushEffects()
    container.querySelector('#start')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
    flushEffects()
    expect(container.querySelector('#stop')).toBeTruthy()
    expect(container.querySelector('#start')).toBeNull()
  })

  test('Stop で停止・時間はそのまま', () => {
    flushEffects()
    // Start
    container.querySelector('#start')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
    flushEffects()

    // 1秒進める
    jest.advanceTimersByTime(1000)
    flushEffects()

    // Stop
    container.querySelector('#stop')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
    flushEffects()

    expect(container.querySelector('#time')?.textContent).toBe('1s')
    expect(container.querySelector('#start')).toBeTruthy()
  })

  test('Reset でゼロに戻る', () => {
    flushEffects()
    // Start → 2秒 → Stop → Reset
    container.querySelector('#start')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
    flushEffects()
    jest.advanceTimersByTime(2000)
    flushEffects()

    container.querySelector('#reset')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
    flushEffects()

    expect(container.querySelector('#time')?.textContent).toBe('0s')
    expect(container.querySelector('#start')).toBeTruthy()
  })

  test('useRef: インターバルIDが再レンダリングをまたいで保持される', () => {
    flushEffects()
    // Start
    container.querySelector('#start')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
    flushEffects()

    // 3秒進める（3回の再レンダリングをまたぐ）
    jest.advanceTimersByTime(3000)
    flushEffects()

    expect(container.querySelector('#time')?.textContent).toBe('3s')

    // Stop でクリーンアップが正しく動作する
    container.querySelector('#stop')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
    flushEffects()

    // 停止後は増えない
    jest.advanceTimersByTime(2000)
    flushEffects()
    expect(container.querySelector('#time')?.textContent).toBe('3s')
  })
})
