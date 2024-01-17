import { output, InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { ActivityHandler, OrchestrationContext, OrchestrationHandler } from 'durable-functions';
import { User } from './types';
import { GriptapeRequest } from './griptapeApiWrapper';

const WEBSITE_HOSTNAME = process.env.WEBSITE_HOSTNAME;
const FUNCTIONS_BASE_URL = `${process.env.IS_LOCAL === "true" ? 'http' : 'https'}://${WEBSITE_HOSTNAME}/api`;
const GRIPTAPE_WRAPPER_BASE_URL = `${FUNCTIONS_BASE_URL}/runs`;

const COSMOSDB_DATABASE_NAME = process.env.COSMOSDB_DATABASE_NAME;
const COSMOSDB_CONTAINER_NAME = process.env.COSMOSDB_CONTAINER_NAME;

export interface Input {
    griptapeRequest: GriptapeRequest;
    user: User;
    type: string;
}

const cosmosOutput = output.cosmosDB({
    databaseName: COSMOSDB_DATABASE_NAME,
    containerName: COSMOSDB_CONTAINER_NAME,
    connection: 'COSMOSDB_CONNECTION_STRING',
})

const saveUserActivity: ActivityHandler = async function (input: Input, context: InvocationContext): Promise<object> {
    context.log(`User input: ${JSON.stringify(input)}`);
    input.user.updated_at = Date.now();
    context.extraOutputs.set(cosmosOutput, input.user);
    return {};
}
df.app.activity('saveUserActivity', {
    handler: saveUserActivity,
    extraOutputs: [cosmosOutput],
});

const griptapeOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
    const input: Input = context.df.getInput<Input>();
    context.log(`orch Input: ${JSON.stringify(input)}`);
    let griptapeRequest = input.griptapeRequest;
    const run_output = yield context.df.callHttp({
        method: 'POST',
        url: GRIPTAPE_WRAPPER_BASE_URL,
        body: griptapeRequest,
        enablePolling: true,
    });
    const run = JSON.parse(run_output.content)
    context.log(`Run output: ${JSON.stringify(run)}`);
    yield context.df.callHttp({
        method: 'POST',
        url: `${FUNCTIONS_BASE_URL}/message-post-${input.type}`,
        body: {
            user: input.user,
            text: run['output']['value']
        },
        enablePolling: false,
    })

    if (!input.user.session_id) {
        input.user.session_id = run.session_id;
        yield context.df.callActivity('saveUserActivity', input)
    }
    return;
};
df.app.orchestration('griptapeOrchestrator', griptapeOrchestrator);
