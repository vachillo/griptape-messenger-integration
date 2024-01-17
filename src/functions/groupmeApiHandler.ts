import { app, input, output, HttpHandler, HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';
import * as df from 'durable-functions';
import axios from 'axios';
import { User } from './types';

const GROUPME_API_TOKEN = process.env.GROUPME_API_TOKEN || 'GROUPME_API_TOKEN not set';
const GROUPME_BOT_ID = process.env.GROUPME_BOT_ID || 'GROUPME_BOT_ID not set';

const TRIGGER = "@dabotby ";
const REGISTER = `${TRIGGER}lets go`

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
    databaseName: 'matt-db',
    containerName: 'dabotby',
    sqlQuery: 'SELECT * FROM c WHERE c.id = {sender_id}',
    partitionKey: '{sender_id}',
    connection: 'COSMOSDB_CONNECTION_STRING',
});

const cosmosOuput = output.cosmosDB({
    databaseName: 'matt-db',
    containerName: 'dabotby',
    connection: 'COSMOSDB_CONNECTION_STRING',
});

const groupmeMessageHandler: HttpHandler = async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const body: GroupmeMessage = <GroupmeMessage>(await request.json());
    context.log(`Incoming message: ${JSON.stringify(body)}`);

    if (!body.text.startsWith(TRIGGER)) {
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
        body.text = body.text.replace(REGISTER, '');
        body.text = "give me a haiku because you're my new friend. also: " + body.text;
        context.extraOutputs.set(cosmosOuput, user);
    }

    // strip trigger from body.text
    body.text = body.text.replace(TRIGGER, '');

    const client = df.getClient(context);
    const griptapeRequest = {
        args: [body.text],
    };
    if (user.session_id) {
        if (Date.now() - user.updated_at > SESSION_TIMEOUT_MS) {
            user.session_id = '';
        } else {
            griptapeRequest['sessionId'] = user.session_id;
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
        const text = await request.text()
        const numChunks = Math.ceil(text.length / 800)
        const chunks = new Array(numChunks)
    
        for (let i = 0, o = 0; i < numChunks; ++i, o += 800) {
            chunks[i] = text.substring(o, Math.min(o+800, text.length-1))
        }
        // send each chunk as a separate message to groupme
        for (const chunk of chunks) {
            const body = {
                "bot_id": GROUPME_BOT_ID,
                "text": chunk,
            }
            await groupmeClient.post('/bots/post', body);
        }
        return {
            status: 200,
        };
    }
});
