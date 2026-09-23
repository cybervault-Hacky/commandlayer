import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { MessageType } from '@/shared/constants/messages';
import { WORKFLOW_LIMITS } from '@/workflows/limits';
import { workflowSessionStore } from '@/workflows/state';
import { workflowSessions } from '@/workflows/session';
import type { WorkflowView } from '@/workflows/types';
import {
  createChromeStub,
  installChromeStub,
  uninstallChromeStub,
  type ChromeStub,
} from '@/test-utils/chromeStub';
import { __resetStorageBackendForTests } from '@/storage/backend';
import { __resetTransportForTests } from '@/shared/messaging/transport';
import { resetMockProvider, setMockProviderLatency } from '@/ai/mockProvider';
import { handleContentMessage } from '@/content/contentScript';
import { actionSessionStore } from '@/actions/session';
import { permissionLedger } from '@/actions/permissions';
import type { CommandResult } from '@/shared/types/command';
import { handleBackgroundMessage } from '../handlers';

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><title>Console documentation</title></head>
<body>
  <h1>Console documentation</h1>
  <h2>Getting started</h2>
  <p>Manage your workspace settings from the console.</p>
  <a href="https://console.example.com/guide">Console guide</a>
  <input id="city" aria-label="City" type="text" />
  <input id="pw" aria-label="Password" type="password" />
