# Rolling the Burnticker host back to a previous public commit

The host runs the public tree (deploy.md, "The host runs the public tree"). Every ship is one public commit, built on the Mac and
mirrored to the host. A rollback ships an older public commit the same way: check it out in the public checkout, run the two deploy
scripts, probe, and read what is live. `scripts/ops/rollback-burnticker.sh` does exactly that and nothing else.

## What a rollback changes and what it does not

- It changes the web app, the static pages (landing, whitepaper, status and fallback pages, the $DEFICIT site) and the code the host's
  units run from, to what they were at the named commit.
- It does not restart the keepers. They run from source, so they pick the old code up only on their next deliberate restart (runbook,
  "Start, stop, pause": between cycles, never mid-crank). Restart them only if the problem was in keeper code.
- It never touches the chain. Programs, readings, receipts and burn pools stay exactly where they are. It does not touch the host's
  `data/`, `logs/`, environment file or `node_modules/` either (the mirror never deletes or overwrites them).
- A database migration that the newer code already ran is not undone. Read the commits between the two before rolling back across one.

## The command

From the monorepo on the Mac (the worktree you ship from):

```sh
sh scripts/ops/rollback-burnticker.sh <public commit> --dry-run    # preflight and the exact commands; nothing is checked out or sent
sh scripts/ops/rollback-burnticker.sh <public commit>              # type the short commit to confirm; then it ships
```

`--public-dir DIR` names the public checkout (default `../burnticker-public`). `BURNTICKER_HOST` and `BURNTICKER_SSH` pass through to
`deploy-burnticker-host.sh` as usual.

It refuses, before anything changes, when the public checkout is not a git checkout, has uncommitted changes (other than the
`tsconfig.json` rewrite that every `next build` makes, which it puts back), does not have the commit, or when the commit is not an
ancestor of the checkout's current HEAD (so only a commit that was actually published can be shipped this way). It also refuses a
commit without `scripts/ops/deploy-sites.sh` or `package-lock.json`.

Then, in order:

1. `git -C ../burnticker-public checkout --detach <commit>` (it prints where the checkout was, for the way back)
2. `BURNTICKER_SRC=../burnticker-public sh scripts/ops/deploy-burnticker-host.sh --webpack`: builds on the Mac, mirrors the tree, swaps
   the build in, restarts the web unit, and runs `deploy-sites.sh` on the host as mct. The rollback stops here if the ship does not
   report "web is up" (the host then swaps its previous build back by itself; see "The web smoke and the automatic swap back" below).
3. `deploy-sites.sh` on the host again, as mct, so the old commit's static pages are certainly in place (it copies only what changed)
4. `sh scripts/ops/probe-burnticker.sh`
5. "Live now": the public commit and its subject, the host's build id beside the one built on the Mac, the probe's verdict, and the
   roll-forward command. The exit code is 0 only when the probes pass and the two build ids match.

## The web smoke and the automatic swap back (third prelaunch audit F02, 2026-10-16)

Every ship swaps the staged build in with `scripts/ops/swap-web-build.sh`, run on the host as mct. The deploy script sends that file
from the Mac checkout it runs in (to a fresh `mktemp` file under `/tmp` on the host, root-owned and mode 0755, removed afterwards) and runs that copy, never the host's tree: a rollback
ships a public commit that may predate the script, and the mirror would have removed it. `rollback-burnticker.sh` refuses to start
when this checkout lacks the script or its deploy script would not send it. After restarting the web unit the script checks, under one
deadline (150 s by default), that `GET /api/burnticker/build` answers HTTP 200 with the STAGED build id and a `startedAt` (the server
process's own start time) no earlier than the restart, so the old process or a unit that did not restart cannot pass, and that
`GET /burnticker` answers HTTP 200 with the Burnticker page. A previous build that is swapped back is checked for what it can show: one
from before `startedAt` existed, or without a BUILD_ID, passes on HTTP 200 alone. A 403, 404 or 500, another build id, a different page or no answer is a
failure (the old check passed any answer, because `curl -s` exits 0 on an HTTP error, and then deleted the previous build).

- Passed: "web is up on build <id>". The previous build stays in `.next-old` until the next deploy replaces it, so a failure found later
  (the public deploy smoke) can still be swapped back by hand on the host, as mct: `mv .next .next-failed && mv .next-old .next &&
  systemctl --user restart mct-burnticker-web`.
- Failed: the host moves the new build to `.next-failed`, puts `.next-old` back, restarts the web unit, checks that the previous build
  answers ("ROLLED BACK", or "ROLLBACK DID NOT ANSWER EITHER" when it does not), and the deploy exits 1 without asking the keepers to
  restart.
- The deploy's last line says which case it was, from what the host printed: rolled back (the previous build serves, next to the new
  source), the web not healthy, the swap refused, a failure before the swap, or "DEPLOY INCOMPLETE" when the new build passed and a later
  step (the keeper restart request, the static pages) failed. `publish-and-deploy.sh` stops on any of them, after the public commit and
  the pins were pushed, and says so.

