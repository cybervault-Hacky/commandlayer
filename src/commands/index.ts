import { CommandDispatcher } from './dispatcher';

export * from './dispatcher';
export * from './requests';

let dispatcher: CommandDispatcher | null = null;

/** Process-wide dispatcher singleton (stateless, safe to reuse). */
export function getCommandDispatcher(): CommandDispatcher {
  if (!dispatcher) dispatcher = new CommandDispatcher();
  return dispatcher;
}
