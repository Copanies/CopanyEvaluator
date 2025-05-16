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
	const body = await c.req.text();
	const signature = c.req.header('x-hub-signature-256') || '';
	const secret = c.env.GITHUB_WEBHOOK_SECRET;
	7;

	const isValid = await verify(secret, body, signature);
	if (!isValid) {
		return c.text('Invalid signature', 401);
	}

	const payload = JSON.parse(body);
	console.log(payload);

	if (payload.action === 'closed' && payload.pull_request?.merged) {
		const installationId = payload.installation.id;
		const prUrl = payload.pull_request.url;

		// TODO: 获取 Installation Token -> 拉 PR diff -> 调用 AI
		// 生成 JWT
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

		// 获取 Installation Token
		const tokenResponse = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github.v3+json',
			},
		});
		const { token: installationToken } = (await tokenResponse.json()) as { token: string };

		// 获取 PR diff
		const diffResponse = await fetch(prUrl, {
			headers: {
				Authorization: `Bearer ${installationToken}`,
				Accept: 'application/vnd.github.v3.diff',
			},
		});
		const diff = await diffResponse.text();

		// TODO: 调用 AI 分析 diff
		console.log('Merged PR:', prUrl, diff);

		return c.text('PR merged event received');
	}

	return c.text('Event ignored');
});

export default app;
