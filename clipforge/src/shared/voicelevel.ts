/**
 * SES SEVİYESİ (kullanıcının kararı): "bazı videolarda sesim çok sessiz; sessiz yerleri yükselt, çok sesliyse düşürmene gerek yok".
 * ASLA KISMAZ (kullanıcı: "başta sesim kısılıyor, video içinde bazen kısılıyor; hiç kısma, kısıksa biraz orta seviyenin üstüne koy"): `compand` SABİT bir eğridir,
 * her noktada çıkış ≥ giriş (dynaudnorm gibi kazanç dalgalanması/başlangıç kısılması YOK). −60 dB altı (gürültü) olduğu gibi; kısık konuşma (−45…−30 dB) +7…+10 dB, normal (−20) +8, yüksek (−6) +2,5, 0 dB aynı.
 * Tek geçiş, ölçüm gerekmez.
 */
export const VOICE_LEVEL_FILTER = "compand=attacks=0.02:decays=0.35:soft-knee=6:points=-90/-90|-60/-60|-45/-38|-30/-20|-20/-12|-12/-7|-6/-3.5|0/0"
/**
 * Abone butonu sesi: konuşmadan HER ZAMAN kısık (kullanıcı: "butonun sesi benim sesimden yüksek olmasın"). Konuşma seviyelendiği için tepeleri ~0,9'dadır;
 * düğme sesi 0,3 (≈ −10 dB) ile karışır.
 */
export const CTA_AUDIO_VOLUME = 0.3
