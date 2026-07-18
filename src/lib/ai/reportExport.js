// ChangeFlow · report export — real PowerPoint (.pptx) and Word (.doc) from a report descriptor.
// PPTX via PptxGenJS (lazy-loaded from CDN). Word via an HTML document saved as .doc (Word
// opens it with formatting + colours). Both read the (possibly admin-edited) sections.

const LV_HEX = { vh: '991B1B', h: 'DC2626', m: 'E8913A', l: '16A34A', vl: '86EFAC', none: 'E2E8F0' }
const LV_CSS = { vh: '#991B1B', h: '#DC2626', m: '#E8913A', l: '#16A34A', vl: '#86EFAC', none: '#E2E8F0' }
const LVL = lv => ({ vh: 'Very High', h: 'High', m: 'Medium', l: 'Low', vl: 'Very Low', none: 'None' }[lv] || '')
const stripMd = s => String(s ?? '').replace(/\*\*/g, '')
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const mdHtml = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
const safe = s => String(s ?? 'report').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_')

function download(content, name, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

// ── Word (.doc) ─────────────────────────────────────────────────────────────
export function exportReportDoc(report) {
  const body = (report.sections ?? []).map(secDocHTML).join('')
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
    <style>body{font-family:Calibri,Arial,sans-serif;color:#1e293b;font-size:11pt}h1{color:#1F4E79}h2{color:#1F4E79;font-size:13pt;border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin-top:18px}
    table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #e2e8f0;padding:5px 8px;font-size:10pt;text-align:left}ul{margin:4px 0 4px 18px}</style></head>
    <body><h1>${esc(report.title)}</h1><p style="color:#64748b">${esc(report.subtitle || '')}</p>${body}</body></html>`
  download('﻿' + html, `${safe(report.title)}.doc`, 'application/msword')
}
function secDocHTML(s) {
  const h = `<h2>${esc(s.heading)}</h2>`
  if (s.type === 'narrative') return h + `<p>${mdHtml(s.body)}</p>`
  if (s.type === 'progress') return h + `<table><tr><th>Item</th><th>Detail</th><th>Progress</th></tr>${(s.rows || []).map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.sub || '')}</td><td>${r.value}%</td></tr>`).join('')}</table>`
  if (s.type === 'list') return h + ((s.rows || []).length ? `<table><tr><th>Item</th><th>Detail</th><th>Status</th></tr>${s.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.meta || '')}</td><td>${esc(r.due || '')}</td></tr>`).join('')}</table>` : `<p style="color:#94a3b8">${esc(s.empty || '—')}</p>`)
  if (s.type === 'heatmap') {
    const head = `<tr><th></th>${s.cols.map(c => `<th style="text-align:center;font-size:9pt">${esc(c)}</th>`).join('')}</tr>`
    const dot = lv => `<span style="color:${LV_CSS[lv] || LV_CSS.none};font-size:16pt;line-height:1">&#9679;</span>`
    const rows = s.rows.map(r => `<tr><td style="border:none"><b>${esc(r.label)}</b></td>${r.cells.map(lv => `<td style="border:none;text-align:center" title="${LVL(lv)}">${dot(lv)}</td>`).join('')}</tr>`).join('')
    const legend = `<p style="font-size:8pt;color:#64748b">${['vh', 'h', 'm', 'l', 'vl', 'none'].map(k => `${dot(k).replace('16pt', '11pt')} ${LVL(k)}`).join('&nbsp;&nbsp;')}</p>`
    const ins = (s.insights || []).length ? `<ul>${s.insights.map(i => `<li>${mdHtml(i)}</li>`).join('')}</ul>` : ''
    return `${h}<table style="border-collapse:collapse">${head}${rows}</table>${legend}${s.headline ? `<p>${mdHtml(s.headline)}</p>` : ''}${ins}`
  }
  if (s.type === 'projectTimeline') return h + (s.gantt ? ganttDocHTML(s.gantt) : `<p><i>No dates scheduled yet — add phase dates to draw the timeline.</i></p>`)
  return h
}

// Month-bucketed gantt as a Word table: bars = coloured cell spans, milestones = ◆ markers.
const BAR_CSS = { completed: '#16A34A', active: '#E8913A', locked: '#E2E8F0' }
function ganttDocHTML(g) {
  return g.projects.map(pr => {
    const head = `<tr><th style="width:130px"></th>${g.months.map((m, i) => `<th style="font-size:8pt;text-align:center;${i === g.todayIdx ? 'background:#FEE2E2;' : ''}">${esc(m)}</th>`).join('')}</tr>`
    const rows = pr.rows.map(r => {
      const cells = g.months.map((_, i) => {
        if (r.kind === 'bar' && i >= r.startIdx && i <= r.endIdx) {
          const c = BAR_CSS[r.status] || BAR_CSS.locked
          return `<td bgcolor="${c}" style="background:${c};padding:2px"></td>`
        }
        if (r.kind === 'point' && i === r.pointIdx) return `<td style="text-align:center;color:${r.color || '#1F4E79'};font-size:10pt">◆</td>`
        return '<td></td>'
      }).join('')
      const lbl = r.kind === 'bar' ? `${esc(r.label)} <span style="color:#94a3b8">(${r.pct}%)</span>` : esc(r.label)
      return `<tr><td style="font-size:9pt">${lbl}</td>${cells}</tr>`
    }).join('')
    return `<p style="font-weight:bold;color:#1F4E79;margin:10px 0 2px">${esc(pr.name)}</p><table style="table-layout:fixed">${head}${rows}</table>`
  }).join('')
}

