import { app, input, output, HttpHandler, HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';
import * as df from 'durable-functions';
import axios from 'axios';
import { User } from './types';

const GROUPME_API_TOKEN = process.env.GROUPME_API_TOKEN
const GROUPME_BOT_ID = process.env.GROUPME_BOT_ID
const GROUPME_USER_ID_FIELD = process.env.GROUPME_USER_ID_FIELD

const COSMOSDB_DATABASE_NAME = process.env.COSMOSDB_DATABASE_NAME
const COSMOSDB_CONTAINER_NAME = process.env.COSMOSDB_CONTAINER_NAME

const TRIGGER_PHRASE = process.env.TRIGGER_PHRASE

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const groupmeClient = axios.create({ baseURL: `https://api.groupme.com/v3`, params: { 'token': GROUPME_API_TOKEN }, headers: { 'Content-Type': 'application/json' } });

interface GroupmeMessage {
    attachments: unknown[];
    avatar_url: string;
    created_at: number;
    group_id: string;
    id: string;
    name: string;
    sender_id: string;
    sender_type: string;
    source_guid: string;
    system: boolean;
    text: string;
    user_id: string;
}

const cosmosInput = input.cosmosDB({
    databaseName: COSMOSDB_DATABASE_NAME,
    containerName: COSMOSDB_CONTAINER_NAME,
    sqlQuery: `SELECT * FROM c WHERE c.id = {${GROUPME_USER_ID_FIELD}}`,
    partitionKey: `{${GROUPME_USER_ID_FIELD}}`,
    connection: 'COSMOSDB_CONNECTION_STRING',
});

const cosmosOuput = output.cosmosDB({
    databaseName: COSMOSDB_DATABASE_NAME,
    containerName: COSMOSDB_CONTAINER_NAME,
    connection: 'COSMOSDB_CONNECTION_STRING',
});

const groupmeMessageHandler: HttpHandler = async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const body: GroupmeMessage = <GroupmeMessage>(await request.json());

    if (!body.text.startsWith(TRIGGER_PHRASE)) {
        context.log(`Message ${body.text} does not start with trigger, ignoring`);
        return {
            status: 200,
        };
    }

    let docs = <User[]>context.extraInputs.get(cosmosInput);
    context.log(`Docs: ${JSON.stringify(docs)}`);

    let user: User = docs.length >= 1 ? docs[0] : null;
    context.log(`User: ${user}`);

    if (!user) {
        user = {
            id: body.sender_id,
            name: body.name,
            session_id: '',
            updated_at: Date.now(),
        }
        body.text = "I am new! Nice to meet you. also: " + body.text;
        context.extraOutputs.set(cosmosOuput, user);
    }

    // strip trigger from body.text
    body.text = body.text.replace(TRIGGER_PHRASE, '');

    const client = df.getClient(context);
    const griptapeRequest = {
        args: [body.text],
    };
    // timeout the session if it's been more than 5 minutes since the last message
    if (user.session_id) {
        if (Date.now() - user.updated_at > SESSION_TIMEOUT_MS) {
            user.session_id = '';
        }
    }
    const input = {
        griptapeRequest: griptapeRequest,
        user: user,
        type: 'groupme',
    };
    await client.startNew("griptapeOrchestrator", { input: input });

    return {
        status: 202,
    }
};

app.http('groupmeMessageCallback', {
    route: 'groupme-message-callback',
    methods: ['POST'],
    extraInputs: [
        df.input.durableClient(),
        cosmosInput
    ],
    extraOutputs: [
        cosmosOuput
    ],
    handler: groupmeMessageHandler,
});

app.http('groupmeMessagePost', {
    route: 'message-post-groupme',
    methods: ['POST'],
    handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        // chunk the run output into 800 character chunks
        const req = await request.json()
        const user: User = req['user']
        const text = req['text']
        const numChunks = Math.ceil(text.length / 800)
        const chunks = new Array(numChunks)
    
        for (let i = 0, o = 0; i < numChunks; ++i, o += 800) {
            chunks[i] = text.substring(o, Math.min(o+800, text.length-1))
        }
        // send each chunk as a separate message to groupme
        for (let i = 0; i < chunks.length; i++) {
            let text;
            if (i == 0) {
                text = `@${user.name} ${chunks[i]}`
            } else {
                text = chunks[i]
            }
            const body = {
                "bot_id": GROUPME_BOT_ID,
                "text": text,
            }
            await groupmeClient.post('/bots/post', body);
        }
        return {
            status: 200,
        };
    }
});
