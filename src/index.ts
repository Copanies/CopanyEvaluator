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
	AI: Ai;
	GITHUB_WEBHOOK_SECRET: string;
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.text('Hono!'));

app.post('/github-webhook', async (c) => {
	// GitHub webhook documentation: https://docs.github.com/en/webhooks/webhook-events-and-payloads?actionType=synchronize#pull_request
	const body = await c.req.text();
	const signature = c.req.header('x-hub-signature-256') || '';
	const secret = c.env.GITHUB_WEBHOOK_SECRET;

	const isValid = await verify(secret, body, signature);
	console.log('Signature verification result:', isValid);
	if (!isValid) {
		return c.text('Invalid signature', 401);
	}

	const payload = JSON.parse(body);
	// console.log('Parsed payload:', payload);

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

			console.log('Merged PR:', prUrl);
			const diffStr = String(diffData);

			// 过滤自动生成代码
			function filterGeneratedCode(diff: string): string {
				// 分割成不同的文件变更块
				const diffBlocks = diff.split('diff --git');

				// 过滤掉自动生成的代码块
				const filteredBlocks = diffBlocks.filter((block) => {
					// 跳过空块
					if (!block.trim()) return false;

					// 解析文件名
					const fileNameMatch = block.match(/a\/([^\s]+) b\/([^\s]+)/);
					if (!fileNameMatch) return false;

					const fileName = fileNameMatch[2]; // 使用b/后面的文件名（修改后的文件）

					// 检查是否为自动生成的文件类型
					const isGenerated =
						/package(-lock)?\.json$/.test(fileName) ||
						/yarn\.lock$/.test(fileName) ||
						/\.min\.(js|css)$/.test(fileName) ||
						/\.rcuserdata$/.test(fileName) ||
						/\.xcuserstate$/.test(fileName) ||
						/\.(usdz|usda|usdc)$/.test(fileName) ||
						/\.drawing$/.test(fileName) ||
						/\.(png|jpg|jpeg|gif|svg|bmp|ico|tiff|webp)$/.test(fileName);
					// 内容判断（保留部分内容判断作为补充）
					// block.includes('// Generated by') ||
					// block.includes('/* Generated by') ||
					// block.includes('# Generated by') ||
					// block.includes('@generated') ||
					// block.includes('auto-generated') ||
					// block.includes('automatically generated');
					console.log(fileName, 'isGenerated:', isGenerated);
					return !isGenerated;
				});

				// 重新组合差异内容
				return filteredBlocks.length > 0 ? 'diff --git' + filteredBlocks.join('diff --git') : '没有找到非自动生成的代码改动';
			}

			const filteredDiffStr = filterGeneratedCode(diffStr);
			console.log('Filtered diff:', filteredDiffStr);

			const messages = [
				{
					role: 'system',
					content: `你是一个专业的项目分析师，请根据我之后提供给你的 Pull Request 的代码变更，帮我总结该 PR 的主要内容和意义。输出结构请遵循以下格式：
					【功能改动摘要】
					- 简要说明该 PR 实现了哪些功能或修复了哪些问题
					- 是否添加了新能力、对用户或产品是否有影响
					【技术改动摘要】
					- 代码结构发生了哪些变化（模块拆分、重构、性能优化等）
					- 涉及的技术难点与解决方式- 是否提升了代码质量（如注释、测试、重构）
					【潜在影响与价值】
					- 该 PR 改动是否影响核心功能- 是否大幅提升了系统性能、稳定性、可维护性
				`,
				},
				{
					role: 'user',
					content: `
					以下是 PR 的详细信息:
					PR的标题: ${prTitle};
					PR的描述: ${prDescription};
					PR的diff: ${filteredDiffStr};
				`,
				},
			];

			// const llama3_2_3b_instruct_response = await c.env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
			// 	messages,
			// 	max_tokens: 1024,
			// });
			// console.log('llama3_2_3b_instruct_response: $0.051 per M input tokens $0.34 per M output tokens', llama3_2_3b_instruct_response);

			const llama3_2_11b_vision_instruct_response = await c.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
				messages,
				max_tokens: 1024,
			});
			console.log(
				'llama3_2_11b_vision_instruct_response: $0.049 per M input tokens $0.68 per M output tokens',
				llama3_2_11b_vision_instruct_response
			);

			// const llama3_3_70b_instruct_fp8_fast_response = await c.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
			// 	messages,
			// 	max_tokens: 1024,
			// });
			// console.log(
			// 	'llama3_3_70b_instruct_fp8_fast_response: $0.29 per M input tokens $2.25 per M output tokens',
			// 	llama3_3_70b_instruct_fp8_fast_response
			// );

			// const llama4_scout_17b_16e_instruct_response = await c.env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
			// 	messages,
			// 	max_tokens: 1024,
			// });
			// console.log(
			// 	'llama4_scout_17b_16e_instruct_response: $0.27 per M input tokens $0.85 per M output tokens',
			// 	llama4_scout_17b_16e_instruct_response
			// );

			// const deepseek_r1_distill_qwen_32b_response = await c.env.AI.run('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', {
			// 	messages,
			// 	max_tokens: 1024,
			// });
			// console.log(
			// 	'deepseek_r1_distill_qwen_32b_response: $0.5 per M input tokens $4.88 per M output tokens',
			// 	deepseek_r1_distill_qwen_32b_response
			// );

			return c.text('PR merged event received');
		} catch (error: any) {
			console.error('Error processing webhook:', error);
			return c.text(`Error: ${error.message}`, 500);
		}
	}

	return c.text('Event ignored');
});

export default app;
