import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import axios from 'axios';
import { User } from "./types";

const GRIPTAPE_API_KEY = process.env.GRIPTAPE_API_KEY;
const GRIPTAPE_APP_ID = process.env.GRIPTAPE_APP_ID;
const GRIPTAPE_API_URL = process.env.GRIPTAPE_API_URL;
const GRIPTAPE_API_HEADERS = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GRIPTAPE_API_KEY}` };
const GRIPTAPE_API_SESSION_VAR = "GT_CLOUD_THREAD_ID";

const client = axios.create({ baseURL: GRIPTAPE_API_URL, headers: GRIPTAPE_API_HEADERS });

export interface GriptapeRequest {
    args: string[];
    sessionId?: string;
}

export async function createThread(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    let req = <User>await request.json();
    context.log(`Incoming create thread request: ${JSON.stringify(req)}`)
    const threadReq = {
        name: "dabotbyThread",
        metadata: {
            "type": "ConversationMemory",
        }
    }
    const res = await client.post(`/threads`, threadReq);
    req['session_id'] = res.data['thread_id'];

    return {
        jsonBody: req,
        status: res.status,
    };
}

export async function createRun(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const req = <GriptapeRequest>await request.json();
    context.log(`Incoming create run request: ${JSON.stringify(req)}`)
    const args = req.args.filter(arg => arg !== 'sessionId');

    const body = {
        args: req.args,
        env_vars: [
            {
                name: GRIPTAPE_API_SESSION_VAR,
                source: "manual",
                value: req.sessionId,
            }
        ]
    }

    const res = await client.post(`/structures/${GRIPTAPE_APP_ID}/runs`, body);
    let response = res.data;
    response['session_id'] = req['sessionId'];
    return {
        jsonBody: response,
        status: 202,
        headers: {
            'Retry-After': '5',
            'Location': `${request.url}/${res.data['structure_run_id']}`,
        },
    };
};

export async function getRun(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Incoming get run request: ${JSON.stringify(request)}`)

    const runId = request.params.runId;

    const res = await client.get(`/structure-runs/${runId}`);
    const data = res.data;

    return {
        jsonBody: data,
        status: (data["status"] === 'SUCCEEDED' || data["status"] === 'FAILED' || data['output']) ? 200 : 202,
        headers: {
            'Retry-After': '1',
            'Location': request.url,
        },
    };
};

app.http('griptapeCreateRun', {
    methods: ['POST'],
    route: 'runs',
    authLevel: 'anonymous',
    handler: createRun
});

app.http('griptapeGetRun', {
    methods: ['GET'],
    route: 'runs/{runId}',
    authLevel: 'anonymous',
    handler: getRun
});

app.http('griptapeCreateThread', {
    methods: ['POST'],
    route: 'threads',
    authLevel: 'anonymous',
    handler: createThread
});
