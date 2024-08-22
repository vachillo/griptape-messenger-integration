import { output, InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { ActivityHandler, OrchestrationContext, OrchestrationHandler } from 'durable-functions';
import { User } from './types';
import { GriptapeRequest } from './griptapeApiWrapper';

const WEBSITE_HOSTNAME = process.env.WEBSITE_HOSTNAME;
const FUNCTIONS_BASE_URL = `${process.env.IS_LOCAL === "true" ? 'http' : 'https'}://${WEBSITE_HOSTNAME}/api`;
const GRIPTAPE_WRAPPER_BASE_URL = `${FUNCTIONS_BASE_URL}`;

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

const saveUserActivity: ActivityHandler = async function (user: User, context: InvocationContext): Promise<object> {
    context.log(`Saving user activity: ${JSON.stringify(user)}`);
    user.updated_at = Date.now();
    context.extraOutputs.set(cosmosOutput, user);
    return {};
}
df.app.activity('saveUserActivity', {
    handler: saveUserActivity,
    extraOutputs: [cosmosOutput],
});

const griptapeOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
    const input: Input = context.df.getInput<Input>();
    if (!input.user.session_id) {
        const userResponse = yield context.df.callHttp({
            method: 'POST',
            url: `${GRIPTAPE_WRAPPER_BASE_URL}/threads`,
            body: input.user,
            enablePolling: false,
        });
        const user = JSON.parse(userResponse.content)
        yield context.df.callActivity('saveUserActivity', user);
        input.user.session_id = user.session_id;
    }
    let griptapeRequest = input.griptapeRequest;
    griptapeRequest.sessionId = input.user.session_id;
    const run_output = yield context.df.callHttp({
        method: 'POST',
        url: `${GRIPTAPE_WRAPPER_BASE_URL}/runs`,
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
            text: run['output'] ? run['output']['value'] : "Sorry, I didn't understand that",
        },
        enablePolling: false,
    })
    return;
};
df.app.orchestration('griptapeOrchestrator', griptapeOrchestrator);
