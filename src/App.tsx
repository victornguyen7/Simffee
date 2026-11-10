import { lazy, Suspense, useState } from 'react'
import Town from './pages/Town'
import type { ShopId } from './sim/runs'

// The town is the landing page; the others load on first visit so the first paint stays small.
const Shop = lazy(() => import('./pages/Shop'))
const Market = lazy(() => import('./pages/Market'))
const Conclusion = lazy(() => import('./pages/Conclusion'))
const WhatIf = lazy(() => import('./pages/WhatIf'))

type Scene =
  | { name: 'town' }
  | { name: 'interior'; shop: ShopId }
  | { name: 'market' }
  | { name: 'conclusion' }
  | { name: 'whatif' }

function App() {
  const [scene, setScene] = useState<Scene>({ name: 'town' })
  const fullBleed = scene.name !== 'market' && scene.name !== 'conclusion' && scene.name !== 'whatif'

  return (
    <div className={`shell ${fullBleed ? 'shell--full' : ''}`}>
      {/* Small floating controls so the scene underneath stays visible. */}
      <div className={`hud ${fullBleed ? 'hud--float' : ''}`}>
        <span className="hud__mark">Simffee</span>

        {scene.name !== 'town' && (
          <button className="hud__btn" onClick={() => setScene({ name: 'town' })}>
            ← town
          </button>
        )}

        <button
          className={`hud__btn ${scene.name === 'market' ? 'hud__btn--on' : ''}`}
          onClick={() => setScene(scene.name === 'market' ? { name: 'town' } : { name: 'market' })}
        >
          model
        </button>
        <button
          className={`hud__btn ${scene.name === 'conclusion' ? 'hud__btn--on' : ''}`}
          onClick={() => setScene(scene.name === 'conclusion' ? { name: 'town' } : { name: 'conclusion' })}
        >
          why
        </button>
        <button
          className={`hud__btn ${scene.name === 'whatif' ? 'hud__btn--on' : ''}`}
          onClick={() => setScene(scene.name === 'whatif' ? { name: 'town' } : { name: 'whatif' })}
        >
          ask
        </button>
      </div>

      <main className={`shell__body ${fullBleed ? 'shell__body--full' : ''}`}>
        {scene.name === 'town' && <Town onEnterShop={(shop) => setScene({ name: 'interior', shop })} />}
        <Suspense fallback={<p className="page-loading">Loading…</p>}>
          {scene.name === 'interior' && <Shop shop={scene.shop} />}
          {scene.name === 'market' && <Market />}
          {scene.name === 'conclusion' && <Conclusion />}
          {scene.name === 'whatif' && <WhatIf />}
        </Suspense>
      </main>
    </div>
  )
}

export default App