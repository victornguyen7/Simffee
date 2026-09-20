import { useState } from 'react'
import Town from './pages/Town'
import Shop from './pages/Shop'
import Market from './pages/Market'
import Conclusion from './pages/Conclusion'
import type { ShopId } from './sim/runs'

type Scene =
  | { name: 'town' }
  | { name: 'interior'; shop: ShopId }
  | { name: 'market' }
  | { name: 'conclusion' }

function App() {
  const [scene, setScene] = useState<Scene>({ name: 'town' })
  const fullBleed = scene.name !== 'market' && scene.name !== 'conclusion'

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
      </div>

      <main className={`shell__body ${fullBleed ? 'shell__body--full' : ''}`}>
        {scene.name === 'town' && <Town onEnterShop={(shop) => setScene({ name: 'interior', shop })} />}
        {scene.name === 'interior' && <Shop shop={scene.shop} />}
        {scene.name === 'market' && <Market />}
        {scene.name === 'conclusion' && <Conclusion />}
      </main>
    </div>
  )
}

export default App