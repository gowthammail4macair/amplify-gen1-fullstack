# CI/CD and migration diagram generation

Mode: built-in image_gen, using the imagegen skill.

## CI/CD and infrastructure prompt

Use case: infographic-diagram
Asset type: documentation architecture diagram for these AWS Amplify support-ticket repositories.
Create a polished, high-resolution landscape diagram on white, with dark navy typography, restrained green and lavender lane backgrounds, flat AWS-style icons, crisp aligned boxes and clean orthogonal arrows. Large readable labels, generous whitespace, no decorative scenery, tiny text, 3D, watermark or invented services.

Exact title: "CI/CD & Infrastructure: Gen 1 vs Gen 2"
Exact subtitle: "Proposed cloud pipeline for the support-ticket backend"
A prominent small status banner: "Current repos: local validation only. Cloud CI/CD is not connected."

Use TWO horizontal pipeline lanes, Gen 1 above and Gen 2 below. Both progress left to right from Git to CI to deployment to infrastructure to smoke testing. The lanes represent SEPARATE projects and separate AWS resources; do not merge their AWS backends.

GEN 1 lane:
Heading "Amplify Gen 1"
Infrastructure-source caption: "amplify/backend/" and smaller "CLI inputs · GraphQL SDL · REST override · function templates · custom WebSocket CDK"
Five main stages with arrows:
1 "Git push"
2 "CI checks" with two exact command lines "npm ci" and "npm run validate"
3 "CD deploy" with exact command "amplifyPush --simple" and small label "Amplify Hosting helper"
4 "CloudFormation" with "CLI-generated templates" and "Root + category stacks"
5 "AWS backend" with simple service icons and readable short names "Cognito · Lambda · AppSync", "API Gateway REST + WebSocket", "DynamoDB"
After AWS backend, a small connected checkmark labeled "Smoke tests".
A clear lane footnote: "Git branch maps to a named Gen 1 environment."
A small separate output label connected to the AWS backend: "Client config + stack outputs".

GEN 2 lane:
Heading "Amplify Gen 2"
Infrastructure-source caption: "amplify/backend.ts" and smaller "defineAuth · defineData · defineFunction · CDK REST + WebSocket"
Five corresponding stages:
1 "Git push"
2 "CI checks" with exact "npm ci" and "npm run validate"
3 "CD deploy" with exact "ampx pipeline-deploy" and small label "App ID + branch"
4 "CloudFormation" with "CDK synthesis + Lambda assets" and "Root + resource stacks"
5 "AWS backend" with the SAME service names as the first lane, representing new separate instances.
After AWS backend, a small connected checkmark "Smoke tests".
Footnote: "App ID and Git branch select the deployment."
Output label connected to this AWS backend: "amplify_outputs.json".

The CI boxes have an unobtrusive subtitle "TypeScript · 21 runtime tests · synthesis". A concise common note states "Failed checks stop deployment."

Under both lanes, a clean four-cell explanatory strip titled "How infrastructure is managed", with these exact cells:
"Source of truth" / "Committed backend code"
"Deployed state" / "CloudFormation stacks"
"Deployment access" / "AWS service role"
"Environment isolation" / "Separate stack sets"

At the bottom, a compact setup reminder: "Cloud setup required: connected repository, Amplify app, deployment role; Gen 2 also needs CDK bootstrap."
A separate bottom note: "Gen 2 ampx sandbox is a personal AWS deployment, not offline validation."

Do not draw a frontend, CDN or frontend build; these repositories are backend-only. Do not depict CI/CD as already deployed. Do not invent an amplify.yml or GitHub Actions workflow present in the repo. This is an informative reference design using the actual local check commands and documented cloud deployment mechanisms. Keep spelling exact, avoid crossed arrows, and show clearly that backend definitions become CloudFormation-managed services.

## Migration workflow prompt

