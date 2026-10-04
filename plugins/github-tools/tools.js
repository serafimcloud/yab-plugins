// Agent tools on GitHub's public REST API (api.github.com). Yab runs each
// tool in a blank realm; site.json(path) is a GET on api.github.com with no
// token, so these tools see public repositories only and share GitHub's
// anonymous rate limits (60 requests an hour, 10 searches a minute).

function repoPath(repo) {
  const value = String(repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value)) throw Error('Use a repository as owner/name, such as oven-sh/bun.');
  return value;
}

function login(user) {
  const value = String(user || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value)) throw Error('Use a GitHub login, such as octocat.');
  return value;
}

function pull(item) {
  return {
    title: item.title,
    repo: item.repository_url.replace('https://api.github.com/repos/', ''),
    number: item.number,
    author: item.user && item.user.login,
    updated: item.updated_at,
    draft: !!item.draft,
    url: item.html_url
  };
}

// Pull requests waiting on this person's review, and their own open pull
// requests still waiting for one.
export async function prs_needing_review(args, site) {
  const user = login(args.user);
  const limit = Math.max(1, Math.min(30, args.limit || 10));
  const search = query => site.json('/search/issues?sort=updated&order=desc&per_page=' + limit + '&q=' + encodeURIComponent(query));
  const asked = await search(`is:pr is:open archived:false draft:false review-requested:${user}`);
  const mine = await search(`is:pr is:open archived:false draft:false author:${user} review:required`);
  return {
    user,
    to_review: asked.items.map(pull),
    to_review_total: asked.total_count,
    mine_waiting: mine.items.map(pull),
    mine_waiting_total: mine.total_count,
    note: 'Public repositories only: api.github.com does not use your github.com sign-in.'
  };
}

// Whether the latest commit on a branch (the default branch unless named)
// passes its checks.
export async function ci_status(args, site) {
  const repo = repoPath(args.repo);
  let branch = args.branch && String(args.branch).trim();
  if (!branch) branch = (await site.json('/repos/' + repo)).default_branch;
  const ref = encodeURIComponent(branch);
  const commit = await site.json(`/repos/${repo}/commits/${ref}`);
  // Workflow runs, not check runs: a big repository's check runs for one
  // commit can exceed what a tool may read (2 MB).
  const actions = await site.json(`/repos/${repo}/actions/runs?head_sha=${commit.sha}&per_page=25&exclude_pull_requests=true`);
  const legacy = await site.json(`/repos/${repo}/commits/${commit.sha}/status`);
  let workflows = actions.workflow_runs || [];
  if (!workflows.length) {
    const checks = await site.json(`/repos/${repo}/commits/${commit.sha}/check-runs?per_page=20`);
    workflows = (checks.check_runs || []).map(run => ({ name: run.name, status: run.status, conclusion: run.conclusion, html_url: run.html_url }));
  }

  const failing = [], running = [];
  let passed = 0;
  const latest = new Map();
  for (const run of workflows) if (!latest.has(run.name)) latest.set(run.name, run);
  for (const run of latest.values()) {
    if (run.status !== 'completed') running.push(run.name);
    else if (['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(run.conclusion)) failing.push({ name: run.name, conclusion: run.conclusion, url: run.html_url });
    else passed++;
  }
  for (const status of legacy.statuses || []) {
    if (status.state === 'pending') running.push(status.context);
    else if (status.state === 'failure' || status.state === 'error') failing.push({ name: status.context, conclusion: status.state, url: status.target_url });
    else passed++;
  }
  const state = failing.length ? 'failing' : running.length ? 'running' : passed ? 'passing' : 'no checks';
  return {
    repo,
    branch,
    state,
    commit: {
      sha: commit.sha.slice(0, 7),
      message: String(commit.commit.message || '').split('\n')[0].slice(0, 140),
      author: commit.author ? commit.author.login : commit.commit.author.name,
      date: commit.commit.committer.date
    },
    passed,
    failing: failing.slice(0, 20),
    running: running.slice(0, 20),
    url: `https://github.com/${repo}/commits/${ref}`
  };
}

// A new-issue link with the title and body filled in. GitHub's API needs a
// token to create issues and Yab never hands tools one, so the person submits
// the prefilled form on github.com themselves.
export async function draft_issue(args, site) {
  const repo = repoPath(args.repo);
  const title = String(args.title || '').trim();
  if (!title) throw Error('An issue needs a title.');
  const info = await site.json('/repos/' + repo);
  if (!info.has_issues) return { repo, error: 'Issues are turned off for this repository.' };
  const query = new URLSearchParams({ title: title.slice(0, 256) });
  if (args.body) query.set('body', String(args.body).slice(0, 6000));
  if (Array.isArray(args.labels) && args.labels.length) query.set('labels', args.labels.map(String).slice(0, 10).join(','));
  return {
    repo: info.full_name,
    url: `https://github.com/${info.full_name}/issues/new?${query}`,
    next: 'Open this link: GitHub shows the filled-in form, and the person presses Create to file it. Nothing is filed until then.'
  };
}