The limit: only the Next build is swapped back. By then the deploy has already mirrored the new source to the host and, when the lock
file changed, run `npm ci` in place; neither is undone. The keepers run from that source: they were not asked to restart, so they keep
the code they loaded, but one that restarts for any other reason (a crash; systemd brings it back) loads the new source. To put everything back, ship the previous public commit with
`rollback-burnticker.sh` as above.

## Rolling forward again

The script prints it. With the defaults:

```sh
git -C ../burnticker-public checkout -- tsconfig.json; git -C ../burnticker-public checkout main
BURNTICKER_SRC=../burnticker-public sh scripts/ops/deploy-burnticker-host.sh --webpack
sh scripts/ops/probe-burnticker.sh
```

Do not run `publish-public-repo.sh` while the public checkout is detached at an old commit: it would write the current tree over it, and
a commit made there would not be on `main`. Check `main` out first.

## The drill (owner, once, before launch week ends)

Run it once on a quiet hour, with nothing queued to burn, and write the result in `docs/burnticker/incidents/LOG.md` as a drill.

At the time of writing the public checkout is at `4f01c46` on `main`, and the public commit before it is `8a51959`. Check that this is
still true with `git -C ../burnticker-public log --oneline -3`, and use the commit just below the top one if it has moved.

```sh
sh scripts/ops/rollback-burnticker.sh 8a51959 --dry-run     # read the plan
sh scripts/ops/rollback-burnticker.sh 8a51959               # type 8a51959; read "Live now"
# then roll forward with the three commands above and read the probe again
```

What to record: how long the rollback took from the confirmation to "Live now", whether the probes passed both ways, the two build ids,
and anything the script refused.

## Rolling the burn_receipts PROGRAM back (round 5 to round 4)

The host rollback above never touches the chain. A program rollback is a different act: an upgrade of `burn_receipts` through the Squads
vault to an older binary. Round 5 adds coins that burn another token (docs/burnticker/EXTERNAL-BURN.md); round 4 does not know them.

- **The hazard.** Round 4 reads `TokenConfig.burn_target_kind` as a reserved byte. If a coin that burns another token has `pool_verified`
  set, round 4's `crank_buyback` spends its fuel on the coin itself, against what the coin promised.
- **The fence (round-5 blind review R5-12).** Round 5 never sets `pool_verified` for a coin that burns another token: registering its own
  pool records `burn_target_kind = 2` instead. Round 4 then refuses `crank_buyback` on it (`PoolNotVerified`). The fence does not cover a
  coin on the FIXED pool policy: round 4's `register_pool` would verify that pool again.
- **The rule.** Do not roll the program back to round 4 while any BurnTarget-pinned coin holds fuel in its fee PDA. Check every
  `["burn_target", mint]` account first; if one exists and its coin's fee PDA holds more than its reserve, settle it (its readings
  cranked, `release_target` where its target is stalled) or do not roll back.
- Round 5 also retires `initialize_token`; a rollback brings it back for every caller.
