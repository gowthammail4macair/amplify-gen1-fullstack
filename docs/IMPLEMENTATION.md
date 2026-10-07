# How Task 1 was implemented

The steps below record initial construction and local validation. The later authorized GitHub Actions deployment and live API results are recorded in [CLOUD-DEPLOYMENT.md](CLOUD-DEPLOYMENT.md).

## Live notifications, comments, and status editing — current implementation

The initial construction steps below are followed by the deployed enhancement
verified on 7 October 2026. [LIVE-UPDATES-AND-COMMENTS.md](LIVE-UPDATES-AND-COMMENTS.md)
and [API-CONTRACT.md](API-CONTRACT.md) describe the current UI and message protocol.

- `src/domain.cjs`, `src/database.cjs`, and `src/rest.cjs` validate comments,
  derive authors from verified claims, and append them atomically to the Ticket
  item. GET/POST `/tickets/{id}/comments` enforce owner/Agents access. Comments
  are limited to 100 per ticket and 2000 UTF-8 bytes each.
- `src/workflow.cjs` implements `listTicketComments` and `addTicketComment`
  alongside summary and close. The generated Ticket input does not expose the
  stored comment attribute.
- `src/websocket.cjs` dispatches DynamoDB stream events to `src/notifications.cjs`.
  The broadcaster sends ticket metadata to authorized owner/Agent connections,
  removes expired/gone sessions, and emits removal messages after deletion or
  access revocation. The existing socket Lambda is reused.
- `frontend/src/api.js` connects automatically, handles repeated push messages,
  sends a four-minute heartbeat, and reconnects with a current token.
  `frontend/src/main.js` updates the queue/status/comments, preserves drafts,
  and prevents delayed responses crossing sign-ins. Pause/Resume resyncs the
  queue and selected comments. The Status selector and Comments form appear
  after selecting a ticket.

Current validation: 30 runtime/UI tests, 17 live API check groups, five hosting
checks, and 12 two-session browser checks per repository. See
[CI evidence](../evidence/live-feature-ci.json) and
[browser results and fixture cleanup](../evidence/live-feature-browser.json).

The Gen 1 `custom/ticketSocket/cdk-stack.ts` imports the transformer-exported
Ticket stream ARN and creates a scoped stream-read policy and Lambda event
source mapping. The handler's native template grants connection-table scanning.
`scripts/synth.ts` compiles GraphQL before the custom CDK dependency helper reads
its generated outputs; this order also passes with no cached GraphQL build.

## 1. Define the use case and shared contract

A support-ticket owner creates and manages tickets. Agents have additional administrative access. REST, GraphQL and WebSockets all use the same model table within the backend. [API-CONTRACT.md](API-CONTRACT.md) lists every operation and its authorization.

## 2. Create the Gen 1 project structure

I authored the Gen 1 category inputs and function templates under `amplify/backend/`, using CLI 14.5.1 structures. This initial construction was offline; the later CI deployment uses actual `amplify init`/`push` against the configured environment. `amplify/.config/project-config.json` describes the JavaScript project. `amplify/cli.json` enables GraphQL Transformer v2 and the default `sub::username` owner claim.

`backend-config.json` records category dependencies. The official CLI is a pinned development dependency. `scripts/prepare-local.cjs` creates ignored local metadata only when missing and copies each handler's required canonical `src/*.cjs` modules into its Lambda `src/` folder, removing obsolete `.cjs` copies. The authorizer includes `authorizer` and `domain`; REST and workflow include their handler, `domain`, and `database`; the socket includes `websocket`, `domain`, `database`, and `notifications`. Function manifests contain only the libraries those files import. `test/lambda-packages.test.cjs` checks the dependency graph and reruns the backend suites using isolated copies with only declared dependencies available. It does not fabricate an AWS app ID, stack or credentials.

```bash
npm ci
npm run prepare
```

## 3. Configure Cognito

`auth/ticketAuth/cli-inputs.json` configures email sign-in, email verification, a 12-character password with upper/lowercase, numbers and symbols, no MFA, and no unauthenticated identity access. The Gen 1 native Auth category creates a user pool, web/native app clients and an identity pool. The APIs use user-pool tokens, not identity-pool IAM authentication. The custom WebSocket stack also creates the `Agents` group.

The local synthesis script invokes the **official** `AmplifyAuthTransform` to build the actual CloudFormation template. It uses an empty environment-parameter provider and does not call Cognito.

## 4. Define GraphQL and DynamoDB

`api/supportGraphql/schema.graphql` contains `Ticket @model`, owner and Agents `@auth` rules, and a TicketStatus enum. Amplify generates the Ticket DynamoDB table, CRUD resolvers, auth pipeline functions and subscription fields. `ticketSummary`, `closeTicket`, `listTicketComments`, and `addTicketComment` use `@function(name: "ticketWorkflow-${env}")`.

`function/ticketWorkflow/` contains a native Lambda definition. Its runtime in `src/workflow.cjs` reads/updates DynamoDB and enforces owner or Agents authorization. The function gets the generated table name from the API ID and environment parameters.

