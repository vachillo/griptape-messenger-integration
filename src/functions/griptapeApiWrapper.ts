import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import axios from 'axios';


const GRIPTAPE_API_KEY = process.env.GRIPTAPE_API_KEY;
const GRIPTAPE_APP_ID = process.env.GRIPTAPE_APP_ID;
const GRIPTAPE_API_URL = `https://api.cloud-preview.griptape.ai`;
const GRIPTAPE_API_HEADERS = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GRIPTAPE_API_KEY}` };
const client = axios.create({ baseURL: GRIPTAPE_API_URL, headers: GRIPTAPE_API_HEADERS });

export interface GriptapeRequest {
    args: string[];
    sessionId?: string;
}

export async function createRun(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const req = <GriptapeRequest>await request.json();
    context.log(`Incoming create run request: ${req}`)

    const body = {
        args: req['args'],
    }
    if (req.sessionId) {
        body['session_id'] = req.sessionId;
    }

    const res = await client.post(`/apps/${GRIPTAPE_APP_ID}/runs`, body);
    context.log(`Griptape response: ${JSON.stringify(res.data)}`);

    return {
        jsonBody: res.data,
        status: 202,
        headers: {
            'Retry-After': '5',
            'Location': `${request.url}/${res.data['run_id']}`,
        },
    };
};

export async function getRun(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Incoming get run request: ${JSON.stringify(request)}`)

    const runId = request.params.runId;

    const res = await client.get(`/runs/${runId}`);
    const data = res.data;
    context.log(`Griptape response: ${JSON.stringify(data)}`);

    return {
        jsonBody: data,
        status: (data["status"] === 'SUCCEEDED' || data["status"] === 'FAILED') ? 200 : 202,
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
