#!/usr/bin/env bun
import { Command } from 'commander';
import { registerAgent } from './commands/agent';
import { registerInit } from './commands/init';
import { registerProject } from './commands/project';
import { registerServe } from './commands/serve';
import { registerTeam } from './commands/team';

const program = new Command();

program
  .name('nightshift')
  .description('Define a team of AI agents and let them do the work.')
  .version('0.1.0');

registerInit(program);
registerAgent(program);
registerTeam(program);
registerProject(program);
registerServe(program);

program.parse();
