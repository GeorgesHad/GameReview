# Architecture

Football Match Review is a modular monolith. Each environment has one Cloudflare Worker deployment and HTTPS origin. Cloudflare serves the built Vite assets and routes `/api` and `/api/*` to Hono before considering the SPA fallback. The public `GET /api/v1/health` liveness check identifies the running Worker without any external calls. A separate DEV route group supports the private video lab.

| Location | Responsibility |
| --- | --- |
| `frontend/src/pages` | React screens and user-facing state. Extract shared components as they recur. |
| `frontend/src/api` | Same-origin HTTP clients and response validation using shared contracts. |
| `backend/src` | Worker entry point, Hono routes and safe request metadata. |
| `backend/src/video-poc`, `frontend/src/video-poc` | Isolated Phase 2 routes, storage and database adapters, upload and playback UI. |
| `shared/contracts`, `docs/openapi.yaml` | Zod schemas and a REST contract that can outlive React, Hono or Workers. |
| `supabase/migrations`, `supabase/fixtures` | Forward-only PostgreSQL migrations and optional DEV fixtures. |
| `tests` | API unit tests, PostgreSQL migration checks, and browser tests against the built Worker and assets. |

Introduce `backend/src/services`, `repositories` and `infrastructure` as the first workflows need them. Hono controllers will translate HTTP and call services. Services will own team access checks and workflow rules. Repositories will own SQL operations and transactional boundaries. Supabase Auth, PostgreSQL access and R2 signing will sit at the infrastructure boundary. Application logic should avoid runtime-specific request or storage types so a Spring Boot replacement can preserve the contracts and SQL.

The first migration separates Auth identity, profile, team and membership. Membership stores roles and stable player codes. It can be disabled while retaining IDs. `anon` and `authenticated` have no direct table grants or RLS policies. The Worker checks authorization before using its private service credential for recording operations. Use additional team-consistent keys when the match, recording and note schema lands. Keep R2 object identity separate from logical recording identity and reconcile database and bucket changes after failures.

Use direct browser-to-R2 transfers. The Worker will reserve storage, authorize and sign a specific operation. Private objects remain private, and a signed URL can continue working through its expiry after an authorization change. Cloudflare Cron will run bounded cleanup after those state transitions are implemented. A manifest and icons establish the PWA shell. The foundation has no service worker or offline cache. The browser can read public assets even when future application data and video are access controlled.

The DEV video lab uses Supabase password sign-in with sessions held in memory. On each API call the Worker checks issuer, audience and expiry, verifies the access token with Supabase Auth, and checks active admin membership on the configured DEV team. Recording reads and writes are scoped to both team and owner. The database copies of the POC migration and deployed frontend settings are restricted to `develop`. A separate Worker check rejects the API in any environment except configured DEV.

The DEV-only table tracks file identity and a single multipart upload per recording. An advisory lock serializes reservations. Claims with time limits serialize completion and deletion, and retries can recover by reading R2's object or part metadata. Incomplete and completed recordings count against the same limit until cleanup is confirmed. The browser hashes the source in bounded chunks, sends original 32 MiB slices directly to R2 and resumes from R2's size-checked part list. AWS SigV4 upload URLs include the expected part length, and playback URLs allow native byte ranges. Final completion checks object size and media type. The POC relies on the browser's MP4 metadata probe and source hash, so an independent provider-verified full-file digest remains a future integrity decision.

## Requirements review and decisions to validate

| Issue | Decision or validation gate |
| --- | --- |
| Private GitHub repository on GitHub Free | Environment secrets and protection rules are unavailable on this plan. DEV deploys after branch CI. PROD requires manual dispatch from `main` and an active GitHub PR approval of the final head. Use separate repository secrets and control write access. Solo ownership requires a second reviewer for the production gate. |
| R2 multipart signing and integrity | R2 documents `UploadPart` and composite SHA-256, but does not document a full-object SHA-256 for multipart. Probe browser SigV4 part upload, CORS, signed headers, ETags, resume and range requests in DEV. Use size and provider-supported integrity checks. A browser-computed whole-file digest supports exact file matching on restore and is not independent server verification. R2 can omit CORS headers on an expired URL, so design renewal without relying on the browser reading the provider's error body. |
| Quota versus billing | Application byte caps and reservations target free usage. R2 meters GB-month and operations across the account and bucket controls cannot make a hard billing cap. Use decimal byte budgets of 250,000,000 DEV and 9,500,000,000 PROD initially. Confirm terms in the dashboard and get owner approval for any temporary POC budget change. |
| Worker resource limits | Worker Free documentation lists 100,000 dynamic requests/day, 10 ms CPU per HTTP call and per Cron invocation, and 128 MB per isolate. Measure signed calls, auth, imports and Cron batch sizes in deployed DEV. Bound workloads using measurements. |
| Private account recovery | A Supabase identity is global. A team admin may disable a membership, but multi-team account linking and recovery require an owner procedure. Validate server-side provisioning, token checks, collision handling and password change in DEV. Keep public signup disabled and rely on owner-provisioned confirmed email/password users. |
| Browser and provider gaps | Define the supported device/browser matrix and validate native H.264/AAC seeking and PWA installation there. Verify live quotas, Supabase free project availability, provider grants and Worker smoke checks when accounts exist. |
| Upload and import limits | Choose multipart sizes/concurrency, expiry, signed playback lifetime, CSV limits and timestamp tolerance using DEV measurements. Keep those choices explicit in the implementation and API documentation for their respective phases. |

Provider references are available in the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Supabase pricing](https://supabase.com/pricing) and [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) documentation.
