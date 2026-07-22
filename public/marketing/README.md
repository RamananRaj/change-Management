# ChangeFlow — website mockup

Live at **`/marketing`** on the Vercel deployment.

> **Don't preview by double-clicking `index.html`.** The hero image uses a root-absolute
> path (`/marketing/img/…`) because Vercel redirects `/marketing/` to `/marketing`, which
> breaks relative paths. Opening the file directly makes that image 404. To preview locally,
> serve `public/` as the web root:
>
> ```bash
> cd changeflow/public && python3 -m http.server 8000
> # then open http://localhost:8000/marketing/index.html
> ```

```
website-mockup/
  index.html          the whole site — HTML, CSS and JS in one file
  img/
    hero-cora.webp    the one real screenshot on the page (hero teaser)
    hero-timeline.webp  alternate hero, if you'd rather lead with the timeline
    01-…06-*.webp     the original captures, unused — kept as spares
```

**Verified** at 1440, 768, 430, 390 and 320px: no horizontal overflow, no console errors,
no broken images when served as deployed, form validation and success state both working.
All primary buttons and form fields meet the 44px minimum touch target.

---

## Design decisions worth knowing

**One screenshot, not six.** The page shows a single real screen — CORA's programme
update — cropped into the hero and faded into the background. Everything else is a
purpose-built UI illustration: the scope picker, the comms plan, the impact heat map.
A real screenshot carries a hundred details and makes one point badly; these carry one
detail and make it loudly. They're also vector-crisp at any size and never go stale
when the product's padding changes.

**The hero crop removes your browser chrome.** The original capture included the tab
bar, the `change-management-rust.vercel.app` address and a "Relaunch to update" prompt.
All cropped out.

**Each section carries one punchline.** *Blocked is not late* · *Unknown is never zero* ·
*Run three phases, not five* · *An AI that tells you what it doesn't have.* These are the
design rules the product actually follows, which is why they hold up in a demo.

**The roadmap section is deliberate.** Publishing what isn't built yet is unusual and it
is the same move the product makes. It also pre-empts the gaps identified in the
capability map — a prospect who reads it can't ambush you with them.

---

## Two things to change before this goes live

1. **"Good afternoon, Ram"** is visible in the hero screenshot. Fine for review, wrong
   for a public site — recapture signed in as a demo user.
2. **Pricing is invented.** $149 / $690 / Custom are placeholders sized to look plausible
   next to the market. Nothing behind them yet.

Minor: the screenshot shows *"Brief me on Meredian"* — Meridian is misspelled in
whatever seeded that question.

---

## Wiring the lead form (not done yet)

The form validates, shows a success state and displays a receipt card standing in for the
admin queue — but it submits nowhere. Field `name` attributes already match the proposed
table, so wiring is a contained change at the marked spot in `index.html`:

```js
// ── This is where the real insert goes ──
```

### Proposed migration — `supabase/add_leads.sql`

Not written to the repo yet; this is the shape for review.

```sql
CREATE TABLE public.leads (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name       text NOT NULL,
  email           text NOT NULL,
  organisation    text NOT NULL,
  role            text,
  programme_size  text,
  timeframe       text,
  message         text,
  source          text NOT NULL DEFAULT 'website',
  status          text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','contacted','qualified','demo_booked','won','lost')),
  owner_id        uuid REFERENCES auth.users(id),
  notes           text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Anyone may submit. Nobody may read back what they submitted.
CREATE POLICY "Anyone can submit a lead" ON public.leads
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Only platform admins see the queue.
CREATE POLICY "Admins manage leads" ON public.leads
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- RLS is only half the gate. Without the GRANT the insert fails with
-- "permission denied for table leads" in the browser while the SQL editor
-- (superuser) passes — exactly how the comms_items bug surfaced.
GRANT INSERT ON public.leads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
```

### A public-insert table needs care

This is the only table in ChangeFlow that an unauthenticated stranger can write to,
so it deserves more thought than the rest:

- **Honeypot** — already in the form (`input[name=website]`, hidden). Bots fill it;
  drop those rows server-side rather than rejecting, so the bot doesn't learn to retry.
- **Rate limit** — cap inserts per IP per hour. Cleanest as an edge function in front of
  the table rather than a direct client insert, which also keeps the anon key off the
  marketing page.
- **Length caps** — `CHECK (length(message) < 2000)` and similar, or the table becomes
  free storage for whoever finds it.
- **Never read back** — the insert policy has no matching select for `anon`, so a
  submitter cannot enumerate other people's leads. Worth keeping that way.

### Admin surface

A **Leads** subtab in `SystemAdmin.jsx`, following the existing `subtabs` pattern:
list, filter by status, assign an owner, add notes, move through the pipeline. Roughly
the shape of the Pending Invites tab.

An email notification on new lead is a separate small piece — the `notify-chat` edge
function is the closest existing template.

---

## Porting to the app

The page is a standalone file, not React. When you're happy with it, it becomes
`src/pages/Landing.jsx` (which currently holds a much simpler hero). Tailwind covers most
of the styling; the animated gradient mesh, the reveal-on-scroll observer and the heat map
need to come across as custom CSS.
