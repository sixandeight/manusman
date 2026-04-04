// src/components/ManusTools/PhysicsEngine.ts

import {
  forceSimulation,
  forceManyBody,
  forceCollide,
  forceLink,
  forceX,
  forceY,
  Simulation,
  SimulationNodeDatum,
  SimulationLinkDatum,
} from "d3-force"

// ── Types ──────────────────────────────────────────

export interface PhysicsNode extends SimulationNodeDatum {
  id: string
  width: number
  height: number
  targetWidth: number
  targetHeight: number
  zone: string
}

export interface PhysicsLink extends SimulationLinkDatum<PhysicsNode> {
  source: string | PhysicsNode
  target: string | PhysicsNode
}

// ── Zone targets ───────────────────────────────────

const ZONE_ORDER = ["NE", "E", "SE", "NW", "W", "SW", "N", "S"]

function getZoneTarget(zone: string, screenW: number, screenH: number): { x: number; y: number } {
  const pad = 200
  const targets: Record<string, { x: number; y: number }> = {
    NE: { x: screenW - pad, y: pad },
    E:  { x: screenW - pad, y: screenH / 2 },
    SE: { x: screenW - pad, y: screenH - pad },
    NW: { x: pad, y: pad },
    W:  { x: pad, y: screenH / 2 },
    SW: { x: pad, y: screenH - pad },
    N:  { x: screenW / 2, y: pad },
    S:  { x: screenW / 2, y: screenH - pad },
  }
  return targets[zone] || targets.NE
}

// ── Entity linker ──────────────────────────────────

const STOP_WORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "have", "has", "been", "will", "not", "are", "was", "were"])

interface CardData {
  id: string
  toolName: string
  query: string
  parsedResult: any | null
  resultText: string
}

function extractEntityFields(parsed: any): string[] {
  if (!parsed) return []
  const fields = ["company", "client", "name", "competitor_name", "us_name", "them_name", "person_or_company"]
  const values: string[] = []
  for (const f of fields) {
    if (parsed[f] && typeof parsed[f] === "string") {
      values.push(parsed[f].toLowerCase())
    }
  }
  return values
}

function extractProperNouns(text: string): string[] {
  if (!text) return []
  const matches = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || []
  return matches.filter(m => m.length > 3).map(m => m.toLowerCase())
}

export function findLinks(cards: CardData[]): Array<{ source: string; target: string }> {
  const links: Array<{ source: string; target: string }> = []
  const seen = new Set<string>()

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]
      const b = cards[j]
      const key = [a.id, b.id].sort().join("-")
      if (seen.has(key)) continue

      let linked = false

      // Layer 1: structured field match
      const aFields = extractEntityFields(a.parsedResult)
      const bFields = extractEntityFields(b.parsedResult)
      if (aFields.some(f => bFields.includes(f))) {
        linked = true
      }

      // Layer 2: query text match
      if (!linked && a.query && b.query) {
        const aq = a.query.toLowerCase()
        const bq = b.query.toLowerCase()
        if (aq.includes(bq) || bq.includes(aq)) {
          linked = true
        } else {
          const aWords = aq.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w))
          const bWords = new Set(bq.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)))
          if (aWords.some(w => bWords.has(w))) {
            linked = true
          }
        }
      }

      // Layer 3: proper nouns in result text
      if (!linked) {
        const aNouns = extractProperNouns(a.resultText)
        const bNouns = new Set(extractProperNouns(b.resultText))
        if (aNouns.some(n => bNouns.has(n))) {
          linked = true
        }
      }

      if (linked) {
        seen.add(key)
        links.push({ source: a.id, target: b.id })
      }
    }
  }

  return links
}

// ── Physics engine ─────────────────────────────────

export class PhysicsEngine {
  private simulation: Simulation<PhysicsNode, PhysicsLink>
  private nodes: PhysicsNode[] = []
  private links: PhysicsLink[] = []
  private screenW: number
  private screenH: number
  private zoneCounter = 0
  private nodeZones: Map<string, string> = new Map()
  private onTick: (positions: Map<string, { x: number; y: number }>) => void

