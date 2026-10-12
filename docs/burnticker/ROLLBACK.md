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
   report "web is up" (the host then keeps its previous build in `.next-old`).
3. `deploy-sites.sh` on the host again, as mct, so the old commit's static pages are certainly in place (it copies only what changed)
4. `sh scripts/ops/probe-burnticker.sh`
5. "Live now": the public commit and its subject, the host's build id beside the one built on the Mac, the probe's verdict, and the
   roll-forward command. The exit code is 0 only when the probes pass and the two build ids match.

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
