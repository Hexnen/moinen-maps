#!/bin/sh
# sh dev/stage-js/rec.sh <label> [port] : setup on the GM, home views + watchers on both players, record both players while the scenario runs,
# (NOREC=1: no video) then the metrics of both (dev/director-stage-<label>-p1.webm / -p2.webm, dev/stage-js/out/<label>-p*.json)
L=$1; P=${2:-9377}; GM=http://127.0.0.81:30004/game; P1=http://127.0.0.82:30004/game; P2=http://127.0.0.83:30004/game
cd "$(dirname "$0")/../.." && mkdir -p dev/stage-js/out
node dev/tools/cdp-rec.mjs eval $P $GM @dev/stage-js/setup.js
node dev/tools/cdp-rec.mjs eval $P $P1 @dev/stage-js/home.js; node dev/tools/cdp-rec.mjs eval $P $P2 @dev/stage-js/home.js
[ -n "$NOREC" ] || node dev/tools/cdp-rec.mjs rec $P $P1 dev/director-stage-$L-p1.webm 50000 > dev/stage-js/out/$L-rec1.log 2>&1 &
[ -n "$NOREC" ] || node dev/tools/cdp-rec.mjs rec $P $P2 dev/director-stage-$L-p2.webm 50000 > dev/stage-js/out/$L-rec2.log 2>&1 &
sleep 1; node dev/stage-js/scenario.mjs $P $GM $P1 > dev/stage-js/out/$L-steps.json
node dev/tools/cdp-rec.mjs eval $P $P1 @dev/stage-js/dump.js > dev/stage-js/out/$L-p1.json
node dev/tools/cdp-rec.mjs eval $P $P2 @dev/stage-js/dump.js > dev/stage-js/out/$L-p2.json
wait
cat dev/stage-js/out/$L-steps.json; for f in p1 p2; do node -e 'const o=require(process.argv[1]);const {log,moveList,...r}=o;console.log(JSON.stringify(r));for(const m of moveList)console.log(" mv",JSON.stringify(m));for(const l of log)console.log(" ",JSON.stringify(l))' "$PWD/dev/stage-js/out/$L-$f.json"; done
