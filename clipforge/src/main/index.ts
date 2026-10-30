import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { join } from 'node:path'
import { AppService } from './app'
import { registerIpc } from './ipc'
import { serveFile } from './media/serve'

// Önizleme medyasını (proxy/ses/küçük resim) Range desteğiyle sunan özel şema; dosya:// yerine kullanılır.
protocol.registerSchemesAsPrivileged([{ scheme: 'cf-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

// Testler ve taşınabilir kurulumlar için kullanıcı verisi klasörü değiştirilebilir
if (process.env.CLIPFORGE_USER_DATA) app.setPath('userData', process.env.CLIPFORGE_USER_DATA)

let win: BrowserWindow | null = null
let service: AppService

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1115',
    title: 'ClipForge',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  // Dışarıya giden bağlantılar sistem tarayıcısında açılır; uygulama penceresi dış sayfaya yönlenmez.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost')) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

function buildMenu() {
  const send = (cmd: 'open' | 'save' | 'saveAs' | 'import' | 'export') => win?.webContents.send('menu:command', cmd)
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'Dosya',
        submenu: [
          { label: 'Kayıt içe aktar…', accelerator: 'CmdOrCtrl+I', click: () => send('import') },
          { label: 'Proje aç…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
          { label: 'Kaydet', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
          { label: 'Farklı kaydet…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
          { type: 'separator' },
          { label: 'Dışa aktar…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
          { type: 'separator' },
          mac ? { role: 'close' as const } : { role: 'quit' as const }
        ]
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}

void app.whenReady().then(async () => {
  service = new AppService({
    userDataDir: app.getPath('userData'),
    resourcesDir: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
    version: app.getVersion(),
    platform: process.platform,
    emit: (event, payload) => win?.webContents.send(event, payload)
  })
  await service.init()

  protocol.handle('cf-media', async (req) => {
    const u = new URL(req.url)
    const [assetId, kind, idx] = u.pathname.split('/').filter(Boolean)
    const file = service.resolveMediaPath(u.hostname === 'm' ? assetId : u.hostname, kind, Number(idx ?? 0))
    if (!file) return new Response('Bulunamadı', { status: 404 })
    // Range'i kendimiz karşılarız (net.fetch(file://) yok sayıyordu → büyük videolarda bozuk oynatma)
    try {
      return await serveFile(file, req.headers.get('range'))
    } catch {
      return new Response('Bulunamadı', { status: 404 })
    }
  })

  registerIpc(service, () => win)
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Beklenmeyen hatalar uygulamayı çökertmesin; kullanıcıya görünür biçimde kaydedilir.
process.on('uncaughtException', (e) => console.error('[main] uncaughtException', e))
process.on('unhandledRejection', (e) => console.error('[main] unhandledRejection', e))
