/*
  One script for every page.

  It reads /api/state, works out where each loan is from the chain, the loanbook and its
  vault (never from what was last clicked), fills every `data-app` key the page carries,
  and shows the one step panel that matches. Buttons with `data-act` post to
  /api/<act>, with the row's `data-loan`, `data-basket` or `data-piece` when they sit in a
  table row; long actions run as jobs on the server and their outcome arrives with the
  next state.

  A borrow can be filled from several desks' orders (D16): each piece is its own loan
  with its own vault. The borrower's screens carry the whole borrow; the desk's carry
  that desk's loans.

  Figures it cannot read are shown as a dash, never guessed.
*/
;(() => {
  /* Redraws go through el.markup: the element is rewritten only when its HTML changed.
     The state is polled every 2 s; rewriting unchanged rows replaced buttons under the
     pointer and lost clicks between press and release. */
  Object.defineProperty(HTMLElement.prototype, 'markup', {
    set(m) {
      if (this.__markup === m) return
      this.__markup = m
      this.innerHTML = m
    },
  })

  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
  const view = document.body.dataset.view

  /* ---------------------------------------------------------- theme, rail -- */

  const root = document.documentElement
  const store = (k, v) => {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)
    } catch (e) {}
  }
  const themeLabel = () =>
    $$('[data-theme-label]').forEach((el) => (el.textContent = root.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode'))
  themeLabel()
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) {
      const dark = root.dataset.theme !== 'dark'
      dark ? root.setAttribute('data-theme', 'dark') : root.removeAttribute('data-theme')
      store('hypothec-theme', dark ? 'dark' : null)
      themeLabel()
    }
    if (e.target.closest('[data-rail-toggle]')) {
      const collapsed = root.dataset.rail !== 'collapsed'
      collapsed ? root.setAttribute('data-rail', 'collapsed') : root.removeAttribute('data-rail')
      store('hypothec-rail', collapsed ? 'collapsed' : null)
    }
  })

  /* The landing page: its live stage, its chain and stablecoin words, and the contract
     link, from the same state the app reads. Read every 20 seconds while it is open. */
  if (!view) {
    const live = (key, text) => $$(`[data-live="${key}"]`).forEach((el) => (el.textContent = text))
    const landing = async () => {
      try {
        const s = await (await fetch('/api/state')).json()
        const c = s.chain || {}
        $$('[data-sym]').forEach((el) => (el.textContent = c.symbol || 'USDC'))
        $$('[data-net]').forEach((el) => (el.textContent = c.short || 'Base'))
        $$('[data-net-full]').forEach((el) => (el.textContent = c.label || 'Base Sepolia'))
        $$('[data-live="contract"]').forEach((el) => (el.href = `${c.explorer}/address/${c.loans}`))
        const open = (s.desks || []).filter((d) => BigInt(d.availableUsdc) > 0n).sort((a, b) => a.aprBps - b.aprBps)
        const best = open[0]
        const days = (t) => (t >= 86400 ? `${Math.round(t / 86400)} days` : `${Math.round(t / 60)} minutes`)
        live('rate', best ? `${(best.aprBps / 100).toFixed(best.aprBps % 100 ? 1 : 0)}%` : '—')
        live('rate-desk', best ? `${best.name}, ${days(best.termSeconds)}, liquidation at ${best.liquidationLtvBps / 100}% LTV` : 'No order is open right now.')
        const avail = open.reduce((a, d) => a + BigInt(d.availableUsdc), 0n)
        live('avail', `${Number(avail) / 1e6} ${c.symbol || 'USDC'}`)
        live('desks', `Across ${open.length} desk${open.length === 1 ? '' : 's'}’ open orders`)
        const g = s.guardians || []
        const on = g.filter((x) => x.online).length
        live('guardians', `${on} of ${g.length}`)
        live('guardians-big', `${on} of ${g.length} online`)
        if (g[0]?.code) live('code', `Rules code ${g[0].code.slice(0, 12)}…, the same on every guardian`)
      } catch (e) {
        live('rate-desk', 'The live figures are not reachable right now.')
      }
    }
    landing()
    setInterval(landing, 20_000)
    // The footer's water video loads only when the visitor nears the bottom.
    const pool = $('.pool-vid')
    if (pool && 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const io = new IntersectionObserver((entries) => {
        if (!entries.some((x) => x.isIntersecting)) return
        pool.src = pool.dataset.src
        pool.play().catch(() => undefined)
        io.disconnect()
      }, { rootMargin: '400px' })
      io.observe(pool)
    }
    return
  }

  /* The log page keeps the rail of the surface the visitor came from. */
  const asDesk = new URLSearchParams(location.search).get('as') === 'desk'
  if (view === 'log') $$('[data-rail-for]').forEach((el) => (el.hidden = el.dataset.railFor !== (asDesk ? 'desk' : 'borrower')))

  /* ------------------------------------------------------------- formats -- */

  const DASH = '—'
  const trim = (s) => s.replace(/\.?0+$/, '')
  /* The dollar side's chain and stablecoin, from /api/state (Base Sepolia and USDC, or
     Robinhood Chain testnet and USDG). */
  let SYM = 'USDC'
  let NET = 'Base Sepolia'
  let NETS = 'Base'
  let FAUCET = { gas: 'https://www.alchemy.com/faucets/base-sepolia', stable: 'https://faucet.circle.com/' }
  const usdc = (base) => (base == null ? DASH : `${trim((Number(base) / 1e6).toFixed(6))} ${SYM}`)
  const zec = (zat) => (zat == null ? DASH : `${trim((Number(zat) / 1e8).toFixed(8))} ZEC`)
  const usd = (n) => (n == null || !isFinite(n) ? DASH : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  const pct = (bps) => (bps == null ? DASH : `${trim((Number(bps) / 100).toFixed(2))}%`)
  const short = (s) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : DASH)
  const date = (secs) => (secs ? new Date(secs * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : DASH)
  const time = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  /* A due date within two days shows its time too (short test terms). */
  const due = (secs) => (!secs ? DASH : secs * 1000 - Date.now() < 2 * 86400000 ? `${date(secs)}, ${new Date(secs * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : date(secs))
  const term = (secs) => (secs % 86400 === 0 ? `${secs / 86400} day${secs === 86400 ? '' : 's'}` : secs % 3600 === 0 ? `${secs / 3600} hours` : `${Math.round(secs / 60)} minutes`)
  const termAdj = (secs) => term(secs).replace(/^(\d+) (day|hour|minute)s?$/, '$1-$2')
  const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const sum = (xs) => xs.reduce((a, x) => a + BigInt(x ?? 0), 0n)

  const set = (key, text) => $$(`[data-app="${key}"]`).forEach((el) => (el.textContent = text))
  const setPill = (key, label, tone) =>
    $$(`[data-app="${key}"]`).forEach((el) => {
      el.textContent = label
      el.className = `pill${tone ? ` pill-${tone}` : ''}`
    })
  const html = (key, markup) => $$(`[data-app="${key}"]`).forEach((el) => (el.markup = markup))

  /* --------------------------------------------------------------- toast -- */

  let toastTimer
  const toast = (text, tone = '') => {
    const el = $('[data-app="toast"]')
    if (!el) return
    el.textContent = text
    el.dataset.tone = tone
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (el.hidden = true), tone === 'bad' ? 9000 : 4000)
  }

  /* --------------------------------------------------------------- state -- */

  let last = null
  let configured = false
  let clientBusy = false
  const W = window.HypothecWallet
  const me = () => W?.address?.() || null

  const ended = (l) => !!l?.ended
  /* A guardian from the operator list, by address. */
  const guardianOf = (s, address) => (s.guardians || []).find((g) => same(g.address, address)) || null
  const gName = (s, address) => guardianOf(s, address)?.name || short(address)
  const dot = (g) => `<i class="dot ${g?.online ? 'dot-on' : 'dot-off'}" title="${g?.online ? 'online' : 'offline'}"></i>`
  const loanById = (s, id) => s.loans.find((l) => l.id === id) || null
  /* Jobs not finished for a loan: its buttons wait. */
  const busyLoan = (s, id) => s.jobs.some((j) => !j.done && j.loans.includes(id))

  /* The connected borrower's borrow: the newest one still going, else the newest. */
  function myBasket(s) {
    const mine = s.baskets.filter((b) => same(b.borrower, me())).sort((a, b) => b.at - a.at)
    const going = mine.find((b) => b.pieces.some((p) => !p.loan || !ended(loanById(s, p.loan))))
    return going || mine[0] || null
  }
  const basketLoans = (s, b) => (b ? b.pieces.map((p) => loanById(s, p.loan)).filter(Boolean) : [])
  const myDesk = (s) => s.desks.find((d) => same(d.owner, me())) || null
  const deskName = (s, owner) => s.desks.find((d) => same(d.owner, owner))?.name || 'Desk'

  /* The loans the page is about: the borrower's borrow, the desk's loans, or (on the log
     page) whichever side the visitor came from. */
  function pageLoans(s) {
    if (view === 'desk' || (view === 'log' && asDesk)) {
      const d = myDesk(s)
      return d ? s.loans.filter((l) => same(l.desk, d.owner)) : []
    }
    const b = myBasket(s)
    return b ? basketLoans(s, b) : view === 'log' ? s.loans.slice(-4) : []
  }

  /* --------------------------------------------------- one loan's step -- */

  const QUEST = ['request', 'accept', 'keys', 'lock', 'receive', 'repay', 'release']
  const AT = { none: 0, 'wait-offer': 1, accept: 1, keys: 2, 'wait-fund': 3, lock: 3, confirming: 4, active: 5, repaid: 6, refund: 6, closed: 7, liquidated: 5 }

  function loanStep(s, l) {
    const on = l.onchain.status
    if (on === 'Liquidated') return 'liquidated'
    if (l.loanbookStatus === 'Released') return 'closed'
    if (on === 'Offered') return 'accept'
    if (on === 'Accepted') return l.vault ? 'wait-fund' : 'keys'
    if (on === 'Funded') return BigInt(l.spendableZat) >= BigInt(l.offer.collateralZat) ? 'confirming' : 'lock'
    if (on === 'Active') return 'active'
    if (on === 'Repaid') return 'repaid'
    // Cancelled before the lock completed: any ZEC already sent goes back to the borrower.
    if (on === 'Cancelled') return BigInt(l.vaultZat) > 0n ? 'refund' : 'closed'
    return 'none'
  }

  /* The borrow's step: offers waiting on the borrower come first; otherwise the step of
     the piece furthest behind, so a panel that needs the borrower stays up until every
     piece is past it. Running, repaid and liquidated pieces share the loans panel. */
  const ORDER = ['wait-offer', 'accept', 'keys', 'wait-fund', 'lock', 'confirming', 'active', 'repaid', 'refund', 'liquidated', 'closed']
  function basketStep(s, b) {
    if (!b) return 'none'
    const steps = b.pieces.map((p) => (p.loan ? (loanById(s, p.loan) ? loanStep(s, loanById(s, p.loan)) : 'accept') : 'wait-offer'))
    if (steps.every((x) => x === 'closed' || x === 'liquidated')) return 'closed'
    if (steps.includes('accept')) return 'accept'
    const behind = steps.filter((x) => x !== 'closed' && x !== 'liquidated').sort((a, c) => ORDER.indexOf(a) - ORDER.indexOf(c))[0]
    return behind === 'repaid' || behind === 'refund' ? 'active' : behind
  }

  function paintQuest(step) {
    const at = AT[step] ?? 0
    const lastNode = QUEST.length - 1
    $$('[data-app="quest-wrap"]').forEach((wrap) => {
      wrap.dataset.ended = step === 'liquidated' ? 'liquidated' : ''
      wrap.style.setProperty('--p', `${(Math.min(at, lastNode) / lastNode) * 100}%`)
      $$('li', wrap).forEach((li, i) => {
        li.classList.toggle('is-done', i < at)
        li.classList.toggle('is-current', i === at)
        $('.quest-tag', li).textContent = i < at ? 'done' : i === at ? (step === 'liquidated' ? 'ended' : 'now') : ''
      })
    })
  }

  /* --------------------------------------------------------- loan picker -- */

  /* Which loan the health bar, the guardians' checks and the detail show. Defaults to the
     loan nearest liquidation, else the newest. */
  let picked = new URLSearchParams(location.search).get('loan')
  function focusLoan(s) {
    const loans = pageLoans(s)
    const chosen = loans.find((l) => l.id === picked)
    if (chosen) return chosen
    const live = loans.filter((l) => l.risk && ['Funded', 'Active'].includes(l.onchain.status)).sort((a, b) => b.risk.ltvBps - a.risk.ltvBps)
    return live[0] || loans[loans.length - 1] || null
  }
  function paintPicker(s, focus) {
    const loans = pageLoans(s)
    $$('[data-app="pick-wrap"]').forEach((w) => (w.hidden = loans.length < 2))
    $$('[data-app="loan-pick"]').forEach((sel) => {
      const opts = loans.map((l) => `<option value="${l.id}">${esc(l.deskName)} · ${usdc(l.offer.principalUsdc)}</option>`).join('')
      if (sel.dataset.opts !== opts) {
        sel.markup = opts
        sel.dataset.opts = opts
      }
      if (focus) sel.value = focus.id
    })
  }
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-app="loan-pick"]')) {
      picked = e.target.value
      if (last) paint(last)
    }
  })

  /* ----------------------------------------------------------- guardians -- */

  function guardianState(loan, letter) {
    if (!loan) return ['Waiting', '']
    const role = `referee${letter}`
    const mine = loan.events.filter((e) => e.actor === role)
    const lastEv = mine[mine.length - 1]
    if (lastEv?.kind === 'liquidation-recorded') return [`Recorded on ${NETS}`, 'good']
    if (lastEv?.kind?.startsWith('approve-')) return ['Signed', 'good']
    if (lastEv?.kind === 'refuse') return ['Refused', 'bad']
    if (loan.onchain[`lock${letter}`]) return ['Lock confirmed', 'good']
    if (loan.onchain.status === 'Funded') return ['Watching vault', 'warn']
    if (loan.accepted) return ['On duty', '']
    return ['Proposed', '']
  }

  /* -------------------------------------------------------------- health -- */

  function paintHealth(s, loan) {
    const price = s.price && 'microUsd' in s.price ? Number(s.price.microUsd) / 1e6 : null
    set('price', price == null ? DASH : usd(price))
    const venues = s.price?.detail ? Object.keys(s.price.detail).filter((k) => k !== 'median').length : 0
    set('price-source', !s.price || s.price.error ? 'feed unavailable' : s.price.source === 'override' ? 'demo override' : `1h avg · ${venues} exchanges`)
    const margin = loan ? loan.offer.marginLtvBps : 6500
    const liq = loan ? loan.offer.liquidationLtvBps : 7500
    $$('[data-app="zone-safe"]').forEach((el) => (el.style.width = `${margin / 100}%`))
    $$('[data-app="zone-margin"]').forEach((el) => (el.style.width = `${(liq - margin) / 100}%`))
    set('margin-ltv-label', `${margin / 100}%`)
    set('liq-ltv-label', `${liq / 100}%`)
    $$('[data-app="margin-ltv-label"]').forEach((el) => (el.style.left = `${margin / 100}%`))
    $$('[data-app="liq-ltv-label"]').forEach((el) => (el.style.left = `${liq / 100}%`))
    const risk = loan?.risk
    const live = risk && ['Funded', 'Active'].includes(loan.onchain.status)
    $$('[data-app="health-mark"]').forEach((el) => {
      el.hidden = !live
      if (live) el.style.left = `${Math.min(risk.ltvBps / 100, 100)}%`
    })
    set('ltv', live ? pct(risk.ltvBps) : DASH)
    set('margin-price', risk ? usd(risk.marginPriceUsd) : DASH)
    set('liq-price', risk ? usd(risk.liquidationPriceUsd) : DASH)
    if (!live) setPill('health-pill', loan && ended(loan) ? 'Closed' : 'No loan', '')
    else if (loan.overdue) setPill('health-pill', 'Overdue', 'bad')
    else if (risk.ltvBps >= liq) setPill('health-pill', 'Liquidation', 'bad')
    else if (risk.ltvBps >= margin) setPill('health-pill', 'Margin call', 'warn')
    else setPill('health-pill', 'Safe', 'good')
  }

  /* ----------------------------------------------------------------- log -- */

  const VENUES = { bitstamp: 'Bitstamp', bitfinex: 'Bitfinex', gemini: 'Gemini', gate: 'Gate.io', mexc: 'MEXC' }
  const venue = (k) => VENUES[k] || k
  const WHO = { borrower: 'Borrower', refereeA: 'Guardian A', refereeB: 'Guardian B' }
  const link = (url, label) => (url ? ` · <a href="${url}" target="_blank" rel="noopener">${label}</a>` : '')

  function describe(e) {
    const d = e.data || {}
    switch (e.kind) {
      case 'offer': return 'Posted the terms and both guardians, signed'
      case 'accept': return 'Accepted the terms and both guardians, and signed a fresh ZEC payout address'
      case 'vault': return `Vault made by all four: ${esc(short(d.address))}`
      case 'funded': return `Put the ${SYM} into the loan contract`
      case 'cancelled': return `Not locked by the deadline: cancelled and refunded on ${NETS}${link(d.tx, 'tx')}`
      case 'waiting': return `Waiting: ${esc(d.reason)}`
      case 'lock-confirmed': return `Saw ${esc(zec(d.vaultZat))} locked and confirmed it on ${NETS}${link(d.tx, 'tx')}`
      case 'lent': return `${SYM} received from the contract`
      case 'approve-release': return `Signed the release · rule: ${esc(d.rule)}`
      case 'approve-liquidation': return `Signed the liquidation · ${esc(d.rule)} at ${esc(usd(d.priceUsd))} (${d.priceSource === 'override' ? 'demo override' : 'exchange average'})`
      case 'refuse': return `Refused · ${esc(d.reason)}`
      case 'liquidation-recorded': return `Recorded the liquidation on ${NETS}${link(d.tx, 'tx')}`
      case 'released': return 'ZEC released to the borrower’s registered address'
      case 'vault-open': return 'Opened the loan’s vault: the four parties start making its keys'
      case 'vault-join': return 'Joined the vault'
      case 'safety-number': return `Safety number ${esc(d.number)}: the same on all four`
      case 'top-up': return `Added ${esc(zec(d.zat))} to the vault; it now holds ${esc(zec(d.vaultZat))}`
      case 'liquidated': return `Sent the liquidation: ${esc(zec(d.lenderZat))} to the desk, ${esc(zec(d.surplusZat))} back to the borrower, in one transaction`
      default: return esc(e.kind)
    }
  }

  function paintLog(s) {
    const box = $('[data-app="log"]')
    if (!box) return
    const loans = pageLoans(s)
    const events = loans.flatMap((l) => l.events.map((e) => ({ ...e, loanDesk: l.deskName }))).sort((a, b) => b.at - a.at)
    set('log-count', `${events.length} entries`)
    box.markup = events.length
      ? events
          .map((e) => {
            const g = e.actor.startsWith('referee')
            const who = e.actor === 'lender' ? e.loanDesk : WHO[e.actor] || e.actor
            const tag = loans.length > 1 ? ` <em class="log-loan">${esc(e.loanDesk)} loan</em>` : ''
            return `<div class="log-row"><span class="log-time">${time(e.at)}</span><span class="guardian-token${g ? '' : ' guardian-token-party'}">${g ? e.actor.slice(-1) : e.actor === 'lender' ? 'D' : e.actor === 'borrower' ? 'B' : '·'}</span><div><b class="log-who">${esc(who)}</b>${tag}<p class="log-what">${describe(e)}</p></div>${e.sig ? '<span class="pill pill-good">Signed</span>' : '<span class="pill">Note</span>'}</div>`
          })
          .join('')
      : '<p class="log-empty">No entries yet. Every guardian decision appears here with its evidence.</p>'
  }

  /* ---------------------------------------------------- guardian checks -- */

  const STAGE_KINDS = { lock: ['lock-confirmed'], release: ['approve-release'], liquidation: ['approve-liquidation', 'liquidation-recorded'] }
  const stageOfRefusal = (reason = '') => (reason.startsWith('release') ? 'release' : reason.startsWith('liquidation') ? 'liquidation' : 'lock')

  function decision(loan, letter, key) {
    const role = `referee${letter}`
    const mine = loan ? loan.events.filter((e) => e.actor === role) : []
    const signed = [...mine].reverse().find((e) => STAGE_KINDS[key].includes(e.kind))
    const refused = [...mine].reverse().find((e) => e.kind === 'refuse' && stageOfRefusal(e.data.reason) === key)
    const waiting = key === 'lock' ? [...mine].reverse().find((e) => e.kind === 'waiting') : null
    const tag = `<span>${letter}</span><b>Guardian ${letter}</b>`
    if (signed) {
      const what = signed.kind === 'lock-confirmed' ? 'Confirmed the lock' : signed.kind === 'liquidation-recorded' ? `Signed, and recorded it on ${NETS}` : 'Signed'
      return `<div class="decision decision-signed">${tag}<span>${what} · ${time(signed.at)}${signed.data.tx ? ` · <a href="${signed.data.tx}" target="_blank" rel="noopener">tx</a>` : ''}</span></div>`
    }
    if (refused) return `<div class="decision decision-refused">${tag}<span>Refused · ${esc(refused.data.reason)}</span></div>`
    if (waiting) return `<div class="decision">${tag}<span>Watching · ${esc(waiting.data.reason)}</span></div>`
    return `<div class="decision">${tag}<span>Nothing to sign yet</span></div>`
  }

  function paintChecks(loan) {
    for (const key of ['lock', 'release', 'liquidation']) {
      const list = $(`[data-app="checks-${key}"]`)
      if (!list) continue
      const checks = loan?.checks?.[key] ?? []
      list.markup = checks.length
        ? checks.map((c) => {
            const [cls, mark, word] = c.ok === true ? ['ck-ok', '✓', 'passed'] : c.ok === false ? ['ck-no', '✕', 'failed'] : ['ck-wait', '·', 'waiting']
            return `<li class="${c.ok === true ? 'is-ok' : ''}"><span class="ck ${cls}" aria-label="${word}">${mark}</span><div><b>${esc(c.label)}</b><em>${esc(c.detail)}</em></div></li>`
          }).join('')
        : '<li><span class="ck ck-wait" aria-label="waiting">·</span><div><b>No loan yet</b><em>checks start when a loan has its vault</em></div></li>'
      const okAll = checks.length && checks.every((c) => c.ok === true)
      const anyNo = checks.some((c) => c.ok === false)
      setPill(`stage-${key}-pill`, okAll ? 'Passed' : anyNo ? 'Not met' : 'Waiting', okAll ? 'good' : anyNo ? 'bad' : '')
      const dec = $(`[data-app="dec-${key}"]`)
      if (dec) dec.markup = decision(loan, 'A', key) + decision(loan, 'B', key)
    }
  }

  /* The vault being made, party by party, for the loan whose keys are being made now. */
  function paintMaking(s, loans) {
    const box = $('[data-app="making"]')
    if (!box) return
    const making = loans.find((l) => l.accepted && !l.vault) || loans[loans.length - 1]
    const ev = making?.events ?? []
    const has = (kind, actor) => ev.some((e) => e.kind === kind && (!actor || e.actor === actor))
    const done = { open: has('vault-open'), lender: has('vault-join', 'lender'), refereeA: has('vault-join', 'refereeA'), refereeB: has('vault-join', 'refereeB'), safety: has('safety-number'), keys: !!making?.vault }
    const safety = ev.find((e) => e.kind === 'safety-number')
    set('safety-number', safety ? safety.data.number : DASH)
    const made = loans.filter((l) => l.vault).length
    set('keys-note', loans.length > 1 ? `Vault ${Math.min(made + 1, loans.length)} of ${loans.length}${making ? ` · ${making.deskName}` : ''}` : 'Your loan’s vault')
    $$('[data-app="making"] [data-app="desk-name"]').forEach((el) => (el.textContent = making ? making.deskName : 'The desk'))
    let nowSet = false
    $$('li', box).forEach((li) => {
      const d = done[li.dataset.make]
      li.classList.toggle('is-done', !!d)
      const now = !d && !nowSet && !!making && busyLoan(s, making.id)
      li.classList.toggle('is-now', now)
      if (now) nowSet = true
    })
  }

  /* ----------------------------------------------------- wallet checks -- */

  /* What the connected wallet holds, so a screen can say before an action that it would
     fail. A fee on Base Sepolia costs a fraction of this. */
  const FEE_ETH = 20000000000000n // 0.00002 ETH
  let bal = null
  let balFor = null
  let balAt = 0
  async function refreshBalances(force = false) {
    const a = me()
    if (!a || !W?.balances || (!force && a === balFor && Date.now() - balAt < 15000)) return
    try {
      bal = await W.balances(a)
      balFor = a
      balAt = Date.now()
      if (last) paint(last)
    } catch (e) {}
  }
  const eth = (wei) => `${trim((Number(wei) / 1e18).toFixed(6))} ETH`
  const faucets = () => `<a href="${FAUCET.stable}" target="_blank" rel="noopener">${SYM} faucet</a> · <a href="${FAUCET.gas}" target="_blank" rel="noopener">ETH faucet</a>`

  /* One check block: the wallet's figures, then what is short, if anything. */
  function preflight(key, needs) {
    const lines = []
    if (!me()) return html(key, '')
    if (!bal || balFor !== me()) return html(key, '<p class="pf-line"><span>Your wallet</span><b>checking…</b></p>')
    lines.push(`<p class="pf-line"><span>Your wallet on ${NET}</span><b>${eth(bal.eth)} · ${usdc(bal.usdc)}</b></p>`)
    const short = []
    if (needs.feeTxs && bal.eth < FEE_ETH) short.push(`a little ${NET} ETH for fees (${needs.feeTxs} confirmation${needs.feeTxs === 1 ? '' : 's'} in your wallet)`)
    if (needs.usdc && bal.usdc < needs.usdc) short.push(`${usdc(needs.usdc - bal.usdc)} more ${SYM} ${needs.usdcWhy || ''}`.trim())
    lines.push(short.length
      ? `<p class="pf-warn"><b>Before you go on</b> This wallet needs ${short.join(' and ')}. ${faucets()}</p>`
      : `<p class="pf-ok">Enough for the fees${needs.usdc ? ` and the ${SYM}` : ''}.</p>`)
    html(key, lines.join(''))
  }

  /* ------------------------------------------------------- the order book -- */

  /* Orders the borrower unticked in the Borrow dialog; every other order is in. */
  const unticked = new Set()
  /* The desk whose row the Borrow dialog was opened from: it fills first. */
  let chosen = null

  function quoteOf(s, d, principal) {
    const p = BigInt(principal)
    const owed = p + (p * BigInt(d.aprBps) * BigInt(d.termSeconds)) / (10000n * 365n * 86400n)
    const collateral = s.sizingPriceUsd ? (p * 100000000n * 10000n) / (BigInt(d.startLtvBps) * BigInt(Math.round(s.sizingPriceUsd * 1e6))) : null
    return { owed, collateral }
  }

  /* The desk picked fills first; then the other ticked orders, cheapest rate first and the
     larger order on a tie (services/src/desks.ts fill()). */
  function fillOrders(s) {
    const want = BigInt(Math.round(Number($('[data-input="amount"]')?.value || 0) * 1e6))
    const orders = s.desks
      .filter((d) => BigInt(d.availableUsdc ?? 0) > 0n && !same(d.owner, me()) && (same(d.owner, chosen) || !unticked.has(d.owner.toLowerCase())))
      .sort((a, b) => (same(b.owner, chosen) - same(a.owner, chosen)) || a.aprBps - b.aprBps || (BigInt(b.availableUsdc) > BigInt(a.availableUsdc) ? 1 : -1))
    const pieces = []
    let left = want
    for (const d of orders) {
      if (left <= 0n || pieces.length >= s.maxPieces) break
      const take = BigInt(d.availableUsdc) < left ? BigInt(d.availableUsdc) : left
      pieces.push({ desk: d, take })
      left -= take
    }
    return { want, pieces, left }
  }

  /* Each desk's record, from the loans in the loanbook. */
  function recordOf(s, owner) {
    const mine = s.loans.filter((l) => same(l.desk, owner))
    return {
      open: mine.filter((l) => !ended(l) && ['Accepted', 'Funded', 'Active', 'Repaid'].includes(l.onchain.status)).length,
      repaid: mine.filter((l) => l.loanbookStatus === 'Released' || l.onchain.status === 'Repaid').length,
      liquidated: mine.filter((l) => l.onchain.status === 'Liquidated').length,
    }
  }

  let sortKey = 'rate'
  let sortDir = 1
  let filter = 'all'
  let search = ''
  const FILTERS = {
    all: () => true,
    instant: (d) => d.instant,
    short: (d) => d.termSeconds < 30 * 86400,
    long: (d) => d.termSeconds >= 30 * 86400,
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-filter]')
    if (!c) return
    filter = c.dataset.filter
    $$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)))
    if (last) paintMarkets(last)
  })
  document.addEventListener('input', (e) => {
    if (!e.target.matches('[data-input="desk-search"]')) return
    search = e.target.value.trim().toLowerCase()
    if (last) paintMarkets(last)
  })

  /* A desk's mark: its initials on a tint of its own, picked from its address. */
  function avatar(d) {
    const initials = d.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    const hue = parseInt(d.owner.slice(2, 8), 16) % 360
    return `<span class="avatar" style="--h:${hue}">${esc(initials)}</span>`
  }
  const SORTS = {
    rate: (d) => d.aprBps,
    term: (d) => d.termSeconds,
    lent: (d) => Number(d.lentUsdc ?? 0),
    available: (d) => Number(d.availableUsdc ?? 0),
  }
  document.addEventListener('click', (e) => {
    const h = e.target.closest('[data-sort]')
    if (!h) return
    sortDir = sortKey === h.dataset.sort ? -sortDir : h.dataset.sort === 'rate' || h.dataset.sort === 'term' ? 1 : -1
    sortKey = h.dataset.sort
    if (last) paintMarkets(last)
  })

  function paintMarkets(s) {
    const shown = s.desks.filter((d) => FILTERS[filter](d) && (!search || d.name.toLowerCase().includes(search)))
    set('m-count', `Showing ${shown.length} of ${s.desks.length} desk${s.desks.length === 1 ? '' : 's'}`)
    set('m-desks', String(s.desks.length))
    set('m-available', usdc(sum(s.desks.map((d) => d.availableUsdc))))
    $$('[data-sort]').forEach((h) => (h.dataset.dir = h.dataset.sort === sortKey ? (sortDir > 0 ? 'up' : 'down') : ''))
    const open = s.desks.filter((d) => BigInt(d.availableUsdc ?? 0) > 0n && !same(d.owner, me()))
    const best = open.length ? Math.min(...open.map((d) => d.aprBps)) : null
    const rows = $('[data-app="market-rows"]')
    if (rows) {
      rows.markup = shown.length
        ? [...shown]
            .sort((a, b) => sortDir * (SORTS[sortKey](a) - SORTS[sortKey](b)) || a.aprBps - b.aprBps)
            .map((d) => {
              const own = same(d.owner, me())
              const empty = BigInt(d.availableUsdc ?? 0) <= 0n
              const r = recordOf(s, d.owner)
              const record = r.repaid || r.liquidated ? `${r.repaid} repaid · ${r.liquidated} liquidated` : 'no loans closed yet'
              const ga = guardianOf(s, d.guardianA)
              const gb = guardianOf(s, d.guardianB)
              const guards = `<span class="guards">${dot(ga)}${esc(gName(s, d.guardianA))} · ${dot(gb)}${esc(gName(s, d.guardianB))}</span>`
              const isBest = !own && !empty && d.aprBps === best && open.length > 1
              return `<div class="tr${isBest ? ' tr-best' : ''}" role="row">
                <span class="td-desk" role="cell">${avatar(d)}<span><b>${esc(d.name)}${d.instant ? ' <i class="pill pill-good pill-sm">Instant</i>' : ''}${own ? ' <i class="pill pill-sm">Yours</i>' : ''}</b><em>${record}</em>${guards}</span></span>
                <span role="cell" data-label="Rate"><b class="num-accent">${pct(d.aprBps)}</b>${isBest ? '<em class="best">Best rate</em>' : ''}</span>
                <span role="cell" data-label="Term"><b>${term(d.termSeconds)}</b></span>
                <span role="cell" data-label="LTV start / liq."><b>${pct(d.startLtvBps)} / ${pct(d.liquidationLtvBps)}</b></span>
                <span role="cell" data-label="Lent now"><b>${usdc(d.lentUsdc ?? 0)}</b><em>${r.open} open loan${r.open === 1 ? '' : 's'}</em></span>
                <span role="cell" data-label="Available"><b>${usdc(d.availableUsdc)}</b><em>of ${usdc(d.maxUsdc)}</em></span>
                <span class="td-act td-pair" role="cell">
                  <button class="btn btn-primary" type="button" data-open="borrow" data-desk="${esc(d.owner)}"${own || empty ? ' disabled' : ''}><span>Borrow</span></button>
                  <button class="btn btn-ghost" type="button" data-open="lend" data-desk="${esc(d.owner)}"><span>${own ? 'Edit' : 'Lend'}</span></button>
                </span>
              </div>`
            })
            .join('')
        : s.desks.length
          ? '<p class="table-empty">No desk matches. Clear the search or pick another filter.</p>'
          : `<div class="table-empty table-empty-act"><span>No desk has an order up yet.</span><button class="btn btn-primary" type="button" data-open="lend"><span>Post the first order</span></button></div>`
    }

    // The featured cards: the three best rates with money left to lend.
    const feat = $('[data-app="featured"]')
    if (feat) {
      const top3 = open.sort((a, b) => a.aprBps - b.aprBps).slice(0, 3)
      feat.hidden = !top3.length
      feat.markup = top3
        .map((d) => `<button class="feat" type="button" data-open="borrow" data-desk="${esc(d.owner)}">
          ${avatar(d)}<span class="feat-main"><b>${esc(d.name)}</b><em>${term(d.termSeconds)} · ${usdc(d.availableUsdc)} available${d.instant ? ' · instant' : ''}</em></span>
          <span class="feat-rate"><b>${pct(d.aprBps)}</b><sup>APR</sup></span><span class="feat-go">${'→'}</span>
        </button>`)
        .join('')
    }

    // The Borrow dialog: which orders fill it, and what the borrow comes to.
    const fillRows = $('[data-app="fill-rows"]')
    if (!fillRows) return
    const f = fillOrders(s)
    const takes = new Map(f.pieces.map((p) => [p.desk.owner.toLowerCase(), p.take]))
    const lead = s.desks.find((d) => same(d.owner, chosen))
    $$('[data-app="borrow-dialog"] [data-app="desk-name"]').forEach((el) => (el.textContent = lead ? lead.name : 'the desks'))
    {
      const fq = fillOrders(s)
      const owedAll = sum(fq.pieces.map((p) => quoteOf(s, p.desk, p.take).owed))
      const principal = sum(fq.pieces.map((p) => p.take))
      // To repay later the wallet needs the interest on top of what it receives.
      preflight('preflight-borrow', { feeTxs: fq.pieces.length, usdc: owedAll - principal, usdcWhy: 'by the time you repay (the interest)' })
    }
    fillRows.markup = [...s.desks]
      .filter((d) => !same(d.owner, me()) && BigInt(d.availableUsdc ?? 0) > 0n)
      .sort((a, b) => (same(b.owner, chosen) - same(a.owner, chosen)) || a.aprBps - b.aprBps)
      .map((d) => {
        const k = d.owner.toLowerCase()
        const isLead = same(d.owner, chosen)
        const take = takes.get(k)
        return `<label class="mini-row${take ? ' is-taken' : ''}"><span><input type="checkbox" data-tick="${esc(k)}"${isLead || !unticked.has(k) ? ' checked' : ''}${isLead ? ' disabled' : ''}/></span><span><b>${esc(d.name)}</b></span><span>${pct(d.aprBps)}</span><span>${usdc(d.availableUsdc)}</span><span><b>${take ? usdc(take) : DASH}</b></span></label>`
      })
      .join('')
    const qs = f.pieces.map((p) => ({ ...quoteOf(s, p.desk, p.take), take: p.take, d: p.desk }))
    const total = sum(qs.map((q) => q.take))
    set('q-collateral', !qs.length ? DASH : qs.some((q) => q.collateral === null) ? 'price feed down' : zec(sum(qs.map((q) => q.collateral))))
    set('q-owed', qs.length ? usdc(sum(qs.map((q) => q.owed))) : DASH)
    set('q-apr', total ? pct(Number(sum(qs.map((q) => q.take * BigInt(q.d.aprBps))) / total)) : DASH)
    const dues = [...new Set(qs.map((q) => term(q.d.termSeconds)))]
    set('q-due', dues.length ? (dues.length === 1 ? `in ${dues[0]}` : `in ${dues.join(' / ')}, each loan its own`) : DASH)
    set('sizing-price', usd(s.sizingPriceUsd))
    set('fill-note', f.left > 0n && f.want > 0n ? `These orders cover ${usdc(f.want - f.left)} of ${usdc(f.want)}. Tick more orders or ask for less.` : f.pieces.length > 1 ? `${f.pieces.length} loans, one per desk, each in its own vault.` : '')
    $$('[data-app="ask-btn"] span').forEach((el) => (el.textContent = !me() ? 'Connect wallet' : f.pieces.length > 1 ? `Request from ${f.pieces.length} desks` : 'Request'))
  }

  document.addEventListener('change', (e) => {
    const t = e.target.closest('[data-tick]')
    if (!t) return
    t.checked ? unticked.delete(t.dataset.tick) : unticked.add(t.dataset.tick)
    if (last) paintMarkets(last)
  })
  document.addEventListener('input', (e) => {
    if (e.target.matches('[data-input="amount"]') && last) paintMarkets(last)
  })

  /* Dialogs close from their X, from a click on the dimmed backdrop, and from the browser's
     Back button: opening one adds a history entry, so Back closes it and stays on the page. */
  document.addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]')
    if (x) return void x.closest('dialog')?.close()
    if (e.target.matches('dialog[open]')) {
      const r = e.target.getBoundingClientRect()
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      if (!inside) e.target.close()
    }
  })
  /* Leaving from an open dialog replaces its history entry, so Back skips straight past it. */
  const go = (url) => (history.state?.dialog ? location.replace(url) : (location.href = url))
  const openDialog = (sel) => {
    const d = $(sel)
    if (!d || d.open) return
    d.showModal()
    history.pushState({ dialog: sel }, '')
  }
  document.addEventListener('close', (e) => {
    // Closed by X, Escape or the backdrop: drop the history entry it added.
    if (e.target.matches?.('dialog') && history.state?.dialog) history.back()
  }, true)
  window.addEventListener('popstate', () => {
    $$('dialog[open]').forEach((d) => d.close())
  })

  /* Borrow and Lend open their dialogs from a row; Lend starts from that desk's terms, or
     from your own order when you have one. */
  document.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]')
    if (!open || open.disabled || !last) return
    if (!me()) await connectWallet()
    if (!me()) return
    if (open.dataset.open === 'borrow') {
      const going = myBasket(last)
      if (going && basketStep(last, going) !== 'closed') return void go('loan.html')
      chosen = open.dataset.desk
      unticked.clear()
      refreshBalances(true)
      paintMarkets(last)
      openDialog('[data-app="borrow-dialog"]')
    } else {
      const mine = myDesk(last)
      const from = last.desks.find((d) => same(d.owner, open.dataset.desk))
      const base = mine || from || { ...last.testnet.deskTerms, name: '' }
      fillDeskForm({ ...base, name: mine ? mine.name : '', maxUsdc: mine ? mine.maxUsdc : base.maxUsdc, lenderZec: mine ? mine.lenderZec : '' })
      set('lend-title', mine ? `Update ${mine.name}` : from ? `Lend on ${from.name}'s terms` : 'Post an order')
      openDialog('[data-app="lend-dialog"]')
    }
  })

  /* ----------------------------------------------------- the progress -- */

  /* One line on what the borrow is waiting for, while it waits. The bar moves while the
     system works and stands still when it is the borrower's turn. */
  const testnetChain = () => last?.chain?.zecPrefix === 'utest1'
  function paintProgress(s, b, loans) {
    const box = $('[data-app="progress"]')
    if (!box) return
    const step = b ? basketStep(s, b) : 'none'
    const pieces = b?.pieces ?? []
    const names = (xs) => xs.map((x) => x.deskName).join(', ')
    const jobsNow = s.jobs.filter((j) => !j.done && j.loans.some((id) => loans.some((l) => l.id === id)))
    let title = ''
    let detail = ''
    let usual = ''
    let yours = false
    if (step === 'wait-offer') {
      const answered = pieces.filter((p) => p.loan)
      const waiting = pieces.filter((p) => !p.loan)
      title = 'The desks are answering'
      detail = `${answered.length ? `${names(answered)} offered · ` : ''}${names(waiting)} ${waiting.length === 1 ? 'is' : 'are'} preparing ${waiting.length === 1 ? 'its' : 'their'} offer`
      usual = waiting.every((p) => s.desks.find((d) => same(d.owner, p.desk))?.instant) ? 'usually under 15 s' : 'a person at the desk reviews it'
    } else if (step === 'accept') {
      title = 'Your turn: review and accept the offers below'
      detail = `${loans.filter((l) => l.onchain.status === 'Offered').length} offer${loans.length === 1 ? '' : 's'} waiting`
      yours = true
    } else if (step === 'keys') {
      const made = loans.filter((l) => l.vault).length
      title = 'Making the vaults'
      detail = `Vault ${Math.min(made + 1, loans.length)} of ${loans.length}: you, the desk and both guardians each make a key share`
      usual = 'about 30 s each'
    } else if (step === 'wait-fund') {
      title = 'The desks are funding their contracts'
      detail = `${names(loans.filter((l) => l.onchain.status === 'Accepted'))} moving ${SYM} into the loan contract`
      usual = 'usually under 20 s'
    } else if (step === 'lock') {
      title = 'Your turn: lock your ZEC below'
      detail = 'One payment request pays every vault'
      yours = !jobsNow.some((j) => j.name === 'lock')
      if (!yours) (title = 'Sending your ZEC to the vaults'), (usual = testnetChain() ? 'a few minutes' : 'about 20 s')
    } else if (step === 'confirming') {
      title = 'The guardians are confirming your deposit'
      detail = 'Each checks the full amount is in its vault, then the contract pays you'
      usual = testnetChain() ? 'about 30 min on testnet (10 confirmations)' : 'about 30 s'
    } else if (jobsNow.length) {
      const j = jobsNow[0]
      title = { release: 'Releasing your ZEC', topup: 'Adding collateral', liquidate: 'Liquidating' }[j.name] || 'Working'
      detail = 'The guardians check and sign'
      usual = testnetChain() ? 'a few minutes' : 'about 30 s'
    }
    box.hidden = !title
    if (!title) return
    box.dataset.yours = yours ? '1' : ''
    set('prog-title', title)
    set('prog-detail', detail)
    // Since the last thing that happened on this borrow.
    const since = Math.max(b?.at ?? 0, ...loans.flatMap((l) => l.events.map((e) => e.at)))
    const secs = Math.max(0, Math.round((Date.now() - since) / 1000))
    const clock = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs} s`
    set('prog-time', yours ? '' : `${clock}${usual ? ` · ${usual}` : ''}`)
  }

  /* ------------------------------------------------------- the borrower -- */

  const statusWord = (s, l) => {
    if (!l) return 'Waiting for the desk'
    const st = loanStep(s, l)
    return { accept: 'Offered: accept it', keys: 'Making the vault', 'wait-fund': 'Desk funding', lock: 'Waiting for your ZEC', confirming: 'Guardians checking', active: l.overdue ? 'Overdue' : 'Running', repaid: 'Repaid: take your ZEC back', refund: 'Cancelled: take your ZEC back', closed: 'Released', liquidated: 'Liquidated' }[st] || l.onchain.status
  }

  /* A ZIP 321 payment request paying every vault waiting for its ZEC, in one transaction. */
  function zip321(locks) {
    const amount = (zat) => trim((Number(zat) / 1e8).toFixed(8))
    return `zcash:?${locks.map((l, i) => `${i ? `address.${i}` : 'address'}=${l.vault}&${i ? `amount.${i}` : 'amount'}=${amount(l.offer.collateralZat)}`).join('&')}`
  }

  /* ------------------------------------------------------------ lock (F4) -- */

  /* Waiting (nothing in the vaults), seen and confirming (in, counting confirmations),
     confirmed (every vault full and spendable: the guardians confirm on the loan chain),
     or several vaults paid by one request. Copy buttons read lockCopy. */
  let lockCopy = { amount: '', addr: '', uri: '' }
  function paintLock(s, loans) {
    const vaults = loans.filter((l) => l.onchain.status === 'Funded' && l.vault)
    if (!vaults.length) return
    const need = (l) => BigInt(l.offer.collateralZat)
    const toPay = vaults.filter((l) => BigInt(l.vaultZat) < need(l))
    const total = sum(vaults.map((l) => l.offer.collateralZat))
    const needed = vaults[0].confirmationsNeeded || 10
    const confs = Math.min(...vaults.map((l) => l.confirmations || 0))
    const seen = vaults.every((l) => BigInt(l.vaultZat) >= need(l))
    const confirmed = vaults.every((l) => BigInt(l.spendableZat) >= need(l))
    const state = confirmed ? 'confirmed' : seen ? 'seen' : 'waiting'
    const several = vaults.length > 1
    const testnet = s.chain?.zecPrefix === 'utest1'

    const uri = zip321(toPay.length ? toPay : vaults)
    lockCopy = { amount: trim((Number(total) / 1e8).toFixed(8)), addr: vaults[0].vault, uri }
    $$('[data-app="lock4"]').forEach((el) => (el.dataset.state = state))
    set('lock-badge', several && state === 'waiting' ? 'Several vaults, one payment' : { waiting: 'Waiting for ZEC', seen: 'Seen, confirming', confirmed: 'Confirmed' }[state])
    set('lock-title', state === 'confirmed' ? 'Payment confirmed' : state === 'seen' ? 'Payment detected' : several ? 'One payment. Several vaults.' : 'Send ZEC to the vault')
    set('lock-sub', state === 'confirmed'
      ? `Your ZEC has ${needed} of ${needed} confirmations on the Zcash network. The guardians are confirming the lock on ${NETS}, and the contract pays your dollars next.`
      : state === 'seen'
        ? `Your ZEC is in the vault and is being confirmed on the Zcash network.${testnet ? ' On testnet this takes about 12 minutes.' : ''}`
        : several
          ? `Your borrow is split across ${vaults.length} vaults, one per lending desk. One payment from your Zcash wallet fills every vault in a single shielded transaction.`
          : 'Scan the QR code with your Zcash wallet, or copy the details below. The guardians see it arrive through the vault’s view-only key.')
    set('lock-amt-label', several ? 'Total to send' : 'Amount to send')
    set('b-lock-total', zec(total))
    set('lock-addr', vaults[0].vault)
    $$('[data-app="lock-single"]').forEach((el) => (el.hidden = several))
    $$('[data-app="lock-multi"]').forEach((el) => (el.hidden = !several))
    $$('[data-app="lock-vaults"]').forEach((el) => (el.hidden = !several))
    html('lock-vaults', several ? `<div class="lv4-head"><b>Your payment fills ${vaults.length} vaults</b><span class="pill">${vaults.length} vaults · 1 payment</span></div>` + vaults
      .map((l, i) => `<div class="lv4"><span class="lv4-ic">${MARK_KEY}</span><div><b>Vault ${i + 1} · ${esc(l.deskName)}</b><span>${zec(l.offer.collateralZat)} · ${usdc(l.offer.principalUsdc)}</span><code>${esc(short(l.vault))}</code></div><button class="copy4" type="button" data-copy-text="${esc(l.vault)}"><span>Copy address</span></button></div>`)
      .join('') : '')
    $$('[data-app="lock-qr"]').forEach((el) => {
      if (uri && el.dataset.for !== uri && W) {
        el.markup = W.qr(uri)
        el.dataset.for = uri
      }
    })

    // Confirmations: a ring, a dot per confirmation, and the state beside them.
    const n = state === 'confirmed' ? needed : confs
    set('lock-conf-n', `${n} of ${needed} confirmations`)
    $$('[data-app="lock-ring"]').forEach((el) => el.style.setProperty('--c', String(n / needed)))
    html('lock-dots', Array.from({ length: needed }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join(''))
    set('lock-conf-state', { waiting: 'Waiting for ZEC', seen: `Waiting for ${needed} confirmations`, confirmed: 'Confirmed on the Zcash network' }[state])
    const minutes = Math.max(1, Math.round(((needed - n) * 75) / 60))
    set('lock-conf-note', state === 'waiting' ? 'Nothing has arrived in the vault yet.' : state === 'seen' ? (testnet ? `About ${minutes} minute${minutes === 1 ? '' : 's'} to go.` : 'Pending on the Zcash network.') : 'Shielded, and now spendable only by 3 of the 4 keys.')
    set('lock-i3-t', state === 'confirmed' ? `${needed} confirmations completed` : `Wait for ${needed} confirmations`)
    set('lock-i3-p', state === 'confirmed' ? 'Your payment is confirmed on the Zcash network. The vault is locked.' : `Once your payment is seen, the guardians wait for ${needed} confirmations on the Zcash network.`)
    set('lock-i4-t', state === 'confirmed' ? 'Your dollars are paid next' : 'Then your dollars are paid')
    $$('[data-app="lock-demo"]').forEach((el) => (el.hidden = state !== 'waiting' || busyLoan(s, vaults[0].id)))
  }
  const MARK_KEY = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="0.5" y="0.5" width="39" height="39" rx="9.5" fill="#231F20"/><circle cx="20" cy="16.4" r="5.4" fill="#F4B728"/><path d="M17.6 19.6h4.8l1.9 10.6h-8.6Z" fill="#F4B728"/></svg>'

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy], [data-copy-text]')
    if (!b) return
    const text = b.dataset.copyText || lockCopy[b.dataset.copy] || ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied')
    } catch (err) {
      toast(text)
    }
  })

  function paintBorrower(s) {
    const b = myBasket(s)
    const loans = basketLoans(s, b)
    {
      const offeredNow = loans.filter((l) => l.onchain.status === 'Offered' && !l.accepted)
      preflight('preflight-accept', { feeTxs: offeredNow.length })
      const runningNow = loans.filter((l) => l.onchain.status === 'Active')
      const owe = sum(runningNow.map((l) => BigInt(l.offer.owedUsdc) - BigInt(l.onchain.repaid)))
      preflight('preflight-repay', { feeTxs: runningNow.length * 2, usdc: owe, usdcWhy: 'to repay everything' })
    }
    paintProgress(s, b, loans)
    const step = me() ? basketStep(s, b) : 'none'
    $$('[data-step]').forEach((el) => (el.hidden = el.dataset.step !== step))
    paintQuest(step)

    const live = loans.filter((l) => !ended(l))
    const names = [...new Set((b?.pieces ?? []).map((p) => p.deskName))]
    set('basket-sub', b ? `${b.pieces.length > 1 ? `${b.pieces.length} loans · ` : ''}${names.join(', ')} · ${SYM} on ${NETS} against shielded ZEC` : `${SYM} on ${NETS} against shielded ZEC`)
    set('b-principal', b ? usdc(sum(b.pieces.map((p) => p.principalUsdc))) : DASH)
    set('b-left', !loans.length ? DASH : !live.length ? 'Settled' : usdc(sum(live.map((l) => BigInt(l.offer.owedUsdc) - BigInt(l.onchain.repaid)))))
    set('vault-zec', loans.some((l) => l.vault) ? zec(sum(loans.map((l) => l.vaultZat))) : DASH)
    set('vault-count', loans.length > 1 ? `${loans.length} vaults, one per loan` : 'One vault')
    $$('.facts [data-app="desk-name"]').forEach((el) => (el.textContent = names.join(', ') || 'the desk'))
    const ltvs = live.filter((l) => l.risk && ['Funded', 'Active'].includes(l.onchain.status)).map((l) => l.risk.ltvBps)
    set('b-ltv', ltvs.length ? pct(Math.max(...ltvs)) : DASH)

    // The pieces, as they stand.
    html('piece-rows', (b?.pieces ?? [])
      .map((p) => `<div class="mini-row"><span><b>${esc(p.deskName)}</b></span><span>${usdc(p.principalUsdc)}</span><span>${esc(statusWord(s, loanById(s, p.loan)))}</span></div>`)
      .join(''))

    // While the desks answer: what each piece will lock, and in all.
    const instantOf = (owner) => s.desks.find((d) => same(d.owner, owner))?.instant
    html('wait-rows', (b?.pieces ?? [])
      .map((p) => `<div class="mini-row"><span><b>${esc(p.deskName)}</b></span><span>${usdc(p.principalUsdc)}</span><span>${p.quote ? zec(p.quote.collateralZat) : DASH}</span><span>${p.loan ? esc(statusWord(s, loanById(s, p.loan))) : instantOf(p.desk) ? 'Answering now…' : 'Waiting for the desk to review'}</span></div>`)
      .join(''))
    set('b-lock-quote', b && b.pieces.every((p) => p.quote) ? `about ${zec(sum(b.pieces.map((p) => p.quote.collateralZat)))}` : DASH)

    // Offers to accept, each on its own desk's terms.
    const offered = loans.filter((l) => l.onchain.status === 'Offered' && !l.accepted)
    html('accept-rows', offered
      .map((l) => `<div class="mini-row"><span><b>${esc(l.deskName)}</b></span><span>${usdc(l.offer.principalUsdc)}</span><span>${zec(l.offer.collateralZat)}</span><span>${usdc(l.offer.owedUsdc)}</span><span>${due(l.offer.dueAt)}</span><span>${pct(l.offer.liquidationLtvBps)} LTV</span></div>`)
      .join(''))
    set('b-accept-lock', offered.length ? zec(sum(offered.map((l) => l.offer.collateralZat))) : DASH)
    const unanswered = (b?.pieces ?? []).filter((p) => !p.loan).length
    set('accept-note', unanswered ? `${unanswered} more desk${unanswered === 1 ? ' has' : 's have'} not answered yet; you can accept these now and the rest when they come.` : '')
    $$('[data-app="accept-label"] span').forEach((el) => (el.textContent = offered.length > 1 ? `Accept ${offered.length} offers and sign` : 'Accept and sign'))

    // The lock screen (F4): every funded vault of this borrow, and the one payment for them.
    paintLock(s, loans)

    // The running loans, one row each with what can be done to it now.
    html('loan-rows-b', loans
      .map((l) => {
        const st = loanStep(s, l)
        const busy = busyLoan(s, l.id)
        const left = BigInt(l.offer.owedUsdc) - BigInt(l.onchain.repaid)
        const tone = l.overdue || st === 'liquidated' ? 'bad' : st === 'active' && l.risk?.ltvBps >= l.offer.marginLtvBps ? 'warn' : st === 'closed' ? '' : 'good'
        const action =
          st === 'active' ? `<button class="btn btn-primary btn-sm" type="button" data-act="borrower/repay" data-loan="${l.id}"${busy ? ' disabled' : ''}><span>Repay</span></button>`
          : st === 'repaid' || st === 'refund' ? `<button class="btn btn-primary btn-sm" type="button" data-act="borrower/release" data-loan="${l.id}"${busy ? ' disabled' : ''}><span>Get ZEC back</span></button>`
          : ''
        return `<div class="mini-row"><span><b>${esc(l.deskName)}</b></span><span>${usdc(l.offer.principalUsdc)}</span><span>${ended(l) ? 'Settled' : usdc(left)}</span><span>${due(l.offer.dueAt)}</span><span>${l.risk && st === 'active' ? pct(l.risk.ltvBps) : DASH}</span><span><span class="pill${tone ? ` pill-${tone}` : ''}">${esc(statusWord(s, l))}</span></span><span class="mini-act">${action}</span></div>`
      })
      .join(''))
    const running = loans.filter((l) => l.onchain.status === 'Active')
    $$('[data-app="repay-all"]').forEach((el) => (el.hidden = running.length < 2))
    const repaidNow = loans.filter((l) => l.onchain.status === 'Repaid' && l.loanbookStatus !== 'Released')
    $$('[data-app="release-all"]').forEach((el) => (el.hidden = repaidNow.length < 2 || repaidNow.some((l) => busyLoan(s, l.id))))

    // Top-up: to the vault picked, suggested back to that desk's start LTV.
    const pick = $('[data-app="topup-pick"]')
    if (pick) {
      const opts = running.map((l) => `<option value="${l.id}">${esc(l.deskName)} · ${usdc(l.offer.principalUsdc)}</option>`).join('')
      if (pick.dataset.opts !== opts) {
        const keep = pick.value
        pick.markup = opts
        pick.dataset.opts = opts
        const worst = [...running].sort((a, c) => (c.risk?.ltvBps ?? 0) - (a.risk?.ltvBps ?? 0))[0]
        pick.value = running.some((l) => l.id === keep) ? keep : worst?.id ?? ''
      }
      const target = loanById(s, pick.value)
      $$('[data-app="topup"]').forEach((el) => (el.hidden = !running.length))
      const note = $('[data-app="topup-note"]')
      const callNow = !!target?.risk && target.risk.ltvBps >= target.offer.marginLtvBps
      const key = `${target?.id}:${callNow}`
      if (note && target && note.dataset.key !== key) {
        note.dataset.key = key
        note.markup = callNow
          ? `<div class="info info-warn"><b>Margin call on ${esc(target.deskName)}'s loan</b><p>Its LTV passed ${pct(target.offer.marginLtvBps)}. Add about ${esc(zec(target.risk.topUpZat))} to return to that desk's start LTV, or repay it. At ${pct(target.offer.liquidationLtvBps)} the desk may liquidate.</p></div>`
          : '<div class="info"><b>Add collateral</b><p>More ZEC in a vault lowers that loan’s LTV at once: the guardians judge each loan on what its vault holds. It all comes back to you when you repay.</p></div>'
        const input = $('[data-input="topup"]')
        if (input) input.value = callNow && BigInt(target.risk.topUpZat) > 0n ? trim((Number(target.risk.topUpZat) / 1e8).toFixed(8)) : ''
      }
    }

    // How each loan ended.
    html('outcome-rows', loans
      .map((l) => {
        const rel = l.events.find((e) => e.kind === 'released')
        const liq = l.events.find((e) => e.kind === 'liquidated')
        const back = liq ? zec(liq.data.surplusZat) : rel ? 'all of it' : DASH
        return `<div class="mini-row"><span><b>${esc(l.deskName)}</b></span><span>${liq ? 'Liquidated' : rel ? 'Repaid, released' : esc(l.onchain.status)}</span><span>${back}</span><span class="mono">${esc(short((liq || rel)?.data.zcashTx))}</span></div>`
      })
      .join(''))

    paintMaking(s, loans)
  }

  /* ---------------------------------------------------------- the desk -- */

  function fillDeskForm(t) {
    const put = (k, v) => { const el = $(`[data-desk="${k}"]`); if (el) el.value = v }
    const unit = t.termSeconds % 86400 === 0 ? 86400 : 60
    put('name', t.name)
    put('apr', t.aprBps / 100)
    put('term', t.termSeconds / unit)
    put('term-unit', String(unit))
    put('start', t.startLtvBps / 100)
    put('margin', t.marginLtvBps / 100)
    put('liq', t.liquidationLtvBps / 100)
    put('slippage', t.slippageBps / 100)
    put('max', Number(t.maxUsdc) / 1e6)
    const online = (last?.guardians || []).filter((g) => g.online)
    for (const [key, want] of [['guardian-a', t.guardianA], ['guardian-b', t.guardianB]]) {
      const sel = $(`[data-desk="${key}"]`)
      if (!sel) continue
      sel.innerHTML = online.map((g) => `<option value="${g.address}">${esc(g.name)} · ${esc(g.operator)}</option>`).join('') || '<option value="">no guardian online</option>'
      if (want && online.some((g) => same(g.address, want))) sel.value = online.find((g) => same(g.address, want)).address
    }
    const a = $('[data-desk="guardian-a"]')
    const b = $('[data-desk="guardian-b"]')
    if (a && b && a.value === b.value && b.options.length > 1) b.selectedIndex = a.selectedIndex === 0 ? 1 : 0
    put('zec', t.lenderZec || '')
  }

  function paintDesk(s, focus) {
    if (view !== 'desk') return
    const a = me()
    const d = myDesk(s)
    set('my-desk-status', !a ? 'Connect a wallet' : d ? `${d.name} · ${pct(d.aprBps)} · ${term(d.termSeconds)} · ${usdc(d.availableUsdc)} left of ${usdc(d.maxUsdc)}` : 'No order yet')
    $$('[data-app="edit-order"] span').forEach((el) => (el.textContent = d ? 'Edit order' : 'Post an order'))
    const mine = pageLoans(s)
    set('d-lent', usdc(sum(mine.filter((l) => l.onchain.status === 'Active').map((l) => l.offer.principalUsdc))))
    set('d-collateral', mine.some((l) => l.vault) ? zec(sum(mine.filter((l) => !ended(l)).map((l) => l.vaultZat))) : DASH)
    set('d-desk-usdc', d ? usdc(d.availableUsdc) : DASH)

    const req = $('[data-app="req-rows"]')
    const rows = $('[data-app="loan-rows"]')
    if (!req || !rows) return
    if (!d) {
      set('req-count', 'Requests')
      set('loan-count', 'Loans')
      req.markup = `<p class="table-empty">${a ? 'Post an order to receive requests.' : 'Connect your desk’s wallet to see its requests.'}</p>`
      rows.markup = '<p class="table-empty">Your desk’s loans appear here.</p>'
      return
    }
    // Pieces of borrows asked of this desk that it has not answered.
    const asks = s.baskets.flatMap((b) => b.pieces.filter((p) => !p.loan && same(p.desk, d.owner)).map((p) => ({ b, p })))
    set('req-count', `Requests · ${asks.length ? `${asks.length} waiting` : 'none waiting'}`)
    req.markup = asks.length
      ? asks
          .map(({ b, p }) => `<div class="tr tr-hot" role="row">
            <span class="td-desk"><span><b>${short(b.borrower)}</b><em>KYC by the desk</em></span></span>
            <span><b>${usdc(p.principalUsdc)}</b></span>
            <span><b>${p.quote ? zec(p.quote.collateralZat) : DASH}</b></span>
            <span><b>${p.quote ? usdc(p.quote.owedUsdc) : DASH}</b></span>
            <span><b>${b.pieces.length > 1 ? `1 of ${b.pieces.length} desks` : 'all of it'}</b></span>
            <span><b>${short(b.usdcAddress)}</b></span>
            <span class="td-act"><button class="btn btn-primary" type="button" data-act="lender/approve" data-basket="${esc(b.id)}" data-piece="${p.index}"><span>Approve</span></button></span>
          </div>`)
          .join('')
      : '<p class="table-empty">No request waiting. A borrower’s request for part or all of your order appears here.</p>'

    set('loan-count', `Loans · ${mine.filter((l) => !ended(l)).length} open, ${mine.filter(ended).length} closed`)
    rows.markup = mine.length
      ? [...mine]
          .reverse()
          .map((l) => {
            const on = l.onchain.status
            const busy = busyLoan(s, l.id)
            const ltv = l.risk && ['Funded', 'Active'].includes(on) ? l.risk.ltvBps : null
            const tone = ltv == null ? '' : ltv >= l.offer.liquidationLtvBps ? 'bad' : ltv >= l.offer.marginLtvBps ? 'warn' : 'good'
            const canFund = on === 'Accepted' && !!l.vault
            const canLiquidate = on === 'Active' && !!l.risk?.liquidationRule
            // The lock deadline passed without the full collateral: take the USDC back. (Two
            // minutes' margin: the contract goes by Base's clock, which can trail this one.)
            const canCancel = on === 'Funded' && Date.now() / 1000 > Number(l.offer.lockBy) + 120 && BigInt(l.spendableZat) < BigInt(l.offer.collateralZat)
            const action = canFund
              ? `<button class="btn btn-primary" type="button" data-act="lender/fund" data-loan="${l.id}"${busy ? ' disabled' : ''}><span>Fund</span></button>`
              : canCancel
                ? `<button class="btn btn-ghost" type="button" data-act="lender/cancel" data-loan="${l.id}"${busy ? ' disabled' : ''}><span>Cancel and refund</span></button>`
              : canLiquidate
                ? `<button class="btn btn-danger" type="button" data-act="lender/liquidate" data-loan="${l.id}"${busy ? ' disabled' : ''}><span>Liquidate</span></button>`
                : `<button class="btn btn-ghost" type="button" data-show="${l.id}"><span>View</span></button>`
            const label = l.overdue ? 'Overdue' : l.loanbookStatus === 'Released' ? 'Released' : on
            return `<div class="tr${canFund || canLiquidate ? ' tr-hot' : ''}" role="row">
              <span class="td-desk"><span><b>Loan ${l.id.slice(0, 8)}</b><em>${esc(short(l.vault))}</em></span></span>
              <span><b class="num-accent">${pct(d.aprBps)} APR</b></span>
              <span><b>${usdc(l.offer.principalUsdc)}</b></span>
              <span><b>${l.vault ? zec(l.vaultZat) : DASH}</b></span>
              <span>${ltv == null ? `<b>${DASH}</b>` : `<b class="ltv-pill ltv-${tone}">${pct(ltv)}</b>`}</span>
              <span><span class="tokens"><span>A</span><span>B</span></span></span>
              <span><span class="pill${on === 'Active' && !l.overdue ? ' pill-good' : on === 'Liquidated' || l.overdue ? ' pill-bad' : on ? ' pill-warn' : ''}">${label}</span></span>
              <span class="td-act">${action}</span>
            </div>`
          })
          .join('')
      : '<p class="table-empty">No loans yet. Approve a request to open one.</p>'
    const liqRule = focus?.risk?.liquidationRule
    set('d-liq-why', liqRule ? `Loan ${focus.id.slice(0, 8)}: ${liqRule}. The guardians will sign.` : 'Liquidate stays locked until a published rule is met (the liquidation LTV, or the due date passed unpaid). The guardians would refuse it otherwise.')
    paintQuest(focus ? loanStep(s, focus) : 'none')
  }

  document.addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]')
    if (show) {
      picked = show.dataset.show
      if (last) paint(last)
      $('#detail')?.scrollIntoView({ behavior: 'smooth' })
    }
  })

  /* --------------------------------------------------------------- paint -- */

  function paint(s) {
    last = s
    document.body.classList.remove('is-loading')
    refreshBalances()
    if (s.chain) {
      SYM = s.chain.symbol || SYM
      NET = s.chain.label || NET
      NETS = s.chain.short || NETS
      FAUCET = s.chain.faucets || FAUCET
      $$('[data-sym]').forEach((el) => { if (el.textContent !== SYM) el.textContent = SYM })
      $$('[data-net]').forEach((el) => { if (el.textContent !== NETS) el.textContent = NETS })
      $$('[data-net-full]').forEach((el) => { if (el.textContent !== NET) el.textContent = NET })
    }
    if (!configured && s.chain && W) {
      W.configure(s.chain)
      configured = true
    }
    set('net-label', `${NET} · ${s.chain.zecPrefix === 'utest1' ? 'Zcash testnet' : 'Zcash test chain'}`)
    const focus = focusLoan(s)
    paintPicker(s, focus)
    paintHealth(s, focus)
    paintChecks(focus)
    paintLog(s)
    paintDest()
    paintMarkets(s)
    if (view === 'borrower') paintBorrower(s)
    if (view === 'desk') paintDesk(s, focus)
    if ($('[data-app="lend-dialog"]')?.open) {
      const max = BigInt(Math.round(Number($('[data-desk="max"]')?.value || 0) * 1e6))
      preflight('preflight-lend', { feeTxs: 1, usdc: max + 2n * ((max * 10n) / 10000n), usdcWhy: 'to lend the whole order (with the guardians\u2019 fees)' })
    }

    // Cards about loans wait until there is one.
    const loans = pageLoans(s)
    $$('[data-when="loans"]').forEach((el) => (el.hidden = !loans.length))
    $$('[data-app="d-liq-why"]').forEach((el) => (el.hidden = !focus?.risk?.liquidationRule))

    // The guardians and the operator list.
    const open = loans.filter((l) => !ended(l)).length
    if (!$('[data-app="operators"]')) set('log-ops', '2')
    set('log-signed', String(loans.reduce((n, l) => n + l.events.filter((e) => e.sig).length, 0)))
    for (const letter of ['A', 'B']) {
      const role = `referee${letter}`
      const addr = focus?.offer[role] || s.addresses[role]
      set(`guardian-${letter}-addr`, `${gName(s, addr)} · ${short(addr)}`)
      const [label, tone] = guardianState(focus, letter)
      setPill(`guardian-${letter}-state`, label, tone)
      set(`op-${letter}-addr`, short(s.addresses[role]))
      set(`op-${letter}-count`, String(loans.reduce((n, l) => n + l.events.filter((e) => e.actor === role && e.sig).length, 0)))
      set(`op-${letter}-seat`, open ? `On ${open} open loan${open === 1 ? '' : 's'}` : loans.length ? 'On your last loans' : 'Free')
    }

    const ops = $('[data-app="operators"]')
    if (ops) {
      ops.markup = (s.guardians || []).length
        ? s.guardians
            .map((g) => {
              const seats = s.loans.filter((l) => same(l.offer.refereeA, g.address) || same(l.offer.refereeB, g.address))
              const signed = seats.reduce((n, l) => n + l.events.filter((e) => e.sig && e.actor === (same(l.offer.refereeA, g.address) ? 'refereeA' : 'refereeB')).length, 0)
              const ago = Math.max(0, Math.round((Date.now() - g.lastSeen) / 1000))
              return `<div class="operator card">
                <div class="operator-head"><span class="avatar" style="--h:${parseInt(g.address.slice(2, 8), 16) % 360}">${esc(g.name.split(' ').pop().slice(0, 2))}</span><div><h3>${esc(g.name)}</h3><p>${esc(g.operator)}</p></div><span class="pill ${g.online ? 'pill-good' : 'pill-bad'}">${g.online ? 'Online' : 'Offline'}</span></div>
                <div class="sheet">
                  <div class="line"><span>Base address</span><b class="mono">${short(g.address)}</b></div>
                  <div class="line"><span>Last heartbeat</span><b>${ago < 60 ? `${ago} s ago` : `${Math.round(ago / 60)} min ago`}</b></div>
                  <div class="line"><span>Fee per loan</span><b>${pct(g.feeBps)} of principal</b></div>
                  <div class="line"><span>Loans guarded</span><b>${seats.length} · ${signed} signed entries</b></div>
                  <div class="line"><span>Code fingerprint</span><b class="mono" title="${esc(g.code)}">${esc(g.code.slice(0, 16))}…</b></div>
                </div>
              </div>`
            })
            .join('')
        : '<p class="table-empty">No guardian is on the operator list yet.</p>'
      set('log-ops', String(s.guardians.filter((g) => g.online).length))
    }

    const feeds = $('[data-app="feeds"]')
    if (feeds && s.price) {
      feeds.markup = s.price.error
        ? `<div class="feed"><span>Feed unavailable</span><b>${esc(s.price.error)}</b></div>`
        : Object.entries(s.price.detail)
            .sort(([a], [b]) => (a === 'median') - (b === 'median'))
            .map(([k, v]) => `<div class="feed${k === 'median' || k === 'override' ? ' feed-median' : ''}"><span>${k === 'median' ? `Median of ${Object.keys(s.price.detail).length - 1}` : k === 'override' ? 'Demo override' : venue(k)}</span><b>${usd(v)}</b></div>`)
            .concat(Object.entries(s.price.skipped || {}).map(([k, why]) => `<div class="feed feed-out"><span>${venue(k)} · left out</span><em>${esc(why)}</em></div>`))
            .join('')
    }

    // Row buttons wait on their own loan's jobs; every button while the browser is busy.
    $$('[data-act]').forEach((b) => (b.disabled = clientBusy || (b.dataset.loan ? busyLoan(s, b.dataset.loan) : false)))
  }

  /* ------------------------------------------------------------- polling -- */

  const seenDone = new Set()
  let firstPoll = true
  async function refresh() {
    try {
      const res = await fetch('/api/state')
      const s = await res.json()
      if (s.error) throw new Error(s.error)
      paint(s)
      for (const j of s.jobs) {
        if (!j.done || seenDone.has(j.id)) continue
        seenDone.add(j.id)
        if (!firstPoll) j.error ? toast(`${j.name} failed: ${j.error}`, 'bad') : toast(`${j.name}: done`)
      }
      firstPoll = false
    } catch (e) {
      toast(`Cannot reach the Hypothec services: ${e.message}`, 'bad')
    }
  }

  /* -------------------------------------------------------------- wallet -- */

  /*
    The person's own wallet signs every Base action: a desk posts and signs its terms and
    funds; the borrower accepts, signs and repays. Each flow checks it is the right wallet
    first, then asks the wallet, then tells the API what happened (the API checks the
    chain before recording it).
  */
  function paintDest() {
    const a = me()
    set('dest-wallet', a ? short(a) : 'your wallet, once connected')
  }

  function paintWallet() {
    const a = me()
    $$('[data-app="wallet"]').forEach((b) => (a ? b.setAttribute('data-connected', '') : b.removeAttribute('data-connected')))
    if (a) $$('[data-app="wallet-label"]').forEach((el) => (el.markup = `<b>${a.slice(0, 6)}…${a.slice(-4)}</b><em>${NET}</em>`))
    paintDest()
    if (last) paint(last)
  }

  async function connectWallet() {
    try {
      await W.connect()
      paintWallet()
      toast(`Wallet connected on ${NET}`)
    } catch (err) {
      toast(plain(err), 'bad')
    }
  }

  function needWallet(expected, who) {
    const a = me()
    if (!a) throw new Error(`Connect ${who}'s wallet first`)
    if (expected && a.toLowerCase() !== expected.toLowerCase()) throw new Error(`This needs ${who}'s wallet (${short(expected)}); the connected one is ${short(a)}`)
    return a
  }

  async function post(act, body = {}) {
    const res = await fetch(`/api/${act}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const out = await res.json()
    if (!res.ok) throw new Error(out.error)
    return out
  }

  const confirm = (what) => toast(`${what}: confirm in your wallet…`)

  /* What went wrong, in plain words; the wallet's or the chain's own message otherwise. */
  function plain(err) {
    const m = String(err?.shortMessage || err?.message || err)
    if (/user (rejected|denied)|rejected the request|denied transaction/i.test(m)) return 'You cancelled in your wallet.'
    if (/insufficient funds|exceeds the balance of the account|gas required exceeds/i.test(m)) return `Not enough ${NET} ETH in this wallet for the fee.`
    if (/transfer amount exceeds balance|ERC20: transfer amount|exceeds balance/i.test(m)) return `Not enough ${SYM} in this wallet.`
    if (/took too long|timed out|timeout|fetch failed|Failed to fetch|network/i.test(m)) return 'The network is slow to answer. Try again in a moment.'
    if (/Missing or invalid parameters/i.test(m)) return 'The wallet could not send it; the network may be slow. Try again.'
    if (/No browser wallet/i.test(m)) return m
    return m.split('\n')[0]
  }

  /* Repays the given loans in ONE transaction: a USDC permit (a signature, no fee), then
     one repayAll that pays each loan's own lender. Then the vaults' ZEC comes back without
     another click: the borrower's app asks the guardians to release each one. */
  async function repayLoans(loans) {
    if (!loans.length) throw new Error('Nothing to repay')
    needWallet(loans[0].offer.borrower, 'the borrower')
    await refreshBalances(true)
    if (bal && bal.eth < FEE_ETH) throw new Error(`This wallet has no ${NET} ETH for the fee. Add a little, then try again.`)
    const total = sum(loans.map((l) => BigInt(l.offer.owedUsdc) - BigInt(l.onchain.repaid)))
    if (bal && bal.usdc < total) throw new Error(`Repaying needs ${usdc(total)}; this wallet holds ${usdc(bal.usdc)}.`)
    confirm(`Repay ${usdc(total)}: sign the ${SYM} permit, then confirm one transaction`)
    await W.repayAll(loans.map((l) => l.id), total)
    toast(`Repaid ${usdc(total)}. Your ZEC is on its way back…`)
    await post('borrower/release-all', { loans: loans.map((l) => l.id) }).catch((e) => toast(plain(e), 'bad'))
  }

  /* The flows that run in the wallet. Each returns once the chain and the API agree. */
  const FLOWS = {
    'borrower/request': async () => {
      if (!me()) return connectWallet()
      const going = myBasket(last)
      if (going && basketStep(last, going) !== 'closed') return void go('loan.html')
      const f = fillOrders(last)
      if (!f.pieces.length) throw new Error('Type an amount')
      toast('Sending your request…')
      if (f.left > 0n) throw new Error(`The ticked orders cover only ${usdc(f.want - f.left)}`)
      await post('borrower/request', {
        borrower: me(),
        usdcAddress: $('[data-input="usdc-address"]').value.trim() || me(),
        pieces: f.pieces.map((p) => ({ desk: p.desk.owner, amountUsdc: Number(p.take) / 1e6 })),
      })
      go('loan.html')
    },
    'borrower/accept': async () => {
      const b = myBasket(last)
      const offered = basketLoans(last, b).filter((l) => l.onchain.status === 'Offered' && !l.accepted)
      if (!offered.length) throw new Error('No offer to accept yet')
      needWallet(b.borrower, 'the borrower')
      await refreshBalances(true)
      if (bal && bal.eth < FEE_ETH) throw new Error(`This wallet has no ${NET} ETH for the fee, so the wallet cannot send it. Add a little (see the box above), then try again.`)
      const borrowerZec = $('[data-input="zec-payout"]').value.trim()
      if (!new RegExp(`^${last.chain.zecPrefix}`).test(borrowerZec)) throw new Error(`Paste a shielded address from your Zcash wallet (${last.chain.zecPrefix}… on this chain)`)
      for (const l of offered) {
        confirm(`Accept ${l.deskName}'s terms and the guardians on ${NETS}`)
        await W.accept(l.id, b.usdcAddress)
        const accept = { offerDigest: l.offerDigest, borrowerZec }
        confirm(`Sign your ZEC payout address into ${l.deskName}'s loan`)
        const sig = await W.sign(W.message('accept', l.id, accept))
        await post('borrower/accept', { loan: l.id, accept, sig })
      }
      toast(offered.length > 1 ? `Accepted ${offered.length} offers. The vaults are being made…` : 'Accepted. The four keys are being made…')
    },
    'borrower/repay': async (btn) => repayLoans([loanById(last, btn.dataset.loan)]),
    'borrower/repay-all': async () => repayLoans(basketLoans(last, myBasket(last)).filter((l) => l.onchain.status === 'Active')),
    'lender/desk': async () => {
      if (!me()) return connectWallet()
      const owner = me()
      const val = (k) => $(`[data-desk="${k}"]`).value.trim()
      const bps = (k) => Math.round(Number(val(k)) * 100)
      const terms = {
        owner,
        name: val('name'),
        aprBps: bps('apr'),
        termSeconds: Math.round(Number(val('term')) * Number(val('term-unit'))),
        startLtvBps: bps('start'),
        marginLtvBps: bps('margin'),
        liquidationLtvBps: bps('liq'),
        slippageBps: bps('slippage'),
        maxUsdc: Math.round(Number(val('max')) * 1e6),
        lenderZec: val('zec'),
        guardianA: val('guardian-a'),
        guardianB: val('guardian-b'),
        at: Date.now(),
      }
      if (!new RegExp(`^${last.chain.zecPrefix}`).test(terms.lenderZec)) throw new Error(`Paste your shielded ZEC address (${last.chain.zecPrefix}… on this chain)`)
      if (!terms.guardianA || !terms.guardianB || same(terms.guardianA, terms.guardianB)) throw new Error('Pick two different guardians')
      confirm('Sign your desk’s terms')
      if (bal && bal.usdc < BigInt(terms.maxUsdc)) toast(`Posted orders lend from this wallet: it holds ${usdc(bal.usdc)} of the ${usdc(terms.maxUsdc)} you offer.`)
      const sig = await W.sign(W.message('desk', owner, terms, 'desk'))
      await post('lender/desk', { terms, sig })
      $('[data-app="lend-dialog"]')?.close()
      toast('Order posted. Borrowers see it on Markets')
    },
    'lender/approve': async (btn) => {
      const b = last.baskets.find((x) => x.id === btn.dataset.basket)
      const p = b?.pieces[Number(btn.dataset.piece)]
      if (!p) throw new Error('That request is gone')
      const lender = needWallet(p.desk, 'your desk')
      const { id, offer, terms } = await post('lender/prepare', { lender, basket: b.id, piece: p.index })
      confirm(`Post the terms on ${NETS}`)
      await W.offer(id, terms)
      confirm('Sign the terms for the loanbook')
      const sig = await W.sign(W.message('offer', id, offer))
      await post('lender/offer', { id, sig })
      toast('Terms posted and signed')
    },
    'lender/fund': async (btn) => {
      const l = loanById(last, btn.dataset.loan)
      needWallet(l.offer.lender, 'the desk')
      confirm(`Approve the ${SYM}, then fund`)
      await W.fund(l.id)
      await post('lender/funded', { loan: l.id })
      toast(`Funded. The ${SYM} waits in the contract until the guardians see the ZEC`)
    },
    'lender/cancel': async (btn) => {
      const l = loanById(last, btn.dataset.loan)
      needWallet(l.offer.lender, 'the desk')
      confirm(`Cancel the loan on ${NETS}`)
      await W.cancel(l.id)
      await post('lender/cancelled', { loan: l.id })
      toast(`Cancelled. The ${SYM} and fees are back in your wallet; any ZEC sent goes back to the borrower`)
    },
  }

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-app="wallet"]')) return connectWallet()
    if (e.target.closest('[data-toggle="dest"]')) {
      const f = $('[data-app="dest-field"]')
      if (f) f.hidden = !f.hidden
      return
    }
    const fill = e.target.closest('[data-fill]')
    if (fill && last?.testnet) {
      if (fill.dataset.fill === 'test-desk') {
        // Only the address: the terms in the form stay as they are.
        const second = same(me(), last.testnet.lender2Address)
        $('[data-desk="zec"]').value = second ? last.testnet.lender2Zec : last.testnet.lenderZec
        if (!$('[data-desk="name"]').value) $('[data-desk="name"]').value = second ? 'Desk B' : 'Desk A'
      } else if ($('[data-input="zec-payout"]')) $('[data-input="zec-payout"]').value = last.testnet.borrowerZec
      return
    }
    const b = e.target.closest('[data-act]')
    if (!b || b.disabled) return
    let act = b.dataset.act
    clientBusy = true
    b.disabled = true
    b.setAttribute('data-busy', '')
    try {
      if (FLOWS[act]) {
        if (!W) throw new Error('The wallet module did not load')
        await FLOWS[act](b)
        return
      }
      let body = { loan: b.dataset.loan }
      // On the public site the price controls need the demo token, given as ?demo=<token>.
      const token = new URLSearchParams(location.search).get('demo') || undefined
      if (act === 'lender/price') body = { usd: Number($('[data-input="override"]').value), token }
      else if (act === 'lender/price-live') (act = 'lender/price'), (body = { usd: null, token })
      else if (act === 'borrower/topup') body = { loan: $('[data-app="topup-pick"]').value, zec: Number($('[data-input="topup"]').value) }
      else if (act === 'borrower/lock' || act === 'borrower/cancel') body = { basket: myBasket(last)?.id, borrower: me() }
      else if (act === 'borrower/release-all') body = { loans: basketLoans(last, myBasket(last)).filter((l) => l.onchain.status === 'Repaid').map((l) => l.id) }
      const out = await post(act, body)
      if (out.started) toast(`${out.started}: working…`)
    } catch (err) {
      toast(plain(err), 'bad')
    } finally {
      clientBusy = false
      b.removeAttribute('data-busy')
      refresh()
    }
  })

  if (W) {
    W.restore().then(paintWallet).catch(() => undefined)
    W.onChange(() => W.restore().then(paintWallet))
  }

  refresh()
  setInterval(refresh, 2000)
})()
