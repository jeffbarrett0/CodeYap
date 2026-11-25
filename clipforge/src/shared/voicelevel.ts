/**
 * SES SEVİYESİ (kullanıcının kararı): "bazı videolarda sesim çok sessiz; sessiz yerleri yükselt, çok sesliyse düşürmene gerek yok".
 * YALNIZCA YUKARI: `dynaudnorm` her ~0,3 sn'lik parçayı tepe 0,9'a kadar yükseltir (en çok +18 dB), zaten yüksek parçalara dokunmaz;
 * çok sessiz (−46 dB altı) parçalar (arka plan gürültüsü) yükseltilmez. Tek geçiş, ölçüm gerekmez (2,5 saatlik kayıtta ek süre yok).
 */
export const VOICE_LEVEL_FILTER = 'dynaudnorm=f=300:g=11:p=0.9:m=8:t=0.005'
/**
 * Abone butonu sesi: konuşmadan HER ZAMAN kısık (kullanıcı: "butonun sesi benim sesimden yüksek olmasın"). Konuşma seviyelendiği için tepeleri ~0,9'dadır;
 * düğme sesi 0,3 (≈ −10 dB) ile karışır.
 */
export const CTA_AUDIO_VOLUME = 0.3
