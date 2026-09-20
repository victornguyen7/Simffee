/**
 * The simulation. This file owns truth and knows nothing about drawing.
 * One tick is one minute of shop time. Call step() to advance the world.
 */

export const TILE = 28

/** '#' wall, '.' floor, 'C' counter, 'T' table, 'D' door */
const MAP_ART = [
  '####################',
  '#..................#',
  '#..CCCCCC..........#',
  '#..................#',
  '#.........T..T..T..#',
  '#..................#',
  '#.........T..T..T..#',
  '#..................#',
  '#.........T..T..T..#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '########DD##########'
]

export type TileKind = 'floor' | 'wall' | 'counter' | 'table' | 'door'

export const GRID_W = MAP_ART[0].length
export const GRID_H = MAP_ART.length

export const TILES: TileKind[][] = MAP_ART.map((row) =>
  [...row].map((ch) => {
    if (ch === '#') return 'wall'
    if (ch === 'C') return 'counter'
    if (ch === 'T') return 'table'
    if (ch === 'D') return 'door'
    return 'floor'
  })
)

const DOOR = { x: 8.5, y: 12.5 }

/** Where customers stand to be served, and the line stretching back from it. */
const SERVE_SPOT = { x: 4, y: 3 }
const QUEUE_SLOTS = Array.from({ length: 9 }, (_, i) => ({ x: 4, y: 4 + i }))

const TABLE_SPOTS: { x: number; y: number }[] = []
TILES.forEach((row, y) =>
  row.forEach((kind, x) => {
    if (kind === 'table') TABLE_SPOTS.push({ x, y })
  })
)

export type CustomerState =
  | 'entering'
  | 'queueing'
  | 'ordering'
  | 'toTable'
  | 'seated'
  | 'leaving'
  | 'gone'

export type Mood = 'neutral' | 'happy' | 'annoyed'

export type Facing = 'up' | 'down' | 'left' | 'right'

export interface Customer {
  id: number
  x: number
  y: number
  tx: number
  ty: number
  state: CustomerState
  /** Ticks this customer will tolerate in line before walking out. */
  patience: number
  waited: number
  timer: number
  tableIndex: number | null
  mood: Mood
  carrying: boolean
  facing: Facing
  /** Counts up only while walking, so the legs animate at walking pace. */
  anim: number
}

export interface SimConfig {
  baristas: number
  price: number
  /** Ticks one barista spends making one order. */
  serviceTicks: number
  dayLength: number
}

export interface DayStats {
  day: number
  served: number
  walkouts: number
  revenue: number
  totalWait: number
  satisfaction: number
}

export interface World {
  day: number
  tick: number
  customers: Customer[]
  queue: number[]
  baristaBusy: number[]
  tables: { x: number; y: number; takenBy: number | null }[]
  stats: DayStats
  history: DayStats[]
  /** Carries across days. Bad service today means fewer people tomorrow. */
  reputation: number
  config: SimConfig
  nextId: number
}

export const DEFAULT_CONFIG: SimConfig = {
  baristas: 1,
  price: 4.5,
  serviceTicks: 14,
  dayLength: 420
}

function emptyStats(day: number): DayStats {
  return { day, served: 0, walkouts: 0, revenue: 0, totalWait: 0, satisfaction: 1 }
}

export function createWorld(config: SimConfig = DEFAULT_CONFIG): World {
  return {
    day: 1,
    tick: 0,
    customers: [],
    queue: [],
    baristaBusy: Array.from({ length: config.baristas }, () => 0),
    tables: TABLE_SPOTS.map((t) => ({ ...t, takenBy: null })),
    stats: emptyStats(1),
    history: [],
    reputation: 1,
    config: { ...config },
    nextId: 1
  }
}

/** Two rushes: a big one at opening, a smaller afternoon one. */
function arrivalChance(world: World): number {
  const t = world.tick / world.config.dayLength
  const morning = Math.exp(-((t - 0.2) ** 2) / 0.012)
  const afternoon = 0.55 * Math.exp(-((t - 0.66) ** 2) / 0.03)
  const base = 0.06 + 0.5 * (morning + afternoon)

  // Pricier coffee means fewer people through the door.
  const priceFactor = Math.max(0.3, Math.min(1.35, 1.75 - world.config.price / 4))
  return base * priceFactor * world.reputation
}

function spawn(world: World): void {
  const patience = 45 + Math.floor(Math.random() * 65)
  world.customers.push({
    id: world.nextId++,
    x: DOOR.x,
    y: DOOR.y,
    tx: DOOR.x,
    ty: DOOR.y - 1,
    state: 'entering',
    patience,
    waited: 0,
    timer: 0,
    tableIndex: null,
    mood: 'neutral',
    carrying: false,
    facing: 'up',
    anim: 0
  })
}

const SPEED = 0.34

