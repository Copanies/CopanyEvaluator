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
import { Octokit } from '@octokit/rest';
import { Hono } from 'hono';
import jwt from '@tsndr/cloudflare-worker-jwt';

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
		const repoOwner = payload.repository.owner.login;
		const repoName = payload.repository.name;
		const pullNumber = payload.pull_request.number;

		// Generate JWT
		const now = Math.floor(Date.now() / 1000);

		// Handle private key - decode Base64 format
		let privateKey = c.env.GITHUB_APP_PRIVATE_KEY;
		try {
			privateKey = atob(privateKey);
		} catch (e) {
			console.error('Failed to decode private key, using original format:', e);
		}

		console.log('Attempting to sign with JWT');

		try {
			const token = await jwt.sign(
				{
					iat: now,
					exp: now + 60,
					iss: c.env.GITHUB_APP_ID,
				},
				privateKey,
				{ algorithm: 'RS256' }
			);

			// Create a temporary Octokit instance to get installation token
			console.log('Creating Octokit instance with JWT');
			const appOctokit = new Octokit({
				auth: token,
				userAgent: 'Copany-bot',
			});

			// Get installation token
			console.log('Getting installation token');
			const { data: tokenData } = await appOctokit.apps.createInstallationAccessToken({
				installation_id: installationId,
			});
			console.log('Received installation token:', { hasToken: !!tokenData.token });

			// Create a new Octokit instance with installation token
			console.log('Creating Octokit instance with installation token');
			const octokit = new Octokit({
				auth: tokenData.token,
				userAgent: 'Copany-bot',
			});

			// 首先获取PR的完整信息
			console.log('Getting PR details');
			const { data: prData } = await octokit.pulls.get({
				owner: repoOwner,
				repo: repoName,
				pull_number: pullNumber,
			});

			// 提取PR的重要信息
			const prTitle = prData.title;
			const prDescription = prData.body || '';
			const prAuthor = prData.user?.login;
			const prBaseRef = prData.base.ref;
			const prHeadRef = prData.head.ref;
			const prAdditions = prData.additions;
			const prDeletions = prData.deletions;
			const prChangedFiles = prData.changed_files;

			console.log('PR Title:', prTitle);
			console.log('PR Author:', prAuthor);
			console.log('PR Description preview:', prDescription.slice(0, 100) + (prDescription.length > 100 ? '...' : ''));
			console.log('PR Stats:', `${prChangedFiles} files changed, ${prAdditions} additions, ${prDeletions} deletions`);
			console.log('PR Branches:', `prHeadRef:${prHeadRef} → prBaseRef:${prBaseRef}`);

			// 然后获取PR差异
			console.log('Getting PR diff');
			const { data: diffData } = await octokit.pulls.get({
				owner: repoOwner,
				repo: repoName,
				pull_number: pullNumber,
				mediaType: {
					format: 'diff',
				},
			});

			// TODO: Call AI to analyze diff
			console.log('Merged PR:', prUrl);
			// Safely handle diffData regardless of its type
			const diffStr = String(diffData);
			console.log('Diff preview:', diffStr);

			return c.text('PR merged event received');
		} catch (error: any) {
			console.error('Error processing webhook:', error);
			return c.text(`Error: ${error.message}`, 500);
		}
	}

	return c.text('Event ignored');
});

export default app;
