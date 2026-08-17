# v4 Adjudication - USD-complex-event cluster review table

23 clusters, highest-confidence KEEP tranche. Verify each minute against external charts (macro event co-move: multiple USD pairs jump same minute, DXY confirms opposite direction). Flip clusterReviewed:true per passing cluster.

| # | UTC minute | Day | Session | Rows | Symbols (n) | DXY-confirm | Max jumpATR | XAUUSD? |
|---|------------|-----|---------|------|-------------|-------------|-----------|---------|
| 1 | 2026-06-17 21:00 | Wed | offhours | 12 | AUDUSD,EURUSD,GBPUSD,NZDUSD,USDCHF,USDSEK (6) | 12 | 22.4 |  |
| 2 | 2026-06-11 21:00 | Thu | offhours | 8 | AUDUSD,NZDUSD,USDCHF,USDSEK (4) | 8 | 22.3 |  |
| 3 | 2026-06-17 21:05 | Wed | offhours | 8 | AUDUSD,EURUSD,GBPUSD,USDCHF (4) | 8 | 13.1 |  |
| 4 | 2026-06-17 21:12 | Wed | offhours | 7 | AUDUSD,EURUSD,GBPUSD,NZDUSD,USDSEK (5) | 3 | 6.2 |  |
| 5 | 2026-04-30 21:00 | Thu | offhours | 6 | EURUSD,GBPUSD,USDJPY (3) | 6 | 26.5 |  |
| 6 | 2026-04-30 21:04 | Thu | offhours | 6 | EURUSD,GBPUSD,USDJPY (3) | 4 | 12.4 |  |
| 7 | 2026-06-17 21:09 | Wed | offhours | 6 | EURUSD,GBPUSD,USDSEK (3) | 6 | 9.2 |  |
| 8 | 2026-06-11 21:08 | Thu | offhours | 6 | NZDUSD,USDCHF,USDSEK (3) | 4 | 8.5 |  |
| 9 | 2026-06-17 21:11 | Wed | offhours | 5 | AUDUSD,GBPUSD,NZDUSD (3) | 5 | 7.8 |  |
| 10 | 2026-04-27 01:56 | Mon | asia | 4 | AUDUSD,NZDUSD (2) | 2 | 15.2 |  |
| 11 | 2026-06-11 21:03 | Thu | offhours | 4 | AUDUSD,USDCHF (2) | 4 | 12.1 |  |
| 12 | 2026-06-17 21:06 | Wed | offhours | 4 | AUDUSD,NZDUSD (2) | 2 | 10 |  |
| 13 | 2026-06-17 21:10 | Wed | offhours | 4 | EURUSD,GBPUSD,USDSEK (3) | 4 | 7.1 |  |
| 14 | 2026-06-17 21:13 | Wed | offhours | 4 | EURUSD,NZDUSD,USDSEK (3) | 2 | 5.2 |  |
| 15 | 2026-06-18 21:00 | Thu | offhours | 4 | EURUSD,GBPUSD (2) | 4 | 24.2 |  |
| 16 | 2026-06-18 21:03 | Thu | offhours | 4 | EURUSD,GBPUSD (2) | 4 | 13.8 |  |
| 17 | 2026-06-11 21:07 | Thu | offhours | 4 | NZDUSD,USDSEK (2) | 4 | 9.2 |  |
| 18 | 2026-06-06 01:50 | Sat | asia | 4 | USDCHF,USDSEK (2) | 4 | 22.8 |  |
| 19 | 2026-06-11 21:12 | Thu | offhours | 3 | AUDUSD,USDSEK (2) | 3 | 6.4 |  |
| 20 | 2026-06-17 21:17 | Wed | offhours | 3 | EURUSD,GBPUSD,USDSEK (3) | 2 | 4.1 |  |
| 21 | 2026-06-17 21:19 | Wed | offhours | 3 | EURUSD,NZDUSD,USDSEK (3) | 3 | 3.7 |  |
| 22 | 2026-06-11 21:13 | Thu | offhours | 3 | NZDUSD,USDCHF (2) | 2 | 6 |  |
| 23 | 2026-06-11 21:15 | Thu | offhours | 3 | NZDUSD,USDCHF (2) | 3 | 5.1 |  |

## Per-cluster row detail (quarantineId / symbol / jumpATR / dxySign)

### 1. 2026-06-17 21:00 UTC (12 rows)

