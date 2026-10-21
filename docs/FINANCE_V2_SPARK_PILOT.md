# Finance V2 Phases 0–3: independent no-payment pilot

Decision: 21 October 2026. Keep Firebase Spark, the existing Firestore database and Firebase Authentication. Retain the Phase 1 trusted Admin transfer engine and Phase 2 server-calculated EOD. Package the shared API for an independently hosted **Render Free web service**, for development/pilot acceptance only. No cloud resource, external account, secret, billing change, deployment or activation has been created by this work.

This selects the independently hosted fallback in the owner's Phase 2 instructions. It supersedes both the Cloud Run release route and the proposed mandatory browser-posting conversion in FINANCE_V2_SPARK_CONSTRAINT.md. It does not introduce a second financial backend or calculator.

## Audit and decision

| Scope | Billing dependency found | Selected treatment |
| --- | --- | --- |
| Phase 0 contracts and pure policies | None from executing locally or tests | Retain |
| Phase 1 account registration, transfer calculation, integrity and trusted executor | Hosting the Admin API on Cloud Functions/Cloud Run requires a billing-enabled route | Keep the executor; independently host the existing container |
| Phase 2 shift EOD | Runtime API; server queries canonical POS sales and excludes superseded receipts | Keep server calculation and deterministic EOD identity in the shared API |
| Phase 3 accounts, histories, transfers and POS cash funding | Same API; optional always-running polling worker | Same independent API; polling prohibited in the free profile; funding refreshed on authorised account requests/transfers |
| Browser V2 writer | Current rules explicitly deny direct account/ledger posting | Leave closed; a client certification switch is not authority |
| Firebase Hosting | Static frontend; cannot execute Node API | Retain; one HTTPS API origin serves EOD and treasury |
| Cloud Run, Cloud Functions, Artifact Registry and Cloud Build | Not needed by the selected pilot | Do not enable or deploy; no billing attachment |

Firestore transactions with `getAfter` can validate bounded linked writes, so rules-only transfers are not declared impossible. They are **not currently certified**. More importantly, the present EOD and cash-funding handlers query variable receipt sets, follow supersession chains and use controlled funding cursors. Rules cannot independently repeat those queries against a frontend-supplied total. Converting all of that would require new authoritative POS aggregate contracts and systemwide checkout/revision changes. Preserve the already-tested server controls rather than claim that changing a transport certifies those aggregates. Authenticated emulator acceptance confirms the existing rules deny complete browser transfer attempts and orphan/forged ledger writes.

Running Firebase Admin outside Google Cloud does not itself deploy a Firebase Function, create a Cloud Run service or attach billing. It still consumes the existing database/Auth quotas and needs a protected service identity. Before acceptance, verify the existing project's actual Spark/AI Studio database quota status in the console; the earlier CI identity could read the named database but could not inspect billing (403). No database migration, replacement, additional database, paid scaling or billing change is authorised. Do not infer that every named database is billable solely from its name: current Firebase pricing says the first database qualifies for free quota regardless of ID, and AI Studio databases can have shared-quota controls.

## Free-host limitations and no-payment boundary

Verified against Render's official documentation on 21 October 2026:

- Free web services support managed HTTPS and Docker. Their tutorial specifies no payment is required.
- They sleep after 15 minutes of inactivity; waking can take about one minute.
- Each workspace has a shared 750 free instance hours per month. Bandwidth and build-minute limits also apply.
- Without a payment method, exceeding certain included usage suspends services/builds rather than buying extra usage. Render also reserves the right to suspend unusually high outbound traffic, including external database requests.
- Render explicitly advises against Free instances for production applications. This is a **controlled test pilot**, not an always-on enterprise release or a guarantee of unlimited free availability.

Use a free workspace with no payment method and the `plan: free` service. Do not select a trial, paid instance, paid database, disk or worker. If signup/account verification requires payment information or the dashboard would create any charge, stop. No account-specific eligibility or hosted viability has been verified yet. No keep-alive pinger, cron service or artificial traffic is included.

## Deployment package (not executed)

Opt-in Blueprint: `render.finance-v2.yaml`. It is deliberately not the default `render.yaml`. Importing/applying it creates a service and counts as deployment, so it needs explicit owner authorisation. `autoDeployTrigger: off` disables later automatic deployments; it does not prevent the first deployment when a service is created.

The Blueprint pins:

- One Docker web service, Free compute, Frankfurt region.
- Repository root Docker context and `finance-v2-backend/Dockerfile`.
- `FINANCE_V2_API_ENABLED=false` initially.
- `FINANCE_V2_CASH_POLL_ENABLED=false`; free-host startup rejects polling.
- `FINANCE_V2_ALLOWED_TENANTS=zehqTDcKyrDAOHKK3stJ` (Martin Pharma only).
- Existing project `gen-lang-client-0911422817` and database `ai-studio-f7d8654b-e089-425a-a506-38159afe1e75`.
- `ALLOWED_ORIGIN=https://mp.pharmhelm.com`.
- `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/finance-v2-service-account.json`.

