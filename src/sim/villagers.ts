import { AGENTS } from './engine'
import { BUILDINGS, DECOR, T, WAYPOINTS, type DecorKind, type Waypoint } from './town'
import type { Facing } from './sprites'

export interface Villager {
  id: string
  index: number
  name: string
  x: number
  y: number
  target: Waypoint
  facing: Facing
  anim: number
  /** Ticks to stand still before picking a new destination. */
  pause: number
  /** Consecutive frames spent unable to move, used to bail out of corners. */
  stuck: number
  /** What they are saying right now, if anything. */
  chat: { text: string; ttl: number } | null
  /** Frames before this villager will strike up another conversation. */
  chatCooldown: number
}

/**
 * Small talk. Most of it is about the two cafes, because word of mouth is the
 * only way the startup reaches people who have never visited it.
 */
const LINES = [
  'have you tried the new place?',
  'their cold brew flight is unreal',
  'four twenty five for a coffee though',
  'Brewhouse never changes and I like that',
  'the oat cortado is worth it',
  'queue was out the door this morning',
  'I walked past, it smelled amazing',
  'still cheaper down the road',
  'the seasonal syrup bar is a gimmick',
  'I might switch, honestly',
  'too far for me, sadly',
  'my usual is fine, thanks',
  'did you see how busy it was?',
  'I heard good things'
]

const SPEED = 0.55

/** How much space each kind of scenery takes up on the ground. */
const BLOCK_SIZE: Partial<Record<DecorKind, [number, number]>> = {
  tree: [T * 0.5, T * 0.28],
  pine: [T * 0.45, T * 0.25],
  bush: [T * 0.5, T * 0.28],
  bench: [T * 0.85, T * 0.3],
  planter: [T * 0.4, T * 0.28],
  crate: [T * 0.4, T * 0.3],
  barrel: [T * 0.35, T * 0.28],
  lamp: [T * 0.18, T * 0.18],
  mailbox: [T * 0.22, T * 0.18],
  bistro: [T * 1.0, T * 0.4],
  fence: [T * 1.35, T * 0.3]
}

interface Blocker {
  x: number
  y: number
  hw: number
  hh: number
}

/** Built once. Flowers and rocks are left walkable so the town still feels open. */
const BLOCKERS: Blocker[] = [
  ...BUILDINGS.map((b) => ({
    x: b.box.x + b.box.w / 2,
    y: b.box.y + b.box.h - T * 0.35,
    hw: b.box.w / 2 - 2,
    hh: T * 0.5
  })),
  ...DECOR.flatMap((d) => {
    const size = BLOCK_SIZE[d.kind]
    if (!size) return []
    return [{ x: d.x, y: d.y - size[1] * 0.4, hw: size[0], hh: size[1] }]
  })
]

/** Villagers are about this wide, so they stop before clipping a trunk. */
const BODY = T * 0.22

function blockedAt(x: number, y: number): boolean {
  for (const b of BLOCKERS) {
    if (Math.abs(x - b.x) < b.hw + BODY && Math.abs(y - b.y) < b.hh + BODY) return true
  }
  return false
}

function homeSpot(agentId: string): Waypoint {
  const home = BUILDINGS.find((b) => b.id === agentId)
  if (!home) return WAYPOINTS[0]
  return { x: home.door.x + home.door.w / 2, y: home.box.y + home.box.h + T * 0.9 }
}

/**
 * Roughly half the time a villager heads for whoever else is out and about,
 * which is what actually makes conversations happen. The rest of the time they
 * pick a spot on the pavement or a plaza.
 */
function pickTarget(self?: Villager, all?: Villager[]): Waypoint {
  if (self && all && all.length > 1 && Math.random() < 0.55) {
    const others = all.filter((o) => o !== self)
    const other = others[Math.floor(Math.random() * others.length)]
    return {
      x: other.x + (Math.random() < 0.5 ? -T * 1.1 : T * 1.1),
      y: other.y + (Math.random() - 0.5) * T
    }
  }
  return WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)]
}

export function createVillagers(): Villager[] {
  return AGENTS.map((agent, index) => {
    const spot = homeSpot(agent.id)
    return {
      id: agent.id,
      index,
      name: agent.name.split(' ')[0],
      x: spot.x,
      y: spot.y,
      target: spot,
      facing: 'down' as Facing,
      anim: 0,
      pause: Math.floor(Math.random() * 90),
      stuck: 0,
      chat: null,
      chatCooldown: Math.floor(Math.random() * 180)
    }
  })
}

