# Architecture diagram generation

Mode: built-in image_gen (imagegen skill).

Selected final output:
- /Users/testadmin/Documents/AmplifyGen1_to_Gen2_migration/docs/support-ticket-architecture.png
- /Users/testadmin/Documents/AmplifyGen1_to_Gen2_migration/amplify-gen1-fullstack/docs/support-ticket-architecture.png
- /Users/testadmin/Documents/AmplifyGen1_to_Gen2_migration/amplify-gen2-fullstack/docs/support-ticket-architecture.png
- /Users/testadmin/Documents/AmplifyGen1_to_Gen2_migration/amplify-gen1-to-gen2-migration/docs/support-ticket-architecture.png

## Initial generation prompt

Use case: infographic-diagram
Asset type: a polished architecture diagram for the existing AWS Amplify support-ticket example, suitable for repository documentation and a technical presentation.

Create one high-resolution landscape diagram, approximately 16:9, on a white background. Use crisp flat service icons, restrained pastel lane backgrounds, dark navy text, large readable sans-serif typography, generous spacing, straight orthogonal arrows, and a precise aligned grid. Avoid photorealism, decorative scenery, tiny text, 3D effects, watermarks and tangled connectors.

The exact heading is "Support Ticket Backend".
The subheading is "REST, GraphQL and WebSockets share one data model".

CONTENT AND LAYOUT:
At the top, a compact identity flow: "Ticket owner / Agent" -> "Amazon Cognito" -> "ID token". Show "Sign in" on the first arrow. One user pool serves all three API protocols within this backend. Client requests carry this token.

The main diagram has three clearly separated horizontal lanes, with request arrows from a client on the left and one shared blue DynamoDB cylinder on the far right. The client label is "Client". The shared cylinder label is "Ticket table" with small text "id · title · status · owner". All three lanes connect to THIS SAME cylinder. The lanes are titled "REST", "GraphQL" and "WebSocket". Clearly differentiate authentication from business logic. Draw the following connections faithfully:

REST lane:
"API Gateway REST" -> two parallel authentication branches:
upper branch "Cognito authorizer", small endpoint label "/tickets · /tickets/{id}"
lower branch "Lambda authorizer", small endpoint label "/admin/tickets · Agents only"
Both branches merge -> orange Lambda box "ticketRest" -> shared Ticket table.
The lambda authorizer checks the Cognito token and Agents group; the native authorizer handles ordinary ticket operations. Do not depict two REST business Lambdas.

GraphQL lane:
"AWS AppSync" with small subtitle "Cognito authorization" -> two parallel resolver branches:
upper "Generated CRUD resolvers" -> DIRECTLY to shared Ticket table, with no Lambda in this path.
lower orange Lambda "ticketWorkflow", small subtitle "ticketSummary · closeTicket" -> shared Ticket table.
The direct DynamoDB and Lambda paths must remain visibly distinct.

WebSocket lane:
"API Gateway WebSocket" -> "Lambda authorizer", small subtitle "$connect · verify Cognito token" -> orange Lambda "ticketSocketHandler", small subtitle "getTicket · check owner + expiry" -> shared Ticket table.
Use a small label "connect authentication" to make clear the authorizer runs on $connect, not every message. Mark the client/WebSocket request-and-response connection as bidirectional.
A separate smaller blue DynamoDB cylinder UNDER the socket handler is "Connections table", small subtitle "identity · token expiry · TTL". Connect it ONLY to ticketSocketHandler for connection state. Do not merge it with the Ticket table. The socket handler checks saved identity and expiry for each message.
A concise note under this lane: "WebSocket uses Lambda verification of Cognito tokens."
The Lambda authorizer boxes in the REST and WebSocket lanes represent the same reusable ticketAuthorizer function; convey this with the unobtrusive note "Shared authorizer Lambda", not crossing arrows.

Below the architecture, one compact example strip with EXACT text:
"Create via REST → Close via GraphQL → Read via WebSocket"
This is a workflow across APIs over the shared Ticket table, not a message-broadcast claim.

At the bottom, three small aligned repository cards with these headings and short descriptions:
"Gen 1" / "Categories + overrides + custom CDK"
"Native Gen 2" / "defineAuth + defineData + CDK"
"Migration" / "Official generators + manual repairs"
No runtime arrows between these three cards; they are separate implementations of the architecture above.

Bottom footnotes, readable:
"Each project has its own Cognito pool and tables."
"Local validation only; migration discovery used synthetic AWS responses."

Ensure the diagram is neat, technically correct, balanced, and all spelling and arrow destinations are exact. Prefer fewer, larger, clear labels over decorative details. The anatomy must show default AppSync resolvers bypass Lambda, mixed REST authorizers, Cognito-backed WebSocket connect authorization, a shared Ticket table WITHIN one project, a separate Connections table, and separate resources across projects.

## Targeted correction prompt

Edit this architecture diagram with one targeted clarification: make the identity flow unambiguous. Preserve all existing content, text, lane layout, colors, service icons, API branches, shared Ticket table connections, Connections table, workflow strip, repository cards and footnotes.

Remove the long horizontal navy distribution line immediately below the top ID token icon and REMOVE ALL THREE downward arrowheads from that line (including the misleading arrow pointing into the Ticket table column). In its place, draw ONE thin navy orthogonal arrow from the bottom of the ID token icon, leftward through the blank gap below the sign-in row, then downward into the TOP of the left "Client" card. It must terminate at the Client, never at a database or a business Lambda. Avoid crossing any service boxes. This conveys Cognito returning a token to the client and the client using it for all API requests.

In the newly empty top area of the far-right blue Ticket table column, add the small, clear service heading "Amazon DynamoDB". This is a label within the storage column, not a new node. No token arrow enters this storage column.

Keep every other arrow and every other label unchanged.

