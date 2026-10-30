import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import { opsAllowed } from "@/lib/burnticker/api/product";
import { loadOperator, walletOf } from "@/lib/burnticker/trustpack/operator";
import { isStatementDate, statementTemplate, statementText, todayUtc, type StatementTextView } from "@/lib/burnticker/trustpack/statement";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * GET /ops/statement-text?date=YYYY-MM-DD: the operator statement's exact text for that day (default today in UTC) and its signer, for
 * the signing page (/burnticker/operator/sign-statement). Operator only: the claim page's gate (the operator's own network AND the ops
 * PIN in x-action-pin). Reads config/burnticker/operator.json; signs nothing, writes nothing, reads no key and no chain.
 */
export function v1OpsStatementText(req: Request, env: Env = process.env, root = process.cwd(), now = Date.now()): ApiResult {
  const denied = opsAllowed(req, env);
  if (denied) return denied;
  const date = new URL(req.url).searchParams.get("date") ?? todayUtc(now);
  if (!isStatementDate(date)) return fail(400, "The date must be a real day written as YYYY-MM-DD.", { code: "bad-date" });
  const cfg = loadOperator(root), sm = cfg.signedMessage;
  const signer = walletOf(cfg, sm.cluster, sm.signerRole);
  if (!signer) return fail(503, `operator.json has no ${sm.cluster} wallet for the role ${sm.signerRole}, so there is no signer to name.`);
  const tpl = statementTemplate(sm);
  if ("problem" in tpl) return fail(503, tpl.problem);
  const view: StatementTextView = { cluster: sm.cluster, signerRole: sm.signerRole, signer, date, text: statementText(tpl.template, signer, date), signedOn: tpl.signedOn };
  return ok(view);
}
