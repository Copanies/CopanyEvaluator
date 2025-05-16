/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { verify } from '@octokit/webhooks-methods';
import { Hono } from 'hono';
import jwt from '@tsndr/cloudflare-worker-jwt';
// import { verify } from '@octokit/webhooks-methods';
type Env = {
	GITHUB_WEBHOOK_SECRET: string;
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.text('Hono!'));

app.post('/github-webhook', async (c) => {
	console.log('Received GitHub webhook request');
	const body = await c.req.text();
	console.log('Request body:', body.substring(0, 200) + '...'); // Only print first 200 chars to avoid long logs
	const signature = c.req.header('x-hub-signature-256') || '';
	console.log('Signature:', signature);
	const secret = c.env.GITHUB_WEBHOOK_SECRET;
	7;

	const isValid = await verify(secret, body, signature);
	console.log('Signature verification result:', isValid);
	if (!isValid) {
		return c.text('Invalid signature', 401);
	}

	const payload = JSON.parse(body);
	console.log('Parsed payload:', payload);

	if (payload.action === 'closed' && payload.pull_request?.merged) {
		console.log('Processing merged PR');
		const installationId = payload.installation.id;
		console.log('Installation ID:', installationId);
		const prUrl = payload.pull_request.url;
		console.log('PR URL:', prUrl);

		// TODO: Get Installation Token -> Fetch PR diff -> Call AI
		// Generate JWT
		const now = Math.floor(Date.now() / 1000);
		const token = await jwt.sign(
			{
				iat: now,
				exp: now + 60,
				iss: c.env.GITHUB_APP_ID,
			},
			c.env.GITHUB_APP_PRIVATE_KEY,
			{ algorithm: 'RS256' }
		);

		// Get Installation Token
		console.log('Starting to fetch Installation Token...');
		const tokenResponse = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github.v3+json',
			},
		});
		const tokenData = (await tokenResponse.json()) as { token: string };
		console.log('Token response status:', tokenResponse.status);
		// Don't log the actual token, this is a security risk
		console.log('Received token data:', { hasToken: !!tokenData.token });
		const { token: installationToken } = tokenData;

		// Get PR diff
		const diffResponse = await fetch(prUrl, {
			headers: {
				Authorization: `Bearer ${installationToken}`,
				Accept: 'application/vnd.github.v3.diff',
			},
		});
		const diff = await diffResponse.text();

		// TODO: Call AI to analyze diff
		console.log('Merged PR:', prUrl, diff);

		return c.text('PR merged event received');
	}

	return c.text('Event ignored');
});

export default app;
