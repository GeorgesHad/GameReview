# Football Match Review

Football Match Review is a private match review app for coaches and players. The React shell displays `GET /api/v1/health` and the deployed Git revision. The DEV video lab is an isolated test interface for private upload, seeking and deletion. Match management and player workflows follow in later phases.

The approved [requirements](football_review_implementation_requirements.md), [architecture](ARCHITECTURE.md), [roadmap](PROGRESS.md) and [OpenAPI contract](docs/openapi.yaml) describe the scope and what each phase can verify.

## Develop and review in the cloud

Open a checkout in the cloud workspace. The Node version is pinned in `.nvmrc`. GitHub Actions runs the same foundation checks on PRs and branch pushes. Authors and reviewers can use the CI results and, after provisioning, the deployed DEV URL. A local installation is optional.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:deploy
npm run test:e2e
```

Use `npm run dev` for the emulated Worker and built frontend in a development shell. `npm run start -- --ip 0.0.0.0 --port 8787` serves an existing build. Playwright builds the test frontend with fixture values and manages its own server on port 4173. Use Google Chrome or Chromium with H.264 decoding. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the installed browser executable, as CI does with Google Chrome. When the workspace home is read-only, set `npm_config_cache` and `XDG_CONFIG_HOME` to writable directories before running the tools.

The checks need no cloud credentials. The migration tests use embedded PostgreSQL with stand-in Supabase roles. Wrangler dry runs compile both Worker configurations. The browser tests use desktop and mobile Chromium profiles and a synthetic H.264 MP4. They simulate Supabase and R2 responses, test retries and reselecting the original after a reload, compare the direct upload bytes with the fixture, and exercise native playback against simulated range responses.

## Deploy the Phase 1 shell

The shell and liveness endpoint need a private GitHub repository and a Cloudflare Workers Free account. Set up Supabase and R2 separately for Phase 2. The following steps remain owner actions when there are no provider accounts configured.

1. In Cloudflare **Workers & Pages**, set up the account's `workers.dev` subdomain. Keep the Workers Free plan. Wrangler will create `football-match-review-dev` and `football-match-review-prod` on their first deployments. Use the `workers.dev` URLs and leave preview URLs disabled. Use the workflow in this repo as the deployment source and leave automatic Cloudflare Git builds disabled.
2. In Cloudflare **Account API tokens**, create two separate tokens using **Edit Cloudflare Workers**, limited to the intended account. If both Workers share one account, script-edit permission is account-scoped. Retrieve the Account ID from the Cloudflare dashboard.
3. In GitHub **Settings → Secrets and variables → Actions**, add these repository secrets and variables. Use distinct tokens and keep repository write access restricted. Private repositories on GitHub Free can use repository secrets, so the workflow uses those for deployment credentials.

   | Setting | DEV | PROD |
   | --- | --- | --- |
   | Actions secret | `CLOUDFLARE_DEV_API_TOKEN` | `CLOUDFLARE_PROD_API_TOKEN` |
   | Actions variable for account ID | `CLOUDFLARE_DEV_ACCOUNT_ID` | `CLOUDFLARE_PROD_ACCOUNT_ID` |
   | Actions variable for HTTPS origin | `CLOUDFLARE_DEV_BASE_URL` | `CLOUDFLARE_PROD_BASE_URL` |
   | Origin shape, with no trailing slash | `https://football-match-review-dev.<subdomain>.workers.dev` | `https://football-match-review-prod.<subdomain>.workers.dev` |

4. Merge the reviewed foundation PR with a merge or squash commit. Create `develop` from `main` in GitHub after configuring DEV. A push to `develop` runs CI and deploys DEV. The deployment smoke check expects the submitted commit at `/api/v1/health` and checks that `/` serves the app. Open the DEV URL and confirm **API operational** on the shell.
5. After validating DEV, use **Actions → CI and Worker deployment → Run workflow** on `main` to deploy PROD. The workflow reruns CI and verifies that the selected commit belongs to a merged PR to `main` with an active approval on its final head. GitHub requires a reviewer other than the PR author. Use merge or squash to retain the PR association that the check uses.