Use case: infographic-diagram
Asset type: technical documentation diagram showing how the official AWS Amplify Gen 1 to Gen 2 tool produces destination code and how this repository exercised it.
Create a polished, high-resolution landscape diagram on white with dark navy text, flat icons, generous spacing and crisp orthogonal arrows. Use blue for tool-generated code, amber for manual repairs and gray/dashed styling for future AWS steps. Use three clearly separated horizontal bands. All labels must be large and readable. No 3D, watermark, tiny paragraphs, decorative scenery or invented services.

Exact heading: "Gen 1 → Gen 2 Migration"
Exact subtitle: "Generate destination code, repair it, then validate before cloud migration"

BAND 1, heading "How the official tool creates destination code":
A left input box "Gen 1 inputs", with "Configuration · GraphQL SDL", "Lambda source · custom CDK".
Immediately below it, a smaller input box "AWS discovery", subtitle "Stacks · Cognito · Lambda settings".
Both input boxes feed ONE tool-engine box titled "Official CLI 14.5.1". Inside, show a compact sequence "assess → lock → generate". A short line underneath the sequence says "amplify gen2-migration <step>".
A visible amber caution immediately under or next to the engine reads "REST override blocks normal generate". This is a real unsupported-feature gate, not a successful check.
The engine feeds a code-output box "Generated Gen 2 files" with "amplify/backend.ts", "Auth · Data · Functions", "REST + custom CDK", "package.json + table mappings".
That output feeds an amber box "Manual repair" with "REST authorizers · IAM / env", "WebSocket references · ESM", "GraphQL binding · dependencies".
The manual repair box feeds a final blue box "Gen 2 destination" with "Repaired amplify/ + runtime" and "Typecheck · tests · synthesis".
An unambiguous short note below band 1: "The CLI replaces amplify/ in a separate source checkout; the destination Git repository is prepared separately."
Do not imply the tool creates a new Git repository automatically or converts this project without repair.

BAND 2, heading "Live AWS continuation — not run here":
A clean gray dashed left-to-right sequence of six compact steps:
"Deploy Gen 2" → "Test side by side" → "Refactor stateful resources" → "postRefactor + redeploy" → "Cut over clients" → "Retire Gen 1 after checks"
A small command hint beneath refactoring: "refactor --to <stack>".
Beneath this band, ONE readable note: "Real model-table mappings reuse Gen 1 data; Cognito and eligible stateful resources move via refactor."
No automatic data-copy arrows, no DynamoDB model-table refactor claim, no arrow implying endpoint/client migration occurs before testing. This is a supervised future cloud workflow.

BAND 3, heading "What this local migration repository actually ran":
Use a GREEN, solid, fully separate sequence of five boxes:
"source-gen1/" with "Source snapshot"
→ "Official generators" with "Synthetic AWS responses", and command label "migration:exercise"
→ "evidence/generated-raw/" with "Preserved raw output"
→ "Documented repairs" with command "migration:repair"
→ "Repaired amplify/" with "npm run validate" and "21 tests + synthesis"
There must be no connection from this offline band into the cloud-refactor band.
A readable status note in this band: "Public assess/generate stopped at missing app metadata; the offline harness exercised tool components."
A readable note underneath: "Synthetic table mapping removed from the local reference. A live migration must retain the real mapping."

Final footer: "No AWS deployment, lock, refactor or data transfer was performed."
Keep all flows and distinctions exact. Show how source and discovered settings become Gen 2 definitions, where manual work is necessary, and why the local destination project is not proof of a completed live migration.

## Saved assets

Both PNGs are saved under docs/ in the enclosing workspace and in each of these independent repositories:
- amplify-gen1-fullstack
- amplify-gen2-fullstack
- amplify-gen1-to-gen2-migration

Filenames:
- ci-cd-infrastructure-gen1-gen2.png
- gen1-to-gen2-migration-workflow.png

## Sources checked

- https://docs.aws.amazon.com/amplify/latest/userguide/edit-build-settings.html
- https://docs.amplify.aws/react/deploy-and-host/fullstack-branching/cross-account-deployments/
- https://docs.amplify.aws/react/start/migrate-to-gen2/migrate-existing-app/

The project package scripts, infrastructure definitions, migration harness, assessment and generation evidence were inspected before generation.

