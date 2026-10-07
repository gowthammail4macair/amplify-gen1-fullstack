# Cloud deployment and verification

## Current deployed functionality — 7 October 2026

The current version uses automatic, owner/Agents-scoped WebSocket notifications
from DynamoDB Streams and includes protected REST/GraphQL comments and status
editing. It passed 30 runtime/UI tests, 17 live API check groups, five hosting
checks, and 12 two-session browser checks. See [the feature guide](LIVE-UPDATES-AND-COMMENTS.md),
[current CI evidence](../evidence/live-feature-ci.json), and
[current browser checks and cleanup](../evidence/live-feature-browser.json).
The earlier dated walkthroughs below describe the original lookup version.


The repository is private on GitHub. `deployment.json` identifies its Amplify application, AWS region, branch/environment and GitHub OIDC role. `.github/workflows/deploy.yml` runs from `main` or manual dispatch and serializes deployments.

The pipeline pins action revisions, Node 22 and npm 11.13.0, installs locked dependencies, runs TypeScript/runtime checks and local synthesis, obtains temporary AWS credentials, prepares the S3/CloudFront hosting stack, deploys the backend, exports actual outputs, runs `scripts/smoke-test.cjs` against AWS, then builds and publishes the frontend. `scripts/check-hosting.cjs` checks hosted asset hashes, the S3 redirect, and denied anonymous access to the asset bucket. Small JSON evidence and outputs are uploaded for 14 days. No AWS access key or secret is stored in GitHub. Gen 1 bridges its SDK v2 post-push hook through a dedicated profile containing the job's short-lived OIDC session in mode-0600 temporary files; `finally` removes both files. The user's default profile is untouched. Trust is restricted to this exact repository's immutable owner/repository IDs and its `main` branch.

The CI provider is GitHub Actions. The earlier infrastructure diagram shows the Amplify-managed build option; this deployment uses the same Gen 1 CLI or Gen 2 pipeline-deploy backend stages in an external pipeline. The SupportDesk frontend is now built in the same workflow and published to a separate private S3 bucket behind CloudFront. A second empty S3 website bucket redirects visitors to that HTTPS site. This hosting stack is defined in `frontend/hosting-template.json`; this project does not use the Amplify Hosting build service.

The smoke check creates two temporary Cognito owners and an Agents member without sending invitations, authenticates using SRP, verifies REST owner CRUD and Cognito rejection, checks the custom Agents authorizer, verifies generated AppSync and custom Lambda resolvers against shared DynamoDB data, and tests authenticated WebSocket responses, denied ownership and malformed messages. The current smoke suite also checks protected REST/GraphQL comments, verified authors, stream-driven creation/status/comment pushes, Agents delivery, and cross-owner notification isolation. Finally it closes sockets and removes tickets and users. Unit checks additionally cover JWT issuer/audience/signature/expiry and expired WebSocket identity handling; token expiry over a real hour is not part of the live check.

Gen 1 deploys with `amplify init` against its existing `dev` environment followed by `amplify push --yes`. Only its deployment bucket/root environment was initialized locally; API/function resources are deployed by Actions. Offline validation fixtures are replaced with real deployment metadata before push. The root overrides GraphQL to 15.10.3 so CLI code generation and subsequent schema compilation use one module instance. Local compilation alone did not expose the post-push duplicate-module failure. The source-installed CLI explicitly discovers hoisted runtime plugins, and backend overrides use the root's pinned build dependencies. The authored category scaffolding also records AppSync auth metadata and its Cognito parameter, and supplies the Cognito helper-role/shared-ID defaults required by the official stack builder. An empty Auth `parameters.json` supplies the CLI post-push trigger uploader's required input even when no trigger assets are configured. REST override parameter names match the backend dependency names; synthesis checks both Auth references and REST dependency parameters.

Both Gen 2 repositories deploy with `ampx pipeline-deploy --branch main --app-id ...` and export outputs using `ampx generate outputs`. The migrated repository creates an independent environment. No Gen 1 lock, user-pool ownership transfer, stateful refactor or data copy is performed.

The Gen 1 deployment role uses AWS's `AdministratorAccess-Amplify` managed policy; it is powerful. An additional account/region-scoped `cognito-identity:ListTagsForResource` permission is required by CloudFormation when it retrieves the identity pool Name attribute; the AWS-managed policy did not cover this action. A similarly scoped `cognito-idp:GetGroup` permission supplies the custom Agents group resource's read operation. CloudFormation-only API Gateway V2 tag/untag permission supports WebSocket stage tags. These additions are recorded in `evidence/ci-policy-additions.json`. Gen 2 roles use `AmplifyBackendDeployFullAccess`, which delegates deployment through the account's CDK bootstrap roles. Runtime roles separately limit table/connection access. The live test policy is narrowed to each demo's Cognito pool after creation. Trusted code on `main` can change infrastructure through these roles; protect branch write access and review infrastructure changes before production use.

