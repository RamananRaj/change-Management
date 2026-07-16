import AiCanvas from '../components/AiCanvas'

// Standalone AI Canvas page (/canvas). Fills the viewport; the reusable AiCanvas component
// carries the whole experience so the dashboard can embed the same thing inline.
export default function Canvas() {
  return <AiCanvas fill />
}
