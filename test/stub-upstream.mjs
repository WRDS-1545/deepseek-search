/**
 * 本地联调用的 DeepSeek 上游桩服务（仅用于开发 / 截图验收）。
 * 不参与正式运行，也不会产生任何 API 费用。
 *
 *   node test/stub-upstream.mjs
 *   DEEPSEEK_BASE_URL=http://127.0.0.1:8799 DEEPSEEK_API_KEY=sk-stub node server.js
 */
import http from 'node:http';

const PORT = Number(process.env.STUB_PORT || 8799);
const HOST = '127.0.0.1';

const RESULTS = [
  {
    rerank_score: 2.83,
    title: 'DeepSeek V4 正式发布：更长上下文与更强的工具调用',
    url: 'https://example.com/deepseek-v4-release',
    snippet:
      'DeepSeek V4 已正式上线，上下文窗口扩展至 1M tokens，原生支持工具调用、结构化输出与网页搜索，面向 Agent 场景进行了系统优化。',
    summary:
      'DeepSeek 发布 V4 系列模型。此次升级的重点包括更长的上下文窗口、更稳定的多轮工具调用、更低的首 token 延迟，以及面向搜索与 RAG 场景优化的结构化输出能力。官方表示，V4 在代码、数学与长文档理解等基准上均有明显提升，并同步开放 API 与开源权重。',
    content:
      'DeepSeek V4 正式发布\n\n今天我们发布 DeepSeek V4 系列模型，带来更强的推理能力、更长的上下文窗口与更稳定的工具调用表现。\n\n1. 上下文窗口扩展至 1M tokens\n2. 原生支持搜索、抓取与代码执行等工具\n3. 面向 Agent 工作流优化多轮决策\n\nAPI 已同步开放，开发者可以在开放平台直接调用。',
    site_name: 'DeepSeek 官方博客',
    site_icon: '',
    date: '2026-10-18T09:30:00+00:00',
    authority: 4,
  },
  {
    rerank_score: 2.66,
    title: '网页搜索 · DeepSeek API Docs',
    url: 'https://example.com/docs/search',
    snippet:
      'Search 接口按 query 搜索网页，返回结构化结果列表；支持 site:、-site:、引号、lang:、after:、before: 等搜索语法。',
    summary:
      'Search 与 Fetch 接口为 Agent 与 RAG 应用提供实时网页内容。Search 由 DeepSeek 自研搜索引擎提供支持，单次最多返回 50 条结果，包含相关度分数、权威度、发布时间、站点信息与可选网页正文。两者均使用 Bearer 鉴权。',
    content:
      '# 网页搜索\n\nPOST /v1/tools/search\n\n按 query 搜索网页，返回结构化的结果列表。\n\n- query：搜索词，1～128 个字符\n- count：返回条数，1～50，默认 10\n- need_content：是否返回网页正文\n\n结果字段包括 rerank_score、title、url、snippet、summary、content、site_name、site_icon、date 与 authority。',
    site_name: 'DeepSeek API Docs',
    site_icon: '',
    date: '2026-10-16T03:00:00+00:00',
    authority: 4,
  },
  {
    rerank_score: 2.41,
    title: 'deepseek-ai / DeepSeek-V4 · GitHub',
    url: 'https://example.com/github/deepseek-v4',
    snippet:
      'DeepSeek-V4 官方仓库：模型权重、推理代码、部署文档与 Issue 讨论。支持 vLLM、SGLang 与 Transformers。',
    summary:
      '官方 GitHub 仓库提供 DeepSeek-V4 的模型卡、推理示例与部署脚本。README 中给出了单机多卡与多机推理的推荐配置，并说明如何通过 OpenAI 兼容接口调用。社区已在仓库中提交大量关于量化、长上下文与工具调用的实践问题。',
    content: '',
    site_name: 'GitHub',
    site_icon: '',
    date: '2026-10-12T11:20:00+00:00',
    authority: 3,
  },
  {
    rerank_score: 2.18,
    title: 'DeepSeek Search API 将于 11 月 1 日开始计费',
    url: 'https://example.com/news/search-billing',
    snippet:
      'Search 与 Fetch 按成功请求次数计费：每 1,000 次 5 元，失败、无结果与超时均不计费。账号级 QPS 限制分别为 100 与 25。',
    summary:
      '根据最新公告，Search 与 Fetch 接口将按成功请求计费，单价为每 1,000 次 5 元，只有返回 HTTP 200 且产生结果的请求才会产生费用。Search 与 Fetch 的 QPS 限制相互独立，分别按账号维度计算。',
    content: '',
    site_name: 'DeepSeek 公告',
    site_icon: '',
    date: '2026-10-27T02:00:00+00:00',
    authority: 4,
  },
  {
    rerank_score: 1.97,
    title: 'DeepSeek V4 技术报告解读：MoE 架构、训练效率与评测',
    url: 'https://example.com/articles/v4-technical-report',
    snippet:
      '从稀疏专家、注意力机制到后训练流程，逐节拆解 V4 技术报告，并对比 V3 在推理成本上的变化。',
    summary:
      '文章对 V4 技术报告进行了系统解读：模型继续采用 MoE 稀疏架构，通过调整专家路由与训练数据配比，在保持推理成本可控的同时提升能力。作者还讨论了长上下文的实现细节，以及工具调用数据在後训练阶段的占比。',
    content: '',
    site_name: '机器之心',
    site_icon: '',
    date: '2026-10-09T07:45:00+00:00',
    authority: 3,
  },
  {
    rerank_score: 1.78,
    title: '如何用 DeepSeek Search API 构建一个 RAG 应用',
    url: 'https://example.com/posts/rag-with-deepseek-search',
    snippet:
      '从查询改写、调用 Search、重排到拼接上下文，手把手实现一个可用的检索增强生成流水线，并给出成本估算。',
    summary:
      '本文给出一个基于 Search API 的 RAG 实践：先用模型改写用户问题，再调用搜索接口获取摘要与正文，最后按权威度与相关度筛选上下文。文章还比较了「搜索时直接返回正文」与「按需调用 Fetch」两种策略的延迟和成本。',
    content: '',
    site_name: '掘金',
    site_icon: '',
    date: '2026-09-28T13:10:00+00:00',
    authority: 2,
  },
  {
    rerank_score: 1.62,
    title: 'DeepSeek-V4 模型卡与许可证说明',
    url: 'https://example.com/huggingface/deepseek-v4',
    snippet:
      '模型卡包含训练数据说明、推荐推理参数、已知限制与许可证条款，适用于研究与商业场景。',
    summary:
      'Hugging Face 模型卡列出了 V4 的参数量、上下文长度、分词器版本与推荐采样参数，并附有许可证常见问题。页面提醒使用者关注模型在事实性、时效性与高风险领域中的局限。',
    content: '',
    site_name: 'Hugging Face',
    site_icon: '',
    date: '2026-09-20T05:00:00+00:00',
    authority: 3,
  },
  {
    rerank_score: 1.31,
    title: '社区实测：DeepSeek V4 在 Agent 任务中的表现',
    url: 'https://example.com/community/v4-agent-review',
    snippet:
      '用 20 个真实任务对比 V4 与上一代模型的规划、工具调用成功率与恢复能力，附完整测试用例。',
    summary:
      '社区作者用一组 Agent 任务进行了对比测试，覆盖网页搜索、表单填写与多步数据处理。结果显示 V4 在工具选择与错误恢复上更稳定，但在超长任务中仍可能出现重复调用。测试脚本与原始日志已开源。',
    content: '',
    site_name: '知乎',
    site_icon: '',
    date: '2026-08-30T09:15:00+00:00',
    authority: 1,
  },
  {
    rerank_score: 1.05,
    title: '网页搜索接口常见错误码与重试策略',
    url: 'https://example.com/blog/search-api-errors',
    snippet:
      '整理 400、401、402、429 与 5xx 的触发原因，给出指数退避与幂等重试的示例代码。',
    summary:
      '文章梳理了 Search 与 Fetch 接口的错误码：400 表示请求参数不合法，401 表示鉴权失败，402 表示余额不足，429 表示触发 QPS 限制，5xx 则建议退避后重试。作者强调不要对未修改的 4xx 请求直接重试。',
    content: '',
    site_name: 'CSDN',
    site_icon: '',
    date: '2026-08-15T04:30:00+00:00',
    authority: 1,
  },
  {
    rerank_score: 0.86,
    title: '从零实现一个网页搜索前端：交互、分页与状态管理',
    url: 'https://example.com/posts/search-ui-from-scratch',
    snippet:
      '不依赖框架，用原生 JavaScript 实现搜索框、结果卡片、筛选排序与错误状态，讨论可访问性与性能细节。',
    summary:
      '一篇偏前端的教程，介绍如何设计搜索结果的层次结构、如何呈现权威度与时间信息，以及如何用 AbortController 处理并发请求。作者还分享了空状态、骨架屏与键盘操作的实现方式。',
    content: '',
    site_name: 'SegmentFault',
    site_icon: '',
    date: '2026-07-22T12:00:00+00:00',
    authority: 1,
  },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    json(res, 401, {
      error: { message: 'Authentication Fails (no such user)', type: 'authentication_error', param: null, code: 'invalid_api_key' },
    });
    return;
  }

  try {
    if (req.method === 'POST' && req.url === '/v1/tools/search') {
      const body = await readBody(req);
      const query = typeof body.query === 'string' ? body.query : '';
      const count = Math.min(50, Math.max(1, Number(body.count) || 10));

      if (!query.trim()) {
        json(res, 400, {
          error: { message: 'query is required', type: 'invalid_request_error', param: null, code: 'invalid_request_error' },
        });
        return;
      }

      const results = RESULTS.slice(0, count).map((item) => ({
        ...item,
        content: body.need_content ? item.content || `${item.summary}\n\n（桩数据：这是 ${item.site_name} 的示例正文内容。）` : '',
      }));

      setTimeout(() => json(res, 200, { results }), 260);
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/tools/fetch') {
      const body = await readBody(req);
      if (!body.url) {
        json(res, 400, {
          error: { message: 'url is required', type: 'invalid_request_error', param: null, code: 'invalid_request_error' },
        });
        return;
      }
      const matched = RESULTS.find((item) => item.url === body.url);
      setTimeout(
        () =>
          json(res, 200, {
            title: matched ? matched.title : '示例网页',
            content: `# ${matched ? matched.title : '示例网页'}\n\n这是来自桩服务的网页正文，用于验证 Fetch 接口在页面中的展示效果。\n\n- 来源：${body.url}\n- 生成时间：${new Date().toISOString()}\n\n正文结束。`,
          }),
        320,
      );
      return;
    }

    json(res, 404, { error: { message: 'not found', type: 'invalid_request_error', param: null, code: 'not_found' } });
  } catch {
    json(res, 400, {
      error: { message: 'invalid json body', type: 'invalid_request_error', param: null, code: 'invalid_request_error' },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[stub] DeepSeek upstream stub listening on http://${HOST}:${PORT}`);
});
