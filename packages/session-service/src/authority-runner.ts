import { runAuthorityModule } from '@bp/authority-runtime';

/** 平台 runner：由 Supervisor 以独立子进程启动，加载 module 模型游戏的 createAuthority。 */
const modulePath = process.argv[2];
if (!modulePath) {
  console.error('用法：authority-runner <模块入口>');
  process.exit(2);
}

runAuthorityModule(modulePath).catch((error) => {
  console.error(error);
  process.exit(1);
});
