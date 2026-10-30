source /private/tmp/claude-501/<home>/22ac3f49-48c5-42a4-b835-a5ad37cfc3a2/scratchpad/r4x/env.zsh
cd $S/k
BURNTICKER_DB=$S/k/data2/burnticker.db BURNTICKER_PUBLISH_DIR=$S/k/site BURNTICKER_CLUSTER=devnet BURNTICKER_KEEPER_PUBKEY=$KEEPER \
BURNTICKER_PROGRAM_ID=$PROG BURNTICKER_RPC_URL=https://api.devnet.solana.com BURNTICKER_SIGNER_PATH=$D/keeper.json \
BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r4 BURNTICKER_END_SINKS_LIVE=1 BURNTICKER_PAIR_CURVE_ENABLED=1 \
OWN_TOKENS_GENERATED_PATH=$S/k/data2/own-tokens.generated.json R4X_PAIRS=792sAKMeHvZCxZpZeutjCWUt4cJkybLmRbgbbh8XgYD2,7Ebs5oCpyCJo1su7ZdZB1Gd2Vo5jfJ8Rj1622tSY2ET6 \
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import $REPO/test/alias-hook.mjs --import $S/k/pairfilter-hook.mjs $REPO/scripts/burnticker-keeper.mts --once "$@"
