import { buildTrendChart, TREND_COLORS } from '/sessions/intelligent-keen-fermi/mnt/Change Management/changeflow/src/lib/ai/analysis.js'
// Sample series: fortnightly snapshots rising to 40% now (22 Jul 2026).
const series = [{
  name:'Customer Billing Transformation',
  forecast:'2026-12-20',            // velocity projects 100% around here
  points:[
    {captured_on:'2026-05-13',pct:8},{captured_on:'2026-05-27',pct:14},
    {captured_on:'2026-06-10',pct:19},{captured_on:'2026-06-24',pct:25},
    {captured_on:'2026-07-08',pct:31},{captured_on:'2026-07-22',pct:40},
  ],
}]
const c = buildTrendChart(series, { plannedEnd:'2027-02-15', today:new Date('2026-07-22'), w:320, h:120, pad:22 })
process.stdout.write(JSON.stringify({ c, color:TREND_COLORS[0] }))
