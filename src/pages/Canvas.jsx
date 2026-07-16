import AiCanvas from '../components/AiCanvas'

// Standalone AI Canvas page (/canvas). Fills the viewport below the 56px top bar; the
// reusable AiCanvas carries the whole experience so the dashboard can embed the same thing.
export default function Canvas() {
  return (
    <div className="h-[calc(100vh-3.5rem)]">
      <AiCanvas fill />
    </div>
  )
}