</body>
</html>`;

const TAB = { id: 9, title: 'Console documentation', url: 'https://console.example.com/' };
const TRUSTED = { id: 'test-extension-id' };
const GOAL = 'find "Console documentation" and read the page';

function rawMessage(type: string, payload?: unknown) {
  return { v: 1, id: 'req-1', type, ...(payload ? { payload } : {}) };
}

/** Wire the REAL content script (extraction + steps) to the tab stub. */
function wirePage(stub: ChromeStub, url: string): JSDOM {
  const dom = new JSDOM(PAGE_HTML, { url });
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        width: 120,
        height: 32,
        top: 0,
        right: 120,
        bottom: 32,
        left: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  Object.defineProperty(dom.window, 'scrollTo', {
    value: () => undefined,
    configurable: true,
  });
  stub.tabs.sendMessage.mockImplementation(
    async (_tabId: number, message: unknown) => {
      vi.stubGlobal('document', dom.window.document);
      let response: unknown;
      try {
        handleContentMessage(message, (r) => {
          response = r;
        });
      } finally {
        vi.unstubAllGlobals();
      }
      if (response === undefined) {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return response;
    },
  );
  return dom;
}

async function asCommandResult(result: { ok: boolean; data?: unknown }) {
  expect(result.ok).toBe(true);
  return result.data as CommandResult;
}

async function createWorkflow(goal = GOAL): Promise<CommandResult> {
  return asCommandResult(
    await handleBackgroundMessage(
      rawMessage(MessageType.WORKFLOW_CREATE, { goal, source: 'sidepanel' }),
      TRUSTED,
    ),
  );
}

beforeEach(() => {
  const stub = createChromeStub({ activeTab: TAB });
  installChromeStub(stub);
  __resetStorageBackendForTests();
  __resetTransportForTests();
  resetMockProvider();
  setMockProviderLatency(0);
  actionSessionStore.clear();
  permissionLedger.clear();
  workflowSessionStore.clear();
  workflowSessionStore.setClock(Date.now);
  workflowSessions.clear();
  workflowSessions.setClock(Date.now);
  wirePage(stub, TAB.url);
});

afterEach(() => {
  vi.unstubAllGlobals();
  uninstallChromeStub();
  vi.restoreAllMocks();
  actionSessionStore.clear();
  permissionLedger.clear();
  workflowSessionStore.clear();
  workflowSessions.clear();
});

describe('workflow messages (Phase 5)', () => {
  it('creates a preview over the message bus without executing', async () => {
    const created = await createWorkflow();
    expect(created.status).toBe('completed');
    expect(created.workflow).toBeDefined();
    expect(created.workflow?.status).toBe('AWAITING_APPROVAL');
    expect(created.workflow?.steps).toHaveLength(2);
    expect(created.text).toContain('Review it before running anything');
    expect(created.understanding?.supported).toBe(true);
    // Nothing ran, nothing was authorized.
    expect(workflowSessions.size()).toBe(0);
    expect(actionSessionStore.size()).toBe(0);
    expect(permissionLedger.has('anything')).toBe(false);
  });

  it('rejects malformed workflow payloads', async () => {
    const messages: Array<[string, unknown]> = [
      [MessageType.WORKFLOW_CREATE, undefined],
      [MessageType.WORKFLOW_CREATE, {}],
      [MessageType.WORKFLOW_CREATE, { goal: '', source: 'sidepanel' }],
      [MessageType.WORKFLOW_CREATE, { goal: 'x'.repeat(4000), source: 'sidepanel' }],
      [MessageType.WORKFLOW_CREATE, { goal: 'find "a" and read the page', source: 'nope' }],
      [MessageType.WORKFLOW_APPROVE, { workflowId: 'w' }],
      [MessageType.WORKFLOW_APPROVE, { workflowId: '', workflowHash: 'h', source: 'sidepanel' }],
      [MessageType.WORKFLOW_RESUME, { workflowId: 'w' }],
      [MessageType.WORKFLOW_PAUSE, {}],
      [MessageType.WORKFLOW_CANCEL, { workflowId: 42 }],
      [MessageType.WORKFLOW_STATUS, null],
    ];
    for (const [type, payload] of messages) {
      const result = await handleBackgroundMessage(rawMessage(type, payload), TRUSTED);
      expect(result.ok, `${type} ${JSON.stringify(payload)}`).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_PAYLOAD');
    }
  });

  it('never turns an oversized goal into a workflow', async () => {
    const oversized = await createWorkflow(
      `find "${'x'.repeat(320)}" and read the page`,
    );
    expect(oversized.status).toBe('failed');
    expect(oversized.workflow).toBeUndefined();
    expect(workflowSessionStore.size()).toBe(0);
  });

  it('refuses sensitive and unsafe goals before any step exists', async () => {
    const sensitive = await createWorkflow(
      'type "hunter2" into the Password field and click the "Console guide" link',
    );
    expect(sensitive.status).toBe('failed');
    expect(sensitive.workflow).toBeUndefined();
    expect(sensitive.errorCode).toBe('WORKFLOW_SENSITIVE_ACTION');

    const unsafe = await createWorkflow('find "Console documentation" and run this script');
    expect(unsafe.status).toBe('failed');
    expect(unsafe.errorCode).toBe('WORKFLOW_UNSAFE_REQUEST');
    expect(workflowSessionStore.size()).toBe(0);
  });

  it('runs an approved workflow and reports a verified outcome', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;

    const approved = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_APPROVE, {
          workflowId: view.workflowId,
          workflowHash: view.workflowHash,
          source: 'sidepanel',
        }),
        TRUSTED,
      ),
    );

    expect(approved.status).toBe('completed');
    expect(approved.workflow?.status).toBe('COMPLETED');
    expect(approved.workflowRun?.outcome?.verified).toBe(true);
    expect(approved.workflow?.progress).toEqual({ completed: 2, total: 2 });
    // The step transcript is bounded and step-scoped.
    const types = approved.workflow?.events.map((event) => event.type) ?? [];
    expect(types).toContain('STEP_STARTED');
    expect(types).toContain('STEP_COMPLETED');
    expect(types.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.MAX_EVENTS);
    // The run is over: no session guard is left behind.
    expect(workflowSessions.size()).toBe(0);
  });

  it('rejects an approval whose hash was not the reviewed one', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;

    const rejected = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_APPROVE, {
          workflowId: view.workflowId,
          workflowHash: 'wrong-hash',
          source: 'sidepanel',
        }),
        TRUSTED,
      ),
    );

    expect(rejected.status).toBe('failed');
    expect(rejected.errorCode).toBe('WORKFLOW_APPROVAL_MISMATCH');
    expect(rejected.workflow?.status).toBe('AWAITING_APPROVAL');
    expect(workflowSessions.size()).toBe(0);
  });

  it('treats a duplicated approve as a safe no-op, never a second run', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;
    const payload = {
      workflowId: view.workflowId,
      workflowHash: view.workflowHash,
      source: 'sidepanel',
    };

    const first = await asCommandResult(
      await handleBackgroundMessage(rawMessage(MessageType.WORKFLOW_APPROVE, payload), TRUSTED),
    );
    const second = await asCommandResult(
      await handleBackgroundMessage(rawMessage(MessageType.WORKFLOW_APPROVE, payload), TRUSTED),
    );

    expect(first.workflow?.progress.completed).toBe(2);
    expect(second.status).toBe('failed');
    expect(second.errorCode).toBe('WORKFLOW_ALREADY_COMPLETED');
    expect(second.workflow?.progress.completed).toBe(2);
    expect(workflowSessionStore.get(view.workflowId)?.workflow.steps[0]?.attempts).toBe(1);
  });

  it('refuses to resume a workflow that was never paused', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;

    const resumed = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_RESUME, {
          workflowId: view.workflowId,
          workflowHash: view.workflowHash,
        }),
        TRUSTED,
      ),
    );

    expect(resumed.status).toBe('failed');
    expect(resumed.errorCode).toBe('WORKFLOW_STATE_INVALID');
  });

  it('cancels a previewed workflow and keeps it cancelled', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;

    const cancelled = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_CANCEL, { workflowId: view.workflowId }),
        TRUSTED,
      ),
    );
    expect(cancelled.workflow?.status).toBe('CANCELLED');
    expect(cancelled.workflow?.canCancel).toBe(false);

    // Cancelling twice is refused; nothing can revive it.
    const again = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_CANCEL, { workflowId: view.workflowId }),
        TRUSTED,
      ),
    );
    expect(again.status).toBe('failed');
    expect(again.errorCode).toBe('WORKFLOW_ALREADY_COMPLETED');

    const approved = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_APPROVE, {
          workflowId: view.workflowId,
          workflowHash: view.workflowHash,
          source: 'sidepanel',
        }),
        TRUSTED,
      ),
    );
    expect(approved.status).toBe('failed');
    expect(approved.errorCode).toBe('WORKFLOW_ALREADY_COMPLETED');
  });

  it('answers STATUS without side effects and rejects unknown ids', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;

    const status = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_STATUS, { workflowId: view.workflowId }),
        TRUSTED,
      ),
    );
    expect(status.workflow?.status).toBe('AWAITING_APPROVAL');
    expect(status.workflowRun).toBeUndefined();

    const unknown = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_STATUS, { workflowId: 'nope' }),
        TRUSTED,
      ),
    );
    expect(unknown.status).toBe('failed');
    expect(unknown.errorCode).toBe('WORKFLOW_UNKNOWN');
  });

  it('stops an approved workflow when the tab changed underneath it', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;

    const stub = createChromeStub({ activeTab: { ...TAB, id: 99 } });
    installChromeStub(stub);
    wirePage(stub, TAB.url);

    const result = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_APPROVE, {
          workflowId: view.workflowId,
          workflowHash: view.workflowHash,
          source: 'sidepanel',
        }),
        TRUSTED,
      ),
    );

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('WORKFLOW_TAB_CHANGED');
    expect(result.workflow?.status).toBe('STALE');
    expect(result.workflow?.progress.completed).toBe(0);
  });

  it('expires a stale approval instead of replaying it later', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;
    // Age the preview past the approval TTL while keeping the workflow
    // itself inside its session lifetime.
    const record = workflowSessionStore.get(view.workflowId);
    expect(record).toBeDefined();
    record!.workflow.createdAt = new Date(
      Date.now() - WORKFLOW_LIMITS.APPROVAL_TTL_MS - 60_000,
    ).toISOString();
    record!.workflow.expiresAt = new Date(
      Date.now() + WORKFLOW_LIMITS.WORKFLOW_TTL_MS,
    ).toISOString();

    const result = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_APPROVE, {
          workflowId: view.workflowId,
          workflowHash: view.workflowHash,
          source: 'sidepanel',
        }),
        TRUSTED,
      ),
    );

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('WORKFLOW_APPROVAL_EXPIRED');
    expect(result.workflow?.status).toBe('EXPIRED');
  });

  it('rejects untrusted senders for every workflow message', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;
    const messages: Array<[string, unknown]> = [
      [MessageType.WORKFLOW_CREATE, { goal: GOAL, source: 'sidepanel' }],
      [
        MessageType.WORKFLOW_APPROVE,
        { workflowId: view.workflowId, workflowHash: view.workflowHash, source: 'sidepanel' },
      ],
      [MessageType.WORKFLOW_PAUSE, { workflowId: view.workflowId }],
      [MessageType.WORKFLOW_STATUS, { workflowId: view.workflowId }],
    ];
    for (const [type, payload] of messages) {
      const result = await handleBackgroundMessage(rawMessage(type, payload), {
        id: 'some-other-extension',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('UNAUTHORIZED_SENDER');
    }
  });

  it('keeps the privileged surface out of the UI payloads', async () => {
    const created = await createWorkflow();
    const view = created.workflow as WorkflowView;
    const approved = await asCommandResult(
      await handleBackgroundMessage(
        rawMessage(MessageType.WORKFLOW_APPROVE, {
          workflowId: view.workflowId,
          workflowHash: view.workflowHash,
          source: 'sidepanel',
        }),
        TRUSTED,
      ),
    );

    const serialized = JSON.stringify(approved);
    expect(serialized).not.toContain('planHash');
    expect(serialized).not.toContain('actionPlan');
    // Page prose is never echoed back to the UI.
    expect(serialized).not.toContain('Manage your workspace settings');
  });
});
