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
    const head = `<tr><th></th>${s.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`
    const rows = s.rows.map(r => `<tr><td><b>${esc(r.label)}</b></td>${r.cells.map(lv => `<td bgcolor="${LV_CSS[lv] || LV_CSS.none}" style="background:${LV_CSS[lv] || LV_CSS.none};color:#fff;text-align:center">${LVL(lv)}</td>`).join('')}</tr>`).join('')
    const ins = (s.insights || []).length ? `<ul>${s.insights.map(i => `<li>${mdHtml(i)}</li>`).join('')}</ul>` : ''
    return `${h}<table>${head}${rows}</table>${s.headline ? `<p>${mdHtml(s.headline)}</p>` : ''}${ins}`
  }
  if (s.type === 'projectTimeline') return h + `<p><i>Timeline is best viewed in the app or the PDF.</i></p>`
  return h
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
      const header = [{ text: '', options: { fill: 'F1F5F9' } }, ...s.cols.map(c => ({ text: c, options: { bold: true, align: 'center', fill: 'F1F5F9', color: '475569' } }))]
      const body = s.rows.map(r => [{ text: r.label, options: { bold: true, color: '334155' } }, ...r.cells.map(lv => ({ text: LVL(lv), options: { fill: LV_HEX[lv] || LV_HEX.none, color: 'FFFFFF', align: 'center', fontSize: 9 } }))])
      sl.addTable([header, ...body], { x: 0.5, y: 1.1, w: 12.3, fontSize: 11 })
      if (s.headline) sl.addText(stripMd(s.headline), { x: 0.5, y: 5.5, w: 12.3, fontSize: 11, color: '475569' })
    } else if (s.type === 'projectTimeline') {
      sl.addText('Timeline is best viewed in the app or the PDF.', { x: 0.5, y: 1.1, fontSize: 13, italic: true, color: '94A3B8' })
    }
  })

  pptx.writeFile({ fileName: `${safe(report.title)}.pptx` })
}