Use Cloudflare **Worker → Logs** to inspect request IDs, safe route labels, status and timing, and compare the deployed version and Git SHA with the health response. For a Worker rollback use **Worker → Deployments** and select a known good version. Check database compatibility before rolling back. Worker rollback leaves database migrations and data in place.

## Enable the DEV video lab

The Phase 1 DEV Worker and deployment smoke test have passed. The following setup applies to `football-match-review-dev` only. Production continues to serve the foundation shell.

1. In the **DEV Supabase project**, follow the [Supabase setup](#supabase-projects-and-initial-owner) for password sign-in and `SUPABASE_DEV_DB_URL`. After merging Phase 2, run **Actions → Apply Supabase migrations** on `develop`, first to plan and then with **Apply** checked. Verify versions `20261127000000` and `20261128000000` in both columns of the run output. The workflow includes the video migration only on `develop`. Create or confirm the DEV user and provision their active `admin` membership using the setup SQL. Keep the team UUID.
2. In Cloudflare **R2 Object Storage**, create or select a dedicated DEV test bucket with Standard storage. Leave **Public Development URL** and **Custom Domains** disabled. Set the exact DEV origin and enable the multipart lifecycle fallback as shown in [Private R2 buckets](#private-r2-buckets). Under **Manage API Tokens**, create an R2 **Object Read & Write** token with **Apply to specific buckets only** and select only the DEV bucket. Save the displayed access key ID and secret access key securely. The Cloudflare deployment token cannot substitute for those credentials.
3. Open **Workers & Pages → football-match-review-dev → Settings → Variables and Secrets**. Add the following values. DEV Wrangler deploys preserve dashboard variables. The Worker uses the standard S3 endpoint for the selected account, so it needs no native R2 binding.

   | Type | Name | Value |
   | --- | --- | --- |
   | Text | `SUPABASE_URL` | DEV project URL, `https://<project-ref>.supabase.co` without trailing slash |
   | Text | `SUPABASE_PUBLISHABLE_KEY` | DEV publishable key from the Supabase API Keys page |
   | Secret | `SUPABASE_SERVER_SECRET_KEY` | DEV Supabase server secret key |
   | Text | `VIDEO_POC_TEAM_ID` | UUID of the active DEV team from step 1 |
   | Text | `R2_ACCOUNT_ID` | Cloudflare account ID shown by R2, 32 hex digits |
   | Text | `R2_BUCKET_NAME` | Exact private DEV bucket name |
   | Secret | `R2_ACCESS_KEY_ID` | Access key ID from the bucket-scoped R2 credential |
   | Secret | `R2_SECRET_ACCESS_KEY` | Secret access key from the same credential |
   | Text, optional | `VIDEO_POC_LIMIT_BYTES` | Total DEV lab budget in decimal bytes. Defaults to `250000000`. |

   Save and deploy the Worker settings. Keep the bucket and configured team fixed while recordings or reservations remain. Use the standard account S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`) for this proof of concept, which assumes a bucket outside a jurisdiction-specific R2 endpoint.
4. In **GitHub → Settings → Secrets and variables → Actions → Variables**, add `VIDEO_POC_SUPABASE_URL` and `VIDEO_POC_SUPABASE_PUBLISHABLE_KEY` with the matching DEV URL and publishable key. Set them before merging to `develop`, or re-run the latest push workflow on `develop` afterward. The deploy job includes them in the DEV frontend build. Open the deployed DEV shell and select **Open DEV video lab**, or visit `/video-poc` on that origin. Complete the check below before treating Phase 2 as live.

### Verify the live upload and playback path

1. Start signed out. `GET /api/v1/video-poc/recordings` on a configured DEV Worker should return `401`. Sign in on `/video-poc` with the confirmed DEV admin. If testing a non-admin identity, expect `403` from the Worker. Confirm the list loads as the active admin.
2. Upload a short, non-sensitive fast-start MP4 with H.264 8-bit 4:2:0 video and AAC audio or none. The checked-in synthetic clip at `tests/fixtures/video-poc.mp4` is suitable for the first smoke check. For a multi-part smoke check under the default cap, use a compatible clip larger than 32 MiB. In browser DevTools **Network**, verify that `PUT` part requests reach the private R2 S3 host, that `ETag` is exposed, and that Worker requests contain only metadata. Compare the lab file size with the original size. The SHA-256 shown is the browser-computed source digest, which is used to verify the reselected file. An R2 multipart ETag does not verify a whole-file SHA-256.
3. Pause or interrupt a larger upload and reload the lab. Sign in again, use **Reselect file** on the incomplete row, and select the same file. Confirm R2 receives only unfinished or invalid-size parts. Sessions expire after 24 hours. Delete expired sessions to release their reservation. A failed or ambiguous start/completion can show a three-minute operation window before retry or deletion is available.
4. Confirm the recording list makes no video request. Open the player, then seek to a late timestamp and play a short start/end range. Verify native position and pause behavior. On a longer clip, check R2 requests for `Range` and `206 Partial Content` with `Content-Range`. Browsers may prefetch metadata, keyframes and extra bytes. Use a longer clip to test a seek away from the already buffered interval. Test on real target devices, including mobile Safari/Chrome, and verify **Renew playback URL** resumes at the previous position when a URL expires.
5. Select **Delete** and confirm. Check that the lab releases capacity and the object is absent in the R2 dashboard. Check cleanup of an interrupted upload, plus CPU and errors in DEV Worker observability. Keep signed URLs private. A previously issued URL is usable until its expiry or object deletion. The URL carries a SigV4 key identifier, while the signing secret stays on the Worker.

The lab uses sequential 32 MiB parts, upload URLs valid for up to 15 minutes, and 30-minute playback URLs. It reserves bytes transactionally against one shared DEV budget and allows up to 20 recordings and open reservations combined. Test multi-GB uploads only after checking account-wide R2 usage and approving a temporary DEV cap that fits below the 10 GB budget alongside other usage. The maximum supported lab cap is `9750000000` bytes. Revert to `250000000` and delete all test objects and reservations afterward. The app does not account for unrelated bucket activity or make R2 a hard billing cap.

To retire the lab, delete test recordings and incomplete uploads, then remove the DEV frontend variables and Worker settings and deploy again. Revoke the bucket-scoped credential when it is no longer needed. The DEV-only migration has its own history entry. Remove its schema with a reviewed forward migration when retiring it.

## Prepare DEV and PROD data services

### Supabase projects and initial owner

1. In Supabase, create two Free projects with distinct database passwords. Use DEV test users and fixtures and keep PROD for real users. Confirm that the organization has capacity for two active Free projects and restore paused Free projects from the dashboard before deploying integrations.
2. In **Authentication → Sign In / Providers**, enable the email/password provider and disable new-user signup and anonymous sign-ins. In **Authentication → URL Configuration**, set **Site URL** to the corresponding `workers.dev` origin. Add only exact redirect URLs if a later flow needs them. The operator creates confirmed users through the trusted dashboard or server Admin API. This avoids needing custom SMTP for initial provisioning.
3. In each project choose **Connect → Session pooler**. Copy the PostgreSQL connection string, substitute its own database password with reserved URI characters percent-encoded, and require TLS with `sslmode=verify-full`. Keep the entire connection string in GitHub Actions repository secrets as `SUPABASE_DEV_DB_URL` or `SUPABASE_PROD_DB_URL`. Use port 5432 in the session pooler connection supplied by the dashboard. The runtime Worker does not use the migration URL.
4. In GitHub **Actions → Apply Supabase migrations**, choose `develop` for DEV or `main` for PROD when provisioning it later. Run the plan with **Apply** unchecked, then run with **Apply** checked after reviewing it. Apply and verify DEV first. The workflow uses the Supabase CLI to maintain migration history and prints the applied versions. The first migration should list `20261127000000` locally and remotely. Keep production migrations compatible with the currently deployed code and run them from reviewed commits.
5. In the target project's **Authentication → Users**, add the initial email/password user with confirmation enabled through the operator flow. Copy the resulting user UUID. In **SQL Editor**, run `select gen_random_uuid();` to obtain a stable team UUID, then substitute those UUIDs and appropriate display names in the following transaction. DEV may use a team from `supabase/fixtures/dev_teams.sql` after running that optional fixture through SQL Editor.

   ```sql
   begin;
   insert into public.profiles (user_id, display_name)
   values ('<auth-user-uuid>'::uuid, '<owner-display-name>')
   on conflict (user_id) do nothing;

   insert into public.teams (id, name)
   values ('<team-uuid>'::uuid, '<team-name>')
   on conflict (id) do nothing;

   insert into public.team_memberships (team_id, user_id, role)
   values ('<team-uuid>'::uuid, '<auth-user-uuid>'::uuid, 'admin')
   on conflict (team_id, user_id) do nothing;
   commit;

   select team_id, user_id, role, active from public.team_memberships
   where team_id = '<team-uuid>'::uuid and user_id = '<auth-user-uuid>'::uuid;
   ```

   Verify the selected membership is active and `admin`. Use a new UUID for a new team and escape SQL text values by doubling any single quotes. Keep initial passwords in a secure credential manager and use a private channel to share login details.

### Private R2 buckets

1. In Cloudflare **R2 Object Storage**, activate R2 if needed and review its billing terms. Create two Standard storage buckets, one per environment, such as `football-match-review-dev` and `football-match-review-prod`. Keep public development URLs and custom domains disabled.
2. In R2 **Manage API tokens**, create separate **Object Read & Write** S3 credentials scoped to each corresponding bucket. Retain the S3 account endpoint, bucket name, access key ID and secret access key securely. The app deployment token serves a separate purpose.
3. In each bucket's **Settings → CORS Policy**, install this policy with that environment's exact origin. The signing integration may require additional signed request headers. Add them explicitly if the DEV POC verifies that need.

   ```json
   [
     {
       "AllowedOrigins": ["https://football-match-review-dev.<subdomain>.workers.dev"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["Content-Type", "Range"],
       "ExposeHeaders": ["ETag", "Accept-Ranges", "Content-Range", "Content-Length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. Under **Object Lifecycle Rules**, verify an **Abort incomplete multipart uploads** rule, with seven days as the initial fallback. The app will expire and reconcile sessions separately. Check storage and operations in the R2 dashboard and monitor account billing and any available usage alerts. R2 measures account-wide GB-month and operations. The planned app caps are 0.25 GB DEV and 9.5 GB PROD, leaving a 0.25 GB nominal margin. R2 can bill for usage outside its free allowance. Keep test clips small, remove them after testing and approve any temporary cap adjustment before a large-file test.

### Runtime settings for later phases

Set Worker secrets as encrypted values on the exact Worker. The lab settings above apply in DEV. Use names from the implementation when activating later integrations.

| Phase | Non-secret Worker config | Worker secrets |
| --- | --- | --- |
| Foundation | `APP_ENV` and `WORKER_VERSION` are set by Wrangler | None |
| Retention | Cron schedule and bounded cleanup settings scoped to each Worker | Use the same environment's existing Worker secrets |

Use the Supabase project's **Settings → API Keys** for the publishable and server secret keys. Keep the server key and R2 signing credentials on the Worker. R2 operations will use the S3 endpoint. Configure Cron in the matching Wrangler environment once a scheduled cleanup handler is implemented. Inspect **Triggers** after deployment to verify that only the intended schedules are active.

## Recovery and validation

Keep original uploaded MP4 bytes separately under owner control. Before a production migration, run the [Supabase logical backup procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) using a trusted cloud runner with the matching project connection. Keep schema, roles, data, migration history and any required Auth records in an owner-controlled encrypted location. Keep provider settings and key rotation instructions separately, and check Auth recovery on a disposable environment before relying on backups. A database or Worker rollback cannot recover deleted R2 bytes on its own.

Phase 2 live deployment, Supabase Auth and migration checks, actual R2 multipart and CORS, and playback on real devices require verification. Use the [roadmap](PROGRESS.md) for those acceptance gates. The sample CSV at `tests/fixtures/sample-notes.csv` is for later import testing.

test