// ── PowerPoint (.pptx) ──────────────────────────────────────────────────────
async function loadPptx() {
  if (typeof window !== 'undefined' && window.PptxGenJS) return window.PptxGenJS
  await new Promise((resolve, reject) => {
    const sc = document.createElement('script')
    sc.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
    sc.onload = resolve; sc.onerror = reject
    document.head.appendChild(sc)
  })
  return window.PptxGenJS
}

export async function exportReportPptx(report) {
  const P = await loadPptx()
  const pptx = new P()
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 }); pptx.layout = 'WIDE'

  const title = pptx.addSlide(); title.background = { color: '1F4E79' }
  title.addText(report.title, { x: 0.7, y: 2.6, w: 12, fontSize: 34, bold: true, color: 'FFFFFF' })
  title.addText(report.subtitle || '', { x: 0.7, y: 3.7, w: 12, fontSize: 14, color: 'CBD5E1' })

  ;(report.sections ?? []).forEach(s => {
    const sl = pptx.addSlide()
    sl.addText(s.heading, { x: 0.5, y: 0.35, w: 12.3, fontSize: 20, bold: true, color: '1F4E79' })
    if (s.type === 'narrative') {
      sl.addText(stripMd(s.body), { x: 0.5, y: 1.1, w: 12.3, h: 5.5, fontSize: 14, color: '334155', valign: 'top' })
    } else if (s.type === 'progress') {
      const rows = [[{ text: 'Item', options: { bold: true } }, { text: 'Progress', options: { bold: true } }], ...(s.rows || []).map(r => [r.label, `${r.value}%`])]
      sl.addTable(rows, { x: 0.5, y: 1.1, w: 12.3, fontSize: 13, border: { pt: 0.5, color: 'E2E8F0' }, color: '334155' })
    } else if (s.type === 'list') {
      const src = (s.rows || []).length ? s.rows.map(r => [r.name, r.meta || '', r.due || '']) : [[s.empty || '—', '', '']]
      sl.addTable([[{ text: 'Item', options: { bold: true } }, { text: 'Detail', options: { bold: true } }, { text: 'Status', options: { bold: true } }], ...src], { x: 0.5, y: 1.1, w: 12.3, fontSize: 12, border: { pt: 0.5, color: 'E2E8F0' }, color: '334155' })
    } else if (s.type === 'heatmap') {
      // Dot matrix on the left (matches the app/PDF), AI insight on the right.
      heatmapDotsPptx(sl, P, s)
      const insX = 7.4, insW = 5.4
      if (s.headline) sl.addText(stripMd(s.headline), { x: insX, y: 1.1, w: insW, h: 1.6, fontSize: 12, bold: true, color: '1F4E79', valign: 'top' })
      if (s.insights?.length) {
        const items = s.insights.map(t => ({ text: stripMd(t), options: { bullet: { code: '2022' }, fontSize: 10, color: '334155', paraSpaceAfter: 6 } }))
        sl.addText(items, { x: insX, y: 2.7, w: insW, h: 4.4, valign: 'top' })
      }
    } else if (s.type === 'projectTimeline') {
      if (s.gantt) ganttPptx(sl, P, s.gantt)
      else sl.addText('No dates scheduled yet — add phase dates to draw the timeline.', { x: 0.5, y: 1.1, fontSize: 13, italic: true, color: '94A3B8' })
    }
  })

  pptx.writeFile({ fileName: `${safe(report.title)}.pptx` })
}

