import { APIGatewayProxyHandler } from 'aws-lambda';
import { SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

// Initialize DynamoDB Client
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// SQS Handler
export const sqsHandler: SQSHandler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const siteId = message.siteId;
    const body = message.body;

    if (!siteId || !body) {
      console.error('Missing required fields: siteId or body');
      continue;
    }

    const params = {
      TableName: process.env.TABLE_NAME!,
      Item: {
        siteId: siteId,
        ...body,
        timestamp: new Date().toISOString()
      }
    };

    try {
      await docClient.send(new PutCommand(params));
      console.info(`Successfully stored data for siteId: ${siteId}`);
    } catch (error) {
      console.error(`Error storing data for siteId: ${siteId}`, error);
    }
  }
};

// API Gateway Handler
export const apiGatewayHandler: APIGatewayProxyHandler = async (event, context) => {
  // Custom response logic
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Telemetry data processed successfully',
      requestId: context.awsRequestId,
      timestamp: new Date().toISOString()
    }),
  };
};
