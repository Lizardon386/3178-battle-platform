import { readBootFrame, runAuthorityProcess } from '@bp/authority-runtime';
import { createReferenceAuthority } from './index.js';

const boot = await readBootFrame();

await runAuthorityProcess({
  boot,
  createRuntime: (transport) => createReferenceAuthority({
    stateDir: boot.stateDir,
    sessionId: boot.sessionId,
    epoch: boot.epoch,
    roundId: boot.roundId,
    members: boot.members,
    transport,
  }),
});
