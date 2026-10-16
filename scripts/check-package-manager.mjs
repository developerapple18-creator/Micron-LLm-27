const manager = process.env.npm_config_user_agent || '';
if (!manager.startsWith('pnpm/')) {
  console.error('Install this workspace with pnpm.');
  process.exitCode = 1;
}
