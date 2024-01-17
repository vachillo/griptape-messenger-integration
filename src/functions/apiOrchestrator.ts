import { output, InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { ActivityHandler, OrchestrationContext, OrchestrationHandler } from 'durable-functions';
import { User } from './types';
import { GriptapeRequest } from './griptapeApiWrapper';

const WEBSITE_HOSTNAME = process.env.WEBSITE_HOSTNAME;
const GRIPTAPE_BASE_URL = `https://${WEBSITE_HOSTNAME}/api/runs`;

export interface Input {
    griptapeRequest: GriptapeRequest;
    user: User;
    type: string;
}

const cosmosOutput = output.cosmosDB({
    databaseName: 'matt-db',
    containerName: 'dabotby',
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
    context.log(`GRIPATE_BASE_URL: ${GRIPTAPE_BASE_URL}`);
    let griptapeRequest = input.griptapeRequest;
    const run_output = yield context.df.callHttp({
        method: 'POST',
        url: GRIPTAPE_BASE_URL,
        body: griptapeRequest,
        enablePolling: true,
    });
    const run = JSON.parse(run_output.content)
    context.log(`Run output: ${JSON.stringify(run)}`);
    yield context.df.callHttp({
        method: 'POST',
        url: `https://${WEBSITE_HOSTNAME}/api/message-post-${input.type}`,
        body: run['output']['value'],
        enablePolling: false,
    })

    if (!input.user.session_id) {
        input.user.session_id = run.session_id;
        yield context.df.callActivity('saveUserActivity', input)
    }
    return;
};
df.app.orchestration('griptapeOrchestrator', griptapeOrchestrator);
