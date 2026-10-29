import { useState } from 'react'
import { cn } from '@/lib/utils'
import { COLOR_ROWS } from './drawing'

const HEX = /^#[0-9a-f]{6}$/i

/**
 * Colour chooser for drawings: four rows of ready colours (basic, pastel, dark, neutral)
 * plus a free colour (system picker or a typed #rrggbb value).
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hex, setHex] = useState('')
  return (
    <div className="space-y-2">
      {COLOR_ROWS.map((row) => (
        <div key={row.name} className="flex items-center gap-1">
          <span className="w-10 shrink-0 text-2xs text-muted">{row.name}</span>
          {row.colors.map((c) => (
            <button key={c} type="button" aria-label={`Renk ${c}`} aria-pressed={value.toLowerCase() === c} onClick={() => onChange(c)} className={cn('h-5 w-5 shrink-0 rounded-full border', value.toLowerCase() === c ? 'border-2 border-foreground' : 'border-white/25')} style={{ background: c }} />
          ))}
        </div>
      ))}
      <div className="flex items-center gap-2 border-t border-border pt-2">
        <label className="flex items-center gap-1.5 text-2xs text-muted">Özel renk
          <input type="color" aria-label="Özel renk" value={HEX.test(value) ? value : '#ef4444'} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0" />
        </label>
        <input
          value={hex}
          onChange={(e) => { setHex(e.target.value); const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`; if (HEX.test(v)) onChange(v.toLowerCase()) }}
          placeholder={value}
          aria-label="Renk kodu (#rrggbb)"
          maxLength={7}
          className="h-6 w-20 rounded border border-border bg-raised px-1.5 font-mono text-2xs"
        />
      </div>
    </div>
  )
}
