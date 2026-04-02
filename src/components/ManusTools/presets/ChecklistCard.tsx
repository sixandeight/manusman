import React from "react"

interface ContextItem {
  text: string
  priority: "high" | "medium" | "low"
}

interface ChecklistItem {
  text: string
  checked: boolean
}

interface ChecklistData {
  title: string
  subtitle?: string
  context: ContextItem[]
  items: ChecklistItem[]
  notes?: string
}

const PRIORITY_COLORS = {
  high: "#f87171",
  medium: "#facc15",
  low: "#4ade80",
}

const ChecklistCard: React.FC<{ data: ChecklistData }> = ({ data }) => {
  return (
    <div className="space-y-3">
      {/* Title */}
      <div>
        <div className="text-base font-semibold text-gray-800">{data.title}</div>
        {data.subtitle && <div className="text-xs text-gray-400">{data.subtitle}</div>}
      </div>

      {/* Context bullets */}
      <div className="space-y-1">
        {data.context.map((c, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span
              className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
              style={{ background: PRIORITY_COLORS[c.priority] || PRIORITY_COLORS.medium }}
            />
            <span className="text-gray-600">{c.text}</span>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-gray-100" />

      {/* Action items */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-gray-300 uppercase tracking-wider">Talking points</div>
        {data.items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="w-4 h-4 rounded border border-gray-200 shrink-0 mt-0.5 flex items-center justify-center text-[10px] text-gray-200">
              {item.checked ? "x" : ""}
            </span>
            <span className="text-gray-600">{item.text}</span>
          </div>
        ))}
      </div>

      {/* Notes */}
      {data.notes && (
        <div className="text-xs text-gray-400 italic">{data.notes}</div>
      )}
    </div>
  )
}

export default ChecklistCard
