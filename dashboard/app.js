// Token Launch Radar dashboard (radar-2). Renders window.RADAR, written by
// main.ts from the sealed snapshot: the ranked pre-token board with its
// model breakdown and farm plan per protocol, plus the live-token
// comparison set. No network, no framework. Views are addressable for the
// screenshots: ?detail=<slug>, ?cat=<category>, ?tier=<tier>, ?watch=1,
// ?q=<text>, ?sort=<key>.
(function () {
  'use strict';
  var R = window.RADAR;
  var main = document.getElementById('board');
  if (!R || !R.rows) { main.innerHTML = '<p>No radar data was written beside this page.</p>'; return; }

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    tier: params.get('tier') || '',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'rank',
    dir: 1,
    detail: params.get('detail') || '',
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n == null) return '<span class="flat">no data</span>';
    var cls = n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageLabel(days) {
    if (days == null) return 'age unknown';
    if (days >= 730) return (days / 365).toFixed(1) + ' yrs tracked';
    if (days >= 60) return Math.round(days / 30.4) + ' mo tracked';
    return days + ' days tracked';
  }

  var categories = [];
  var chainsSeen = {};
  R.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { chainsSeen[c] = 1; });
  });
  categories.sort();
  var chainNames = Object.keys(chainsSeen).sort();

  function filtered() {
    var rows = R.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.tier && r.tier !== state.tier) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d == null ? -999 : a.change_7d; vb = b.change_7d == null ? -999 : b.change_7d; }
      else if (key === 'age') { va = a.age_days == null ? -1 : a.age_days; vb = b.age_days == null ? -1 : b.age_days; }
      else if (key === 'signal') { va = a.signal_score; vb = b.signal_score; }
      else if (key === 'name') { return a.name < b.name ? -1 : 1; }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; if (key === 'rank') { va = -a.rank; vb = -b.rank; } }
      return (vb - va) * (key === 'rank' ? -1 : 1) * state.dir * (key === 'rank' ? -1 : 1);
    });
    if (key === 'rank') rows.sort(function (a, b) { return a.rank - b.rank; });
    return rows;
  }

  function detailHtml(r) {
    if (!r) return '';
    var m = r.model;
    var steps = r.farm_steps.map(function (s, i) { return '<li>' + esc(s) + '</li>'; }).join('');
    var flags = r.risk_flags.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('');
    return '<section class="detail" id="detail"><button class="close" id="closeDetail">Close detail</button>' +
      '<div class="kicker">Protocol detail · rank #' + r.rank + ' of ' + R.board_size + '</div>' +
      '<h2>' + esc(r.name) + (r.on_watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">EARLY · BELOW FLOOR</span>') + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'chain unlisted') + ' · ' + ageLabel(r.age_days) +
      ' · records no token in the snapshot (no market cap, no CoinGecko id, no symbol) — that is DefiLlama\u2019s record, not proof none exists.</p>' +
      '<div class="dgrid">' +
      '<div class="dcard"><h3>Why this value — model radar-2</h3>' +
      '<div class="kv"><span>TVL (snapshot)</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div class="kv"><span>Category peer multiple</span><b>× ' + m.peer_multiple.toFixed(3) + '</b></div>' +
      '<div class="kv"><span>Peers behind it</span><b>' + (m.category_peers >= 3 ? m.category_peers + ' live-token ' + esc(r.category || '') : 'thin category — all-market median anchors it') + '</b></div>' +
      '<div class="kv"><span>Momentum × (7d ' + (r.change_7d == null ? 'n/a' : r.change_7d.toFixed(1) + '%') + ')</span><b>× ' + m.growth_multiplier.toFixed(3) + '</b></div>' +
      '<div class="kv"><span>Maturity ×</span><b>× ' + m.maturity_multiplier.toFixed(3) + '</b></div>' +
      '<div class="kv"><span>Chain breadth × (' + r.chains.length + ' chains)</span><b>× ' + m.breadth_multiplier.toFixed(3) + '</b></div>' +
      '<div class="kv"><span>Implied launch value</span><b class="implied">' + money(r.implied_value_usd) + '</b></div>' +
      '<div class="kv"><span>Signal score / tier</span><b>' + r.signal_score + ' / 100 · ' + esc(r.tier) + '</b></div></div>' +
      '<div class="dcard"><h3>Risk flags</h3><ul class="flags">' + flags + '</ul></div>' +
      '<div class="dcard"><h3>How to farm it — ' + r.farm_steps.length + ' steps</h3><ol class="steps">' + steps + '</ol></div>' +
      '</div></section>';
  }

  function render() {
    var rows = filtered();
    var detail = state.detail ? R.rows.find(function (r) { return r.slug === state.detail; }) : null;
    var top = R.rows[0];
    var catChips = R.categories.map(function (c) {
      return '<span class="cat-chip">' + esc(c.category) + ' <b>×' + c.blended_multiple.toFixed(2) + '</b> · ' + c.peers + ' peers</span>';
    }).join('');
    var opts = function (list, cur, allLabel) {
      return '<option value="">' + allLabel + '</option>' + list.map(function (x) {
        return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>';
      }).join('');
    };
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (detail && detail.slug === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank">#' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.on_watchlist ? '<span class="badge wl">WL</span>' : '<span class="badge early">EARLY</span>') +
        '<div class="pslug">' + esc(r.slug) + ' · ' + ageLabel(r.age_days) + '</div></td>' +
        '<td>' + esc(r.category || '—') + '<div class="chains">' + esc(r.chains.slice(0, 3).join(' · ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td><span class="sig">' + r.signal_score + '</span> <span class="tier ' + r.tier + '">' + r.tier + '</span><div class="bar"><i style="width:' + r.signal_score + '%"></i></div></td>' +
        '<td class="hideS">' + r.farm_steps.length + ' steps · $' + r.farm_capital_usd + ' plan</td></tr>';
    }).join('');
    var live = R.live.map(function (r, i) {
      return '<tr><td class="rank">' + (i + 1) + '</td><td><span class="pname">' + esc(r.name) + '</span> <span class="pslug">' + esc(r.symbol || '') + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.multiple == null ? '—' : '×' + r.multiple.toFixed(2)) + '</td><td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');

    main.innerHTML =
      '<div class="hero"><div><div class="kicker">Token Launch Radar · model radar-2 · snapshot ' + esc(R.as_of) + '</div>' +
      '<h1>Which pre-token protocol is<br>worth farming <span class="accent">next?</span></h1>' +
      '<p class="lede">Every protocol DefiLlama tracks was scanned. Those that <b>record no token</b> are ranked by an <b>implied launch value</b> built from the market\u2019s own category pricing — not from a hand-picked list. Click any row for its value breakdown, risk flags and farm plan. Top of the board: <b>' + esc(top.name) + '</b> at <b>' + money(top.implied_value_usd) + '</b> implied.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="n">' + R.scanned_size + '</div><div class="l">Protocols scanned</div></div>' +
      '<div class="stat"><div class="n">' + R.board_size + '</div><div class="l">Pre-token ranked</div></div>' +
      '<div class="stat"><div class="n">' + R.watchlist_size + '/' + R.watchlist_size + '</div><div class="l">Watchlist covered</div></div>' +
      '<div class="stat"><div class="n">' + money(R.total_implied_usd) + '</div><div class="l">Total implied</div></div></div></div>' +
      (detail && params.get('detail') ? detailHtml(detail) : '') +

      '<section class="model"><h2>How the implied value is built — and why it is not a TVL table</h2>' +
      '<p><code>implied = TVL × category peer multiple × momentum × maturity × chain breadth</code></p>' +
      '<div class="grid">' +
      '<div><b>Peer multiple.</b> Live-token protocols in the same category reveal what $1 of TVL trades for (median market cap ÷ TVL, blended 65/35 with the all-market median ×' + R.global_multiple.toFixed(2) + '). Recomputed from the snapshot on every run — a future snapshot reprices itself.</div>' +
      '<div><b>Momentum.</b> The 7-day TVL change, clamped to −50%…+60%, scales value by up to ±36%: growing protocols earn a premium, shrinking ones are discounted, never erased.</div>' +
      '<div><b>Maturity.</b> Days tracked with no token recorded, capped at 3 years: a long pre-token record is scarcer — and likelier to launch — than a new listing.</div>' +
      '<div><b>Breadth.</b> Each extra chain beyond the first adds 3% (max +15%): wider deployment means a wider day-one user base to distribute to.</div></div>' +
      '<div class="cats">' + catChips + '</div>' +
      '<p>Protocols whose token already trades are never ranked here — they sit in the comparison table at the bottom at the market\u2019s own prices, and they are what calibrates the multiples above.</p></section>' +

      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name, slug, chain…" value="' + esc(state.q) + '">' +
      '<label>Category <select id="fcat">' + opts(categories, state.cat, 'All categories') + '</select></label>' +
      '<label>Chain <select id="fchain">' + opts(chainNames, state.chain, 'All chains') + '</select></label>' +
      '<label>Tier <select id="ftier">' + opts(['Prime', 'Promising', 'Speculative', 'Watch'], state.tier, 'All tiers') + '</select></label>' +
      '<label>Sort <select id="fsort">' +
      [['rank', 'Rank (implied value)'], ['tvl', 'TVL'], ['growth', '7d growth'], ['signal', 'Signal score'], ['age', 'Age tracked'], ['name', 'Name A–Z']].map(function (o) {
        return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="toggle"><input type="checkbox" id="fwatch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label></div>' +

      '<p class="count">Showing <b>' + rows.length + '</b> of ' + R.board_size + ' ranked protocols · ' + R.early_size + ' of them are early finds below the $50M watchlist floor · every watchlist protocol is on the board</p>' +
      (detail && params.get('detail') ? '' : (detail ? detailHtml(detail) : '')) +
      '<table><thead><tr><th data-k="rank">Rank</th><th data-k="name">Protocol</th><th>Category · chains</th><th class="num" data-k="tvl">TVL</th><th class="num" data-k="growth">7d</th><th class="num" data-k="rank">Implied value</th><th data-k="signal">Signal</th><th class="hideS">Farm plan</th></tr></thead><tbody>' + body + '</tbody></table>' +

      '<section class="live"><h2>Already trading — the comparison set, kept off the board</h2>' +
      '<p>These protocols\u2019 tokens exist, so the radar does not rank or value them: the market already does. Their market-cap ÷ TVL ratios, grouped by category, are exactly what prices the pre-token board above.</p>' +
      '<table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap ÷ TVL</th><th class="num">7d</th></tr></thead><tbody>' + live + '</tbody></table></section>' +

      '<footer>Source: ' + esc(R.source) + ' · Floor for the house watchlist: ' + money(R.floor_usd) + ' TVL · Implied values are this radar\u2019s own model claims (model ' + esc(R.model_version) + '), not predictions that a token will launch, and not make.fun\u2019s claims. “Records no token” describes the snapshot\u2019s record. Farm plans carry real cost and smart-contract risk — amounts shown are the plan\u2019s, sized to the protocol\u2019s TVL tier.</footer>';
    main.setAttribute('aria-busy', 'false');
    wire();
  }

  function wire() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; render(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
    document.getElementById('fcat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
    document.getElementById('fchain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
    document.getElementById('ftier').addEventListener('change', function (e) { state.tier = e.target.value; render(); });
    document.getElementById('fsort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
    document.getElementById('fwatch').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
    Array.prototype.forEach.call(main.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        state.detail = tr.getAttribute('data-slug');
        render();
        var d = document.getElementById('detail');
        if (d) d.scrollIntoView({ block: 'start' });
      });
    });
    Array.prototype.forEach.call(main.querySelectorAll('thead th[data-k]'), function (th) {
      th.addEventListener('click', function () { state.sort = th.getAttribute('data-k'); render(); });
    });
    var close = document.getElementById('closeDetail');
    if (close) close.addEventListener('click', function () { state.detail = ''; render(); });
  }

  render();
})();