During setup, CDKToolkit reported bootstrap version 26 and CREATE_COMPLETE, but its asset bucket returned 404. The missing original bucket was restored with blocked public access, SSE-KMS, versioning, a TLS-only policy, and the original lifecycle settings. Existing application resources/data were not changed.

Use [the cost forecast](COST-ESTIMATE.md) for regional assumptions and shared allowances. Backend deployment status alone does not prove application correctness: the live smoke step must also succeed.

The CLI initialization scaffolding and managed-policy compatibility fixes are deployment preparation, separate from migration-tool translation. The migration report records only the generator repairs and stateful-migration limits.

## Verified Gen 1 deployment

[Actions run 37188203254](https://github.com/gowthammail4macair/amplify-gen1-fullstack/actions/runs/37188203254) succeeded on source `3469b61`. TypeScript, all 21 runtime tests, synthesis, official CLI push/synchronization and all 12 live API check groups passed. A consistent scan found zero rows in both tables after cleanup; Cognito contained zero users. Both tables use on-demand billing with PITR disabled.

- REST: `https://iu6zhvysy7.execute-api.ap-south-1.amazonaws.com/dev`
- GraphQL: `https://zw4vheuavfdzfkaugphptnr22y.appsync-api.ap-south-1.amazonaws.com/graphql`
- WebSocket: `wss://b36pvu2da7.execute-api.ap-south-1.amazonaws.com/dev`

The public migration assessment of this synchronized source succeeded and reported the unsupported REST override. See `evidence/real-cloud-migration-assess.log`. The Gen 1 app remains unlocked. If a future code change replaces the Cognito pool, update the smoke policy to the new pool ARN before the next live check.

## Visible browser verification — 2026-10-04

A local browser page at `http://localhost:3000` made direct requests to the deployed AWS services through real sign-in forms and buttons. All 17 final browser checks passed: three Cognito identities, REST create/update/read, default GraphQL create/read, custom Lambda summary/close, WebSocket connect/message/disconnect, cross-owner REST/GraphQL denial, and custom-authorizer agent allow/non-agent deny. No backend change was needed for Gen 1. See `evidence/browser-live.json`, including the original failed CORS attempt where applicable and its successful retry. The walkthrough removed only its exact sample ticket IDs and the two extra identities per pool; the Ticket Owner account remains for the user’s manual testing. Passwords and JWTs are excluded from evidence.

## S3 and HTTPS frontend

Frontend source: [`frontend/`](../frontend/README.md). Hosting outputs: [`hosting.json`](../frontend/hosting.json).

- HTTPS website: https://d2i2kf1hg91937.cloudfront.net
- S3 website redirect: http://support-d1zija7gqlw461-website-112097210422.s3-website.ap-south-1.amazonaws.com
- Private assets bucket: `support-d1zija7gqlw461-assets-112097210422`
- Separate website redirect bucket: `support-d1zija7gqlw461-website-112097210422`
- Hosting stack: `support-d1zija7gqlw461-frontend`

These resources belong only to this repository. Its frontend uses its own Cognito pool, REST API, AppSync API, WebSocket API and tables. Frontend bundles contain public client configuration; passwords and AWS deployment credentials are excluded. The GitHub role has an additional scoped `DedicatedFrontendHosting` policy whose checked-in document identifies only this hosting stack, buckets, distribution and origin access control. Initial hosting provisioning used the account deployment credentials; the policy allows ongoing updates to those existing resources.

## Hosted frontend verification — original lookup version, 4 October 2026

[Original full-stack CI](https://github.com/gowthammail4macair/amplify-gen1-fullstack/actions/runs/37197677372) passed on source `4816a1c0d8f32ff3b43ab69ef9445b4c1b3c9f67`. It ran 22 runtime tests, 13 live API check groups, and five hosting checks. Served JavaScript, CSS and HTML matched the deployment build hashes; the S3 website returned a 301 to this HTTPS site; direct anonymous S3 asset access returned 403.

The visible hosted-browser walkthrough passed 15 checks: sign-in, REST create/update, generated GraphQL create/read/list, shared records between APIs, Lambda summary/close, WebSocket connect/lookup/disconnect, status filtering, readable custom-authorizer owner denial, and sign-out. Native confirmation/cancel interaction temporarily blocked the original migrated tab. A later browser read showed a successful REST deletion of its selected sample ticket. The cancel path was not verified; REST and GraphQL deletion also passed through CI. Migrated sign-out passed in a fresh tab.

`evidence/frontend-browser.json` records the actual checks and conditional cleanup of only this walkthrough's two exact ticket IDs. The Ticket Owner account and all other observed tickets were preserved. Passwords/JWTs are excluded from evidence.
