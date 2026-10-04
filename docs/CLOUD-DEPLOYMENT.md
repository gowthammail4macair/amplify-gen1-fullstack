# Cloud deployment and verification

The repository is private on GitHub. `deployment.json` identifies its Amplify application, AWS region, branch/environment and GitHub OIDC role. `.github/workflows/deploy.yml` runs from `main` or manual dispatch and serializes deployments.

The pipeline pins action revisions, Node 22 and npm 11.13.0, installs locked dependencies, runs TypeScript/runtime checks and local synthesis, obtains temporary AWS credentials, deploys the backend, exports actual outputs, and runs `scripts/smoke-test.cjs` against AWS. Small JSON evidence and outputs are uploaded for 14 days. No AWS access key or secret is stored in GitHub. Gen 1 bridges its SDK v2 post-push hook through a dedicated profile containing the job's short-lived OIDC session in mode-0600 temporary files; `finally` removes both files. The user's default profile is untouched. Trust is restricted to this exact repository's immutable owner/repository IDs and its `main` branch.

The CI provider is GitHub Actions. The earlier infrastructure diagram shows the Amplify-managed build option; this deployment uses the same Gen 1 CLI or Gen 2 pipeline-deploy backend stages in an external pipeline. Amplify Hosting/CDN frontend builds are not configured because this use case is backend-only.

The smoke check creates two temporary Cognito owners and an Agents member without sending invitations, authenticates using SRP, verifies REST owner CRUD and Cognito rejection, checks the custom Agents authorizer, verifies generated AppSync and custom Lambda resolvers against shared DynamoDB data, and tests authenticated WebSocket responses, denied ownership and malformed messages. Finally it closes sockets and removes tickets and users. Unit checks additionally cover JWT issuer/audience/signature/expiry and expired WebSocket identity handling; token expiry over a real hour is not part of the live check.

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