  constructor(
    screenW: number,
    screenH: number,
    onTick: (positions: Map<string, { x: number; y: number }>) => void
  ) {
    this.screenW = screenW
    this.screenH = screenH
    this.onTick = onTick

    this.simulation = forceSimulation<PhysicsNode, PhysicsLink>()
      .velocityDecay(0.4)
      .alphaDecay(0.01)
      .alphaTarget(0)
      .force("charge", forceManyBody<PhysicsNode>().strength(-80).distanceMax(500))
      .force("collide", forceCollide<PhysicsNode>().radius(d => Math.max(d.width, d.height) / 2 + 24).strength(1))
      .force("link", forceLink<PhysicsNode, PhysicsLink>(this.links).id(d => d.id).distance(200).strength(0.3))
      .force("zoneX", forceX<PhysicsNode>().x(d => getZoneTarget(d.zone, screenW, screenH).x).strength(0.2))
      .force("zoneY", forceY<PhysicsNode>().y(d => getZoneTarget(d.zone, screenW, screenH).y).strength(0.2))
      .on("tick", () => {
        const cx = screenW / 2
        const cy = screenH / 2
        const CENTER_DEAD_ZONE = 150 // only push when card is within this radius of center

        const positions = new Map<string, { x: number; y: number }>()
        for (const node of this.nodes) {
          let dx = (node.x || 0) - cx
          let dy = (node.y || 0) - cy
          const dist = Math.sqrt(dx * dx + dy * dy)

          // Only apply center repulsion when card is near center
          if (dist < CENTER_DEAD_ZONE) {
            // If card is at exact center, nudge with random offset to escape dead zone
            if (dist < 1) {
              dx = (Math.random() - 0.5) * 2
              dy = (Math.random() - 0.5) * 2
            }
            const normDist = dist || 1
            const centerForce = 3 * (1 - dist / CENTER_DEAD_ZONE) // fade out near boundary
            node.vx = (node.vx || 0) + (dx / normDist) * centerForce
            node.vy = (node.vy || 0) + (dy / normDist) * centerForce
          }

          const x = Math.max(16, Math.min(this.screenW - node.width - 16, node.x || 0))
          const y = Math.max(16, Math.min(this.screenH - node.height - 16, node.y || 0))
          node.x = x
          node.y = y
          positions.set(node.id, { x, y })
        }
        this.onTick(positions)
      })

    this.simulation.stop()
  }

  public addNode(id: string, width: number, height: number, linkedToId?: string): void {
    // Guard against duplicate node IDs
    if (this.nodes.some(n => n.id === id)) return

    let zone: string
    if (linkedToId && this.nodeZones.has(linkedToId)) {
      zone = this.nodeZones.get(linkedToId)!
    } else {
      zone = ZONE_ORDER[this.zoneCounter % ZONE_ORDER.length]
      this.zoneCounter++
    }
    this.nodeZones.set(id, zone)

    const target = getZoneTarget(zone, this.screenW, this.screenH)
    const node: PhysicsNode = {
      id,
      x: target.x + (Math.random() - 0.5) * 60,
      y: target.y + (Math.random() - 0.5) * 60,
      width,
      height,
      targetWidth: width,
      targetHeight: height,
      zone,
    }
    this.nodes.push(node)
    this.simulation.nodes(this.nodes)
    this.simulation.alpha(0.5).restart()
  }

  public removeNode(id: string): void {
    this.nodes = this.nodes.filter(n => n.id !== id)
    this.links = this.links.filter(l => {
      const s = typeof l.source === "string" ? l.source : (l.source as PhysicsNode).id
      const t = typeof l.target === "string" ? l.target : (l.target as PhysicsNode).id
      return s !== id && t !== id
    })
    this.nodeZones.delete(id)
    this.simulation.nodes(this.nodes)
    ;(this.simulation.force("link") as any)?.links(this.links)
    this.simulation.alpha(0.1).restart()
  }

  public updateNodeSize(id: string, width: number, height: number): void {
    const node = this.nodes.find(n => n.id === id)
    if (!node) return
    node.width = width
    node.height = height
    node.targetWidth = width
    node.targetHeight = height
    // Recompute collision radii with updated sizes
    ;(this.simulation.force("collide") as ReturnType<typeof forceCollide<PhysicsNode>>)
      ?.radius(d => Math.max(d.width, d.height) / 2 + 24)
    this.simulation.alpha(0.3).restart()
  }

  public updateLinks(newLinks: Array<{ source: string; target: string }>): void {
    this.links = newLinks.map(l => ({ source: l.source, target: l.target }))
    ;(this.simulation.force("link") as ReturnType<typeof forceLink<PhysicsNode, PhysicsLink>>)
      ?.links(this.links)
    this.simulation.alpha(0.3).restart()
  }

  public destroy(): void {
    this.simulation.stop()
  }
}
