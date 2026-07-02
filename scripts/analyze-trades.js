const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2] || 'reports/smart_risk_ob_ifvg_1m_90d_trades.json', 'utf8'));
const trades = data.trades || [];

trades.sort((a, b) => new Date(a.ts) - new Date(b.ts));

function session(h) {
  if (h >= 0 && h < 8) return 'ASIA';
  if (h >= 8 && h < 13) return 'LONDON';
  if (h >= 13 && h < 17) return 'NY';
  return 'LATE_NY';
}

const stats = {
  total: trades.length,
  wins: trades.filter(t => t.outcome === 'win').length,
  losses: trades.filter(t => t.outcome === 'loss').length,
  timeouts: trades.filter(t => t.outcome === 'timeout').length,
};

console.log('Trades:', stats.total, '| Wins:', stats.wins, '| Losses:', stats.losses, '| Timeouts:', stats.timeouts);
console.log('Net R:', trades.reduce((s, t) => s + t.r, 0).toFixed(2));

// Win R distribution
const winRs = trades.filter(t => t.outcome === 'win').map(t => t.r);
console.log('\nWin R values:', winRs.map(r => r.toFixed(2)).join(', '));
console.log('Avg win R:', (winRs.reduce((a, b) => a + b, 0) / winRs.length).toFixed(2));
console.log('Min win R:', Math.min(...winRs).toFixed(2), 'Max win R:', Math.max(...winRs).toFixed(2));

// Losing streaks
let maxLossStreak = 0, currentLossStreak = 0;
let streakStart = null, maxStreakStart = null, maxStreakEnd = null;
const streaks = [];
for (const t of trades) {
  if (t.outcome === 'loss') {
    if (currentLossStreak === 0) streakStart = t.ts;
    currentLossStreak++;
  } else {
    if (currentLossStreak > 0) {
      streaks.push({ length: currentLossStreak, start: streakStart, end: t.ts });
      if (currentLossStreak > maxLossStreak) {
        maxLossStreak = currentLossStreak;
        maxStreakStart = streakStart;
        maxStreakEnd = t.ts;
      }
    }
    currentLossStreak = 0;
  }
}
if (currentLossStreak > 0) {
  streaks.push({ length: currentLossStreak, start: streakStart, end: trades[trades.length - 1].ts });
  if (currentLossStreak > maxLossStreak) {
    maxLossStreak = currentLossStreak;
    maxStreakStart = streakStart;
    maxStreakEnd = trades[trades.length - 1].ts;
  }
}

console.log('\nAll loss streaks (length >= 2):');
for (const s of streaks.filter(s => s.length >= 2).sort((a, b) => b.length - a.length)) {
  console.log(`  ${s.length} losses from ${s.start.slice(0,16)} to ${s.end.slice(0,16)}`);
}
console.log('\nMax consecutive losses:', maxLossStreak,
  maxStreakStart ? `from ${maxStreakStart.slice(0,16)} to ${maxStreakEnd.slice(0,16)}` : '');

// Outcome by session
const bySession = {};
for (const t of trades) {
  const h = new Date(t.ts).getUTCHours();
  const sess = session(h);
  bySession[sess] = bySession[sess] || { wins: 0, losses: 0, timeouts: 0, total: 0 };
  bySession[sess].total++;
  bySession[sess][t.outcome === 'win' ? 'wins' : t.outcome === 'loss' ? 'losses' : 'timeouts']++;
}
console.log('\nOutcome by session:');
for (const [sess, s] of Object.entries(bySession)) {
  console.log(`  ${sess}: total=${s.total} wins=${s.wins} losses=${s.losses} timeouts=${s.timeouts} WR=${(s.wins / (s.wins + s.losses) * 100).toFixed(1)}%`);
}

// Avg hold bars
const avgHold = (arr) => arr.length ? (arr.reduce((a, b) => a + b.holdBars, 0) / arr.length).toFixed(1) : 0;
console.log('\nAvg hold bars — wins:', avgHold(trades.filter(t => t.outcome === 'win')),
  'losses:', avgHold(trades.filter(t => t.outcome === 'loss')),
  'timeouts:', avgHold(trades.filter(t => t.outcome === 'timeout')));

// Consecutive win/loss counts
console.log('\nOutcome sequence (first 50):');
console.log(trades.slice(0, 50).map(t => t.outcome === 'win' ? 'W' : t.outcome === 'loss' ? 'L' : 'T').join(''));

// Biggest R loss (should be -1)
const losses = trades.filter(t => t.outcome === 'loss');
console.log('\nLoss R values:', losses.map(t => t.r.toFixed(2)).join(', '));

// List worst losing streak trades in detail
if (maxLossStreak > 0) {
  const idx = trades.findIndex(t => t.ts === maxStreakStart);
  console.log('\nTrades during max loss streak:');
  for (let i = idx; i < idx + maxLossStreak && i < trades.length; i++) {
    const t = trades[i];
    console.log(`  ${t.ts.slice(0,16)} ${t.side} entry=${t.entry} SL=${t.stopLoss} TP=${t.takeProfit} bars=${t.holdBars}`);
  }
}