/** Steps one tile-space toward the target, x first then y. */
function moveToward(c: Customer): boolean {
  const dx = c.tx - c.x
  const dy = c.ty - c.y

  if (Math.abs(dx) < SPEED && Math.abs(dy) < SPEED) {
    c.x = c.tx
    c.y = c.ty
    return true
  }

  if (Math.abs(dx) >= SPEED) {
    c.x += Math.sign(dx) * SPEED
    c.facing = dx > 0 ? 'right' : 'left'
  } else {
    c.y += Math.sign(dy) * SPEED
    c.facing = dy > 0 ? 'down' : 'up'
  }
  c.anim += 1
  return false
}

function queueTarget(index: number): { x: number; y: number } {
  if (index === 0) return SERVE_SPOT
  return QUEUE_SLOTS[Math.min(index - 1, QUEUE_SLOTS.length - 1)]
}

function leave(c: Customer, mood: Mood): void {
  c.state = 'leaving'
  c.mood = mood
  c.tx = DOOR.x
  c.ty = DOOR.y
}

export function step(world: World): void {
  const { config } = world

  if (world.tick < config.dayLength && Math.random() < arrivalChance(world)) {
    spawn(world)
  }

  // Free up baristas that finished an order.
  world.baristaBusy = world.baristaBusy.map((t) => Math.max(0, t - 1))

  for (const c of world.customers) {
    switch (c.state) {
      case 'entering': {
        if (moveToward(c)) {
          world.queue.push(c.id)
          c.state = 'queueing'
        }
        break
      }

      case 'queueing': {
        const index = world.queue.indexOf(c.id)
        const target = queueTarget(index)
        c.tx = target.x
        c.ty = target.y
        moveToward(c)

        c.waited += 1
        if (c.waited > c.patience) {
          // Walked out. This is the number that should hurt.
          world.queue = world.queue.filter((id) => id !== c.id)
          world.stats.walkouts += 1
          leave(c, 'annoyed')
          break
        }

        if (index === 0 && c.x === SERVE_SPOT.x && c.y === SERVE_SPOT.y) {
          const free = world.baristaBusy.findIndex((t) => t === 0)
          if (free !== -1) {
            world.baristaBusy[free] = config.serviceTicks
            world.queue.shift()
            c.state = 'ordering'
            c.timer = config.serviceTicks
          }
        }
        break
      }

      case 'ordering': {
        c.timer -= 1
        if (c.timer <= 0) {
          world.stats.served += 1
          world.stats.revenue += config.price
          world.stats.totalWait += c.waited
          c.carrying = true

          const freeTable = world.tables.findIndex((t) => t.takenBy === null)
          if (freeTable === -1) {
            // No seat, so they take it to go. Still a sale, slightly less happy.
            leave(c, 'neutral')
          } else {
            world.tables[freeTable].takenBy = c.id
            c.tableIndex = freeTable
            c.state = 'toTable'
            c.tx = world.tables[freeTable].x
            c.ty = world.tables[freeTable].y
          }
        }
        break
      }

      case 'toTable': {
        if (moveToward(c)) {
          c.state = 'seated'
          c.timer = 60 + Math.floor(Math.random() * 90)
          c.mood = 'happy'
        }
        break
      }

      case 'seated': {
        c.timer -= 1
        if (c.timer <= 0) {
          if (c.tableIndex !== null) world.tables[c.tableIndex].takenBy = null
          c.tableIndex = null
          leave(c, 'happy')
        }
        break
      }

      case 'leaving': {
        if (moveToward(c)) c.state = 'gone'
        break
      }

      case 'gone':
        break
    }
  }

  world.customers = world.customers.filter((c) => c.state !== 'gone')
  world.tick += 1
}

export function dayIsOver(world: World): boolean {
  return world.tick >= world.config.dayLength && world.customers.length === 0
}

/** Closes the books, updates reputation, and sets up the next day. */
export function endDay(world: World): void {
  const attempts = world.stats.served + world.stats.walkouts
  const servedShare = attempts === 0 ? 1 : world.stats.served / attempts
  const avgWait = world.stats.served === 0 ? 0 : world.stats.totalWait / world.stats.served
  const waitScore = Math.max(0, 1 - avgWait / 60)

  world.stats.satisfaction = Number((servedShare * 0.65 + waitScore * 0.35).toFixed(3))
  world.history.push({ ...world.stats })

  // Word of mouth: reputation drifts toward how today actually went.
  world.reputation = Number(
    Math.max(0.35, Math.min(1.25, world.reputation * 0.6 + world.stats.satisfaction * 0.6)).toFixed(3)
  )

  world.day += 1
  world.tick = 0
  world.customers = []
  world.queue = []
  world.tables = world.tables.map((t) => ({ ...t, takenBy: null }))
  world.baristaBusy = Array.from({ length: world.config.baristas }, () => 0)
  world.stats = emptyStats(world.day)
}

export function applyConfig(world: World, patch: Partial<SimConfig>): void {
  world.config = { ...world.config, ...patch }
  if (patch.baristas !== undefined) {
    world.baristaBusy = Array.from({ length: patch.baristas }, () => 0)
  }
}

export { SERVE_SPOT, QUEUE_SLOTS, DOOR }
