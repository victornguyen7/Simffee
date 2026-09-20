import { useState } from 'react'
import Town from './pages/Town'
import Shop from './pages/Shop'
import Market from './pages/Market'
import type { ShopId } from './sim/engine'

type Scene = { name: 'town' } | { name: 'interior'; shop: ShopId } | { name: 'market' }

function App() {
  const [scene, setScene] = useState<Scene>({ name: 'town' })
  const fullBleed = scene.name !== 'market'

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
      </div>

      <main className={`shell__body ${fullBleed ? 'shell__body--full' : ''}`}>
        {scene.name === 'town' && <Town onEnterShop={(shop) => setScene({ name: 'interior', shop })} />}
        {scene.name === 'interior' && <Shop />}
        {scene.name === 'market' && <Market />}
      </main>
    </div>
  )
}

export default App
