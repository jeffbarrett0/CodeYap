import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { describeWhisperError, unknownArgument, WhisperCppProvider } from '../../src/main/transcribe/providers'

const root = mkdtempSync(join(tmpdir(), 'cf-wcpp-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Sahte whisper-cli: argv ve cwd'yi kaydeder; `rejectFlag` verilen bayrakta kullanım metni basıp hata verir */
function fake(rejectFlag: string | null): string {
  const bin = join(root, `whisper-${rejectFlag ?? 'ok'}`)
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv.slice(2)
fs.appendFileSync(process.env.WLOG || '/dev/null', JSON.stringify({ args: a, cwd: process.cwd() }) + '\\n')
const val = (f) => a[a.indexOf(f) + 1]
${rejectFlag ? `if (a.includes(${JSON.stringify(rejectFlag)})) { console.error('error: unknown argument: ${rejectFlag}'); console.error('usage: whisper-cli [options] file0.wav'); console.error('  -h, --help [default] show this help message and exit'); console.error('  -vp N, --vad-speech-pad-ms N [30 ] VAD speech padding (extend segments)'); process.exit(1) }` : ''}
fs.writeFileSync(val('-of') + '.json', JSON.stringify({ transcription: [{ offsets: { from: 0, to: 100 }, text: '[_BEG_]' }, { offsets: { from: 1000, to: 1300 }, text: ' Merhaba' }, { offsets: { from: 1400, to: 1700 }, text: ' dünya' }] }))
`
  )
  chmodSync(bin, 0o755)
  return bin
}

/** Türkçe karakterli ve köşeli parantezli klasör (gerçek hatanın tetikleyicisi) */
function workDir(): string {
  const d = join(root, 'HER GENCİN İZLEMESİ GEREKEN VİDEO [IMouIMdFvWs].clipforge-data', 'tmp', 'k')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'chunk_0.wav'), 'x')
  return d
}

describe('whisper.cpp sağlayıcısı: Windows yol sorunu ve sürüm farkları', () => {
  it('bağımsız değişkenlerde klasör yolu YOK: yalnızca ASCII göreli adlar, çalışma klasörü cwd', async () => {
    process.env.WLOG = join(root, 'log1.jsonl')
    const d = workDir()
    const p = new WhisperCppProvider(fake(null), root, 2)
    const words = await p.transcribeChunk({ wavPath: join(d, 'chunk_0.wav'), offsetSec: 600, language: 'tr', model: 'tiny', workDir: d, prompt: 'Kavukçu, Osimhen' })
    expect(words.map((w) => w.text)).toEqual(['Merhaba', 'dünya'])
    expect(words[0].start).toBeCloseTo(601, 1)
    const call = JSON.parse(readFileSync(process.env.WLOG, 'utf8').trim().split('\n')[0])
    expect(call.cwd).toBe(d)
    const f = call.args[call.args.indexOf('-f') + 1]
    const o = call.args[call.args.indexOf('-of') + 1]
    expect(f).toBe('chunk_0.wav')
    expect(o).toBe('wcpp_600')
    // model ve istem hariç hiçbir bağımsız değişkende klasör ayracı, Türkçe karakter ya da köşeli parantez yok
    const m = call.args.indexOf('-m')
    const pr = call.args.indexOf('--prompt')
    const rest = call.args.filter((_: string, i: number) => i !== m + 1 && i !== pr + 1)
    expect(rest.some((x: string) => /[İ\[\]/\\]/.test(x))).toBe(false)
  })
  it('sürüm bir isteğe bağlı bayrağı tanımazsa ("-sow") o bayrak çıkarılıp yeniden denenir', async () => {
    process.env.WLOG = join(root, 'log2.jsonl')
    const d = workDir()
    const p = new WhisperCppProvider(fake('-sow'), root, 2)
    const words = await p.transcribeChunk({ wavPath: join(d, 'chunk_0.wav'), offsetSec: 0, language: 'tr', model: 'tiny', workDir: d })
    expect(words).toHaveLength(2)
    const calls = readFileSync(process.env.WLOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(calls.length).toBe(2)
    expect(calls[0].args).toContain('-sow')
    expect(calls[1].args).not.toContain('-sow')
  })
  it('zorunlu bayrak tanınmazsa kullanım metni değil, asıl neden gösterilir', async () => {
    process.env.WLOG = join(root, 'log3.jsonl')
    const d = workDir()
    const p = new WhisperCppProvider(fake('-ml'), root, 2)
    await expect(p.transcribeChunk({ wavPath: join(d, 'chunk_0.wav'), offsetSec: 0, language: 'tr', model: 'tiny', workDir: d })).rejects.toThrow(/"-ml" tanınmıyor/)
    await expect(p.transcribeChunk({ wavPath: join(d, 'chunk_0.wav'), offsetSec: 0, language: 'tr', model: 'tiny', workDir: d })).rejects.not.toThrow(/vad-speech-pad/)
  })
  it('hata ayrıştırma yardımcıları', () => {
    expect(unknownArgument('error: unknown argument: --foo\nusage: x')).toBe('--foo')
    expect(unknownArgument('başka bir hata')).toBeNull()
    expect(describeWhisperError('error: failed to open ggml model file', 'C:/m/ggml-small.bin')).toMatch(/modeli yüklenemedi/)
    expect(describeWhisperError('whisper_init: boom\nerror: something broke', 'm')).toMatch(/something broke/)
  })
})
