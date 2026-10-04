# Rough monthly cost — Mumbai, 4 October 2026

These are usage forecasts for the three separate backends, not a bill or a price quote. Regional unit rates were retrieved from the AWS Price List API and saved in `pricing/`. Taxes, exchange rates, support plans and unrelated account workloads are excluded.

## Example usage for EACH repository

1,000 monthly active users, including 90 disposable CI identities at 30 smoke runs; 100,000 REST calls; 100,000 GraphQL query/mutation operations; 100,000 WebSocket requests plus 100,000 responses; 100,000 WebSocket connection minutes; 500,000 Lambda invocations averaging 200 ms; 500,000 DynamoDB read request units and 200,000 write request units; 1 GB database storage; 1 GB log ingestion and retained log storage; 0.5 GB deployment assets; 1 GB internet egress. CI: 30 deployments/month at 10 minutes each. DynamoDB units include ticket and connection table operations, not just API requests. Scans, large records and transactions can increase them.

## Charges before account allowances

| Component | Regional rate | Gen 1 | Native Gen 2 | Repaired migration |
|---|---|---:|---:|---:|
| REST API Gateway | $3.50 / million | $0.35 | $0.35 | $0.35 |
| AppSync queries/mutations | $4 / million | $0.40 | $0.40 | $0.40 |
| WebSocket messages + connections | $1 / million messages + $0.25 / million minutes | $0.23 | $0.23 | $0.23 |
| Lambda requests + x86 duration | $0.20 / million + $0.0000166667 / GB-second | $0.31 | $0.93 | $0.31 |
| DynamoDB on-demand request units | $0.1425 / million reads; $0.71 / million writes | $0.21 | $0.21 | $0.21 |
| DynamoDB standard storage | $0.285 / GB-month beyond allowance | $0.29 | $0.29 | $0.29 |
| CloudWatch logs | $0.67 / GB ingested + $0.03 / GB-month retained | $0.70 | $0.70 | $0.70 |
| S3 deployment assets | $0.025 / GB-month | $0.01 | $0.01 | $0.01 |
| Egress planning allowance | $0.09 / GB assumption; actual account/route allowance varies | $0.09 | $0.09 | $0.09 |
| **AWS subtotal excluding Cognito** | | **$2.58** | **$3.21** | **$2.58** |
| GitHub Linux CI, before included minutes | 300 minutes × $0.006 | $1.80 | $1.80 | $1.80 |

The deployed code uses 128 MB for Gen 1 and migrated application Lambdas, and 512 MB for native Gen 2. This comparison assumes identical duration; measure actual duration before choosing memory. Deployment provider Lambdas, S3 requests and AWS-managed KMS request charges add a small amount; reserve approximately $0.10–$0.50/month across the three demos for that overhead.

API rates: [API Gateway](https://aws.amazon.com/api-gateway/pricing/), [AppSync](https://aws.amazon.com/appsync/pricing/). Compute and data rates: [Lambda](https://aws.amazon.com/lambda/pricing/), [DynamoDB](https://aws.amazon.com/dynamodb/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [S3](https://aws.amazon.com/s3/pricing/). The stored AWS pricing records contain the Mumbai SKU/range used, including DynamoDB free storage ranges. The egress row is an allowance, not a verified Mumbai internet-transfer SKU.

## Cognito and CI allowances

Cognito Lite/Essentials offer 10,000 direct/social monthly active users per account or organization; eligible older Lite accounts can have 50,000. This allowance is shared with other user pools. Each smoke run authenticates three new users; deleting them afterward does not remove their monthly activity. If the 1,000 MAUs are business users alone, add 90 CI MAUs per repository ($1.35 on Essentials when the allowance is exhausted). Three independent copies can count the same person three times. If an available allowance covers these 3,000 MAUs, their incremental authentication charge is $0. If the allowance is already consumed, 1,000 MAUs cost $5.50 on Lite or $15 on Essentials per backend. All three deployed pools were confirmed as Essentials. Account billing eligibility and other pools determine the remaining allowance. [Cognito pricing](https://aws.amazon.com/cognito/pricing/).

The three pipelines use about **900 Linux minutes/month** under this assumption. GitHub Free includes 2,000 standard runner minutes and 500 MB artifact storage, shared with other private repositories. With enough remaining included minutes, CI is $0; otherwise these 900 minutes cost **$5.40**. Small JSON evidence artifacts expire after 14 days; dependency cache has a separate per-repository allowance. [Actions rates](https://docs.github.com/en/billing/reference/actions-runner-pricing), [included usage and storage](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Combined monthly forecast: approximately **$8.40 AWS usage + $0–$5.40 CI + applicable Cognito charges**, before other account allowances. Budget roughly **$10–$15/month for all three demos** if Cognito's allowance remains available; if their Cognito allowance is exhausted, add **$45/month**. Lambda, DynamoDB storage, logs, egress and time-limited API allowances/credits may reduce the forecast. They are not assumed available because this account has existing applications.

For ten times the API/Lambda/read/write traffic while retaining the same MAUs and storage, the subtotal excluding Cognito/CI is about **$54/month across all three**. Idle on-demand backends have no fixed API or Lambda capacity charge; retained tables, logs and assets still cost money. With the assumed storage volumes and no usage, gross storage cost is roughly **$1/month across all three**, before shared allowances.

## Maintenance effort and cost growth

IAM and CloudFormation have no separate project license fee. These are backend-only deployments through GitHub Actions: there is no Amplify Hosting frontend, CodeBuild/CodePipeline subscription, NAT gateway, provisioned Lambda concurrency, dedicated API cache, WAF or custom domain in this estimate. AppSync subscriptions are available in the schema but not included in the example traffic; add $2/million updates and $0.08/million connection minutes if used.

The root production dependency audit reported zero advisories on 4 October 2026 (`evidence/production-audit.json`). Build/CLI dependencies are a separate, older tree and still need periodic security and compatibility review.

Human maintenance is separate. For planning, allow 1–3 engineering hours/month across the demos for dependency/security review, deployment failures, log/storage retention and permission review; multiply by your own hourly rate. This is an effort assumption, not an AWS charge. Gen 1 is in maintenance mode and reaches end of life on May 1, 2027, so a production team must also budget migration work. [AWS announcement](https://github.com/aws-amplify/amplify-cli/issues/14881).

Log groups and retained tables/assets can outlive stack deletion. Current objects with different deployment asset hashes are not removed merely by a noncurrent-version lifecycle rule. Storage estimates need revision as these accumulate. Default list operations scan/filter tickets; sustained multi-tenant usage calls for an owner index and query design. Email/SMS verification, backups/PITR, extra observability, security services and data transfer beyond this assumption add costs if enabled.