- `1075` AUDUSD jumpATR=21.01522842639494 dxy=confirm coMove=10 sess=offhours
- `642` AUDUSD jumpATR=21.01522842639494 dxy=confirm coMove=10 sess=offhours
- `1099` EURUSD jumpATR=22.435129740518647 dxy=confirm coMove=10 sess=offhours
- `676` EURUSD jumpATR=22.435129740518647 dxy=confirm coMove=10 sess=offhours
- `1135` GBPUSD jumpATR=22.295597484276524 dxy=confirm coMove=10 sess=offhours
- `729` GBPUSD jumpATR=22.295597484276524 dxy=confirm coMove=10 sess=offhours
- `1167` NZDUSD jumpATR=17.970479704797754 dxy=confirm coMove=10 sess=offhours
- `768` NZDUSD jumpATR=17.970479704797754 dxy=confirm coMove=10 sess=offhours
- `1189` USDCHF jumpATR=20.092307692307728 dxy=confirm coMove=10 sess=offhours
- `800` USDCHF jumpATR=20.092307692307728 dxy=confirm coMove=10 sess=offhours
- `1242` USDSEK jumpATR=18.966165413534423 dxy=confirm coMove=10 sess=offhours
- `888` USDSEK jumpATR=18.966165413534423 dxy=confirm coMove=10 sess=offhours

### 2. 2026-06-11 21:00 UTC (8 rows)

- `1071` AUDUSD jumpATR=18.628158844765448 dxy=confirm coMove=6 sess=offhours
- `638` AUDUSD jumpATR=18.628158844765448 dxy=confirm coMove=6 sess=offhours
- `1161` NZDUSD jumpATR=21.218592964824 dxy=confirm coMove=6 sess=offhours
- `760` NZDUSD jumpATR=21.218592964824 dxy=confirm coMove=6 sess=offhours
- `788` USDCHF jumpATR=21.029572836800668 dxy=confirm coMove=6 sess=offhours
- `1184` USDCHF jumpATR=21.029572836800668 dxy=confirm coMove=6 sess=offhours
- `1237` USDSEK jumpATR=22.28518057285263 dxy=confirm coMove=6 sess=offhours
- `882` USDSEK jumpATR=22.28518057285263 dxy=confirm coMove=6 sess=offhours

### 3. 2026-06-17 21:05 UTC (8 rows)

- `643` AUDUSD jumpATR=12.407547169811115 dxy=confirm coMove=6 sess=offhours
- `1076` AUDUSD jumpATR=12.407547169811115 dxy=confirm coMove=6 sess=offhours
- `1100` EURUSD jumpATR=13.110419906687357 dxy=confirm coMove=6 sess=offhours
- `677` EURUSD jumpATR=13.110419906687357 dxy=confirm coMove=6 sess=offhours
- `1138` GBPUSD jumpATR=6.791452442159368 dxy=confirm coMove=6 sess=offhours
- `732` GBPUSD jumpATR=6.791452442159368 dxy=confirm coMove=6 sess=offhours
- `1192` USDCHF jumpATR=6.690570096808903 dxy=confirm coMove=6 sess=offhours
- `803` USDCHF jumpATR=6.690570096808903 dxy=confirm coMove=6 sess=offhours

### 4. 2026-06-17 21:12 UTC (7 rows)

- `647` AUDUSD jumpATR=4.901574803149649 dxy=contradict coMove=6 sess=offhours
- `680` EURUSD jumpATR=5.707941929974313 dxy=confirm coMove=5 sess=offhours
- `1103` EURUSD jumpATR=5.707941929974313 dxy=confirm coMove=5 sess=offhours
- `736` GBPUSD jumpATR=3.5612608032536985 dxy=contradict coMove=6 sess=offhours
- `1170` NZDUSD jumpATR=6.244153414406027 dxy=contradict coMove=5 sess=offhours
- `771` NZDUSD jumpATR=6.244153414406027 dxy=contradict coMove=5 sess=offhours
- `894` USDSEK jumpATR=4.066136815214298 dxy=confirm coMove=6 sess=offhours

### 5. 2026-04-30 21:00 UTC (6 rows)

- `1092` EURUSD jumpATR=20.604751619869067 dxy=confirm coMove=4 sess=offhours
- `661` EURUSD jumpATR=20.604751619869067 dxy=confirm coMove=4 sess=offhours
- `1115` GBPUSD jumpATR=22.973451327434788 dxy=confirm coMove=4 sess=offhours
- `708` GBPUSD jumpATR=22.973451327434788 dxy=confirm coMove=4 sess=offhours
- `1200` USDJPY jumpATR=26.508530030381174 dxy=confirm coMove=4 sess=offhours
- `811` USDJPY jumpATR=26.508530030381174 dxy=confirm coMove=4 sess=offhours

### 6. 2026-04-30 21:04 UTC (6 rows)

