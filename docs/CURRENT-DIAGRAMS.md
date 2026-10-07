# Current architecture and live-update diagrams

These diagrams describe the deployed notification and comment implementation
verified on 7 October 2026. The same behavior is implemented independently in
Gen 1, native Gen 2, and migrated Gen 2; each has its own pool, APIs, Ticket
table, and Connections table.

## Architecture

![Current architecture: REST and GraphQL changes flow through DynamoDB Streams to authorized WebSocket clients](support-ticket-live-updates.png)

REST and generated/custom GraphQL operations use one Ticket table per project.
Comments are stored on that Ticket item. Its stream invokes the existing
`ticketSocketHandler`, which scans live connection records and filters by
owner/Agents and JWT expiry before posting metadata through API Gateway.
The connect Lambda verifies the Cognito ID token. Generated CRUD resolvers
bypass the workflow Lambda. The Connections table stores sessions, not tickets.

## Two-browser sequence

![Status and comment changes arrive in another authorized browser without refresh](ticket-live-notifications-sequence.png)

The sequence follows a REST status update and a comment append. The observer
browser has the ticket selected. Notifications carry ticket metadata; a
comment event makes the selected browser retrieve the text through the
Cognito-protected comment API. Generated GraphQL writes and custom Lambda
close operations trigger the same DynamoDB stream path.

Pause/Resume reconnects and resyncs current state. These are in-page updates in
the signed-in website, with no manual WebSocket lookup required. The legacy
`getTicket` route remains for compatibility and API tests.

## Sources and verification

- [Editable architecture source](support-ticket-live-updates.mmd)
- [Editable sequence source](ticket-live-notifications-sequence.mmd)
- [Generation prompts and asset hashes](live-diagram-generation.json)
- [Feature behavior and limits](LIVE-UPDATES-AND-COMMENTS.md)
- [Original lookup architecture — historical](support-ticket-architecture.png)

The PNGs were created with the built-in imagegen tool and visually inspected
against `src/notifications.cjs`, `src/websocket.cjs`, and the workflow handlers.
The Mermaid files describe the same flow and provide an editable reference.
The original lookup bitmap and earlier CI/migration illustrations remain
historical artifacts; they do not describe the current notification UI.