// Draw the heat map as a grid of coloured dots (matches the app + PDF).
function heatmapDotsPptx(sl, P, s) {
  const oval = P.ShapeType?.ellipse ?? 'ellipse'
  const X = 0.5, top = 1.15, labelW = 2.2
  const nCols = s.cols.length
  const colW = Math.min((6.8 - labelW) / Math.max(nCols, 1), 1.1)
  const rowH = Math.min((6.0 - 0.4) / Math.max(s.rows.length, 1), 0.55)
  const D = 0.26
  s.cols.forEach((c, j) => sl.addText(c, { x: X + labelW + j * colW, y: top, w: colW, h: 0.3, fontSize: 9, bold: true, color: '475569', align: 'center' }))
  s.rows.forEach((r, i) => {
    const ry = top + 0.4 + i * rowH
    sl.addText(r.label, { x: X, y: ry, w: labelW - 0.1, h: rowH, fontSize: 9, color: '334155', align: 'right', valign: 'middle' })
    r.cells.forEach((lv, j) => {
      const cx = X + labelW + j * colW + colW / 2
      sl.addShape(oval, { x: cx - D / 2, y: ry + rowH / 2 - D / 2, w: D, h: D, fill: { color: LV_HEX[lv] || LV_HEX.none }, line: { color: 'FFFFFF', width: 0.75 } })
    })
  })
  // Legend under the matrix.
  const ly = top + 0.4 + s.rows.length * rowH + 0.15
  let lx = X
  ;['vh', 'h', 'm', 'l', 'vl', 'none'].forEach(k => {
    sl.addShape(oval, { x: lx, y: ly + 0.02, w: 0.14, h: 0.14, fill: { color: LV_HEX[k] } })
    sl.addText(LVL(k), { x: lx + 0.18, y: ly - 0.04, w: 1.0, h: 0.22, fontSize: 8, color: '94A3B8', valign: 'middle' })
    lx += 0.18 + Math.min(LVL(k).length * 0.062 + 0.3, 1.2)
  })
}

// Draw the gantt as positioned shapes on a slide.
const BAR_TRACK = { completed: '16A34A', active: 'FDE3C6', locked: 'E2E8F0' }
const BAR_FILL  = { completed: '16A34A', active: 'E8913A', locked: 'E2E8F0' }
function ganttPptx(sl, P, g) {
  const X = 0.5, top = 1.15, labelW = 2.1, W = 12.3
  const trackX = X + labelW, trackW = W - labelW
  const colW = trackW / g.months.length
  const rect = P.ShapeType?.rect ?? 'rect'
  const diamond = P.ShapeType?.diamond ?? 'diamond'

  g.months.forEach((m, i) => {
    sl.addText(m, { x: trackX + i * colW, y: top, w: colW, h: 0.22, fontSize: 8, color: '94A3B8', align: 'center' })
    sl.addShape(rect, { x: trackX + i * colW, y: top + 0.24, w: 0.008, h: 5.6, fill: { color: 'F1F5F9' } })
  })
  if (g.todayIdx != null) {
    const tx = trackX + (g.todayIdx + 0.5) * colW
    sl.addShape(rect, { x: tx, y: top + 0.24, w: 0.012, h: 5.6, fill: { color: 'EF4444' } })
  }

  let y = top + 0.32
  g.projects.forEach(pr => {
    sl.addText(pr.name, { x: X, y, w: W, h: 0.26, fontSize: 13, bold: true, color: '1F4E79' })
    y += 0.32
    pr.rows.forEach(r => {
      if (y > 7.1) return
      sl.addText(r.label, { x: X, y, w: labelW - 0.1, h: 0.24, fontSize: 9, color: '334155', valign: 'middle' })
      if (r.kind === 'bar') {
        const bx = trackX + r.startIdx * colW
        const bw = Math.max((r.endIdx - r.startIdx + 1) * colW, 0.12)
        sl.addShape(rect, { x: bx, y: y + 0.02, w: bw, h: 0.2, fill: { color: BAR_TRACK[r.status] || BAR_TRACK.locked }, line: { color: 'FFFFFF', width: 0.5 } })
        if (r.status !== 'locked' && r.pct > 0) sl.addShape(rect, { x: bx, y: y + 0.02, w: Math.max(bw * (r.pct / 100), 0.04), h: 0.2, fill: { color: BAR_FILL[r.status] || BAR_FILL.active } })
        if (bw >= 0.6) sl.addText(`${r.pct}%`, { x: bx, y: y + 0.02, w: bw, h: 0.2, fontSize: 8, bold: true, color: r.status === 'locked' ? '475569' : 'FFFFFF', align: 'center', valign: 'middle' })
      } else if (r.kind === 'point') {
        const px = trackX + (r.pointIdx + 0.5) * colW
        sl.addShape(diamond, { x: px - 0.09, y: y + 0.02, w: 0.18, h: 0.2, fill: { color: (r.color || '#1F4E79').replace('#', '') } })
        sl.addText(r.label, { x: px + 0.14, y, w: 2.4, h: 0.24, fontSize: 8, color: '1F4E79', valign: 'middle' })
      }
      y += 0.28
    })
    y += 0.12
  })

  sl.addText('■ Done   ■ In progress   ▨ Upcoming   ◆ Milestone   | Today', { x: X, y: 7.15, w: W, h: 0.25, fontSize: 8, color: '94A3B8' })
}