- `1093` EURUSD jumpATR=11.514958625078958 dxy=confirm coMove=4 sess=offhours
- `662` EURUSD jumpATR=11.514958625078958 dxy=confirm coMove=4 sess=offhours
- `1116` GBPUSD jumpATR=12.395868043985582 dxy=confirm coMove=4 sess=offhours
- `709` GBPUSD jumpATR=12.395868043985582 dxy=confirm coMove=4 sess=offhours
- `1202` USDJPY jumpATR=9.631274616609426 dxy=contradict coMove=4 sess=offhours
- `813` USDJPY jumpATR=9.631274616609426 dxy=contradict coMove=4 sess=offhours

### 7. 2026-06-17 21:09 UTC (6 rows)

- `1101` EURUSD jumpATR=9.23140269009049 dxy=confirm coMove=4 sess=offhours
- `678` EURUSD jumpATR=9.23140269009049 dxy=confirm coMove=4 sess=offhours
- `1139` GBPUSD jumpATR=5.604482531311791 dxy=confirm coMove=4 sess=offhours
- `733` GBPUSD jumpATR=5.604482531311791 dxy=confirm coMove=4 sess=offhours
- `1246` USDSEK jumpATR=5.449816990945934 dxy=confirm coMove=4 sess=offhours
- `892` USDSEK jumpATR=5.449816990945934 dxy=confirm coMove=4 sess=offhours

### 8. 2026-06-11 21:08 UTC (6 rows)

- `1164` NZDUSD jumpATR=6.67535853976528 dxy=confirm coMove=4 sess=offhours
- `763` NZDUSD jumpATR=6.67535853976528 dxy=confirm coMove=4 sess=offhours
- `790` USDCHF jumpATR=8.544726301735473 dxy=contradict coMove=4 sess=offhours
- `1186` USDCHF jumpATR=8.544726301735473 dxy=contradict coMove=4 sess=offhours
- `1240` USDSEK jumpATR=7.028508771929924 dxy=confirm coMove=4 sess=offhours
- `885` USDSEK jumpATR=7.028508771929924 dxy=confirm coMove=4 sess=offhours

### 9. 2026-06-17 21:11 UTC (5 rows)

- `1079` AUDUSD jumpATR=5.861260053619265 dxy=confirm coMove=3 sess=offhours
- `646` AUDUSD jumpATR=5.861260053619265 dxy=confirm coMove=3 sess=offhours
- `735` GBPUSD jumpATR=4.04899135446689 dxy=confirm coMove=4 sess=offhours
- `1169` NZDUSD jumpATR=7.847507331378278 dxy=confirm coMove=3 sess=offhours
- `770` NZDUSD jumpATR=7.847507331378278 dxy=confirm coMove=3 sess=offhours

### 10. 2026-04-27 01:56 UTC (4 rows)

- `634` AUDUSD jumpATR=15.153846153846308 dxy=contradict coMove=2 sess=asia
- `1067` AUDUSD jumpATR=15.153846153846308 dxy=contradict coMove=2 sess=asia
- `1158` NZDUSD jumpATR=10.452209660842511 dxy=confirm coMove=2 sess=asia
- `757` NZDUSD jumpATR=10.452209660842511 dxy=confirm coMove=2 sess=asia

### 11. 2026-06-11 21:03 UTC (4 rows)

- `639` AUDUSD jumpATR=11.076573161485944 dxy=confirm coMove=2 sess=offhours
- `1072` AUDUSD jumpATR=11.076573161485944 dxy=confirm coMove=2 sess=offhours
- `789` USDCHF jumpATR=12.074852265265536 dxy=confirm coMove=2 sess=offhours
- `1185` USDCHF jumpATR=12.074852265265536 dxy=confirm coMove=2 sess=offhours

### 12. 2026-06-17 21:06 UTC (4 rows)

- `1077` AUDUSD jumpATR=8.751345532830847 dxy=confirm coMove=4 sess=offhours
- `644` AUDUSD jumpATR=8.751345532830847 dxy=confirm coMove=4 sess=offhours
- `1168` NZDUSD jumpATR=10.04773269689751 dxy=contradict coMove=4 sess=offhours
- `769` NZDUSD jumpATR=10.04773269689751 dxy=contradict coMove=4 sess=offhours

### 13. 2026-06-17 21:10 UTC (4 rows)

- `1102` EURUSD jumpATR=7.05771248688346 dxy=confirm coMove=2 sess=offhours
- `679` EURUSD jumpATR=7.05771248688346 dxy=confirm coMove=2 sess=offhours
- `734` GBPUSD jumpATR=4.659645232815987 dxy=confirm coMove=3 sess=offhours
- `893` USDSEK jumpATR=4.604833442194736 dxy=confirm coMove=3 sess=offhours

