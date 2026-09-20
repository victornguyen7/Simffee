import { useEffect, useRef } from 'react'
import type { Row, Runs, ShopId } from '../types'
import { drawPerson, shade } from '../town/draw'
import { shopColor } from '../shops'

interface Props {
  runs: Runs
  shopId: ShopId
  rows: Row[]
  day: number
  sales: Record<string, number>
  onClose: () => void
}

const vnd = (n: number) => `${(n / 1000).toFixed(0)}k`

export default function ShopInterior({ runs, shopId, rows, day, sales, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shop = runs.shops[shopId]
  const visitors = rows.filter((r) => r.choice === shopId)
  const lost = rows.filter((r) => r.choice !== shopId)
  const accent = shopColor(runs, shopId)
  const visitorsRef = useRef(visitors)

  useEffect(() => {
    visitorsRef.current = visitors
  }, [visitors])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    const render = (t: number) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const bw = Math.round(rect.width * dpr)
      const bh = Math.round(rect.height * dpr)
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const w = rect.width
      const h = rect.height
      // back wall + floor
      ctx.fillStyle = '#f2e6d2'
      ctx.fillRect(0, 0, w, h * 0.55)
      ctx.fillStyle = '#c99a63'
      ctx.fillRect(0, h * 0.55, w, h * 0.45)
      for (let i = 0; i < 14; i++) {
        ctx.strokeStyle = 'rgba(120,80,40,0.25)'
        ctx.beginPath()
        ctx.moveTo(0, h * 0.55 + i * 14)
        ctx.lineTo(w, h * 0.55 + i * 14)
        ctx.stroke()
      }
      // menu board
      ctx.fillStyle = shade(accent, -0.25)
      ctx.fillRect(w * 0.08, 24, w * 0.3, 96)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 13px ui-monospace, monospace'
      ctx.textAlign = 'left'
      Object.entries(shop.price).forEach(([item, price], i) => {
        ctx.fillText(`${item.padEnd(10, ' ')} ${vnd(price)}`, w * 0.08 + 14, 52 + i * 22)
      })
      // shelves
      ctx.fillStyle = '#a97a4e'
      ctx.fillRect(w * 0.55, 40, w * 0.33, 10)
      ctx.fillRect(w * 0.55, 84, w * 0.33, 10)
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = ['#e2584f', '#f2b544', '#6b4ec4', '#2f9e7a'][i % 4]
        ctx.fillRect(w * 0.56 + i * 22, 22, 12, 18)
        ctx.fillRect(w * 0.56 + i * 22, 66, 12, 18)
      }
      // counter
      const counterY = h * 0.52
      ctx.fillStyle = shade(accent, 0.1)
      ctx.fillRect(w * 0.12, counterY, w * 0.76, 22)
      ctx.fillStyle = shade(accent, -0.3)
      ctx.fillRect(w * 0.12, counterY + 22, w * 0.76, 14)
      // espresso machine
      ctx.fillStyle = '#b9c3cc'
      ctx.fillRect(w * 0.62, counterY - 34, 70, 34)
      ctx.fillStyle = '#3d4a55'
      ctx.fillRect(w * 0.64, counterY - 24, 50, 12)

      // barista behind the counter
      ctx.save()
      ctx.translate(w * 0.3, counterY + 4)
      drawPerson(ctx, 2, false, t, false)
      ctx.restore()

      // queue of the twins who bought here today
      visitorsRef.current.forEach((row, i) => {
        const twin = runs.twins.find((tw) => tw.id === row.twin)
        const x = w * 0.18 + i * 62
        const y = h * 0.86 - (i % 2) * 26
        ctx.save()
        ctx.translate(x, y)
        drawPerson(ctx, runs.twins.findIndex((tw) => tw.id === row.twin), false, t, false)
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = '#3a2f26'
        ctx.fillText(twin?.name ?? row.twin, 0, 12)
        ctx.font = '9px ui-monospace, monospace'
        ctx.fillStyle = '#6b5a4a'
        ctx.fillText(vnd(row.spent), 0, 23)
        ctx.restore()
      })

      // steam
      for (let i = 0; i < 3; i++) {
        const p = ((t / 22 + i * 40) % 120) / 120
        ctx.beginPath()
        ctx.arc(w * 0.66 + Math.sin(p * 6 + i) * 6, counterY - 40 - p * 40, 4 + p * 4, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - p)})`
        ctx.fill()
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [accent, runs.twins, shop.price])

  return (
    <div className="interior-overlay" role="dialog" aria-label={`${shop.name} interior`}>
      <div className="interior">
        <header>
          <h2 style={{ color: accent }}>{shop.name}</h2>
          <span className="muted">
            day {day} · open {shop.open}–{shop.close} · avg wait {shop.avg_wait_min}m · quality{' '}
            {shop.quality.toFixed(2)}
          </span>
          <button type="button" onClick={onClose}>
            back to town
          </button>
        </header>
        <canvas ref={canvasRef} className="interior-canvas" />
        <div className="interior-stats">
          <div>
            <strong>{vnd(sales[shopId])}</strong>
            <span>revenue today</span>
          </div>
          <div>
            <strong>{visitors.length}</strong>
            <span>customers served</span>
          </div>
          <div>
            <strong>{lost.length}</strong>
            <span>twins who went elsewhere</span>
          </div>
        </div>
        <ul className="interior-log">
          {rows.map((row) => {
            const twin = runs.twins.find((t) => t.id === row.twin)
            const here = row.choice === shopId
            return (
              <li key={row.twin} className={here ? 'here' : 'gone'}>
                <b>{twin?.name ?? row.twin}</b>
                <span className="tag">{here ? row.mode : row.choice === 'none' ? 'skipped' : `went to ${row.choice}`}</span>
                <span className="why">{row.reasoning}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
