// Baselines for "this feature changed nothing when it is off" tests, built from git without freezing a copy of the code (a frozen
// copy goes stale with every later, intentional change to the same file).
//   revTree(root, rev, dir, tmp)    the files of `dir` at `rev`, written to a temp folder
//   withoutCommits(root, file, revs) the working-tree text of `file` with the changes of `revs` taken out again (reverse patch,
//                                    newest first, with shrinking context when later edits moved the surroundings)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const git = (root, ...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 << 20 }).toString("utf8");

/** Every file of `dir` (repo-relative) as it was at `rev`, written under `out`. Returns `out`. */
export function revTree(root, rev, dir, out) {
  fs.mkdirSync(out, { recursive: true });
  for ( const f of git(root, "ls-tree", "--name-only", `${rev}:${dir}`).split("\n").filter(Boolean) ) {
    fs.writeFileSync(path.join(out, f), execFileSync("git", ["show", `${rev}:${dir}/${f}`], { cwd: root, maxBuffer: 64 << 20 }));
  }
  return out;
}

/** Parse a unified diff of ONE file into hunks of [tag, line]. */
function hunks(diff) {
  const out = [];
  let cur = null;
  for ( const line of diff.split("\n") ) {
    if ( line.startsWith("@@") ) { cur = []; out.push(cur); continue; }
    if ( !cur || line.startsWith("\\") ) continue;
    const t = line[0];
    if ( t === " " || t === "+" || t === "-" ) cur.push([t, line.slice(1)]);
    else if ( line === "" ) cur.push([" ", ""]);
  }
  // a trailing empty line of the diff text is not context
  for ( const h of out ) while ( h.length && h[h.length - 1][0] === " " && h[h.length - 1][1] === "" ) h.pop();
  return out;
}

/** Find `needle` (array of lines) in `hay` from `from`; -1 if absent or not unique after `from`. */
function find(hay, needle, from) {
  let hit = -1;
  outer: for ( let i = from; i + needle.length <= hay.length; i++ ) {
    for ( let k = 0; k < needle.length; k++ ) if ( hay[i + k] !== needle[k] ) continue outer;
    if ( hit >= 0 ) return -2;
    hit = i;
  }
  return hit;
}

/** Take the change of one diff back out of `text` (the + lines become the - lines again). Throws when a hunk cannot be placed. */
export function reverseApply(text, diff, label = "patch") {
  const crlf = text.includes("\r\n");
  let lines = text.split(/\r?\n/);
  let from = 0;
  for ( const h of hunks(diff) ) {
    let lo = 0, hi = h.length;
    let placed = false;
    while ( true ) {
      const part = h.slice(lo, hi);
      const now = part.filter(([t]) => t !== "-").map(([, l]) => l), then = part.filter(([t]) => t !== "+").map(([, l]) => l);
      const at = find(lines, now, from);
      if ( at === -2 ) break;                          // not unique: less context would only be less sure, give up
      if ( at >= 0 && now.length ) { lines.splice(at, now.length, ...then); from = at + then.length; placed = true; break; }
      // drop one line of context at each end, if there is any left
      const canLo = h[lo]?.[0] === " ", canHi = h[hi - 1]?.[0] === " ";
      if ( !canLo && !canHi ) break;
      if ( canLo ) lo++;
      if ( canHi ) hi--;
    }
    if ( !placed ) throw new Error(`${label}: a hunk no longer matches (the lines it added were edited since); add the editing commit to the list or update the baseline rule`);
  }
  return lines.join(crlf ? "\r\n" : "\n");
}

/** The working-tree `file` (repo-relative) without the changes that `revs` made to it. */
export function withoutCommits(root, file, revs) {
  let text = fs.readFileSync(path.join(root, file), "utf8");
  for ( const rev of [...revs].reverse() ) {
    const diff = git(root, "diff", `${rev}^`, rev, "--", file);
    if ( diff.trim() ) text = reverseApply(text, diff, `${rev} ${file}`);
  }
  return text;
}