### 14. 2026-06-17 21:13 UTC (4 rows)

- `681` EURUSD jumpATR=4.798619102416578 dxy=confirm coMove=3 sess=offhours
- `1171` NZDUSD jumpATR=5.164792555253912 dxy=contradict coMove=2 sess=offhours
- `772` NZDUSD jumpATR=5.164792555253912 dxy=contradict coMove=2 sess=offhours
- `895` USDSEK jumpATR=3.598347314385905 dxy=confirm coMove=3 sess=offhours

### 15. 2026-06-18 21:00 UTC (4 rows)

- `1104` EURUSD jumpATR=23.355704697984535 dxy=confirm coMove=2 sess=offhours
- `690` EURUSD jumpATR=23.355704697984535 dxy=confirm coMove=2 sess=offhours
- `1140` GBPUSD jumpATR=24.15079969535351 dxy=confirm coMove=2 sess=offhours
- `739` GBPUSD jumpATR=24.15079969535351 dxy=confirm coMove=2 sess=offhours

### 16. 2026-06-18 21:03 UTC (4 rows)

- `1105` EURUSD jumpATR=13.125000000000032 dxy=confirm coMove=2 sess=offhours
- `691` EURUSD jumpATR=13.125000000000032 dxy=confirm coMove=2 sess=offhours
- `1141` GBPUSD jumpATR=13.843298969072274 dxy=confirm coMove=2 sess=offhours
- `740` GBPUSD jumpATR=13.843298969072274 dxy=confirm coMove=2 sess=offhours

### 17. 2026-06-11 21:07 UTC (4 rows)

- `1163` NZDUSD jumpATR=8.34448160535117 dxy=confirm coMove=2 sess=offhours
- `762` NZDUSD jumpATR=8.34448160535117 dxy=confirm coMove=2 sess=offhours
- `884` USDSEK jumpATR=9.195621132793999 dxy=confirm coMove=2 sess=offhours
- `1239` USDSEK jumpATR=9.195621132793999 dxy=confirm coMove=2 sess=offhours

### 18. 2026-06-06 01:50 UTC (4 rows)

- `1183` USDCHF jumpATR=22.823218997361995 dxy=confirm coMove=2 sess=asia
- `787` USDCHF jumpATR=22.823218997361995 dxy=confirm coMove=2 sess=asia
- `1236` USDSEK jumpATR=19.602169981917307 dxy=confirm coMove=2 sess=asia
- `881` USDSEK jumpATR=19.602169981917307 dxy=confirm coMove=2 sess=asia

### 19. 2026-06-11 21:12 UTC (3 rows)

- `1074` AUDUSD jumpATR=6.415891800507233 dxy=confirm coMove=1 sess=offhours
- `641` AUDUSD jumpATR=6.415891800507233 dxy=confirm coMove=1 sess=offhours
- `887` USDSEK jumpATR=4.741550695825056 dxy=confirm coMove=2 sess=offhours

### 20. 2026-06-17 21:17 UTC (3 rows)

- `682` EURUSD jumpATR=4.135740971357375 dxy=confirm coMove=2 sess=offhours
- `738` GBPUSD jumpATR=2.856358896968053 dxy=contradict coMove=2 sess=offhours
- `896` USDSEK jumpATR=3.33592534992222 dxy=confirm coMove=2 sess=offhours

### 21. 2026-06-17 21:19 UTC (3 rows)

- `683` EURUSD jumpATR=3.6446444249341297 dxy=confirm coMove=2 sess=offhours
- `775` NZDUSD jumpATR=3.6622199848980945 dxy=confirm coMove=2 sess=offhours
- `897` USDSEK jumpATR=2.9909819639278767 dxy=confirm coMove=2 sess=offhours

### 22. 2026-06-11 21:13 UTC (3 rows)

- `1165` NZDUSD jumpATR=5.973131243541126 dxy=confirm coMove=1 sess=offhours
- `764` NZDUSD jumpATR=5.973131243541126 dxy=confirm coMove=1 sess=offhours
- `793` USDCHF jumpATR=4.494571773220761 dxy=contradict coMove=2 sess=offhours

### 23. 2026-06-11 21:15 UTC (3 rows)

- `1166` NZDUSD jumpATR=5.067393174648611 dxy=confirm coMove=1 sess=offhours
- `765` NZDUSD jumpATR=5.067393174648611 dxy=confirm coMove=1 sess=offhours
- `795` USDCHF jumpATR=3.4837278106508456 dxy=confirm coMove=2 sess=offhours
