import { useEffect, useState } from 'react'
import WhatIfBox from '../components/WhatIfBox'
import type { Runs, WhatIfAnswer } from '../types'
import './whatif.css'

export default function WhatIf() {
  const [runs, setRuns] = useState<Runs | null>(null)
  const [current, setCurrent] = useState<WhatIfAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}runs.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`runs.json failed to load (${response.status})`)
        return response.json() as Promise<Runs>
      })
      .then((loaded) => alive && setRuns(loaded))
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div className="whatif-page">
        <h2>Ask the simulation</h2>
        <div className="check check--bad">runs.json did not load: {error}</div>
      </div>
    )
  }

  if (!runs) {
    return (
      <div className="whatif-page">
        <h2>Ask the simulation</h2>
        <p className="dim">Loading the simulation.</p>
      </div>
    )
  }

  return (
    <div className="whatif-page">
      <header className="whatif-page__head">
        <h2>Ask the simulation</h2>
        <p className="dim">Needs the local API: <code>python -m api.server --library runs/library --cache cache --offline</code></p>
      </header>
      <WhatIfBox runs={runs} current={current} onAnswer={setCurrent} />
    </div>
  )
}
