import { FileVideo, UploadCloud, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { cn, formatBytes, formatDate } from '@/lib/utils'
import { useData } from '@/store/data'
import { useLookups } from '@/store/hooks'
import { useUploads } from '@/store/uploads'

const ACCEPT = '.mp4,.m4v,.mov,.webm,.mkv,video/*'
const ANGLES = ['Main', 'Tactical', 'Behind goal', 'Broadcast', 'Other']
const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '')

interface Draft {
  key: string
  file: File
  title: string
}

export function UploadDialog({ open, onOpenChange, defaultMatchId }: { open: boolean; onOpenChange: (o: boolean) => void; defaultMatchId?: string | null }) {
  const matches = useData((s) => s.matches)
  const { teamById } = useLookups()
  const enqueue = useUploads((s) => s.enqueue)
  const inputRef = useRef<HTMLInputElement>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [matchId, setMatchId] = useState<string>(defaultMatchId ?? '')
  const [angle, setAngle] = useState('Main')
  const [tags, setTags] = useState('')
  const [dragging, setDragging] = useState(false)

  const add = (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(f.name))
    setDrafts((d) => [...d, ...list.map((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, title: baseName(file) }))])
  }

  const reset = () => {
    setDrafts([])
    setTags('')
  }

  const submit = () => {
    enqueue(
      drafts.map((d) => ({
        file: d.file,
        title: d.title.trim() || baseName(d.file),
        matchId: matchId || null,
        angle,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      })),
    )
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Upload match video" description="Files are streamed to storage; thumbnails and metadata are generated afterwards." className="max-w-xl">
        <DialogBody className="space-y-4">
          <div
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              add(e.dataTransfer.files)
            }}
            className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors', dragging ? 'border-accent bg-accent/10' : 'border-border bg-background')}
          >
            <UploadCloud className="h-6 w-6 text-muted" />
            <p className="text-xs text-muted">Drag video files here, or</p>
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>Choose files…</Button>
            <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden aria-label="Choose video files" onChange={(e) => (e.target.files && add(e.target.files), (e.target.value = ''))} />
            <p className="text-2xs text-muted">MP4 (H.264) plays everywhere; MOV, WebM and MKV depend on your browser’s codecs.</p>
          </div>

          {drafts.length > 0 && (
            <ul className="space-y-1.5">
              {drafts.map((d) => (
                <li key={d.key} className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5">
                  <FileVideo className="h-4 w-4 shrink-0 text-muted" />
                  <Input aria-label={`Title for ${d.file.name}`} value={d.title} onChange={(e) => setDrafts((all) => all.map((x) => (x.key === d.key ? { ...x, title: e.target.value } : x)))} className="h-7 flex-1" />
                  <span className="shrink-0 font-mono text-2xs text-muted">{formatBytes(d.file.size)}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${d.file.name}`} onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Match" className="col-span-2" hint={matches.length === 0 ? 'No matches yet — create one under Matches first.' : undefined}>
              <Select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
                <option value="">Unassigned</option>
                {matches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {teamById.get(m.homeTeamId)?.name} v {teamById.get(m.awayTeamId)?.name} · {formatDate(m.date)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Camera angle">
              <Select value={angle} onChange={(e) => setAngle(e.target.value)}>
                {ANGLES.map((a) => <option key={a}>{a}</option>)}
              </Select>
            </Field>
            <Field label="Tags (comma-separated)">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="league, scouting" />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={drafts.length === 0} onClick={submit}>
            Upload {drafts.length > 0 ? `${drafts.length} file${drafts.length > 1 ? 's' : ''}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
