import { AmplifyApiRestResourceStackTemplate } from '@aws-amplify/cli-extensibility-helper';

export function override(resources: AmplifyApiRestResourceStackTemplate) {
  resources.addCfnParameter({ type: 'String' }, 'authticketAuthUserPoolArn', { 'Fn::GetAtt': ['authticketAuth', 'Outputs.UserPoolArn'] });
  resources.addCfnParameter({ type: 'String' }, 'functionticketAuthorizerArn', { 'Fn::GetAtt': ['functionticketAuthorizer', 'Outputs.Arn'] });
  const body = resources.restApi.body as any;
  body.securityDefinitions = {
    Cognito: { type: 'apiKey', name: 'Authorization', in: 'header', 'x-amazon-apigateway-authtype': 'cognito_user_pools',
      'x-amazon-apigateway-authorizer': { type: 'cognito_user_pools', providerARNs: [{ Ref: 'authticketAuthUserPoolArn' }] } },
    AgentAuthorizer: { type: 'apiKey', name: 'Authorization', in: 'header', 'x-amazon-apigateway-authtype': 'custom',
      'x-amazon-apigateway-authorizer': { type: 'token', authorizerResultTtlInSeconds: 0,
        authorizerUri: { 'Fn::Sub': 'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${functionticketAuthorizerArn}/invocations' } } }
  };
  const template = body.paths['/tickets']['x-amazon-apigateway-any-method'];
  const options = { ...template, security: [], parameters: [] };
  const method = (security: string, withId = false) => ({ ...template, security: [{ [security]: [] }],
    parameters: withId ? [{ name: 'id', in: 'path', required: true, type: 'string' }] : [] });
  body.paths = {
    '/tickets': { get: method('Cognito'), post: method('Cognito'), options },
    '/tickets/{id}': { get: method('Cognito', true), patch: method('Cognito', true), delete: method('Cognito', true), options },
    '/tickets/{id}/comments': { get: method('Cognito', true), post: method('Cognito', true), options },
    '/admin/tickets': { get: method('AgentAuthorizer'), options }
  };
  resources.restApi.addPropertyOverride('Body', body);
  resources.addCfnResource({ type: 'AWS::Lambda::Permission', properties: {
    Action: 'lambda:InvokeFunction', FunctionName: { Ref: 'functionticketAuthorizerArn' }, Principal: 'apigateway.amazonaws.com',
    SourceArn: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':execute-api:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':', resources.restApi.ref, '/authorizers/*']] }
  } }, 'AgentAuthorizerPermission');
}
