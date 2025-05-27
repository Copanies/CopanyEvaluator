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

					return !isGenerated;
				});

				// 重新组合差异内容
				return filteredBlocks.length > 0 ? 'diff --git' + filteredBlocks.join('diff --git') : '没有找到非自动生成的代码改动';
			}

			console.log('Diff:', diffStr);
			const filteredDiffStr = filterGeneratedCode(diffStr);
			console.log('Filtered diff:', filteredDiffStr);

			const messages = [
				{
					role: 'system',
					content: `你是一个专业的开源项目审查助理，擅长评估 Pull Request(PR)对项目的实际贡献。  
				请根据以下维度对该 PR 进行分析并给出评分, 并输出详细解释:
				1. 功能价值（是否解决了重要需求或添加了关键功能）
				2. 技术复杂度（是否有技术挑战、模块间耦合、性能优化等）  
				3. 影响范围（是否影响了核心模块或项目整体架构）  
				4. 代码质量（是否提升了代码整洁性、可维护性、测试覆盖等）  
				5. 风险控制（是否存在潜在 bug 或部署难度）

				请返回一个JSON对象,包含以下字段:
				{
					"analysis": {
						"functionalValue": {
							"score": "number", // 总分(0-10)
							"reason": "string" // 功能价值评分理由
						},
						"technicalComplexity": {
							"score": "number", // 总分(0-10)
							"reason": "string" // 技术复杂度评分理由
						},
						"impactScope": {
							"score": "number", // 总分(0-10)
							"reason": "string" // 影响范围评分理由
						},
						"codeQuality": {
							"score": "number", // 总分(0-10)
							"reason": "string" // 代码质量评分理由
						},
						"riskControl": {
							"score": "number", // 总分(0-10)
							"reason": "string" // 风险控制评分理由
						}
					},
					"suggestion": "string" // 改进建议(可选)
				}
				`,
				},
				{
					role: 'user',
					content: `
				请分析以下PR:
				PR的标题: ${prTitle}
				PR的描述: ${prDescription}
				PR的作者: ${prAuthor}
				PR的PR链接: ${prUrl}
				PR的PR编号: ${pullNumber}
				PR的PR分支: ${prHeadRef}
				PR的PR分支: ${prBaseRef}
				PR的diff: ${filteredDiffStr}
				`,
				},
			];

			const ai_response = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages });
			console.log('AI response:', ai_response);

			return c.text('PR merged event received');
		} catch (error: any) {
			console.error('Error processing webhook:', error);
			return c.text(`Error: ${error.message}`, 500);
		}
	}

	return c.text('Event ignored');
});

export default app;
