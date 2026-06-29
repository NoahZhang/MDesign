import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import './index.css'
import Gallery from './pages/Gallery'
import Workspace from './pages/Workspace'
import DialogHost from './components/DialogHost'
import { useReady } from './lib/store'

const router = createBrowserRouter([
  { path: '/', element: <Gallery /> },
  { path: '/p/:projectId', element: <Workspace /> },
])

function Gate() {
  const ready = useReady()
  if (!ready) {
    return (
      <div className="grid h-screen place-items-center bg-paper">
        <Loader2 size={26} className="animate-spin text-coral" />
      </div>
    )
  }
  return (
    <>
      <RouterProvider router={router} />
      <DialogHost />
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gate />
  </React.StrictMode>,
)