The API starts inactive without credentials. `GET /healthz` is process liveness only, returns `databaseVerified:false`, and never queries Firestore. It does **not** prove authentication, tenant isolation, database connectivity, posting activation or billing status. All financial endpoints return unavailable while the API is disabled.

For a separately approved connection test, an administrator must supply a dedicated least-privilege runtime service-account credential through the host's protected secret-file mechanism, using the filename above. Required access is existing Firestore data operations and Firebase Authentication user lookup for revoked-token verification; no billing administration, project Owner, Cloud Run deployment, repository creation or Firebase Hosting permissions are needed by the runtime. Admin SDK access bypasses Firestore Rules, so the existing authenticated tenant/branch/role handlers remain mandatory. Do not reuse/export the GitHub CI secret, paste private keys into chat, commit keys, or bake them into the image. Git and Docker ignore the credential filename pattern. The container runs as the Node user (group 1000), compatible with documented Render runtime-secret permissions. Rotate/revoke the runtime credential if host access is withdrawn.

Set `FINANCE_V2_API_ENABLED=true` only during an explicitly approved API connection test. Tenant-controlled transfer, registration, EOD and cash-funding flags stay off until separate authorised pilot activation. Use no fabricated staff credentials, balance initialization, backdated postings or live financial test amounts.

Frontend builds use `VITE_FINANCE_V2_API_BASE_URL=https://<approved-service>.onrender.com`. Do not insert that placeholder as a real URL. EOD now uses the same client/endpoint as treasury. The old `VITE_FINANCE_V2_EOD_API_URL` is a migration fallback only if it ends in `/api/finance-v2/eod`; no second EOD server is required. No frontend is deployed by this change. The existing Masaka preview workflow now skips its publication step for this Finance candidate, preserving the owner's no-deployment instruction while retaining build/test checks.

## Cold starts, restarts and transaction outcomes

The client sends a read-only `/healthz` warmup with a 90-second timeout before obtaining a fresh Firebase ID token and sending one financial request. It never automatically retries a financial POST. HTML startup/error responses, timeouts, overload and unknown SDK errors remain unconfirmed outcomes. Transfer retry uses the retained original request identity; EOD uses its canonical tenant/branch/date/shift identity. Unknown backend errors return 503 with `rejected:false` because a transaction might have committed before its acknowledgement was lost. No raw errors or credentials are returned.

The service limits concurrent requests, accepts bounded JSON bodies, rejects non-pilot tenants before dispatch, retains exact-origin CORS, and verifies tokens/active staff/tenant/branch permissions in the existing handlers. A SIGTERM stops accepting new connections and allows in-flight work to drain. Financial state, idempotency evidence and cursors stay in Firestore, never on the host's ephemeral filesystem. Provider shutdown can interrupt acknowledgement; existing atomic/idempotent Firestore posting remains the protection.

## Executed validation and open release gates

- 748 unit/transport/configuration tests passed locally.
- Frontend typecheck, backend typecheck and production build passed locally (existing chunk-size warnings remain).
- Isolated Admin Firestore transfer/EOD/POS cash acceptance passed, including canonical retries, receipt revisions, principal/fees, tenant/branch permissions, concurrent posting and refund funding.
- Existing Management Cash supplier settlement authenticated rules regression passed.
- Dedicated V2 authenticated-client rules denial acceptance passed, including a complete uncertified transfer with no balance changes.
- The preceding revision's five GitHub workflows were inspected and all passed. The new commit's checks must be assessed separately.
- Local browser execution remains unavailable because Chromium downloads failed; use the current CI browser acceptance result. Local Docker is unavailable; CI includes image build, enabled authentication denial and inactive free-profile startup tests.

Open: latest-commit CI, actual Render account/free-plan eligibility, owner approval to deploy, runtime credential/IAM provisioning, deployed HTTPS/authentication/named-database verification, quota suitability, owner acceptance and separately approved tenant activation/test transactions. Host API/Blueprint validation has not been performed against an authenticated Render account. Source configuration and local tests do not establish operational deployment success.

## Primary references

- https://firebase.google.com/docs/admin/setup
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/pricing
- https://firebase.google.com/docs/ai-assistance/ai-studio-integration
- https://render.com/docs/free
- https://render.com/docs/your-first-deploy
- https://render.com/docs/blueprint-spec
- https://render.com/docs/configure-environment-variables
- https://render.com/docs/docker-secrets
