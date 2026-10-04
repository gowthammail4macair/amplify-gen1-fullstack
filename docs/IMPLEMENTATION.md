# How Task 1 was implemented

## 1. Define the use case and shared contract

A support-ticket owner creates and manages tickets. Agents have additional administrative access. REST, GraphQL and WebSockets all use the same model table within the backend. [API-CONTRACT.md](API-CONTRACT.md) lists every operation and its authorization.

## 2. Create the Gen 1 project structure

I authored the Gen 1 category inputs and function templates under `amplify/backend/`, using CLI 14.5.1 structures. This was an offline setup, not an `amplify init` deployment. `amplify/.config/project-config.json` describes the JavaScript project. `amplify/cli.json` enables GraphQL Transformer v2 and the default `sub::username` owner claim.

`backend-config.json` records category dependencies. The official CLI is a pinned development dependency. `scripts/prepare-local.cjs` creates ignored local metadata only when missing and copies canonical `src/*.cjs` into each Lambda's `src/` folder. It does not fabricate an AWS app ID, stack or credentials.

```bash
npm ci
npm run prepare
```

## 3. Configure Cognito

`auth/ticketAuth/cli-inputs.json` configures email sign-in, email verification, a 12-character password with upper/lowercase, numbers and symbols, no MFA, and no unauthenticated identity access. The Gen 1 native Auth category creates a user pool, web/native app clients and an identity pool. The APIs use user-pool tokens, not identity-pool IAM authentication. The custom WebSocket stack also creates the `Agents` group.

The local synthesis script invokes the **official** `AmplifyAuthTransform` to build the actual CloudFormation template. It uses an empty environment-parameter provider and does not call Cognito.

## 4. Define GraphQL and DynamoDB

`api/supportGraphql/schema.graphql` contains `Ticket @model`, owner and Agents `@auth` rules, and a TicketStatus enum. Amplify generates the Ticket DynamoDB table, CRUD resolvers, auth pipeline functions and subscription fields. `ticketSummary` and `closeTicket` use `@function(name: "ticketWorkflow-${env}")`.

`function/ticketWorkflow/` contains a native Lambda definition. Its runtime in `src/workflow.cjs` reads/updates DynamoDB and enforces owner or Agents authorization. The function gets the generated table name from the API ID and environment parameters.

The API names the Lambda through the `@function` directive instead of importing its stack ARN. Therefore the API stack depends on Auth, while the workflow Lambda can depend on the API's table ID without creating an API/function stack cycle.

```bash
npm run amplify -- api gql-compile
```

The compiler needs Gen 1 environment metadata even for offline compilation. `scripts/synth.ts` creates a clearly local, ignored current-cloud metadata fixture if none exists. It requires an explicit successful compilation message and checks generated operations/resolvers; the CLI can return exit code 0 for some missing-file errors.

## 5. Add Lambda-backed REST

`api/supportRest/cli-inputs.json` describes `/tickets` and `/admin/tickets` using `ticketRest`. The Gen 1 REST category normally generates open ANY/proxy methods for those inputs. `api/supportRest/override.ts` replaces that surface with the six explicit protected methods in the API contract and an unauthenticated CORS preflight.

The override adds two OpenAPI authorizers: native Cognito for ticket operations and a TOKEN Lambda authorizer for the Agent endpoint. It injects the Auth pool ARN and authorizer Lambda ARN from the parent stack and grants API Gateway permission to invoke the authorizer. The open category inputs are an input to the override; the synthesized deployed methods are protected. Removing the override would remove that protection.

`src/rest.cjs` dispatches requests; `src/authorizer.cjs` validates Cognito ID tokens and group membership. `src/database.cjs` implements bounded owner-filtered listing and conditional writes. Native Lambda templates contain DynamoDB permissions and environment variables. CORS is restricted to `http://localhost:3000`; adjust the override and runtime origin together for a frontend deployment.

## 6. Add WebSockets through Gen 1 custom CDK

`custom/ticketSocket/cdk-stack.ts` creates the WebSocket API, Lambda integration, connect REQUEST authorizer, four routes, stage and connection table. It uses the Gen 1 `AmplifyHelpers.addResourceDependency` API to reference Auth and the native Lambda functions. The `env` parameter comes from the Gen 1 CLI.

The `ticketSocketHandler` Lambda depends on Auth/API, not on the custom stack. Both the Lambda's connection-table environment variable and the CDK table definition compute `Connections-<pool-id>`. This avoids a circular dependency. Its callback IAM policy allows only the deployment stage's connection-management paths, but must wildcard API IDs in Gen 1 to avoid a custom-stack/function-stack cycle. Gen 2 uses the exact API ID.

The connection table uses PAY_PER_REQUEST, `connectionId` as its key, JWT expiry as TTL, and Retain deletion/replacement policy. The Lambda verifies access again for every ticket lookup and disconnects expired sessions.

## 7. Run local verification

```bash
npm run validate
```

This runs TypeScript checks, 21 runtime tests, official Auth/REST template synthesis, official CLI GraphQL compilation, custom WebSocket CDK synthesis and dependency-graph cycle checks. Evidence is in `evidence/synthesis.json` and `evidence/graphql-compile.log`. CDK's unused dependency-parameter warnings and Amplify's root-field/owner-rule warnings are recorded; they are not deployment success evidence.

`dist/`, `build/`, local environment metadata and cloud outputs are ignored. Lambda code and all infrastructure inputs are committed. All four functions package their own dependencies on a future `amplify push`.

## 8. Initialize and test in AWS later

This step was not run because you requested local validation only. Use a disposable AWS environment first. If you have only run the offline preparation, remove its ignored `amplify/.config/local-env-info.json`, `amplify/backend/amplify-meta.json`, and `amplify/#current-cloud-backend/` fixtures before `amplify init`. Do not remove actual deployed metadata.

```bash
# First configure your selected AWS profile and region.
export AWS_PROFILE=<profile>
export AWS_REGION=<region>
npm run amplify -- init
npm run amplify -- status
npm run amplify -- push
```

Choose a lowercase environment such as `dev`; review all category changes. Read the REST and GraphQL endpoints from CLI outputs and the WebSocket URL from the `customticketSocket` nested stack outputs. Create confirmed test users, add one to Agents, and run the cloud smoke matrix in [API-CONTRACT.md](API-CONTRACT.md). Fresh CloudFormation deployment, IAM enforcement and cloud resolver execution have not been validated here.

## References

- [Gen 1 REST overrides and Cognito/Lambda authorizers](https://docs.amplify.aws/gen1/react/build-a-backend/restapi/override-api-gateway/)
- [Gen 1 custom GraphQL business logic](https://docs.amplify.aws/gen1/react/build-a-backend/graphqlapi/custom-business-logic/)
- [Official CLI source at 14.5.1](https://github.com/aws-amplify/amplify-cli/tree/add1015bf00d7288737911b66db10bcfb10bcb19)
