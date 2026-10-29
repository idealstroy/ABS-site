// Resolver for the REP directives used by this project (Allow/Disallow, * and $).
// Clean-param and Sitemap are metadata, not crawl restrictions.
export const parseRobots = (text) => {
  const groups = [];
  const sitemaps = [];
  const errors = [];
  let current;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) { errors.push(`robots.txt:${index + 1}: invalid directive`); continue; }
    const [, name, value] = match;
    const key = name.toLowerCase();
    if (key === 'user-agent') {
      if (!current || current.rules.length || current.cleanParams.length) {
        current = { agents: [], rules: [], cleanParams: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (key === 'sitemap') {
      sitemaps.push(value);
    } else if (['allow', 'disallow'].includes(key)) {
      if (!current) errors.push(`robots.txt:${index + 1}: rule without User-agent`);
      else if (value) {
        if (!value.startsWith('/')) errors.push(`robots.txt:${index + 1}: path must start with /`);
        current.rules.push({ allow: key === 'allow', path: value });
      }
    } else if (key === 'clean-param') {
      if (!current) errors.push(`robots.txt:${index + 1}: Clean-param without group`);
      else current.cleanParams.push(value);
    } else errors.push(`robots.txt:${index + 1}: unsupported directive ${name}`);
  }
  return { groups, sitemaps, errors };
};

export const canCrawl = (policy, agent, url) => {
  const token = agent.toLowerCase();
  const scored = policy.groups.map(group => ({ group, score: Math.max(-1, ...group.agents.map(name => name === '*' ? 0 : token.includes(name) ? name.length : -1)) }));
  const best = Math.max(-1, ...scored.map(item => item.score));
  const rules = scored.filter(item => item.score === best && best >= 0).flatMap(item => item.group.rules);
  const parsed = new URL(url, 'https://abs-engineer.ru');
  const target = parsed.pathname + parsed.search;
  const matches = rules.filter(rule => {
    const end = rule.path.endsWith('$');
    const path = end ? rule.path.slice(0, -1) : rule.path;
    const expression = path.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${expression}${end ? '$' : ''}`).test(target);
  });
  if (!matches.length) return true;
  const length = Math.max(...matches.map(rule => rule.path.replaceAll('*', '').replace(/\$$/, '').length));
  return matches.filter(rule => rule.path.replaceAll('*', '').replace(/\$$/, '').length === length).some(rule => rule.allow);
};
