/** Önizlemede arka plan sesi azaltılmış kopyası hazır olan (varlık|ses akışı|seviye) anahtarları */
export const denoiseReady = new Set<string>()
export const denoiseKey = (assetId: string, audioStream: number, level: string) => `${assetId}|${audioStream}|${level}`
