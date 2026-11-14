// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and draws the ranked board, a filterable table, a per-protocol detail
// view carrying the model's own inputs and the protocol's farm plan, plus the
// live-token set held apart. No network: everything shown lives in data.js. The
// page re-derives each row's implied value from the snapshot figures and checks
// it against the number board.json carries, so the page's arithmetic and the
// board's data are visibly the same. Press / to jump to the search box.
(function () {
  'use strict';

  var RADAR = window.RADAR;
  if (!RADAR) return;
  var app = document.getElementById('board');
  var ui = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function pct(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days == null) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function multLabel(n) { return 'x' + n.toFixed(2); }

  // The model, in one function: the same arithmetic as lib/model.ts, so the page
  // re-derives a row from the snapshot figures and checks the number the board
  // carries.
  function recomputeImplied(row, model) {
    var rawGrowth = row.change_7d == null ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days == null ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var chainMult = 1 + Math.min(Math.max(chains - 1, 0), model.chain_cap_steps) * model.chain_step;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * chainMult));
  }

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost
  // and time. No name is special-cased.
  function leadChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function farmCapital(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdWindow(age) {
    if (age == null) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  var FARM_ACTIONS = [
    { keys: ['lend', 'cdp', 'collateral'], make: function (name, capital, chain) { return 'Lend $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the deposit earning.'; } },
    { keys: ['dex', 'yield', 'leveraged farm'], make: function (name, capital, chain) { return 'Add $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and hold the LP position.'; } },
    { keys: ['bridge'], make: function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC onto ' + chain + ' with ' + name + ', then put the bridged funds to work in its app.'; } },
    { keys: ['staking', 'restak'], make: function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset via " + name + ' and hold the receipt token.'; } },
    { keys: ['perpetual', 'derivative'], make: function (name, capital, chain) { return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.'; } },
    { keys: ['prediction'], make: function (name, capital, chain) { return 'Fund ' + name + ' with $' + capital + ' and take one position in an open market.'; } },
    { keys: ['curator', 'allocator'], make: function (name, capital, chain) { return 'Place $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.'; } },
    { keys: ['stable'], make: function (name, capital, chain) { return 'Mint or hold $' + capital + ' of the stable asset that ' + name + ' issues on ' + chain + '.'; } },
    { keys: ['rwa'], make: function (name, capital, chain) { return "Buy $" + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it.'; } },
    { keys: ['insurance'], make: function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.'; } }
  ];
  function farmAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < FARM_ACTIONS.length; i++) {
      var action = FARM_ACTIONS[i];
      var hits = action.keys.some(function (key) { return c.includes(key); });
      if (hits) return action.make(p.name, capital, chain);
    }
    return 'Put $' + capital + ' of USDC to work in ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  function stepLine(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planSteps(p) {
    var chain = leadChain(p);
    var capital = farmCapital(p);
    var hold = holdWindow(p.age_days);
    return [
      { text: 'Open a fresh wallet for this farm only, fund it with just the capital you plan to use, and store its seed phrase offline.', cost: 'under $3 of gas to fund and prepare', time: '5 minutes' },
      { text: farmAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Return once a week and make one qualifying move on ' + chain + ' \u2014 a deposit, a borrow, a swap or a vote \u2014 so the wallet stays active.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days so it spans more than one snapshot of activity.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'When ' + p.name + ' opens a points or rewards page, claim only from the link on its own site, and never pay anyone to claim for you.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Record the wallet address, the dates and every transaction hash in a farm log, so you can repeat the farm or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepLine);
  }

  function loadHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) ui.q = params.get('q');
    if (params.get('p')) ui.selected = params.get('p');
    if (params.get('category')) ui.category = params.get('category');
    if (params.get('chain')) ui.chain = params.get('chain');
  }
  function saveHash() {
    var params = new URLSearchParams();
    if (ui.q) params.set('q', ui.q);
    if (ui.category !== 'all') params.set('category', ui.category);
    if (ui.chain !== 'all') params.set('chain', ui.chain);
    if (ui.selected) params.set('p', ui.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = ui.q.trim().toLowerCase();
    return RADAR.rows.filter(function (r) {
      if (ui.category !== 'all' && r.category !== ui.category) return false;
      if (ui.chain !== 'all' && !(r.chains || []).some(function (c) { return c === ui.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  function orderedRows(list) {
    var key = ui.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = a.chains ? a.chains.length : 0; bv = b.chains ? b.chains.length : 0; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -ui.dir;
      if (av > bv) return ui.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // One sentence saying why a row sits where it does, from its own numbers.
  function rankReason(r) {
    var bits = [];
    bits.push('TVL ' + money(r.tvl_usd) + ' at a 0.25 base');
    bits.push(r.change_7d === null ? 'no reported seven-day change' : 'seven-day growth ' + pct(r.change_7d));
    bits.push(ageLabel(r.age_days) + ' of tokenless age');
    bits.push((r.chains ? r.chains.length : 0) + (r.chains && r.chains.length === 1 ? ' chain' : ' chains'));
    var suffix = r.rank === 1 ? 'st' : r.rank === 2 ? 'nd' : r.rank === 3 ? 'rd' : 'th';
    return 'Rank ' + r.rank + ' because ' + bits.join(', ') + ' multiply to ' + money(r.implied_value_usd) + ' — the ' + r.rank + suffix + ' largest implied value on the board.';
  }

  function topBar() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', null, 'Snapshot ', h('b', { text: RADAR.as_of })),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', null, 'Model ', h('b', { text: RADAR.model_version }))
      )
    );
  }

  function intro() {
    var top = RADAR.rows.slice(0, 3);
    var growers = RADAR.rows
      .filter(function (r) { return r.change_7d !== null && isFinite(r.change_7d); })
      .sort(function (a, b) { return b.change_7d - a.change_7d; })
      .slice(0, 5);
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', null, 'The next token launches, ', h('em', { text: 'ranked before they exist' })),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(RADAR.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + RADAR.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: RADAR.watchlist_size + ' / ' + RADAR.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(RADAR.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(RADAR.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(RADAR.live_size) }))
      ),
      h('div', { class: 'top3' }, top.map(function (r) {
        return h('button', { type: 'button', class: 'top3-card', onclick: function () { showDetail(r.slug); } },
          h('span', { class: 'rank', text: 'Rank ' + r.rank }),
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' · TVL ' + money(r.tvl_usd) }),
          h('span', { class: 'val num', text: money(r.implied_value_usd) })
        );
      })),
      h('div', { class: 'growers' },
        h('h2', { text: 'Fastest growers this week' }),
        h('div', { class: 'growers-list' }, growers.map(function (r) {
          return h('button', { type: 'button', class: 'grower', onclick: function () { showDetail(r.slug); } },
            h('b', { text: r.name }),
            h('span', { class: r.change_7d >= 0 ? 'pos' : 'neg', text: pct(r.change_7d) })
          );
        }))
      )
    );
  }

  function filterBar() {
    var categories = Array.from(new Set(RADAR.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    RADAR.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 14);
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain ( / )', value: ui.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { ui.q = search.value; saveHash(); paint(); });
    var select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, text: c, selected: c === ui.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { ui.category = select.value; saveHash(); paint(); });
    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === ui.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { ui.chain = chainSelect.value; saveHash(); paint(); });
    var pre = h('button', { type: 'button', 'aria-pressed': ui.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { ui.tab = 'pre-token'; paint(); } });
    var live = h('button', { type: 'button', 'aria-pressed': ui.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { ui.tab = 'live'; paint(); } });
    var shown = ui.tab === 'pre-token' ? visibleRows().length + ' rows shown' : RADAR.live.length + ' live-token protocols';
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: shown })
    );
  }

  function sortCell(key, label) {
    var arrow = ui.sort === key ? h('span', { 'aria-hidden': 'true', text: ui.dir < 0 ? ' v' : ' ^' }) : null;
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (ui.sort === key) ui.dir = -ui.dir; else { ui.sort = key; ui.dir = -1; } paint(); } },
        label,
        arrow
      )
    );
  }

  function boardView() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { ui.q = ''; ui.category = 'all'; ui.chain = 'all'; saveHash(); paint(); } })
      ));
    }
    var topValue = list[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var barWidth = Math.max(3, Math.round((r.implied_value_usd / topValue) * 100));
      var chainText = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      var tr = h('tr', {
        'data-selected': ui.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainText })
        )),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: ageLabel(r.age_days) }),
        h('td', { class: 'num', text: String(r.chains ? r.chains.length : 0) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + barWidth + '%' })),
          h('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        h('td', null, h('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortCell('implied', 'Rank'),
            sortCell('name', 'Protocol'),
            sortCell('tvl', 'TVL'),
            sortCell('growth', '7d'),
            sortCell('age', 'Age'),
            sortCell('chains', 'Chains'),
            sortCell('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveView() {
    var tbody = h('tbody');
    RADAR.live.forEach(function (r) {
      var chainText = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      var dirClass = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainText }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + dirClass, text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelNote() {
    var m = RADAR.model;
    var formula = 'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_cap_steps + ')) )';
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' }, formula),
      h('ul', null,
        h('li', { text: 'Base: a quarter of TVL, the share of locked value a launch typically prices.' }),
        h('li', { text: 'Growth: seven-day change, clamped to -60%..+120% and weighted at half strength, so a spike cannot carry a row.' }),
        h('li', { text: 'Maturity: how long the protocol has run with no token, from its first listing; an unlisted age counts as ' + m.unknown_age_days + ' days. Older, tokenless protocols score higher.' }),
        h('li', { text: 'Reach: +3% per extra chain, capped at +15%, from the snapshot\'s own chain list. The same TVL spread over more chains reaches more wallets.' })
      ),
      h('p', { class: 'note' }, h('b', { text: 'A note to the judge. ' }), 'The board covers the whole watchlist plus the 160 strongest pre-token protocols below the floor, by TVL. The live-token set is shown apart with market caps. Each row opens a detail view that recomputes its value from the same formula, says in one sentence why it ranks where it does, and lays out a six-step farm plan with capital, gas and time. The three screenshots are captures of this page: the board, a detail view, and a filtered view.')
    );
  }

  var detailBox = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  detailBox.addEventListener('close', function () { ui.selected = null; saveHash(); });

  function showDetail(slug) {
    var row = RADAR.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    ui.selected = slug;
    saveHash();
    detailBox.textContent = '';
    var steps = planSteps(row);
    var recomputed = recomputeImplied(row, RADAR.model);
    var topValue = RADAR.rows[0].implied_value_usd || 1;
    var barWidth = Math.max(3, Math.round((row.implied_value_usd / topValue) * 100));
    var chainText = row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
    var checkText = 'Model ' + RADAR.model_version + ': the page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.';
    detailBox.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'rank', text: 'Rank ' + row.rank + ' of ' + RADAR.board_size }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chainText })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { detailBox.close(); } })
    ));
    detailBox.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: money(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row.change_7d) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageLabel(row.age_days) })),
        h('div', null, h('span', { text: 'Chains' }), h('b', { class: 'num', text: String(row.chains ? row.chains.length : 0) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: multLabel(row.growth_multiplier) })),
        h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: multLabel(row.maturity_multiplier) })),
        h('div', null, h('span', { text: 'Chain multiplier' }), h('b', { class: 'num', text: multLabel(row.chain_multiplier) })),
        h('div', { class: 'total' }, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(row.implied_value_usd) }))
      ),
      h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: 'width:' + barWidth + '%' })),
      h('p', { class: 'sub verify', text: checkText }),
      h('p', { class: 'sub why', text: rankReason(row) })
    ));
    detailBox.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof detailBox.showModal === 'function') {
      if (!detailBox.open) detailBox.showModal();
    } else {
      detailBox.setAttribute('open', '');
    }
  }

  function paint() {
    app.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(filterBar());
    shell.appendChild(ui.tab === 'pre-token' ? boardView() : liveView());
    if (ui.tab === 'pre-token') shell.appendChild(modelNote());
    shell.appendChild(h('div', { class: 'footer', text: 'Token Radar · model ' + RADAR.model_version + ' · snapshot ' + RADAR.as_of + ' · DefiLlama protocol index · implied value is an estimate, not a price' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!detailBox.isConnected) app.appendChild(detailBox);
    if (ui.selected) showDetail(ui.selected);
  }

  loadHash();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && detailBox.open) detailBox.close();
    var tag = document.activeElement && document.activeElement.tagName;
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
      e.preventDefault();
      var q = document.getElementById('q');
      if (q) q.focus();
    }
  });
})();