The API names the Lambda through the `@function` directive instead of importing its stack ARN. Therefore the API stack depends on Auth, while the workflow Lambda can depend on the API's table ID without creating an API/function stack cycle.

```bash
npm run amplify -- api gql-compile
```

The compiler needs Gen 1 environment metadata even for offline compilation. `scripts/synth.ts` creates a clearly local, ignored current-cloud metadata fixture if none exists. It requires an explicit successful compilation message and checks generated operations/resolvers; the CLI can return exit code 0 for some missing-file errors.

## 5. Add Lambda-backed REST

`api/supportRest/cli-inputs.json` describes `/tickets` and `/admin/tickets` using `ticketRest`. The Gen 1 REST category normally generates open ANY/proxy methods for those inputs. `api/supportRest/override.ts` replaces that surface with the eight explicit protected methods in the API contract and unauthenticated CORS preflights.

The override adds two OpenAPI authorizers: native Cognito for ticket operations and a TOKEN Lambda authorizer for the Agent endpoint. It injects the Auth pool ARN and authorizer Lambda ARN from the parent stack and grants API Gateway permission to invoke the authorizer. The open category inputs are an input to the override; the synthesized deployed methods are protected. Removing the override would remove that protection.

`src/rest.cjs` dispatches requests; `src/authorizer.cjs` validates Cognito ID tokens and group membership. `src/database.cjs` implements bounded owner-filtered listing and conditional writes. Native Lambda templates contain DynamoDB permissions and environment variables. The origin allowlist in `frontend/origins.cjs` includes `http://localhost:3000` and this project's hosted HTTPS frontend. Lambda data responses and preflights use that allowlist; gateway-generated error responses have readable CORS headers.

## 6. Add WebSockets through Gen 1 custom CDK

`custom/ticketSocket/cdk-stack.ts` creates the WebSocket API, Lambda integration, connect REQUEST authorizer, four routes, stage and connection table. It uses the Gen 1 `AmplifyHelpers.addResourceDependency` API to reference Auth, the native Lambda functions, and the compiled GraphQL API outputs. The `env` parameter comes from the Gen 1 CLI.

The `ticketSocketHandler` Lambda depends on Auth/API, not on the custom stack. Both the Lambda's connection-table environment variable and the CDK table definition compute `Connections-<pool-id>`. This avoids a circular dependency. Its callback IAM policy allows only the deployment stage's connection-management paths, but must wildcard API IDs in Gen 1 to avoid a custom-stack/function-stack cycle. Gen 2 uses the exact API ID.

The connection table uses PAY_PER_REQUEST, `connectionId` as its key, JWT expiry as TTL, and Retain deletion/replacement policy. The Lambda enforces access and expiry for legacy requests and every broadcast recipient. The current website receives stream-driven push notifications; `getTicket` remains an API compatibility route.

## 7. Run local verification

```bash
npm run validate
```

This runs TypeScript checks, 30 runtime/UI tests, official Auth/REST template synthesis, official CLI GraphQL compilation, custom WebSocket CDK synthesis and dependency-graph cycle checks. Evidence is in `evidence/synthesis.json` and `evidence/graphql-compile.log`. CDK's unused dependency-parameter warnings and Amplify's root-field/owner-rule warnings are recorded; they are not deployment success evidence.

`dist/`, `build/`, local environment metadata and cloud outputs are ignored. Lambda code and all infrastructure inputs are committed. All four functions package their own dependencies during `amplify push`.

## 8. Initialize and test in AWS later

This step was not run during the initial local-only phase. The subsequently authorized cloud pipeline uses `scripts/deploy.cjs` to select the actual `dev` environment and deploy it; see the cloud deployment report. Use a disposable AWS environment first. If you have only run the offline preparation, remove its ignored `amplify/.config/local-env-info.json`, `amplify/backend/amplify-meta.json`, and `amplify/#current-cloud-backend/` fixtures before `amplify init`. Do not remove actual deployed metadata.

```bash
# First configure your selected AWS profile and region.
export AWS_PROFILE=<profile>
export AWS_REGION=<region>
npm run amplify -- init
npm run amplify -- status
npm run amplify -- push
```

Choose a lowercase environment such as `dev`; review all category changes. Read the REST and GraphQL endpoints from CLI outputs and the WebSocket URL from the `customticketSocket` nested stack outputs. Create confirmed test users, add one to Agents, and run the cloud smoke matrix in [API-CONTRACT.md](API-CONTRACT.md). The independent deployed environment passed the live checks linked above. Stateful Gen 1-to-Gen 2 resource transfer remains a separate, unperformed operation.

## References

- [Gen 1 REST overrides and Cognito/Lambda authorizers](https://docs.amplify.aws/gen1/react/build-a-backend/restapi/override-api-gateway/)
- [Gen 1 custom GraphQL business logic](https://docs.amplify.aws/gen1/react/build-a-backend/graphqlapi/custom-business-logic/)
- [Official CLI source at 14.5.1](https://github.com/aws-amplify/amplify-cli/tree/add1015bf00d7288737911b66db10bcfb10bcb19)
