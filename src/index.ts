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

const DEV_GITHUB_APP_PRIVATE_KEY =
	'LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQpNSUlFcEFJQkFBS0NBUUVBeHEvcGRXU1l4QjhXdHdqbWZZYUNRZS9TTldEY1E4QkJzWm9Kd1pyczVrc3M4Tys3CnlUYVNPYmFGeXB2ZnpnK1h2akUxSjhFZ3VKUzltTjhQQ0N2dE5NbEliOHkwWDhHMzlERjU5S3ZyQ1pTcW96a3QKYzBsUkxkUTRRK01EY2hwbWErend3TjhTdk1ub2YxUllBdVNJQ1dYMlFQRmtaRjdQQVRDajZubTlPN2RyVkdSegpQdTZQRzRnalZwVzY4WXlSVFN6YzJUMkNQcGVkaFdFaG04VnZ4WmxpS2hCTFgvS3FEYkl3Wkc5RXZBRmVWWWhTCjJkY3d3WURRdzVkcVNBUVlHQXFFZG5PaHcxdXpvVFVwMkN5aVFzTTc3eEtCWVJjN2ZnbkZyamRicW13ZEIyUHIKY0lRck4zaVNDOUpJcXlOTkFVTmt5c0ZIeHZyYXNjQmZpSEdqNVFJREFRQUJBb0lCQUZ0V28weUVZblpHbEhxdwpiTVZvQUptdlZrT1RzNjZ4dzRHUi9zb3lIcFlBR1RqcC9Mb1RqRVZiMDBYQlFySElHVW9sOVBuQm52azc1NjFQClhlbXp4K2hzWUJDRldxWnF0OVphcUdZQ1lwcVU3Wno3dkJrenEwNFdNWWVENVNHZllWWmNKcEdEKzJrdXFPTmcKTXRXaG1hZzRaMnlUakVOWUVuSEptcEZBUmU0ZEpGNml1THgvTGVhbkI5ZkxxUytnMGFQc2QzMVZmQWNWRjh4agp5WW15Z0cvZjRWbE84cWtYWVQ2QVRlWDBYNlJVVEoweEhEanpzOEFJS1piWHY2dVNZajZ5dUVsMGRxMGRyRmpFClVyWGFYQkswcXJ5NTdsbys5eW9JRGFjdTBmYXlNdU9YMXdkY3NTY0xtbjhzdDJsZFFIekQ2TFBvUVFQaDVnc08KaWxKMjJFRUNnWUVBN2pUalM4dFZadlFNNDJmalB0dUVVQW14WHlQTVlVSnhvU0JpODkvRUtTZzZVYXE0ZVJoRApHdWVqU1hFNnJMN1pVbUh1M25UL3FKcU1DNmpVMmhPc3VmZTFtaWtZcFg0RVB0S0VZbVhBSW81YlV3eWxtN3VwCnFJcWc0dDRiSmdCRENTNUtSSCtzelIybkxUM2tmcUNNbThSclRzQXdUd0J0NnZvdFJHVXNmUnNDZ1lFQTFZZFEKQXlpZTZod255WWJ2WWlpMWN0aWpvdUJ0eVZNRFU4ekRRckZNWHpPN28yS0V1R0Z1ZkZaTzkzdXU1M0tXS1NzNQpRWFkrbk1rTUVuaHJva0lPRzRBQUtER0RPZnJ3TC9YVzRtcEtvVTlpNXJLSHVMOENrUnRpK1lZTHJucnpCY3V2CmhLLzF2Njc4ZWxSVFNsUmZJOExiVFhHY1dadHR1QUNLNXpIeGN2OENnWUVBcmxzajdEeWUvRWF5a0ZsZ2FvZi8KSng2Uko5UnFLdDZaa1pqRkZVQzZzbTF4a29sbGthMkNvTlRnSGtlMDdQQ2MzY0kxTjd0bnpwK2cxbi96bk5ROQozN2xDd2Q1RzNndUpTL3FIVUFhdVJoenhGNjd3SVRlUmpYNDdHUlA5eHlqMTZHaHJrQXZzRGc4Z2FPc2VydGtSClVvckpDTkdBQ3JPRHdUVHhvVmgwNGZVQ2dZQjhtNE5ZNUlxZ2FoL1ozakd5WWJsSnRSMEJQdUV5bkl3VGlpbmsKc0p5MTdmV3hLaHZ6a1lBdGRSeU9GaEtDcEg3MnRXK3JRUHJXK2doZWV3R3M1Y2xmeVBuT2V0NXVwbjhtTGR2aApzMCtzQlN6ZEhoQlFBci9YdUZpdzdzWEFZNldRbTBYcE05cEFxemhSbHdZb0dVYVFFdlZ4b3p3dm1xR1R3RlZQCkIvazBOd0tCZ1FERWIrcTVxK2ZKUzZOMUg2emRjQUNsODFYdTc5U0FLY3N6eHlwSlp0eUZ4ak4rVTBrbFcydTcKVUF5UzNSMmptMkd5MG50V2pVdlU2bWhoazVCRm1rWWxVbXdqOGIxQ2JDTGVha1FHMXgvREFyRktCMHliaXB5ZQp4cFJCc254TVNMQnhRZktRMFV6Qjd3NnF3VHhHM0xCeFBxSEhmWThSZnFqYllOSEo3ODdPV3c9PQotLS0tLUVORCBSU0EgUFJJVkFURSBLRVktLS0tLQo';
const DEV_GITHUB_APP_ID = '1324212';
const DEV_GITHUB_WEBHOOK_SECRET = 'MkkzFbeGTmfxMNa8c1WAPvkxZ2CvLRMk1fmAF25qdM8=';
const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.text('Hono!'));

app.post('/github-webhook', async (c) => {
	// GitHub webhook documentation: https://docs.github.com/en/webhooks/webhook-events-and-payloads?actionType=synchronize#pull_request
	const body = await c.req.text();
	const signature = c.req.header('x-hub-signature-256') || '';
	const secret = c.env.GITHUB_WEBHOOK_SECRET ? c.env.GITHUB_WEBHOOK_SECRET : DEV_GITHUB_WEBHOOK_SECRET;

	const isValid = await verify(secret, body, signature);
	console.log('Signature verification result:', isValid);
	if (!isValid) {
		return c.text('Invalid signature', 401);
	}

	const payload = JSON.parse(body);
	console.log('Parsed payload:', payload);

	if (payload.action === 'opened' || payload.action === 'reopened' || payload.action === 'synchronize') {
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
		let privateKey = c.env.GITHUB_APP_PRIVATE_KEY ? c.env.GITHUB_APP_PRIVATE_KEY : DEV_GITHUB_APP_PRIVATE_KEY;
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
					iss: c.env.GITHUB_APP_ID ? c.env.GITHUB_APP_ID : DEV_GITHUB_APP_ID,
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
