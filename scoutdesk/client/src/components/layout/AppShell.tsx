import { Outlet } from 'react-router-dom'
import { ExportsTray } from '@/features/exports/ExportsTray'
import { UploadTray } from '@/features/library/UploadTray'
import { useVideoProcessingPoll } from '@/store/polling'
import { CheatSheet } from './CheatSheet'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppShell() {
  useVideoProcessingPoll()
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="min-h-0 flex-1 overflow-hidden outline-none" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <CheatSheet />
      <UploadTray />
      <ExportsTray />
    </div>
  )
}
