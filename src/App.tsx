import Shop from './pages/Shop'

function App() {
  return (
    <div className="shell">
      <header className="shell__bar">
        <span className="shell__wordmark">Simffee</span>
        <span className="shell__tagline">watch a coffee shop run itself, day after day</span>
      </header>

      <main className="shell__body">
        <Shop />
      </main>
    </div>
  )
}

export default App
