import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export class TelemetryMicroserviceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a DynamoDB table for storing telemetry data
    const telemetryTable = new dynamodb.Table(this, 'TelemetriesStore', {
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'creationTimeISO', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Create a Dead Letter Queue (DLQ)
    const dlq = new sqs.Queue(this, 'TelemetryDLQ', {
      queueName: 'TelemetryDLQ',
    });

    // Create the main SQS queue with a DLQ
    const telemetryQueue = new sqs.Queue(this, 'TelemetryQueue', {
      queueName: 'TelemetryQueue',
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq,
      },
    });

    // Create the Lambda function to process SQS messages and store them in DynamoDB
    const telemetryProcessorFunction = new lambda.Function(this, 'TelemetryProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset('dist/lambda'), // Update to point to the compiled JS directory
      handler: 'write-telemetries.handler',       // This assumes the file is 'write-telemetries.js' in the 'dist/lambda' folder
      environment: {
        TABLE_NAME: telemetryTable.tableName,
      },
    });
    

    // Grant the Lambda function read/write permissions to the DynamoDB table
    telemetryTable.grantReadWriteData(telemetryProcessorFunction);

    // Add the SQS queue as an event source for the Lambda function
    telemetryProcessorFunction.addEventSource(new SqsEventSource(telemetryQueue, {
      batchSize: 10, // Process up to 10 messages in a batch
    }));

    // Create the API Gateway
    const api = new apigateway.RestApi(this, 'TelemetryWriteAPI', {
      restApiName: 'Telemetry Write Service',
      description: 'API Gateway for telemetry data ingestion',
    });

    // Create the /write/{siteId} endpoint
    const write = api.root.addResource('write');
    const siteId = write.addResource('{siteId}');

    // Create the integration with SQS
    const integration = new apigateway.AwsIntegration({
      service: 'sqs',
      path: `${cdk.Aws.ACCOUNT_ID}/${telemetryQueue.queueName}`,
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: new iam.Role(this, 'ApiGatewaySqsRole', {
          assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
          inlinePolicies: {
            AllowSQSSendMessage: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  actions: ['sqs:SendMessage'],
                  resources: [telemetryQueue.queueArn],
                }),
              ],
            }),
          },
        }),
        requestParameters: {
          'integration.request.header.Content-Type': "'application/x-www-form-urlencoded'",
        },
        requestTemplates: {
          'application/json': `Action=SendMessage&MessageBody={
            "siteId": "$input.params('siteId')",
            "body": $input.json('$')
          }`,
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': JSON.stringify({
                message: 'Message successfully sent to SQS',
                requestId: "$context.requestId",
                messageId: "$input.path('$.SendMessageResponse.SendMessageResult.MessageId')",
              }),
            },
          },
        ],
      },
    });

    siteId.addMethod('POST', integration, {
      methodResponses: [{ statusCode: '200' }],
    });

    // Outputs
    new cdk.CfnOutput(this, 'APIEndpoint', {
      value: api.url,
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: telemetryQueue.queueUrl,
    });

    new cdk.CfnOutput(this, 'DLQUrl', {
      value: dlq.queueUrl,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: telemetryProcessorFunction.functionArn,
    });

    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: telemetryTable.tableName,
    });
  }
}
