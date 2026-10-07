import * as cdk from 'aws-cdk-lib';
import * as AmplifyHelpers from '@aws-amplify/cli-extensibility-helper';
import { Construct } from 'constructs';
import { CfnApi, CfnAuthorizer, CfnIntegration, CfnRoute, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { CfnPermission, CfnEventSourceMapping } from 'aws-cdk-lib/aws-lambda';
import { CfnPolicy } from 'aws-cdk-lib/aws-iam';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';

export class cdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps, amplifyResourceProps?: AmplifyHelpers.AmplifyResourceProps) {
    super(scope, id, props);
    new cdk.CfnParameter(this, 'env', { type: 'String' });
    // @ts-expect-error Gen 1 helper uses a separately pinned CDK Stack type.
    const dependencies: any = AmplifyHelpers.addResourceDependency(this,
      amplifyResourceProps!.category, amplifyResourceProps!.resourceName, [
        { category: 'auth', resourceName: 'ticketAuth' },
        { category: 'function', resourceName: 'ticketSocketHandler' },
        { category: 'function', resourceName: 'ticketAuthorizer' },
        { category: 'api', resourceName: 'supportGraphql' }
      ]);
    const poolId = cdk.Fn.ref(dependencies.auth.ticketAuth.UserPoolId);
    const handlerArn = cdk.Fn.ref(dependencies.function.ticketSocketHandler.Arn);
    const authorizerArn = cdk.Fn.ref(dependencies.function.ticketAuthorizer.Arn);
    const apiId = cdk.Fn.ref(dependencies.api.supportGraphql.GraphQLAPIIdOutput);
    const streamArn = cdk.Fn.importValue(cdk.Fn.join(':', [apiId, 'GetAtt:TicketTable:StreamArn']));
    const streamPolicy = new CfnPolicy(this, 'TicketStreamPolicy', {
      policyName: 'ticket-stream-notifications',
      roles: [cdk.Fn.ref(dependencies.function.ticketSocketHandler.LambdaExecutionRole)],
      policyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow',
        Action: ['dynamodb:DescribeStream','dynamodb:GetRecords','dynamodb:GetShardIterator'], Resource: streamArn }] }
    });
    const mapping = new CfnEventSourceMapping(this, 'TicketNotifications', {
      functionName: handlerArn, eventSourceArn: streamArn, startingPosition: 'LATEST', batchSize: 10,
      bisectBatchOnFunctionError: true, maximumRetryAttempts: 3, maximumRecordAgeInSeconds: 3600
    });
    mapping.addDependency(streamPolicy);
    new CfnUserPoolGroup(this, 'Agents', { userPoolId: poolId, groupName: 'Agents' });
    new Table(this, 'Connections', { tableName: cdk.Fn.join('', ['Connections-', poolId]),
      partitionKey: { name: 'connectionId', type: AttributeType.STRING }, billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt', removalPolicy: cdk.RemovalPolicy.RETAIN });
    const api = new CfnApi(this, 'TicketSocket', { name: cdk.Fn.join('-', ['ticket-socket', cdk.Fn.ref('env')]),
      protocolType: 'WEBSOCKET', routeSelectionExpression: '$request.body.action' });
    const uri = (arn: string) => cdk.Fn.join('', ['arn:', cdk.Aws.PARTITION, ':apigateway:', cdk.Aws.REGION, ':lambda:path/2015-03-31/functions/', arn, '/invocations']);
    const integration = new CfnIntegration(this, 'LambdaIntegration', { apiId: api.ref, integrationType: 'AWS_PROXY', integrationMethod: 'POST', integrationUri: uri(handlerArn) });
    const authorizer = new CfnAuthorizer(this, 'CognitoTokenVerifier', { apiId: api.ref, authorizerType: 'REQUEST', name: 'CognitoTokenVerifier',
      authorizerUri: uri(authorizerArn), identitySource: ['route.request.querystring.token'] });
    for (const routeKey of ['$connect', '$disconnect', '$default', 'getTicket']) {
      new CfnRoute(this, routeKey.replace('$', '') + 'Route', { apiId: api.ref, routeKey,
        target: cdk.Fn.join('/', ['integrations', integration.ref]), authorizationType: routeKey === '$connect' ? 'CUSTOM' : 'NONE',
        ...(routeKey === '$connect' ? { authorizerId: authorizer.ref } : {}) });
    }
    new CfnStage(this, 'Stage', { apiId: api.ref, stageName: cdk.Fn.ref('env'), autoDeploy: true });
    new CfnPermission(this, 'InvokeHandler', { action: 'lambda:InvokeFunction', functionName: handlerArn, principal: 'apigateway.amazonaws.com',
      sourceArn: cdk.Fn.join('', ['arn:', cdk.Aws.PARTITION, ':execute-api:', cdk.Aws.REGION, ':', cdk.Aws.ACCOUNT_ID, ':', api.ref, '/*/*']) });
    new CfnPermission(this, 'InvokeAuthorizer', { action: 'lambda:InvokeFunction', functionName: authorizerArn, principal: 'apigateway.amazonaws.com',
      sourceArn: cdk.Fn.join('', ['arn:', cdk.Aws.PARTITION, ':execute-api:', cdk.Aws.REGION, ':', cdk.Aws.ACCOUNT_ID, ':', api.ref, '/authorizers/*']) });
    new cdk.CfnOutput(this, 'WebSocketUrl', { value: cdk.Fn.join('', ['wss://', api.ref, '.execute-api.', cdk.Aws.REGION, '.', cdk.Aws.URL_SUFFIX, '/', cdk.Fn.ref('env')]) });
    new cdk.CfnOutput(this, 'WebSocketApiId', { value: api.ref });
  }
}
