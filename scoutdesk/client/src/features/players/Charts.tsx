import { Bar, BarChart, CartesianGrid, Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Pitch, px, py } from '@/components/pitch/Pitch'
import type { DisplayClip, RadarAxis } from '@/types'

const AXIS = { fill: 'hsl(var(--muted))', fontSize: 11 }
const TIP = { background: 'hsl(var(--raised))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12, color: 'hsl(var(--foreground))' }

export interface RadarSeries {
  name: string
  color: string
  values: Record<string, number>
  dashed?: boolean
}

/** Radar of the 8 profile axes (0–100) for one or more series. */
export function ProfileRadar({ axes, series, label }: { axes: { key: string; label: string }[]; series: RadarSeries[]; label: string }) {
  const data = axes.map((a) => ({ axis: a.label, ...Object.fromEntries(series.map((s) => [s.name, s.values[a.key] ?? 0])) }))
  return (
    <div role="img" aria-label={label} className="h-72 w-full">
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis dataKey="axis" tick={AXIS} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
          {series.map((s) => (
            <Radar key={s.name} name={s.name} dataKey={s.name} stroke={s.color} fill={s.color} fillOpacity={s.dashed ? 0.08 : 0.28} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} isAnimationActive={false} />
          ))}
          <Tooltip contentStyle={TIP} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function radarSeries(axes: RadarAxis[], name: string, color: string, peerName?: string): RadarSeries[] {
  const out: RadarSeries[] = [{ name, color, values: Object.fromEntries(axes.map((a) => [a.key, a.value])) }]
  if (peerName) out.push({ name: peerName, color: '#94a3b8', dashed: true, values: Object.fromEntries(axes.map((a) => [a.key, a.avg])) })
  return out
}

/** Tagged actions per tag, coloured by category. */
export function ActionsChart({ clips }: { clips: DisplayClip[] }) {
  const map = new Map<string, { tag: string; n: number; color: string }>()
  for (const c of clips) map.set(c.tag, { tag: c.tag, n: (map.get(c.tag)?.n ?? 0) + 1, color: c.color })
  const data = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 10)
  if (data.length === 0) return null
  return (
    <div role="img" aria-label={`Tagged actions by type: ${data.map((d) => `${d.tag} ${d.n}`).join(', ')}`} className="w-full" style={{ height: Math.max(120, data.length * 26 + 20) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
          <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="tag" width={110} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TIP} cursor={{ fill: 'hsl(var(--raised))' }} />
          <Bar dataKey="n" name="Actions" radius={[0, 3, 3, 0]} isAnimationActive={false} shape={(p: any) => <rect x={p.x} y={p.y} width={Math.max(0, p.width)} height={p.height} rx={3} fill={p.payload.color} />} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Heatmap / event map of a player's located actions. */
export function PlayerPitch({ clips, mode, label }: { clips: DisplayClip[]; mode: 'heat' | 'events'; label: string }) {
  const pts = clips.filter((c) => c.x != null && c.y != null)
  return (
    <div className="aspect-[109/72] w-full">
      <Pitch label={`${label}: ${pts.length} located actions`} heat={mode === 'heat' ? pts.map((c) => ({ x: c.x!, y: c.y! })) : null} heatColor="hsl(var(--accent))">
        {mode === 'events' && pts.map((c) => (
          <g key={c.id}>
            {c.endX != null && c.endY != null && <line x1={px(c.x!)} y1={py(c.y!)} x2={px(c.endX)} y2={py(c.endY)} stroke={c.color} strokeWidth={0.35} opacity={0.75} />}
            <circle cx={px(c.x!)} cy={py(c.y!)} r={1.1} fill={c.color} stroke="rgba(0,0,0,.5)" strokeWidth={0.2}><title>{c.tag}</title></circle>
          </g>
        ))}
      </Pitch>
    </div>
  )
}
