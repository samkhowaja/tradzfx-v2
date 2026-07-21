import json, sys

d = json.load(open(sys.argv[1]))
trades = d.get("trades", [])
print(f"Total trades: {len(trades)}")

PIP = 0.0001

for tr in trades:
    e = float(tr["entry"])
    sl = float(tr["stopLoss"])
    tp = float(tr["takeProfit"])
    ee = float(tr.get("effectiveEntry", e))
    side = tr["side"]
    outcome = tr["outcome"]
    r = float(tr["r"])
    
    if side == "buy":
        planned_risk = e - sl
        actual_risk = ee - sl
        gap = ee - e
    else:
        planned_risk = sl - e
        actual_risk = sl - ee
        gap = e - ee
    
    gap_pips = gap / PIP
    
    print(f"{outcome:6s} {side:4s} e={e:.5f} ee={ee:.5f} sl={sl:.5f} tp={tp:.5f}")
    print(f"  plannedR={planned_risk:.6f} actualR={actual_risk:.6f} gap={gap_pips:+.2f}p r={r:+.3f}")
    
    # Check if r is consistent with gap
    if outcome == "loss":
        expected_r = -(actual_risk / planned_risk)
    elif outcome == "win":
        expected_r = (tp - ee) / planned_risk
    else:
        expected_r = 0
    print(f"  expected_r={expected_r:.3f} (based on gap+spread)")

print()
wins = [t for t in trades if t["outcome"] == "win"]
losses = [t for t in trades if t["outcome"] == "loss"]
print(f"Wins: {len(wins)}, avg r={sum(float(t['r']) for t in wins)/len(wins):.3f}" if wins else "Wins: 0")
print(f"Losses: {len(losses)}, avg r={sum(float(t['r']) for t in losses)/len(losses):.3f}" if losses else "Losses: 0")

for label, grp in [("wins", wins), ("losses", losses)]:
    if not grp: continue
    gaps = []
    for tr in grp:
        side = tr["side"]
        gap = float(tr.get("effectiveEntry", tr["entry"])) - float(tr["entry"])
        if side == "sell": gap = -gap
        gaps.append(gap / PIP)
    print(f"{label}: avg_gap={sum(gaps)/len(gaps):+.2f}p min={min(gaps):+.2f}p max={max(gaps):+.2f}p")
