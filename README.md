# Amplify Gen 1: support tickets

The SupportDesk frontend is included under [`frontend/`](frontend/README.md). Its separate S3/CloudFront hosting and full-stack deployment are managed by the GitHub workflow; live URLs are recorded in [`frontend/hosting.json`](frontend/hosting.json).

![Support-ticket architecture: Cognito, REST, GraphQL, WebSockets and DynamoDB](docs/support-ticket-architecture.png)

[CI/CD and infrastructure diagram](docs/ci-cd-infrastructure-gen1-gen2.png) · [Migration workflow diagram](docs/gen1-to-gen2-migration-workflow.png) · [Diagram notes](docs/CI-CD-AND-MIGRATION.md)

Task 1: an Amplify Gen 1 project covering REST, AppSync GraphQL and API Gateway WebSockets. It is published privately on GitHub and deployed in Mumbai. TypeScript, 22 runtime tests, synthesis and all 13 live API check groups pass.

```bash
npm ci
npm run validate
```

Read [the implementation guide](docs/IMPLEMENTATION.md) for the steps used to build this project, and [the API contract](docs/API-CONTRACT.md) for requests and authorization behavior. [Synthesis evidence](evidence/synthesis.json) records the checks performed.

`amplify/backend/` contains native Gen 1 Auth, API and Function definitions. WebSockets are a Gen 1 custom CDK resource. `src/` is the canonical Lambda code; the prepare script copies it into self-contained Gen 1 Lambda source folders. CLI version 14.5.1 is pinned as the official source-distributed `@aws-amplify/cli-internal` package, whose binary is `amplify`. Node 22 is the target Lambda/runtime version. This session validated with Node 24.16.0.

`.github/workflows/deploy.yml` deploys commits to `main` using temporary OIDC credentials. `scripts/deploy.cjs` selects the configured `dev` environment, replaces offline validation metadata, initializes against the actual application and pushes the backend. See the cloud deployment guide for evidence and pipeline status.

## Cloud deployment follow-up

[Private GitHub repository](https://github.com/gowthammail4macair/amplify-gen1-fullstack) · [workflow, endpoints and live checks](docs/CLOUD-DEPLOYMENT.md) · [rough monthly cost](docs/COST-ESTIMATE.md).

The pipeline validates the code, deploys through short-lived GitHub OIDC credentials, and tests Cognito, REST, AppSync and WebSockets against AWS. `evidence/live-smoke.json` records the latest successful cloud check when present. The migration repository uses a separate environment with fresh resources.

### Deployed frontend

- [Open SupportDesk over HTTPS](https://d2i2kf1hg91937.cloudfront.net)
- [S3 website URL — redirects to HTTPS](http://support-d1zija7gqlw461-website-112097210422.s3-website.ap-south-1.amazonaws.com)

All 15 hosted browser workflow checks passed. The latest full-stack CI passed 22 runtime tests, 13 live API check groups, and five hosting checks. See [deployment evidence](evidence/fullstack-ci.json) and [hosted browser results](evidence/frontend-browser.json). The native browser delete confirmation could not be automated; delete API operations passed in CI.