/**
 * Moves everyone one step. Walking is axis aligned, x first then y, which
 * keeps people looking like they are following the pavement rather than
 * drifting diagonally across gardens.
 */
const CHAT_RANGE = T * 2.6

/** Pairs up neighbours who are standing still and gets them talking. */
function maybeChat(villagers: Villager[]): void {
  for (const a of villagers) {
    if (a.chat || a.chatCooldown > 0) continue

    for (const b of villagers) {
      if (b === a || b.chat || b.chatCooldown > 0) continue

      const dx = b.x - a.x
      const dy = b.y - a.y
      if (Math.abs(dx) > CHAT_RANGE || Math.abs(dy) > CHAT_RANGE) continue

      const ttl = 220 + Math.floor(Math.random() * 160)
      a.chat = { text: LINES[Math.floor(Math.random() * LINES.length)], ttl }
      b.chat = { text: LINES[Math.floor(Math.random() * LINES.length)], ttl: ttl + 70 }

      // turn to face each other
      if (Math.abs(dx) > Math.abs(dy)) {
        a.facing = dx > 0 ? 'right' : 'left'
        b.facing = dx > 0 ? 'left' : 'right'
      } else {
        a.facing = dy > 0 ? 'down' : 'up'
        b.facing = dy > 0 ? 'up' : 'down'
      }

      // stay put for the length of the conversation
      a.pause = ttl
      b.pause = ttl
      a.chatCooldown = ttl + 420
      b.chatCooldown = ttl + 420
      break
    }
  }
}

export function stepVillagers(villagers: Villager[]): void {
  maybeChat(villagers)

  for (const v of villagers) {
    if (v.chatCooldown > 0) v.chatCooldown -= 1

    if (v.chat) {
      v.chat.ttl -= 1
      if (v.chat.ttl <= 0) {
        // Say goodbye and walk off. Without this they are still standing next
        // to each other when the cooldown ends, so they just chat forever.
        v.chat = null
        v.pause = 0
        v.stuck = 0
        v.target = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)]
      }
    }

    if (v.pause > 0) {
      v.pause -= 1
      continue
    }

    const dx = v.target.x - v.x
    const dy = v.target.y - v.y

    if (Math.abs(dx) < SPEED && Math.abs(dy) < SPEED) {
      v.x = v.target.x
      v.y = v.target.y
      v.target = pickTarget(v, villagers)
      v.pause = 30 + Math.floor(Math.random() * 150)
      continue
    }

    // Try the axis with the most distance left. If something is in the way,
    // slide along the other axis instead, which is what makes them walk around
    // trees rather than into them.
    const stepX = Math.sign(dx) * SPEED
    const stepY = Math.sign(dy) * SPEED
    const preferX = Math.abs(dx) >= SPEED

    let moved = false

    if (preferX && stepX !== 0 && !blockedAt(v.x + stepX, v.y)) {
      v.x += stepX
      v.facing = stepX > 0 ? 'right' : 'left'
      moved = true
    } else if (!preferX && stepY !== 0 && !blockedAt(v.x, v.y + stepY)) {
      v.y += stepY
      v.facing = stepY > 0 ? 'down' : 'up'
      moved = true
    }

    if (!moved) {
      // first choice was blocked, so go around
      if (stepY !== 0 && !blockedAt(v.x, v.y + stepY)) {
        v.y += stepY
        v.facing = stepY > 0 ? 'down' : 'up'
        moved = true
      } else if (stepX !== 0 && !blockedAt(v.x + stepX, v.y)) {
        v.x += stepX
        v.facing = stepX > 0 ? 'right' : 'left'
        moved = true
      }
    }

    if (!moved) {
      // properly stuck, so give up on this destination and pick another
      v.stuck += 1
      if (v.stuck > 20) {
        v.target = pickTarget(v, villagers)
        v.stuck = 0
        v.pause = 20
      }
      continue
    }

    v.stuck = 0
    v.anim += 1
  }
}

export function isWalking(v: Villager): boolean {
  return v.pause === 0
}