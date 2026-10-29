import { describe, expect, it } from 'vitest'
import { ChatParseError, findPeaks, messageRateSeries, movingSum, parseChatLog, parseTimeValue } from '@shared/chat/parse'

describe('zaman değerleri', () => {
  it('göreli ve mutlak biçimleri ayırt eder', () => {
    expect(parseTimeValue('01:02:03.5')).toEqual({ kind: 'rel', sec: 3723.5 })
    expect(parseTimeValue('02:03')).toEqual({ kind: 'rel', sec: 123 })
    expect(parseTimeValue(753.2)).toEqual({ kind: 'rel', sec: 753.2 })
    expect(parseTimeValue('2024-05-12T20:00:05Z')).toEqual({ kind: 'abs', ms: Date.parse('2024-05-12T20:00:05Z') })
    expect(parseTimeValue(1715544005)).toMatchObject({ kind: 'abs' })
    expect(parseTimeValue('merhaba')).toBeNull()
  })
})

describe('sohbet günlüğü ayrıştırma', () => {
  it('CSV (başlıklı, Türkçe karakter, alıntılı virgül)', () => {
    const csv = 'time,user,message\n00:00:05,ahmet,"merhaba, herkese"\n00:00:09,ayşe,LUL\n'
    const r = parseChatLog(csv, 'chat.csv')
    expect(r.format).toBe('csv')
    expect(r.messages).toEqual([
      { t: 5, user: 'ahmet', text: 'merhaba, herkese' },
      { t: 9, user: 'ayşe', text: 'LUL' }
    ])
  })
  it('CSV sütun adları farklı + noktalı virgül', () => {
    const r = parseChatLog('Zaman;Kullanıcı;Mesaj\n12.5;a;x\n', 'x.csv')
    expect(r.messages[0]).toEqual({ t: 12.5, user: 'a', text: 'x' })
  })
  it('başlıksız CSV', () => {
    const r = parseChatLog('10,ali,selam\n20,veli,naber\n', 'a.csv')
    expect(r.messages.map((m) => m.t)).toEqual([10, 20])
  })
  it('Kick tarzı JSON: mutlak zaman → yayın başlangıcıyla göreli', () => {
    const json = JSON.stringify({ messages: [
      { id: 1, created_at: '2024-05-12T20:00:10Z', content: 'selam', sender: { username: 'a' } },
      { id: 2, created_at: '2024-05-12T20:01:10Z', content: 'naber', sender: { username: 'b' } }
    ] })
    const r = parseChatLog(json, 'kick.json', { streamStart: '2024-05-12T20:00:00Z' })
    expect(r.messages.map((m) => m.t)).toEqual([10, 70])
    expect(r.messages[0].user).toBe('a')
    expect(r.warnings).toHaveLength(0)
    const r2 = parseChatLog(json, 'kick.json')
    expect(r2.messages.map((m) => m.t)).toEqual([0, 60])
    expect(r2.warnings.length).toBe(1)
  })
  it('Twitch tarzı iç içe alanlar', () => {
    const json = JSON.stringify([{ content_offset_seconds: 3.5, commenter: { display_name: 'x' }, message: { body: 'hey' } }])
    expect(parseChatLog(json).messages[0]).toEqual({ t: 3.5, user: 'x', text: 'hey' })
  })
  it('düz metin satırları', () => {
    const r = parseChatLog('[00:01:05] ahmet: selam\n[00:01:09] <ayşe> naber: iyi\n', 'chat.txt')
    expect(r.format).toBe('text')
    expect(r.messages[0]).toEqual({ t: 65, user: 'ahmet', text: 'selam' })
  })
  it('kullanıcı eşlemesi ile tanınmayan başlıklar çözülür', () => {
    const r = parseChatLog('ts,kim,ne\n5,a,b\n', 'c.csv', { time: 'ts', user: 'kim', message: 'ne' })
    expect(r.messages[0]).toEqual({ t: 5, user: 'a', text: 'b' })
  })
  it('tanınmayan biçimde açık hata ve beklenen şema verir', () => {
    expect(() => parseChatLog('foo,bar\n1,2\n', 'x.csv')).toThrow(ChatParseError)
    try {
      parseChatLog('lorem ipsum dolor', 'x.txt')
      throw new Error('fırlatmalıydı')
    } catch (e) {
      expect(e).toBeInstanceOf(ChatParseError)
      expect((e as ChatParseError).userMessage).toContain('time,user,message')
    }
    expect(() => parseChatLog('', 'a.csv')).toThrow(ChatParseError)
    expect(() => parseChatLog('{bozuk', 'a.json')).toThrow(/JSON/)
  })
})

describe('mesaj hızı', () => {
  it('seriyi ve tepe noktasını bulur', () => {
    const msgs = []
    for (let t = 0; t < 600; t += 10) msgs.push({ t, user: 'a', text: 'x' }) // sürekli düşük hız
    for (let i = 0; i < 60; i++) msgs.push({ t: 300 + i * 0.3, user: 'b', text: 'LUL' }) // 300-318 patlama
    const per = messageRateSeries(msgs, 600, 1)
    expect(per.length).toBe(600)
    const sum = movingSum(per, 10)
    const peaks = findPeaks(sum, { minDistanceBins: 30 })
    expect(peaks).toHaveLength(1)
    expect(peaks[0].index).toBeGreaterThan(300)
    expect(peaks[0].index).toBeLessThan(325)
    expect(peaks[0].z).toBeGreaterThan(3)
  })
})
