import { Field, Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { clamp } from '@/lib/utils'
import { useApp } from '@/store/app'
import { PageHeader } from './Placeholder'

export function SettingsPage() {
  const { theme, setTheme, preRoll, postRoll, setRoll } = useApp()
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">Appearance</h2>
            <Field label="Theme">
              <Segmented ariaLabel="Theme" value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} className="self-start" />
            </Field>
          </section>

          <section className="panel p-4">
            <h2 className="mb-1 text-sm font-semibold">Tagging defaults</h2>
            <p className="mb-3 text-xs text-muted">A tag creates a clip from <em>pre-roll</em> seconds before to <em>post-roll</em> seconds after the moment you press it. You can fine-tune any clip afterwards.</p>
            <div className="grid max-w-xs grid-cols-2 gap-3">
              <Field label="Pre-roll (s)">
                <Input type="number" min={0} max={60} step={0.5} value={preRoll} onChange={(e) => setRoll(clamp(Number(e.target.value) || 0, 0, 60), postRoll)} />
              </Field>
              <Field label="Post-roll (s)">
                <Input type="number" min={0} max={60} step={0.5} value={postRoll} onChange={(e) => setRoll(preRoll, clamp(Number(e.target.value) || 0, 0, 60))} />
              </Field>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
