// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SuperAgentChat, SuperAgentChatSummary, SuperAgentResourceCatalog } from '../../../shared/super-agent';
import { NearScreenIntersectionObserver } from '../hooks/intersectionObserverTestUtils';
import { I18nProvider } from '../i18n/I18n';
import { translate } from '../i18n/messages';
import { ApplicationHeader } from '../motion/ApplicationChrome';
import { communityGames } from '../motion/game/gameCatalog';
import { WorkspaceChromeContext } from '../motion/WorkspaceChromeContext';
import { SUPER_AGENT_API } from '../../../shared/super-agent';
import { buildSuperAgentHandoff } from '../../../shared/capability-hub';
import { queueSuperAgentHandoff } from '../motion/superAgentHandoff';
import { clampSuperAgentViewerWidth, SuperAgentWorkspace } from './SuperAgentWorkspace';
import { ExecutionTimeline, formatElapsedDuration, SuperAgentLiveProgressDock } from './ExecutionTimeline';
import { SimpleMarkdown } from './SimpleMarkdown';
import { DEFAULT_MODE_COMPOSER_OPTIONS, getModeComposerPlaceholder } from './ModeComposerControls';
import { SUPER_AGENT_MODES } from './ModeResourceShowcase';
import { clearSuperAgentCache, peekCachedSuperAgentChat } from './superAgentClient';
import { designClient } from '../design/designClient';
import { setClientCacheOverrideForTest } from '../utils/clientCacheMode';
import { setFollowUpBehavior } from '../utils/superAgentPreferences';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../motion/WebBrowser', async () => {
  const React = await import('react');
  const WebBrowser = React.forwardRef(function MockWebBrowser(
    { url, onState }: { url: string; onState?: (state: any) => void },
    ref: React.ForwardedRef<any>,
  ) {
    const imgRef = React.useRef<HTMLImageElement>(null);
    React.useEffect(() => {
      onState?.({
        url,
        title: 'Local App',
        canGoBack: true,
        canGoForward: false,
        loading: false,
        colorScheme: 'auto',
        zoom: 1,
        consoleCount: 0,
        errorCount: 0,
      });
    }, [url]);
    React.useImperativeHandle(ref, () => ({
      command: async (action: string, value?: unknown) => ({
        url,
        title: 'Local App',
        canGoBack: true,
        canGoForward: false,
        loading: false,
        colorScheme: action === 'set-color-scheme' ? value : 'auto',
        zoom: action === 'set-zoom' && typeof value === 'number' ? value : 1,
        consoleCount: 0,
        errorCount: 0,
      }),
      inspectAt: async () => ({
        element: {
          tagName: 'button',
          selector: '#hero-btn',
          label: 'Launch',
          htmlPreview: '<button id="hero-btn">Launch</button>',
          styles: { display: 'inline-flex', backgroundColor: 'rgb(0, 0, 0)' },
          rect: { x: 40, y: 50, width: 120, height: 40 },
          viewport: { width: 1280, height: 800 },
          pageUrl: url,
          componentName: 'HeroButton',
          sourceFile: 'src/HeroButton.tsx',
          sourceLine: 24,
        },
        viewport: { width: 1280, height: 800 },
        pageUrl: url,
        pageTitle: 'Local App',
      }),
      screenshot: async () => ({
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
        width: 1280,
        height: 800,
        pageUrl: url,
        pageTitle: 'Local App',
      }),
      getViewport: () => ({ width: 1280, height: 800 }),
      getRenderedImage: () => imgRef.current,
      clearConsole: async () => undefined,
    }));
    return (
      <div data-testid="mock-web-browser">
        <img ref={imgRef} alt={url} />
        {url}
      </div>
    );
  });
  return { WebBrowser };
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  close() {}
}

const CHAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const sampleResources: SuperAgentResourceCatalog = {
  counts: {
    assets: 2,
    brandKits: 1,
    officialBrandKits: 152,
    motionTemplates: 10,
    designTemplates: 20,
    skills: 5,
    designSkills: 4,
    designProjects: 1,
    motionProjects: 1,
    mediaProvidersAvailable: 1,
  },
  generatedAt: Date.now(),
  items: [
    {
      id: 'dproj-1',
      kind: 'design-project',
      title: 'Neon Arcade',
      subtitle: 'prototype',
      scenario: 'prototype',
      previewUrl: '/motion-api/design/raw/dproj-1/index.html',
    },
    {
      id: 'asset-img-1',
      kind: 'asset',
      title: 'Hero Backdrop',
      subtitle: 'image',
      modality: 'image',
      versionId: 'v1',
      previewUrl: '/motion-api/assets/asset-img-1/versions/v1/media',
    },
    {
      id: 'catalog:vercel',
      kind: 'brand-kit',
      title: 'Vercel',
      subtitle: 'Developer Tools · Official Brand Kit',
      swatches: ['#000000', '#ffffff'],
    },
  ],
};

const sampleChat: SuperAgentChat = {
  id: CHAT_ID,
  title: 'Neon Arcade Build',
  engine: 'codex',
  model: 'gpt-5',
  permissionMode: 'on-request',
  createdAt: 1000,
  updatedAt: 2000,
  state: 'waiting',
  messages: [
    {
      id: 'm1',
      role: 'user',
      text: 'Build me a playable neon game',
      createdAt: 1001,
      attachments: [sampleResources.items[2]],
    },
    {
      id: 'm2',
      role: 'tool',
      text: 'openmotion_design_project: Neon Arcade',
      createdAt: 1002,
      toolEvent: {
        callId: 'c1',
        tool: 'openmotion_design_project',
        label: 'Created HTML design project',
        status: 'completed',
        summary: 'Neon Arcade',
        artifactId: 'design:dproj-1',
        startedAt: 1002,
        finishedAt: 1003,
      },
    },
    {
      id: 'm3',
      role: 'assistant',
      text: 'Created **Neon Arcade** for you.',
      createdAt: 1004,
    },
  ],
  artifacts: [
    {
      id: 'design:dproj-1',
      kind: 'design-project',
      title: 'Neon Arcade',
      subtitle: 'prototype',
      projectId: 'dproj-1',
      scenario: 'prototype',
      entry: 'index.html',
      revision: 'rev-1',
      url: '/motion-api/design/raw/dproj-1/index.html?rev=rev-1',
      createdAt: 1003,
      updatedAt: 1003,
    },
    {
      id: 'asset:asset-img-1:v1',
      kind: 'asset-image',
      title: 'Hero Backdrop',
      subtitle: 'image',
      assetId: 'asset-img-1',
      versionId: 'v1',
      url: '/motion-api/assets/asset-img-1/versions/v1/media',
      downloadUrl: '/motion-api/assets/asset-img-1/versions/v1/media?download=1',
      createdAt: 1005,
      updatedAt: 1005,
    },
  ],
  activeArtifactId: 'design:dproj-1',
  approvals: [
    {
      id: 'appr-1',
      kind: 'generation',
      title: 'Generate media asset',
      detail: '{"prompt":"neon spaceship"}',
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalFetch = globalThis.fetch;
  originalEventSource = globalThis.EventSource;
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({
        agents: [
          {
            id: 'codex',
            label: 'Codex',
            icon: 'codex',
            installed: true,
            auth: 'signed-in',
            models: [{ id: 'gpt-5', label: 'GPT-5', reasoning: ['low', 'medium', 'high'] }],
          },
        ],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json(sampleResources);
    }
    if (url === `${SUPER_AGENT_API}/chats`) {
      const summaries: SuperAgentChatSummary[] = [
        {
          id: CHAT_ID,
          title: sampleChat.title,
          engine: 'codex',
          state: sampleChat.state,
          artifactCount: sampleChat.artifacts.length,
          messageCount: 2,
          updatedAt: sampleChat.updatedAt,
          createdAt: sampleChat.createdAt,
        },
      ];
      return json({ conversations: summaries });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}` && (!init?.method || init.method === 'GET')) {
      return json({ conversation: sampleChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}` && init?.method === 'PATCH') {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      return json({ conversation: { ...sampleChat, ...body } });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}/approve` && init?.method === 'POST') {
      const next: SuperAgentChat = { ...sampleChat, state: 'running', approvals: [] };
      return json({ conversation: next });
    }
    if (url === '/motion-api/design/projects/dproj-1') {
      return json({
        project: {
          id: 'dproj-1',
          title: 'Neon Arcade',
          scenario: 'prototype',
          entry: 'index.html',
          designSystemId: null,
          templateId: null,
          source: 'blank',
          createdAt: 1000,
          updatedAt: 2000,
          trashedAt: null,
          revision: 'rev-1',
          versionId: null,
          versionLabel: null,
          files: [{ path: 'index.html', size: 120, sha256: 'abc', kind: 'html' }],
          path: '/tmp/dproj-1',
          previewUrl: '/motion-api/design/raw/dproj-1/index.html',
          editorUrl: '/?page=design',
          openComments: 0,
        },
      });
    }
    if (url === '/motion-api/design/projects/dproj-1/files/index.html') {
      return json({ path: 'index.html', content: '<!doctype html><canvas id="game"></canvas>', revision: 'rev-1', size: 42, nextOffset: null });
    }
    return json({});
  }) as any;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('motion.super-agent.read-result.')) localStorage.removeItem(key);
  }
  globalThis.fetch = originalFetch;
  (globalThis as any).EventSource = originalEventSource;
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 10));
  });
}

function getComposerEditor(rootEl: ParentNode = container): HTMLElement {
  return rootEl.querySelector<HTMLElement>('.om-sa-composer .om-sa-composer-editor')!;
}

async function typeInComposer(editor: HTMLElement, text: string, options?: { clear?: boolean }) {
  await act(async () => {
    editor.focus();
    await Promise.resolve();
    if (options?.clear) {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      await Promise.resolve();
    }
    // Sync happy-dom DOM selection to the end of the last paragraph/text node so Lexical's onInput matches the active node
    const doc = editor.ownerDocument;
    const sel = doc.getSelection();
    if (sel) {
      const walker = doc.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let lastText: Node | null = null;
      let cur = walker.nextNode();
      while (cur) {
        if (!cur.parentElement?.closest('.om-sa-inline-mention')) lastText = cur;
        cur = walker.nextNode();
      }
      const p = editor.querySelector('p:last-of-type') ?? editor;
      const range = doc.createRange();
      if (lastText) {
        const prev = lastText.textContent ?? '';
        lastText.textContent = `${prev}${text}`;
        range.setStart(lastText, prev.length + text.length);
      } else {
        range.setStart(p, p.childNodes.length);
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
    }
    editor.dispatchEvent(
      new InputEvent('input', {
        inputType: 'insertText',
        data: text,
        bubbles: true,
      }),
    );
    await Promise.resolve();
  });
}

it('renders Super Agent empty home, opens Resource Picker, and applies selected attachments to the composer', async () => {
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  expect(document.body.textContent).toContain('What can I create for you?');
  expect(container.querySelector('.om-sa-home-hero + .om-sa-starter-grid')).toBeTruthy();
  expect(container.querySelector('.om-sa-stream > .om-sa-messages + .om-sa-composer-wrap .om-sa-composer-editor')).toBeTruthy();
  expect([...container.querySelectorAll('.om-sa-starter-card strong')].map(node => node.textContent)).toEqual([
    'Build a game', 'Design Studio', 'Motion graphics', 'Make a video', 'Create slides', 'Explore more',
  ]);

  // No standalone Resources entry button in the stream header
  const standaloneResBtn = [...document.querySelectorAll('.om-sa-stream-head button')].find(
    b => b.getAttribute('aria-label') === 'Resources',
  );
  expect(standaloneResBtn).toBeUndefined();

  // Open resources directly via the composer plus icon and click a resource to attach it straight into the composer
  const plusBtn = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === 'Attach workspace resources',
  ) as HTMLButtonElement;
  expect(plusBtn).toBeTruthy();
  await act(async () => plusBtn.click());
  await flush();

  await vi.waitFor(async () => {
    await flush();
    const row = [...document.querySelectorAll('.om-sa-mention-row')].find(
      b => b.textContent?.includes('Neon Arcade'),
    );
    expect(row).toBeTruthy();
  }, { timeout: 3000 });
  const neonRow = [...document.querySelectorAll('.om-sa-mention-row')].find(
    b => b.textContent?.includes('Neon Arcade'),
  ) as HTMLButtonElement;
  expect(neonRow).toBeTruthy();
  await act(async () => neonRow.click());
  await flush();

  expect(document.querySelector('.om-sa-composer .om-sa-inline-mention')?.textContent).toContain('Neon Arcade');
});

it('keeps background task status in one slot and shows a dot only for an unread result', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const task: SuperAgentChatSummary = {
    id: CHAT_ID,
    title: 'Background task',
    intent: 'game',
    engine: 'codex',
    pinned: true,
    state: 'running',
    artifactCount: 1,
    messageCount: 2,
    lastTurnId: 'turn-1',
    updatedAt: 1000,
    createdAt: 1000,
  };
  const fallbackFetch = globalThis.fetch;
  const getTask = vi.fn(() => new Response(JSON.stringify({
    conversation: {
      ...sampleChat, ...task, artifacts: [], approvals: [],
      requestReceipts: [{ requestId: task.lastTurnId, inputHash: 'test' }],
    },
  })));
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === `${SUPER_AGENT_API}/chats`) return new Response(JSON.stringify({ conversations: [task] }));
    if (url === `${SUPER_AGENT_API}/chats/${task.id}`) return getTask();
    return fallbackFetch(input, init);
  };

  const onChatIdChange = vi.fn();
  const render = (chatId: string | null, key = 'workspace', active = true) => act(async () => {
    root.render(
      <I18nProvider key={key} initialLocale="en">
        <SuperAgentWorkspace
          active={active}
          chatId={chatId}
          onChatIdChange={onChatIdChange}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });

  try {
    clearSuperAgentCache();
    setClientCacheOverrideForTest(true);
    await render(null);
    const pinnedRow = () => container.querySelector<HTMLButtonElement>('.om-sa-chat-group[aria-label="Pinned"] .om-sa-chat-row-btn')!;
    const row = pinnedRow();
    const status = row.lastElementChild!;
    expect(status.matches('.om-sa-chat-status[data-state="running"]')).toBe(true);
    expect(status.querySelector('[data-remix-icon="loader-4-line"]')).toBeTruthy();
    expect(row.querySelector('.om-sa-chat-dot')).toBeNull();
    expect(row.querySelector('.om-sa-chat-count')).toBeNull();

    task.state = 'waiting';
    task.updatedAt++;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(status.matches('.om-badge[data-state="waiting"]')).toBe(true);
    expect(status.textContent).toBe('Approval needed');
    expect(peekCachedSuperAgentChat(CHAT_ID)?.state).toBe('waiting');
    expect(status.querySelector('svg')).toBeNull();
    expect(row.querySelector('.om-sa-chat-dot')).toBeNull();

    task.state = 'idle';
    task.updatedAt++;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(row.lastElementChild).toBe(status);
    expect(status.getAttribute('data-state')).toBe('completed');
    expect(peekCachedSuperAgentChat(CHAT_ID)?.state).toBe('idle');
    expect(status.querySelector('.om-sa-chat-dot')).toBeTruthy();
    expect(status.querySelector('svg')).toBeNull();
    expect(row.querySelector('.om-sa-chat-icon-wrap .om-sa-chat-dot')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(getTask).toHaveBeenCalledTimes(2);
    await render(null, 'workspace', false);
    await render(null);
    expect(pinnedRow().querySelector('.om-sa-chat-dot')).toBeTruthy();
    expect(getTask).toHaveBeenCalledTimes(2);
    clearSuperAgentCache();
    setClientCacheOverrideForTest(null);

    await act(async () => row.click());
    expect(onChatIdChange).toHaveBeenCalledWith(CHAT_ID);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await render(CHAT_ID);
    expect(pinnedRow().querySelector('.om-sa-chat-dot')).toBeTruthy();
    hidden.mockReturnValue(false);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(pinnedRow().querySelector('.om-sa-chat-dot')).toBeNull();

    task.title = 'Renamed task';
    task.updatedAt++;
    await render(null, 'reloaded');
    expect(pinnedRow().querySelector('.om-sa-chat-dot')).toBeNull();

    task.lastTurnId = 'turn-2';
    task.updatedAt++;
    await render(null, 'new-result');
    expect(pinnedRow().querySelector('.om-sa-chat-dot')).toBeTruthy();

    task.state = 'failed';
    task.updatedAt++;
    await render(CHAT_ID, 'stopped-result');
    expect(pinnedRow().querySelector('.om-sa-chat-status-badge[data-state="failed"]')?.textContent).toBe('Stopped');
    expect(container.querySelector('.om-sa-head-status-badge')?.textContent).toBe('Stopped');
    expect(pinnedRow().querySelector('.om-sa-chat-dot')).toBeNull();
  } finally {
    clearSuperAgentCache();
    setClientCacheOverrideForTest(null);
    vi.useRealTimers();
  }
});

it('localizes creation mode introductions, prompt ideas, and composer guidance in Chinese', () => {
  const t = (key: string) => translate('zh-CN', key);
  for (const mode of SUPER_AGENT_MODES) {
    const copy = [
      t(mode.label),
      t(mode.title),
      ...(mode.subtitle ? [t(mode.subtitle)] : []),
      getModeComposerPlaceholder(mode, DEFAULT_MODE_COMPOSER_OPTIONS, t),
      ...mode.quickIdeas.flatMap(idea => [t(idea.title), t(idea.prompt)]),
    ];
    for (const label of copy) expect(label).toMatch(/[\u3400-\u9fff]/u);
  }
});

it('shows Chinese image controls and keeps the draft when switching creation modes', async () => {
  const onChangeRequestedMode = vi.fn();
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="zh-CN">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="image"
          onChangeRequestedMode={onChangeRequestedMode}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  expect(container.querySelector('.om-sa-mode-hero-copy h2')?.textContent).toBe('从视觉大片到交互 HTML，一站式设计');
  expect(container.querySelector('[role="tablist"]')?.textContent).toContain('文生图');
  expect(container.querySelector('[role="tablist"]')?.textContent).toContain('多图融合');
  const example = container.querySelector<HTMLButtonElement>('.om-sa-showcase-card')!;
  expect(example.textContent).toContain('GPT Image 2.6 · 图片');
  const composer = getComposerEditor(container);
  expect(composer.getAttribute('data-placeholder')).toBe('描述你想生成的海报、插画、产品视觉图或参考修图需求…');
  await act(async () => example.click());
  expect(composer.textContent).toMatch(/[\u3400-\u9fff]/u);

  const qualityTrigger = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-composer-top-pill')].find(
    btn => btn.textContent?.includes('1×'),
  )!;
  await act(async () => qualityTrigger.click());

  const parameters = document.querySelector('.om-sa-mode-popover[role="dialog"]');
  expect(parameters?.textContent).toContain('质量');
  expect(parameters?.textContent).toContain('高');
  expect(parameters?.textContent).toContain('生成数量');
  expect(parameters?.textContent).toContain('高级参数');
  const paramPills = [...(parameters?.querySelectorAll('.om-sa-popover-pill') ?? [])].map(el => el.textContent?.trim());
  for (const count of ['1', '2', '4']) expect(paramPills).toContain(count);

  await act(async () => qualityTrigger.click());
  const draft = composer.textContent;
  const modeSelect = container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="创作模式"]')!;
  expect(modeSelect.textContent).toBe('设计工作室');
  await act(async () => modeSelect.click());
  const modes = [...document.querySelectorAll<HTMLElement>('.om-sa-creation-mode-menu [role="option"]')];
  expect(modes.map(option => option.textContent)).toEqual([
    '游戏工作室', '设计工作室', '动态视频', '深度研究', '数据可视化', '音频与音效', '电影镜头', '编程任务',
  ]);
  const audio = modes.find(option => option.textContent === '音频与音效')!;
  await act(async () => audio.click());
  expect(onChangeRequestedMode).toHaveBeenCalledWith('audio');
  expect(container.querySelector('.om-sa-stream')?.getAttribute('data-mode')).toBe('audio');
  expect(modeSelect.textContent).toBe('音频与音效');
  expect(composer.textContent).toBe(draft);
});

it.each(['motion', 'media'] as const)('keeps the %s dropdown limited to video models and supports editable templates', async requestedMode => {
  const fallbackFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === '/motion-api/models/capabilities') {
      return new Response(JSON.stringify({ routes: { video: 'fixture-video' }, providers: [] }));
    }
    if (url.startsWith('/motion-api/models?')) {
      return new Response(JSON.stringify({
        models: [
          { id: 'alternate-video', modelId: 'alternate-video', label: 'Alternate Video', provider: 'fixture', modality: 'video', mode: 'text-to-video' },
          { id: 'fixture-video', modelId: 'fixture-video', label: 'Fixture Video', provider: 'fixture', modality: 'video', mode: 'text-to-video' },
        ],
        nextOffset: null,
      }));
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return new Response(JSON.stringify({
        ...sampleResources,
        items: [{ id: 'motion-template', kind: 'motion-template', title: 'Editable timeline' }],
      }));
    }
    return fallbackFetch(input, init);
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode={requestedMode}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  const bar = container.querySelector('.om-sa-composer-top-bar')!;
  const engineTrigger = () => bar.querySelectorAll<HTMLButtonElement>('.om-sa-composer-top-pill')[0];
  const parameters = () => container.querySelector('.om-sa-mode-param-trigger')?.textContent;

  if (requestedMode === 'motion') {
    expect(bar.querySelectorAll('.om-sa-composer-top-pill')).toHaveLength(1);
    expect(engineTrigger().textContent).toContain('Motion graphics');
    expect(parameters()).toContain('30fps');
    await act(async () => engineTrigger().click());
    await flush();
    const aiVideoPill = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-popover-pill')].find(
      b => b.textContent?.includes('AI Video'),
    )!;
    expect(aiVideoPill).toBeTruthy();
    await act(async () => aiVideoPill.click());
    await flush();
  }

  expect(engineTrigger().textContent).toContain('AI Video');
  const modelTrigger = () => bar.querySelectorAll<HTMLButtonElement>('.om-sa-composer-top-pill')[1];
  const label = () => modelTrigger().querySelector('.om-sa-composer-top-pill-label')?.textContent;
  expect(label()).toBe('Fixture Video');
  expect(modelTrigger().hasAttribute('data-active')).toBe(true);
  expect(modelTrigger().querySelector('.om-sa-mode-param-avatar .om-avatar')).toBeTruthy();

  await act(async () => modelTrigger().click());
  const options = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-mode-model-row')];
  expect(options.map(option => option.querySelector('strong')?.textContent)).toEqual(['Auto (Recommended)', 'Alternate Video', 'Fixture Video']);
  expect(options[0].getAttribute('aria-selected')).toBe('true');

  await act(async () => options[1].click());
  expect(label()).toBe('Alternate Video');
  expect(bar.textContent).toContain('5s');

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Attach workspace resources"]')!.click());
  await vi.waitFor(async () => {
    await flush();
    expect([...document.querySelectorAll('.om-sa-mention-row')].some(r => r.textContent?.includes('Editable timeline'))).toBe(true);
  }, { timeout: 3000 });
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('.om-sa-mention-row')].find(r => r.textContent?.includes('Editable timeline'))!.click();
  });
  expect(engineTrigger().textContent).toContain('Motion graphics');
  expect(parameters()).toContain('30fps');
});

it('displays active conversation, tool steps, approvals, and multi-tab Artifact Viewer with Preview/Code switching', async () => {
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  expect(container.querySelector('.om-sa-stream > .om-sa-messages + .om-sa-composer-wrap .om-sa-composer-editor')).toBeTruthy();

  // Artifact Viewer stays closed by default on initial load / refresh and opens manually
  expect(document.querySelector('.om-sa-viewer')).toBeNull();
  const viewerToggle = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === 'Artifact Viewer',
  ) as HTMLButtonElement;
  expect(viewerToggle).toBeTruthy();
  await act(async () => viewerToggle.click());
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-viewer iframe')).toBeTruthy();
  }, { timeout: 5000 });

  const viewer = document.querySelector('.om-sa-viewer')!;
  const iframe = viewer.querySelector('iframe');
  expect(iframe?.getAttribute('src')).toContain('/motion-api/design/raw/dproj-1/index.html');

  // Switch Design Project Artifact to Code view via the compact icon dropdown and verify CodeViewer renders index.html
  const viewModeBtn = viewer.querySelector('.om-sa-view-mode-trigger') as HTMLButtonElement;
  expect(viewModeBtn).toBeTruthy();
  await act(async () => viewModeBtn.click());
  await flush();
  const codeBtn = [...document.querySelectorAll('.om-sa-view-mode-popover button')].find(b => b.textContent?.trim() === 'Code') as HTMLButtonElement;
  expect(codeBtn).toBeTruthy();
  await act(async () => codeBtn.click());
  await flush();
  expect(viewer.textContent).toContain('<canvas id="game"></canvas>');

  // Click second artifact tab (Hero Backdrop image)
  const imgTab = [...viewer.querySelectorAll('[role="tab"]')].find(t => t.textContent?.includes('Hero Backdrop')) as HTMLButtonElement;
  await act(async () => imgTab.click());
  await flush();
  expect(viewer.querySelector('.om-sa-image-checkerboard img')?.getAttribute('src')).toContain('/motion-api/assets/asset-img-1');

  // Approve pending action
  const approveBtn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Approve') as HTMLButtonElement;
  expect(approveBtn).toBeTruthy();
  await act(async () => approveBtn.click());
  await flush();
  expect(document.querySelector('.om-sa-approval')).toBeNull();
});

it('renders Super Agent inside the top navigation bar beside MCP and activates it on click', async () => {
  const onOpenPage = vi.fn();
  const noop = () => {};
  const chromeValue: any = {
    workspace: { status: 'ready', busy: false, error: '', errorSource: null, activeProjectId: 'p1', projects: [], open: noop, clearError: noop },
    switchingDisabled: false,
    saveState: '',
    registerEditor: noop,
    beforeViewChange: async () => {},
    openLibrary: noop,
    openConnections: noop,
    openModelSettings: noop,
    openProviderSettings: noop,
    openAccountSettings: noop,
    openSubscriptionSettings: noop,
    openHome: noop,
    openAssets: noop,
    assetsOpen: false,
    openSkills: noop,
    skillsOpen: false,
    toggleSidebar: noop,
    sidebarOpen: false,
    navigationCollapsed: false,
    projectNavigation: null,
    settingsOpen: false,
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <WorkspaceChromeContext.Provider value={chromeValue}>
          <ApplicationHeader
            atExploreHome
            onSkill={noop}
            settings={null}
            openSettings={noop}
            openAsset={noop}
            onCommunity={noop}
            onChooseStudio={noop}
            currentPage="agent"
            trackingPage="explore"
            onOpenPage={onOpenPage}
            onOpenAgentStart={noop}
            destination={null}
            motionActive={false}
            onNavigate={noop}
          />
        </WorkspaceChromeContext.Provider>
      </I18nProvider>,
    );
  });

  expect(document.querySelector('.om-mode-switcher')).toBeNull();
  const nav = document.querySelector('nav.om-creative-navigation')!;
  expect(nav).toBeTruthy();
  const agentBtn = nav.querySelector('button.om-super-agent-nav-link') as HTMLButtonElement;
  expect(agentBtn).toBeTruthy();
  expect(agentBtn.getAttribute('aria-current')).toBe('page');

  await act(async () => agentBtn.click());
  expect(onOpenPage).toHaveBeenCalledWith('agent');
});

it('suspends active viewer iframes when inactive, uses throttled thumb previews in game showcase, and releases web tabs on close', async () => {
  const flush = () => act(async () => { await Promise.resolve(); });
  const webChat: SuperAgentChat = {
    ...sampleChat,
    artifacts: [
      ...sampleChat.artifacts,
      {
        id: 'web:example',
        kind: 'web',
        title: 'Example Web',
        url: 'https://example.com',
        createdAt: 1006,
        updatedAt: 1006,
      },
    ],
  };

  const baseFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
  const deleteCalls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE' && url.includes('/browser/')) {
      deleteCalls.push(url);
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}` && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ conversation: webChat }), { status: 200 });
    }
    return baseFetch(input, init);
  });

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // Open Artifact Viewer manually, then verify active workspace renders the Design project iframe.
  const viewerToggle = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === 'Artifact Viewer',
  ) as HTMLButtonElement;
  expect(viewerToggle).toBeTruthy();
  await act(async () => viewerToggle.click());
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-viewer iframe')).toBeTruthy();
  }, { timeout: 5000 });

  // Deactivating SuperAgentWorkspace suspends the heavy viewer iframe while preserving tabs.
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active={false}
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('.om-sa-viewer iframe')).toBeNull();
  expect(document.querySelectorAll('.om-sa-viewer [role="tab"]').length).toBeGreaterThanOrEqual(2);

  // Returning to active restores the iframe cleanly and closing the web tab deletes its server session.
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('.om-sa-viewer iframe')).toBeTruthy();

  const webTab = [...document.querySelectorAll('.om-sa-viewer-tab')].find(tab => tab.textContent?.includes('Example Web'));
  expect(webTab).toBeTruthy();
  const closeTabBtn = webTab!.querySelector<HTMLButtonElement>('.om-sa-viewer-tab-close')!;
  await act(async () => closeTabBtn.click());
  await flush();
  expect(deleteCalls.some(url => url.endsWith('/browser/web-example'))).toBe(true);

  // Opening a new conversation & clicking Build a website uses ScaledPreviewThumb (?thumb=1) instead of raw unthrottled iframes.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return new Response(
        JSON.stringify({
          ...sampleResources,
          items: [
            {
              id: 'proto-landing',
              kind: 'design-template',
              title: 'Interactive Landing',
              subtitle: 'prototype',
              scenario: 'prototype',
              previewUrl: '/motion-api/design/catalog/templates/proto-landing/preview/index.html',
            },
          ],
        }),
        { status: 200 },
      );
    }
    return baseFetch(input, init);
  });

  vi.stubGlobal('IntersectionObserver', NearScreenIntersectionObserver);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={null}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await flush();

    const moreBtn = [...document.querySelectorAll('button')].find(
      b => b.textContent?.includes('Explore more'),
    )!;
    await act(async () => moreBtn.click());
    await flush();

    const webBtn = [...document.querySelectorAll('button')].find(
      b => b.textContent?.includes('Build a website'),
    )!;
    await act(async () => webBtn.click());
    await flush();
    await flush();

    const thumb = document.querySelector('.om-sa-showcase-iframe-wrap .om-design-card-thumb');
    expect(thumb).toBeTruthy();
    expect(thumb!.querySelector('iframe')?.getAttribute('src')).toContain('?thumb=1');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('clamps Artifact Viewer width against docked sidebar and center stream across viewport widths', () => {
  // 1280px screen with 240px docked sidebar + 1px resizer leaves 1039px; min center 300px caps viewer at 739px
  expect(clampSuperAgentViewerWidth(950, 1280, 240)).toBe(739);
  expect(clampSuperAgentViewerWidth(560, 1280, 240)).toBe(560);
  expect(clampSuperAgentViewerWidth(200, 1280, 240)).toBe(320);

  // 1000px mid-width screen with drawer sidebar (0 docked width): 72% cap = min(719, 699) = 699
  expect(clampSuperAgentViewerWidth(900, 1000, 0)).toBe(699);

  // Tight split (< 620 available) falls back to 55% proportional split without overflowing
  expect(clampSuperAgentViewerWidth(600, 600, 0)).toBe(329);
  expect(clampSuperAgentViewerWidth(100, 600, 0)).toBe(329);
  expect(clampSuperAgentViewerWidth(400, 420, 0)).toBe(240);
});

it('renders ExecutionTimeline live status, grouped Work Log with diffs/commands, deliverables, and enhanced SimpleMarkdown', async () => {
  const onCopyText = vi.fn();
  const onOpenArtifactId = vi.fn();
  const onOpenWebUrl = vi.fn();

  const timelineChat: SuperAgentChat = {
    id: CHAT_ID,
    title: 'Timeline Demo',
    engine: 'antigravity',
    permissionMode: 'auto',
    createdAt: 1000,
    updatedAt: 5000,
    state: 'idle',
    lastTurnDurationMs: 3200,
    lastTurnUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    artifacts: [
      {
        id: 'design:d-99',
        kind: 'design-project',
        title: 'Landing Card',
        subtitle: 'prototype',
        projectId: 'd-99',
        createdAt: 2000,
        updatedAt: 4200,
      },
    ],
    approvals: [],
    messages: [
      { id: 'u1', role: 'user', text: 'Inspect and build card', createdAt: 1000 },
      { id: 'r1', role: 'reasoning', text: 'Planning file edits first', status: 'completed', durationMs: 850, createdAt: 1200 },
      {
        id: 't1',
        role: 'tool',
        text: 'Executed command',
        createdAt: 1500,
        toolEvent: {
          callId: 'c1',
          tool: 'run_command',
          label: 'Checked Node',
          status: 'completed',
          category: 'command',
          command: 'node -v',
          exitCode: 0,
          outputPreview: 'v26.11.1',
          durationMs: 120,
          startedAt: 1500,
          finishedAt: 1620,
        },
      },
      {
        id: 't2',
        role: 'tool',
        text: 'Edited styles.css',
        createdAt: 2000,
        toolEvent: {
          callId: 'c2',
          tool: 'Edit',
          label: 'Edited styles.css',
          status: 'completed',
          category: 'file_edit',
          fileOp: {
            action: 'edit',
            path: 'styles.css',
            addedLines: 2,
            removedLines: 1,
            diffPreview: '-color: red;\n+color: blue;\n+gap: 8px;',
          },
          durationMs: 90,
          startedAt: 2000,
          finishedAt: 2090,
        },
      },
      {
        id: 'a1',
        role: 'assistant',
        text: [
          '## Summary',
          '',
          '| Step | Status |',
          '| --- | --- |',
          '| Node | v26.11.1 |',
          '',
          '- [x] Updated `file:///tmp/styles.css`',
          '',
          'See [Example Docs](https://example.com/docs).',
        ].join('\n'),
        createdAt: 4200,
      },
    ],
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={timelineChat}
          busy={false}
          sending={false}
          engineLabel="Antigravity"
          onOpenArtifactId={onOpenArtifactId}
          onPreviewAttachment={vi.fn()}
          onOpenWebUrl={onOpenWebUrl}
          onCopyText={onCopyText}
          onApprove={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  expect(document.body.textContent).toContain('Worked for 3.2s · 3 steps');
  expect(document.body.textContent).toContain('Files changed (1)');
  expect(document.body.textContent).toContain('Antigravity · 3 steps · 3.2s · 150 tokens');
  expect(document.querySelector('.om-sa-md-table')).toBeTruthy();
  expect(document.querySelector('.om-sa-md-task')).toBeTruthy();

  // Completed turn auto-collapses the Work Log while showing FilesChangedCard below assistant summary
  expect(document.querySelector('.om-sa-work-items')).toBeNull();
  const assistantEl = document.querySelector('.om-sa-assistant-content')!;
  const filesChangedEl = document.querySelector('.om-sa-files-changed')!;
  expect(assistantEl.compareDocumentPosition(filesChangedEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(filesChangedEl.textContent).toContain('styles.css');
  expect(filesChangedEl.querySelector('.om-sa-diff-pre')).toBeNull();
  await act(async () => {
    filesChangedEl.querySelector<HTMLButtonElement>('.om-sa-file-row-trigger')!.click();
  });
  await flush();
  expect(filesChangedEl.querySelector('.om-sa-diff-pre')?.textContent).toContain('+gap: 8px;');

  // Expand Work Log and verify command + diff lines
  const workBtn = document.querySelector<HTMLButtonElement>('.om-sa-work-summary-btn')!;
  await act(async () => workBtn.click());
  await flush();
  expect(document.body.textContent).toContain('Thought for 850ms');
  expect(document.body.textContent).toContain('Checked Node');
  expect(document.body.textContent).toContain('exit 0');

  // Deliverable card & guided actions & viewer link button & file chip
  const deliverableBtn = document.querySelector<HTMLButtonElement>('.om-sa-deliverable-main')!;
  await act(async () => deliverableBtn.click());
  expect(onOpenArtifactId).toHaveBeenCalledWith('design:d-99');
  const deliverableActions = document.querySelector('.om-sa-deliverable-actions');
  expect(deliverableActions?.textContent).toContain('Open editor');
  expect(deliverableActions?.textContent).toContain('Share');
  expect(deliverableActions?.textContent).toContain('Export');

  const viewerLinkBtn = document.querySelector<HTMLButtonElement>('.om-sa-link-viewer-btn')!;
  await act(async () => viewerLinkBtn.click());
  expect(onOpenWebUrl).toHaveBeenCalledWith('https://example.com/docs');

  const fileChip = document.querySelector<HTMLButtonElement>('.om-sa-file-chip')!;
  await act(async () => fileChip.click());
  expect(onCopyText).toHaveBeenCalledWith('/tmp/styles.css');

  // Verify live active state + plan rendering
  const liveChat: SuperAgentChat = {
    ...timelineChat,
    state: 'running',
    lastTurnDurationMs: undefined,
    turnActivity: {
      phase: 'tool',
      label: 'Running node -v',
      activeToolName: 'run_command',
      startedAt: Date.now() - 1500,
      updatedAt: Date.now(),
      plan: [
        { content: 'Check Node version', status: 'in_progress' },
        { content: 'Write report', status: 'pending' },
      ],
    },
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={liveChat}
          busy
          sending={false}
          engineLabel="Antigravity"
          onOpenArtifactId={onOpenArtifactId}
          onPreviewAttachment={vi.fn()}
          onCopyText={onCopyText}
          onApprove={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Running node -v');
  expect(document.querySelector('.om-sa-plan-card')?.textContent).toContain('Check Node version');
  expect(document.querySelector('.om-sa-deliverables')).toBeNull();

  // Long user prompts stay collapsed until expanded.
  const longPromptChat: SuperAgentChat = {
    ...timelineChat,
    messages: [
      {
        id: 'u-long',
        role: 'user',
        text: Array.from({ length: 12 }, (_, i) => `Brief line ${i + 1}: detailed requirement specification for game loop.`).join('\n'),
        attachments: [{ kind: 'game-project', id: 'g-1', title: 'Make an original game in the spirit of Little Prince' }],
        createdAt: 1000,
      },
    ],
  };
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={longPromptChat}
          busy={false}
          sending={false}
          engineLabel="Antigravity"
          onOpenArtifactId={onOpenArtifactId}
          onPreviewAttachment={vi.fn()}
          onCopyText={onCopyText}
          onApprove={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  const bubble = document.querySelector('.om-sa-user-bubble-collapsible')!;
  expect(bubble.hasAttribute('data-collapsed')).toBe(true);
  expect(bubble.textContent).toContain('Show full prompt');
  expect(bubble.textContent).toContain('12 lines');

  const promptDisclosure = bubble.querySelector<HTMLButtonElement>('.om-sa-user-bubble-toggle')!;
  await act(async () => {
    promptDisclosure.click();
  });
  await flush();
  expect(bubble.hasAttribute('data-expanded')).toBe(true);
  expect(promptDisclosure.textContent).toContain('Collapse');
  expect(bubble.querySelector('.om-sa-user-bubble-text')?.textContent).toContain('Brief line 12');

  await act(async () => {
    promptDisclosure.click();
  });
  await flush();
  expect(bubble.hasAttribute('data-collapsed')).toBe(true);

  // Direct SimpleMarkdown strikethrough + hr + bare link rendering
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SimpleMarkdown content={'~~old~~\n\n---\n\nVisit https://openmotion.example.com'} onCopyCode={onCopyText} />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('.om-sa-md-del')?.textContent).toBe('old');
  expect(document.querySelector('.om-sa-md-hr')).toBeTruthy();
  expect(document.querySelector<HTMLAnchorElement>('.om-sa-link')?.href).toBe('https://openmotion.example.com/');
});

it('opens clickable Markdown files and web links from Reasoning & Assistant in right Viewer without adding deliverable cards', async () => {
  clearSuperAgentCache();
  const MD_CHAT_ID = '88888888-8888-4888-8888-888888888888';
  const patchBodies: any[] = [];
  const fileReads: string[] = [];
  let currentChat: SuperAgentChat = {
    id: MD_CHAT_ID,
    title: 'Markdown Reference Thread',
    engine: 'codex',
    permissionMode: 'on-request',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'idle',
    lastTurnDurationMs: 1200,
    artifacts: [],
    approvals: [],
    messages: [
      { id: 'u-md-1', role: 'user', text: 'Check docs', createdAt: 1000 },
      {
        id: 'r-md-1',
        role: 'reasoning',
        text: 'Inspecting [Design Guide](docs/guide.md), `README.md`, and [Docs](https://example.com/guide).',
        status: 'completed',
        durationMs: 420,
        createdAt: 1200,
      },
      {
        id: 'a-md-1',
        role: 'assistant',
        text: 'Reviewed [Design Guide](docs/guide.md) and [Docs](https://example.com/guide).',
        createdAt: 1900,
      },
    ],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) return json(sampleResources);
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({
        conversations: [{
          id: currentChat.id,
          title: currentChat.title,
          engine: currentChat.engine,
          createdAt: 1000,
          updatedAt: currentChat.updatedAt,
          state: currentChat.state,
          artifactCount: currentChat.artifacts.length,
          messageCount: currentChat.messages.length,
        }],
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/${MD_CHAT_ID}` && method === 'GET') {
      return json({ conversation: currentChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${MD_CHAT_ID}` && method === 'PATCH') {
      const body = JSON.parse(String(init?.body || '{}'));
      patchBodies.push(body);
      if (body.addArtifact?.kind === 'web') {
        const webArt: SuperAgentArtifact = {
          id: 'web-ext-1',
          kind: 'web',
          title: body.addArtifact.url,
          url: body.addArtifact.url,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          presentedAt: Date.now(),
        };
        currentChat = { ...currentChat, artifacts: [...currentChat.artifacts, webArt], activeArtifactId: webArt.id };
      }
      return json({ conversation: currentChat });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/file-content`)) {
      const parsed = new URL(url, 'http://localhost');
      const reqPath = parsed.searchParams.get('path') || '';
      fileReads.push(reqPath);
      return json({
        path: reqPath,
        content: reqPath === 'packages/brand.md'
          ? '# Brandkit Doc\n\nNested markdown preview.\n'
          : '# Design Guide Heading\n\nDetailed markdown content with [Web Link](https://example.com/guide) and [Brandkit](../packages/brand.md).\n',
        binary: false,
        sizeBytes: 86,
        mimeType: 'text/markdown',
      });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={MD_CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('.om-sa-work-summary-btn')).toBeTruthy();
  }, { timeout: 5000 });

  // Expand Work Log & Reasoning row
  await act(async () => container.querySelector<HTMLButtonElement>('.om-sa-work-summary-btn')!.click());
  await flush();
  await act(async () => container.querySelector<HTMLButtonElement>('.om-sa-reasoning-trigger')!.click());
  await flush();

  const reasoningBody = container.querySelector('.om-sa-reasoning-body')!;
  expect(reasoningBody).toBeTruthy();
  const reasoningChips = [...reasoningBody.querySelectorAll<HTMLButtonElement>('.om-sa-file-chip')];
  expect(reasoningChips.map(c => c.textContent?.trim())).toEqual(['Design Guide', 'README.md']);
  expect(reasoningBody.querySelector<HTMLAnchorElement>('.om-sa-link')?.href).toBe('https://example.com/guide');

  // Click [Design Guide] in reasoning -> opens formatted Markdown Preview in right Viewer without adding deliverable cards
  await act(async () => reasoningChips[0].click());
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('.om-sa-workspace-file-view .om-sa-markdown-doc')).toBeTruthy();
  }, { timeout: 5000 });
  expect(fileReads).toContain('docs/guide.md');
  expect(container.querySelector('.om-sa-markdown-doc h3')?.textContent).toBe('Design Guide Heading');
  expect(container.querySelector('.om-sa-deliverables')).toBeNull();
  expect(patchBodies.some(b => Boolean(b.addArtifact))).toBe(false);

  // Switch between Code and Preview modes in WorkspaceFileArtifactView
  const codeBtn = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-md-mode-btn')].find(b => b.textContent?.trim() === 'Code')!;
  expect(codeBtn).toBeTruthy();
  await act(async () => codeBtn.click());
  await flush();
  expect(container.querySelector('.om-sa-workspace-file-view .om-sa-code-panel')).toBeTruthy();

  const previewBtn = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-md-mode-btn')].find(b => b.textContent?.trim() === 'Preview')!;
  await act(async () => previewBtn.click());
  await flush();
  expect(container.querySelector('.om-sa-workspace-file-view .om-sa-markdown-doc')).toBeTruthy();

  // Click relative Markdown link inside Viewer Preview -> resolves relative path and opens in new tab
  const nestedChip = container.querySelector<HTMLButtonElement>('.om-sa-workspace-file-view .om-sa-markdown-doc .om-sa-file-chip');
  expect(nestedChip?.textContent?.trim()).toBe('Brandkit');
  await act(async () => nestedChip!.click());
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('.om-sa-markdown-doc h3')?.textContent).toBe('Brandkit Doc');
  }, { timeout: 5000 });
  expect(fileReads).toContain('packages/brand.md');
  expect(container.querySelector('.om-sa-deliverables')).toBeNull();
  expect(patchBodies.some(b => Boolean(b.addArtifact))).toBe(false);

  // Click web Markdown link directly in Assistant message -> opens in right Viewer
  const assistantLink = container.querySelector<HTMLAnchorElement>('.om-sa-assistant-content .om-sa-link')!;
  await act(async () => assistantLink.click());
  await flush();
  expect(patchBodies.some(b => b.addArtifact?.kind === 'web' && b.addArtifact?.url === 'https://example.com/guide')).toBe(true);
});

it('enters pure Coding mode from Explore more and renders sidebar/header intent icons', async () => {
  const createdId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  let capturedTurnBody: Record<string, any> | null = null;

  const chatsList: SuperAgentChatSummary[] = [
    {
      id: CHAT_ID,
      title: 'Fix parser bug',
      intent: 'coding',
      engine: 'codex',
      state: 'running',
      artifactCount: 0,
      messageCount: 1,
      updatedAt: 4000,
      createdAt: 1000,
    },
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      title: 'Landing Prototype',
      intent: 'website',
      engine: 'codex',
      state: 'idle',
      artifactCount: 1,
      messageCount: 2,
      updatedAt: 3000,
      createdAt: 1000,
    },
    {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      title: 'Promo Reel',
      intent: 'video',
      engine: 'codex',
      state: 'failed',
      artifactCount: 0,
      messageCount: 2,
      updatedAt: 2000,
      createdAt: 1000,
    },
    {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      title: 'Explain OAuth tokens',
      intent: 'chat',
      pinned: true,
      engine: 'codex',
      state: 'idle',
      artifactCount: 0,
      messageCount: 2,
      updatedAt: 1000,
      createdAt: 1000,
    },
  ];

  const codingChat: SuperAgentChat = {
    ...sampleChat,
    id: CHAT_ID,
    title: 'Fix parser bug',
    intent: 'coding',
    state: 'running',
    artifacts: [],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({
        agents: [{ id: 'codex', label: 'Codex', icon: 'codex', installed: true, auth: 'signed-in', models: [{ id: 'gpt-5', label: 'GPT-5' }] }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) return json(sampleResources);
    if (url === `${SUPER_AGENT_API}/chats` && (!init?.method || init.method === 'GET')) {
      return json({ conversations: chatsList });
    }
    if (url === `${SUPER_AGENT_API}/chats` && init?.method === 'POST') {
      return json({ conversation: { ...codingChat, id: createdId, state: 'idle', title: 'New conversation', messages: [] } });
    }
    if (url === `${SUPER_AGENT_API}/chats/${createdId}/turn` && init?.method === 'POST') {
      capturedTurnBody = init.body ? JSON.parse(String(init.body)) : null;
      return json({
        conversation: {
          ...codingChat,
          id: createdId,
          title: 'Inspect package.json',
          intent: 'coding',
          workingDir: capturedTurnBody?.workingDir,
          messages: [{ id: 'u-1', role: 'user', text: capturedTurnBody?.text, createdAt: Date.now() }],
        },
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}`) {
      return json({ conversation: codingChat });
    }
    return json({});
  }) as any;

  // Verify the Coding entry, pure coding workspace, and submit payload.
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // Sidebar rows keep their intent icons and place status indicators according to the task state.
  expect(document.querySelector('.om-sa-chat-icon[data-intent="coding"][data-tone="coding"]')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-status[data-state="running"] svg')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-status[data-state="running"] .om-sa-chat-dot')).toBeNull();
  expect(document.querySelector('.om-sa-chat-icon[data-intent="website"][data-tone="agent"]')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-status[data-state="completed"] .om-sa-chat-dot')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-icon[data-intent="video"][data-tone="video"]')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-status-badge[data-state="failed"]')?.textContent).toBe('Stopped');
  expect(document.querySelector('.om-sa-chat-icon[data-intent="chat"][data-tone="neutral"]')).toBeTruthy();

  const more = container.querySelector<HTMLButtonElement>('.om-sa-starter-card-more')!;
  await act(async () => more.click());
  const items = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-more-menu .om-sa-more-item')];
  expect(items.map(item => item.textContent)).toEqual([
    'Research a topic',
    'Visualization',
    'Document',
    'Generate image',
    'Build a website',
    'Create audio',
    'Cinema video',
    'Coding',
  ]);
  const codingItem = items.find(item => item.textContent === 'Coding')!;
  await act(async () => codingItem.click());
  await flush();

  expect(document.body.textContent).toContain('Code, debug & ship');
  expect(document.querySelector('.om-sa-showcase-panel')).toBeNull();
  expect(document.body.textContent).toContain('Workspace folder');
  expect(document.body.textContent).toContain('General coding');
  expect(document.querySelector('.om-sa-stream-title-icon[data-tone="coding"]')).toBeTruthy();

  // Set working folder via popover
  const folderBtn = [...document.querySelectorAll('.om-sa-composer-top-pill')].find(
    el => el.textContent?.includes('Workspace folder'),
  ) as HTMLButtonElement;
  await act(async () => folderBtn.click());
  await flush();
  const folderInput = document.querySelector<HTMLInputElement>('.om-sa-mode-url-input')!;
  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    proto.call(folderInput, '/tmp/my-repo');
    folderInput.dispatchEvent(new Event('input', { bubbles: true }));
    folderInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const applyBtn = [...document.querySelectorAll('.om-sa-popover-pill')].find(
    el => el.textContent === 'Apply',
  ) as HTMLButtonElement;
  await act(async () => applyBtn.click());
  await flush();

  // Submit prompt and verify clean coding turn payload (no [Mode: ...] noise)
  await typeInComposer(getComposerEditor(), 'Inspect package.json');
  await flush();
  const sendBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
  await act(async () => sendBtn.click());
  await flush();

  expect(capturedTurnBody).toBeTruthy();
  expect(capturedTurnBody?.mode).toBe('coding');
  expect(capturedTurnBody?.workingDir).toBe('/tmp/my-repo');
  expect(capturedTurnBody?.text).toBe('Inspect package.json');

  // 2. Active coding chat renders coding intent icon in header
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('.om-sa-stream-title-icon[data-tone="coding"]')).toBeTruthy();
});

it('auto-sends queued game handoffs from Game Studio, renders gamepad-line icon, and views/codes game artifacts', async () => {
  const GAME_CHAT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const GAME_ID = 'game-star-99';
  let createBody: any = null;
  let turnBody: any = null;
  const onOpenGameStudio = vi.fn();

  const gameChat: SuperAgentChat = {
    id: GAME_CHAT_ID,
    title: 'Neon wave dodger',
    intent: 'game',
    engine: 'codex',
    model: 'gpt-5',
    permissionMode: 'on-request',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'idle',
    messages: [
      { id: 'm1', role: 'user', text: 'Build Neon wave dodger', createdAt: 1001 },
      { id: 'm2', role: 'assistant', text: 'Ready to play in the Artifact Viewer.', createdAt: 1002 },
    ],
    artifacts: [
      {
        id: `game:${GAME_ID}`,
        kind: 'game-project',
        title: 'Star Dodge',
        subtitle: 'shooter · Game Studio',
        projectId: GAME_ID,
        scenario: 'portrait',
        revision: 'rev-game-1',
        url: `/motion-api/games/${GAME_ID}/play/index.html`,
        createdAt: 1002,
        updatedAt: 1002,
      },
    ],
    activeArtifactId: `game:${GAME_ID}`,
    approvals: [],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({
        agents: [{ id: 'codex', label: 'Codex', icon: 'codex', installed: true, auth: 'signed-in', models: [{ id: 'gpt-5', label: 'GPT-5' }] }],
      });
    }
    if (url.startsWith('/motion-api/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        runtimes: [
          {
            id: 'local-direct',
            kind: 'local-direct',
            name: 'This computer',
            status: 'online',
            agents: [
              { id: 'codex', label: 'Codex', icon: 'codex', installed: true, auth: 'signed-in', models: [{ id: 'gpt-5', label: 'GPT-5' }] },
            ],
            runnableAgentIds: ['codex'],
          },
        ],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) return json(sampleResources);
    if (url === `${SUPER_AGENT_API}/chats` && (!init?.method || init.method === 'GET')) {
      return json({
        conversations: [
          {
            id: GAME_CHAT_ID,
            title: 'Star Dodge',
            intent: 'game',
            engine: 'codex',
            state: 'idle',
            artifactCount: 1,
            messageCount: 2,
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      });
    }
    if (url === `${SUPER_AGENT_API}/chats` && init?.method === 'POST') {
      createBody = init.body ? JSON.parse(String(init.body)) : {};
      return json({
        conversation: { ...gameChat, messages: [], artifacts: [], activeArtifactId: undefined },
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/${GAME_CHAT_ID}/turn` && init?.method === 'POST') {
      turnBody = init.body ? JSON.parse(String(init.body)) : {};
      return json({ conversation: gameChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${GAME_CHAT_ID}`) {
      return json({ conversation: gameChat });
    }
    if (url === `/motion-api/games/${GAME_ID}/files`) {
      return json({
        files: [
          { path: 'vendor/three-helper.js', bytes: 128 },
          { path: 'design/plan.md', bytes: 48 },
          { path: 'logic.js', bytes: 32 },
          { path: 'index.html', bytes: 64 },
        ],
      });
    }
    if (url.startsWith(`/motion-api/games/${GAME_ID}/play/index.html`)) {
      return new Response('<!doctype html><canvas id="dodge"></canvas>', { status: 200 });
    }
    if (url.startsWith(`/motion-api/games/${GAME_ID}/play/logic.js`)) {
      return new Response('console.log("star dodge");', { status: 200 });
    }
    return json({});
  }) as any;

  queueSuperAgentHandoff(buildSuperAgentHandoff(
    {
      kind: 'game-project',
      id: GAME_ID,
      title: 'Neon wave dodger',
      subtitle: 'shooter · Single player',
      genre: 'shooter',
    },
    {
      prompt: 'Brief: Neon wave dodger',
      autoSend: true,
      newChat: true,
    },
  ));

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenGameStudio={onOpenGameStudio}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  // Auto-dispatched queued game handoff with game intent & attachment
  expect(createBody?.intent).toBe('game');
  expect(turnBody?.mode).toBe('game');
  expect(turnBody?.attachments?.[0]?.id).toBe(GAME_ID);

  // Sidebar & header display recognizable gamepad-line icon
  const sidebarIconSvg = document.querySelector('.om-sa-chat-icon[data-intent="game"] svg');
  expect(sidebarIconSvg?.getAttribute('data-remix-icon')).toBe('gamepad-line');
  const headerIconSvg = document.querySelector('.om-sa-stream-title-icon svg');
  expect(headerIconSvg?.getAttribute('data-remix-icon')).toBe('gamepad-line');

  // Viewer opens game iframe in portrait viewport & supports Code inspection + Open in Game Studio
  const viewer = document.querySelector('.om-sa-viewer')!;
  expect(viewer).toBeTruthy();
  // Share belongs in the active tab toolbar (emphasized), never in the outer browser window tab strip
  expect(viewer.querySelector('.om-sa-viewer-tabs-bar .om-web-publish-trigger')).toBeNull();
  const toolbarShareBtn = viewer.querySelector('.om-sa-viewer-toolbar .om-sa-share-trigger');
  expect(toolbarShareBtn).toBeTruthy();
  expect(toolbarShareBtn?.textContent?.trim()).toBe('Share');
  // User's own game does not clutter the toolbar with an Attach to Chat button
  expect(viewer.querySelector('.om-sa-viewer-toolbar .om-sa-game-use-btn')).toBeNull();
  // Non-web game tab omits disabled Back/Forward browser history arrows
  expect(viewer.querySelector('.om-sa-nav-btns button[aria-label="Back"]')).toBeNull();
  expect(viewer.querySelector('.om-sa-nav-btns button[aria-label="Forward"]')).toBeNull();
  expect(viewer.querySelector('.om-sa-nav-btns button[aria-label="Reload"]')).toBeTruthy();
  const stage = viewer.querySelector('.om-sa-iframe-stage');
  expect(stage?.getAttribute('data-viewport')).toBe('mobile');
  const iframe = viewer.querySelector('iframe');
  expect(iframe?.getAttribute('src')).toContain(`/motion-api/games/${GAME_ID}/play/index.html`);

  const menuBtn = viewer.querySelector('button[aria-label="Browser options"]') as HTMLButtonElement;
  expect(menuBtn).toBeTruthy();
  expect(viewer.querySelector('.om-sa-viewer-toolbar button[aria-label="Capture screenshot to chat"]')).toBeTruthy();
  await act(async () => menuBtn.click());
  await flush();
  const previewMenu = document.querySelector('.om-sa-browser-menu');
  expect(previewMenu?.textContent).toContain('Console & errors');
  expect(previewMenu?.textContent).not.toContain('Capture screenshot to chat');
  expect(previewMenu?.textContent).toContain('Attach');
  await act(async () => menuBtn.click());
  await flush();

  // Responsive viewport dropdown switches Game preview viewports without adding a secondary bar
  const deviceBtn = viewer.querySelector('button[aria-label="Viewport presets"]') as HTMLButtonElement;
  expect(deviceBtn).toBeTruthy();
  await act(async () => deviceBtn.click());
  await flush();
  expect(viewer.querySelector('.om-sa-device-bar')).toBeNull();
  const deviceMenu = document.querySelector('.om-sa-device-menu');
  expect(deviceMenu).toBeTruthy();
  const desktopPresetBtn = [...deviceMenu!.querySelectorAll('button')].find(b => b.textContent?.includes('Desktop')) as HTMLButtonElement;
  expect(desktopPresetBtn).toBeTruthy();
  await act(async () => desktopPresetBtn.click());
  await flush();
  expect(stage?.getAttribute('data-viewport')).toBe('desktop');
  expect(document.querySelector('.om-sa-device-menu')).toBeNull();

  const viewModeBtn = viewer.querySelector('.om-sa-view-mode-trigger') as HTMLButtonElement;
  expect(viewModeBtn).toBeTruthy();
  await act(async () => viewModeBtn.click());
  await flush();
  const codeBtn = [...document.querySelectorAll('.om-sa-view-mode-popover button')].find(b => b.textContent?.trim() === 'Code') as HTMLButtonElement;
  expect(codeBtn).toBeTruthy();
  await act(async () => codeBtn.click());
  await vi.waitFor(async () => {
    await flush();
    expect(viewer.textContent).toContain('<canvas id="dodge"></canvas>');
  }, { timeout: 5000 });
  expect(viewer.textContent).toContain('index.html');
  expect(viewer.querySelector('.om-sa-code-sidebar')).toBeTruthy();
  expect(viewer.querySelector('button[aria-label="Copy"]')).toBeTruthy();
  // vendor/ folder is collapsed by default while design/ is expanded
  const folders = [...viewer.querySelectorAll('details.om-sa-code-folder')] as HTMLDetailsElement[];
  const designFolder = folders.find(el => el.textContent?.includes('design'));
  const vendorFolder = folders.find(el => el.textContent?.includes('vendor'));
  expect(designFolder?.hasAttribute('open')).toBe(true);
  expect(vendorFolder?.hasAttribute('open')).toBe(false);

  await act(async () => menuBtn.click());
  await flush();
  const openStudioBtn = [...document.querySelectorAll('.om-sa-browser-menu button')].find(b => b.textContent?.includes('Open in Game Studio')) as HTMLButtonElement;
  expect(openStudioBtn).toBeTruthy();
  await act(async () => openStudioBtn.click());
  expect(onOpenGameStudio).toHaveBeenCalledWith(GAME_ID);
});

it('supports web preview device toolbar, browser options menu, and visual element annotation into composer', async () => {
  const WEB_CHAT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const webChat: SuperAgentChat = {
    id: WEB_CHAT_ID,
    title: 'Local Vite Preview',
    engine: 'codex',
    model: 'gpt-5',
    intent: 'coding',
    permissionMode: 'auto',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'idle',
    messages: [],
    artifacts: [
      {
        id: 'web-local-1',
        kind: 'web',
        title: 'localhost:5173',
        subtitle: 'Local dev server',
        url: 'http://localhost:5173/',
        createdAt: 1000,
        updatedAt: 2000,
      },
    ],
    activeArtifactId: 'web-local-1',
    approvals: [],
  };

  let lastTurnBody: any = null;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/settings/agents')) {
      return json({
        agents: [
          {
            id: 'codex',
            label: 'Codex',
            icon: 'codex',
            installed: true,
            auth: 'signed-in',
            models: [{ id: 'gpt-5', label: 'GPT-5', reasoning: ['low', 'medium', 'high'] }],
          },
        ],
      });
    }
    if (url.includes('/settings/runtimes')) return json({ runtimes: [] });
    if (url.includes(`${SUPER_AGENT_API}/resources`)) return json(sampleResources);
    if (url === `${SUPER_AGENT_API}/chats`) return json({ conversations: [{ ...webChat }] });
    if (url === `${SUPER_AGENT_API}/chats/${WEB_CHAT_ID}`) return json({ conversation: webChat });
    if (url === `${SUPER_AGENT_API}/chats/${WEB_CHAT_ID}/annotations` && init?.method === 'POST') {
      return json({
        id: 'shot-1',
        screenshotUrl: `/motion-api/super-agent/chats/${WEB_CHAT_ID}/annotations/shot-1.png`,
        screenshotPath: '/tmp/shot-1.png',
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/${WEB_CHAT_ID}/turn` && init?.method === 'POST') {
      lastTurnBody = init.body ? JSON.parse(String(init.body)) : null;
      return json({ conversation: webChat });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={WEB_CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  const viewerToggle = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === 'Artifact Viewer',
  ) as HTMLButtonElement;
  expect(viewerToggle).toBeTruthy();
  await act(async () => viewerToggle.click());
  for (let i = 0; i < 30 && !document.querySelector('.om-sa-viewer'); i++) {
    await flush();
  }

  const viewer = document.querySelector('.om-sa-viewer')!;
  expect(viewer).toBeTruthy();
  for (let i = 0; i < 20 && !viewer.querySelector('[data-testid="mock-web-browser"]'); i++) {
    await flush();
  }
  expect(viewer.querySelector('[data-testid="mock-web-browser"]')).toBeTruthy();

  // Live WebBrowser title updates the tab title and Web tabs avoid duplicating External Link in toolbar
  await vi.waitFor(async () => {
    await flush();
    expect(viewer.querySelector('.om-sa-viewer-tab-btn')?.textContent).toContain('Local App');
  }, { timeout: 3000 });
  expect(viewer.querySelector('.om-sa-context-actions a[aria-label="Open in external browser"]')).toBeNull();

  // Open Viewport presets dropdown and switch to Mobile preset
  const deviceBtn = viewer.querySelector('button[aria-label="Viewport presets"]') as HTMLButtonElement;
  expect(deviceBtn).toBeTruthy();
  await act(async () => deviceBtn.click());
  await flush();
  expect(viewer.querySelector('.om-sa-device-bar')).toBeNull();
  const mobilePreset = [...document.querySelectorAll('.om-sa-device-menu-item')].find(b => b.textContent?.includes('Mobile')) as HTMLButtonElement;
  expect(mobilePreset).toBeTruthy();
  await act(async () => mobilePreset.click());
  await flush();
  expect(viewer.querySelector('.om-sa-web-stage-main')?.getAttribute('data-framed')).toBe('true');
  // Re-open dropdown to verify active mobile dimensions and Rotate viewport option
  await act(async () => deviceBtn.click());
  await flush();
  expect(document.querySelector('.om-sa-device-menu')?.textContent).toContain('390 × 844');
  expect(document.querySelector('.om-sa-device-menu')?.textContent).toContain('Rotate viewport');
  await act(async () => deviceBtn.click());
  await flush();

  // Open Browser options menu and inspect items (including Open in new window)
  const menuBtn = viewer.querySelector('button[aria-label="Browser options"]') as HTMLButtonElement;
  expect(menuBtn).toBeTruthy();
  await act(async () => menuBtn.click());
  await flush();
  const menu = document.querySelector('.om-sa-browser-menu')!;
  expect(menu).toBeTruthy();
  expect(menu.parentElement?.matches('[data-menu-panel].motion-positioned-menu')).toBe(true);
  expect(menu.matches('[data-menu-panel]')).toBe(false);
  expect(menu.textContent).toContain('Hard reload');
  expect(menu.textContent).toContain('Appearance');
  expect(menu.textContent).toContain('Clear cookies');
  expect(menu.textContent).toContain('Clear cache');
  expect(menu.textContent).toContain('Open external');
  await act(async () => menuBtn.click());
  await flush();

  // Activate annotation overlay
  const annotBtn = viewer.querySelector('button[aria-label="Annotate elements, regions, and drawings"]') as HTMLButtonElement;
  expect(annotBtn).toBeTruthy();
  await act(async () => annotBtn.click());
  await flush();

  const overlay = viewer.querySelector('.om-sa-annot-layer')!;
  expect(overlay).toBeTruthy();
  expect(overlay.textContent).toContain('Select');
  expect(overlay.textContent).toContain('Region');
  expect(overlay.textContent).toContain('Draw');
  expect(overlay.textContent).toContain('Erase');

  // Mock layout geometry for element picking on the overlay
  const img = viewer.querySelector('[data-testid="mock-web-browser"] img') as HTMLElement;
  const layerEl = overlay as HTMLElement;
  img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
  layerEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });

  const backdrop = overlay.querySelector('.om-sa-annot-backdrop') as HTMLElement;
  await act(async () => {
    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 60, clientY: 60 }));
    backdrop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 60, clientY: 60 }));
  });
  await flush();
  await flush();

  const noteInput = viewer.querySelector('.om-sa-annot-input') as HTMLInputElement;
  expect(noteInput).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(noteInput, 'Make button rounded');
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
    noteInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const attachBtn = viewer.querySelector('.om-sa-annot-attach-btn') as HTMLButtonElement;
  expect(attachBtn).toBeTruthy();
  await act(async () => attachBtn.click());
  await flush();
  await flush();

  // Verify annotation chip attached in composer, click opens preview Popover, and send button enabled without textarea text
  const chip = document.querySelector('.om-sa-composer-chips .om-sa-attachment-chip[data-kind="browser-annotation"]');
  expect(chip).toBeTruthy();
  expect(chip?.textContent).toContain('Make button rounded');

  const chipTrigger = chip!.querySelector('.om-sa-chip-main') as HTMLButtonElement;
  expect(chipTrigger).toBeTruthy();
  await act(async () => chipTrigger.click());
  await flush();
  const previewPopover = document.querySelector('.om-sa-annot-preview-popover');
  expect(previewPopover).toBeTruthy();
  expect(previewPopover?.querySelector('img.om-sa-annot-preview-img')).toBeTruthy();
  expect(previewPopover?.textContent).toContain('#hero-btn');
  const previewJumpBtn = [...previewPopover!.querySelectorAll('button')].find(b => b.textContent?.includes('Preview')) as HTMLButtonElement;
  expect(previewJumpBtn).toBeTruthy();
  await act(async () => previewJumpBtn.click());
  await flush();
  expect(document.querySelector('.om-sa-annot-preview-popover')).toBeNull();
  expect(document.querySelector('.om-sa-composer-chips .om-sa-attachment-chip[data-kind="browser-annotation"]')).toBeTruthy();

  const sendBtn = document.querySelector('.om-sa-send-btn') as HTMLButtonElement;
  expect(sendBtn).toBeTruthy();
  expect(sendBtn.disabled).toBe(false);
  await act(async () => sendBtn.click());
  await flush();
  await flush();

  expect(lastTurnBody).toBeTruthy();
  expect(lastTurnBody.attachments?.[0]?.kind).toBe('browser-annotation');
  expect(lastTurnBody.attachments?.[0]?.annotation?.element?.selector).toBe('#hero-btn');
  expect(lastTurnBody.attachments?.[0]?.annotation?.comment).toBe('Make button rounded');
});

it('keeps multiplayer games playable in the catalog and only scaffolds single-player or playable ad games', async () => {
  const GAME_CHAT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const CREATED_GAME_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  let createGameBody: any = null;
  let createChatBody: any = null;
  let turnBody: any = null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const createdChat: SuperAgentChat = {
    id: GAME_CHAT_ID,
    title: 'Neon Arena',
    engine: 'codex',
    model: 'gpt-5',
    intent: 'game',
    permissionMode: 'auto',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'running',
    messages: [],
    artifacts: [],
    approvals: [],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/settings/agents')) {
      return json({
        agents: [
          {
            id: 'codex',
            label: 'Codex',
            icon: 'codex',
            installed: true,
            auth: 'signed-in',
            models: [{ id: 'gpt-5', label: 'GPT-5', reasoning: ['medium'] }],
          },
        ],
      });
    }
    if (url.includes('/motion-api/agent-runtimes')) {
      return json({
        runtimes: [
          {
            id: 'local-direct',
            kind: 'local-direct',
            name: 'This computer',
            status: 'online',
            agents: [{ id: 'codex', label: 'Codex', icon: 'codex', installed: true, auth: 'signed-in', models: [] }],
            runnableAgentIds: ['codex'],
          },
        ],
      });
    }
    if (url.includes(`${SUPER_AGENT_API}/resources`)) {
      return json({ counts: { assets: 0, brandKits: 0, motionTemplates: 0, designTemplates: 0, skills: 0, designSkills: 0, motionProjects: 0, designProjects: 0, gameProjects: 0 }, items: [] });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') return json({ conversations: [] });
    if (url === `${SUPER_AGENT_API}/chats` && method === 'POST') {
      createChatBody = JSON.parse(String(init?.body ?? '{}'));
      return json({ conversation: createdChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${GAME_CHAT_ID}/turn` && method === 'POST') {
      turnBody = JSON.parse(String(init?.body ?? '{}'));
      return json({ conversation: { ...createdChat, state: 'running' } });
    }
    if (url === `${SUPER_AGENT_API}/chats/${GAME_CHAT_ID}`) return json({ conversation: createdChat });
    if (url.endsWith('/motion-api/games') && method === 'GET') {
      const template = { ...communityGames[0], external: undefined, cover: null, source: 'template', playUrl: '/api/games/example/play/index.html' };
      return json({ games: [
        { ...template, id: 'legacy-arena', title: 'Legacy Arena', multiplayer: true, maxPlayers: 4 },
        ...Array.from({ length: 26 }, (_, i) => ({ ...template, id: `example-${i}`, title: `Example ${i + 1}` })),
      ] });
    }
    if (url.endsWith('/motion-api/games') && method === 'POST') {
      createGameBody = JSON.parse(String(init?.body ?? '{}'));
      return json({
        game: {
          id: CREATED_GAME_ID,
          title: 'Neon Arena',
          description: createGameBody.prompt,
          genre: createGameBody.genre ?? 'shooter',
          style: createGameBody.style ?? null,
          setting: createGameBody.setting ?? null,
          multiplayer: Boolean(createGameBody.multiplayer),
          maxPlayers: createGameBody.multiplayer ? 4 : 1,
          orientation: createGameBody.orientation ?? 'landscape',
          playableAd: createGameBody.playableAd,
          status: 'draft',
          cover: null,
          playUrl: `/api/games/${CREATED_GAME_ID}/play/index.html`,
          plays: 0,
          likes: 0,
          dislikes: 0,
          reaction: 0,
          favorite: false,
          source: 'mine',
          remixOf: null,
          controls: '',
          createdAt: '2026-11-22T00:00:00.000Z',
          updatedAt: '2026-11-22T00:00:00.000Z',
        },
        agentInstruction: 'Use openmotion_game_* tools to build Neon Arena.',
      });
    }
    return json({});
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  };

  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={null}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenGameStudio={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await flush();

    // Enter Game Studio mode inside Super Agent
    const gameStarter = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Build a game'))!;
    expect(gameStarter).toBeTruthy();
    await act(async () => gameStarter.click());
    await flush();

    // Verifies Game Studio hero, 6 genre strip buttons, top controls, and game market template cards
    expect(container.querySelector('.om-sa-mode-hero-copy h2')?.textContent).toBe('Create a playable game in minutes');
    expect(container.querySelector('.om-sa-mode-hero-copy p')).toBeNull();
    expect(container.querySelectorAll('.om-sa-game-genre-card').length).toBe(6);
    expect(container.querySelectorAll('.om-sa-game-showcase-card').length).toBeGreaterThan(0);

    const filters = container.querySelector('.om-sa-showcase-tabs')!;
    const gameTab = [...filters.querySelectorAll('button')].find(tab => tab.textContent?.includes('All games'))!;
    const brandTab = [...filters.querySelectorAll('button')].find(tab => tab.textContent?.includes('Brand Kits'))!;
    const viewAll = container.querySelector<HTMLButtonElement>('.om-sa-showcase-bar .om-sa-showcase-more')!;
    const gameCount = Number(gameTab.querySelector('.om-sa-tab-count')?.textContent);
    expect(viewAll.textContent).toBe('View all');
    expect(container.querySelectorAll('.om-sa-game-showcase-card').length).toBeLessThan(gameCount);
    await act(async () => viewAll.click());
    expect(container.querySelectorAll('.om-sa-game-showcase-card')).toHaveLength(gameCount);
    const legacyCard = container.querySelector('[aria-label="Play Legacy Arena"]')?.closest('article');
    expect(legacyCard).toBeTruthy();
    expect(legacyCard?.querySelector('.om-sa-game-tile-remix')).toBeNull();
    expect(container.querySelector('.om-sa-mode-ideas')?.textContent).not.toContain('Co-op 3D crystal defense');
    await act(async () => brandTab.click());
    expect(container.querySelector('.om-sa-showcase-more')).toBe(viewAll);
    expect(container.querySelector('.om-sa-game-search')).toBeNull();
    await act(async () => gameTab.click());
    expect(container.querySelector('.om-sa-showcase-more')).toBe(viewAll);
    expect(container.querySelector('.om-sa-game-search')).toBeTruthy();

    const topBar = container.querySelector('.om-sa-composer-top-bar')!;
    expect(topBar).toBeTruthy();
    expect(topBar.textContent).toContain('Shooter');
    expect(topBar.textContent).toContain('Style');
    expect(topBar.textContent).toContain('Setting');
    expect(topBar.textContent).toContain('Landscape');
    const adSwitch = topBar.querySelector<HTMLElement>('[role="switch"][aria-label="Playable ad"]')!;
    const adSwitchLabel = adSwitch.closest('label')!;
    expect(adSwitch.getAttribute('aria-checked')).toBe('false');

    // Open Style popover and pick Pixel art
    const styleTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Style')) as HTMLButtonElement;
    await act(async () => styleTrigger.click());
    await flush();
    const pixelOption = [...document.querySelectorAll('.om-sa-game-art-option')].find(b => b.textContent?.includes('Pixel art')) as HTMLButtonElement;
    expect(pixelOption).toBeTruthy();
    await act(async () => pixelOption.click());
    await flush();

    // Open Orientation dropdown and select Portrait (9:16)
    const orientationTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Landscape')) as HTMLButtonElement;
    expect(orientationTrigger.getAttribute('aria-haspopup')).toBe('listbox');
    await act(async () => orientationTrigger.click());
    await flush();
    const portraitOption = [...document.querySelectorAll('.om-sa-game-choice-row')].find(b => b.textContent?.includes('Portrait')) as HTMLButtonElement;
    expect(portraitOption).toBeTruthy();
    expect(portraitOption.textContent).toContain('9:16');
    await act(async () => portraitOption.click());
    await flush();
    expect(topBar.textContent).toContain('Portrait');
    expect(adSwitch.getAttribute('aria-checked')).toBe('true');
    await act(async () => adSwitchLabel.click());
    await flush();
    expect(topBar.textContent).toContain('Portrait');
    expect(adSwitch.getAttribute('aria-checked')).toBe('false');

    const portraitTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Portrait'))!;
    await act(async () => portraitTrigger.click());
    await flush();
    const landscapeOption = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-game-choice-row')].find(b => b.querySelector('strong')?.textContent === 'Landscape')!;
    await act(async () => landscapeOption.click());
    await flush();
    expect(adSwitch.getAttribute('aria-checked')).toBe('false');
    await act(async () => adSwitchLabel.click());
    await flush();
    expect(topBar.textContent).toContain('Portrait');
    expect(adSwitch.getAttribute('aria-checked')).toBe('true');

    // Send brief -> creates Game Studio project and starts Super Agent game turn
    await typeInComposer(getComposerEditor(container), 'Pixel shooter in space');
    const sendBtn = container.querySelector('.om-sa-send-btn') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    await act(async () => sendBtn.click());
    await flush();

    expect(createGameBody).toEqual({
      prompt: 'Pixel shooter in space',
      genre: 'shooter',
      style: 'pixel',
      setting: null,
      multiplayer: false,
      orientation: 'portrait',
      playableAd: true,
    });
    expect(createChatBody?.intent).toBe('game');
    expect(turnBody?.mode).toBe('game');
    expect(turnBody?.attachments?.some((att: any) => att.kind === 'game-project' && att.id === CREATED_GAME_ID)).toBe(true);
    expect(turnBody?.text).toBe('Pixel shooter in space');
    expect(turnBody?.hiddenInstructions).toContain('openmotion_present_artifact');
    expect(turnBody?.contextTags?.map((tag: any) => tag.label)).toEqual([
      'Game',
      'Shooter',
      'Pixel art',
      '9:16',
      'Playable ad',
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('supports unified Phase 2 Game preview console drawer ("Fix with Agent"), element picking, and Draw strokes', async () => {
  const GAME_CHAT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const GAME_ID = '11111111-1111-1111-1111-111111111111';
  const gameChat: SuperAgentChat = {
    id: GAME_CHAT_ID,
    title: 'Orbit Defender',
    engine: 'codex',
    model: 'gpt-5',
    intent: 'game',
    permissionMode: 'auto',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'idle',
    messages: [],
    artifacts: [
      {
        id: `game:${GAME_ID}`,
        kind: 'game-project',
        title: 'Orbit Defender',
        subtitle: 'shooter · Game Studio',
        projectId: GAME_ID,
        scenario: 'landscape',
        revision: '1',
        url: `/motion-api/games/${GAME_ID}/play/index.html`,
        createdAt: 1000,
        updatedAt: 2000,
      },
    ],
    activeArtifactId: `game:${GAME_ID}`,
    approvals: [],
  };

  const turns: any[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/settings/agents')) {
      return json({
        agents: [
          {
            id: 'codex',
            label: 'Codex',
            icon: 'codex',
            installed: true,
            auth: 'signed-in',
            models: [{ id: 'gpt-5', label: 'GPT-5', reasoning: ['medium'] }],
          },
        ],
      });
    }
    if (url.includes('/settings/runtimes')) return json({ runtimes: [] });
    if (url.includes(`${SUPER_AGENT_API}/resources`)) return json(sampleResources);
    if (url === `${SUPER_AGENT_API}/chats`) return json({ conversations: [{ ...gameChat }] });
    if (url === `${SUPER_AGENT_API}/chats/${GAME_CHAT_ID}`) return json({ conversation: gameChat });
    if (url === `${SUPER_AGENT_API}/chats/${GAME_CHAT_ID}/annotations` && init?.method === 'POST') {
      return json({
        id: 'game-shot-1',
        screenshotUrl: `/motion-api/super-agent/chats/${GAME_CHAT_ID}/annotations/game-shot-1.png`,
        screenshotPath: '/tmp/game-shot-1.png',
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/${GAME_CHAT_ID}/preview-snapshot` && init?.method === 'POST') {
      return json({
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
        width: 800,
        height: 600,
        pageUrl: `/motion-api/games/${GAME_ID}/play/index.html`,
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/${GAME_CHAT_ID}/turn` && init?.method === 'POST') {
      turns.push(init.body ? JSON.parse(String(init.body)) : null);
      return json({ conversation: gameChat });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={GAME_CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenGameStudio={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  const viewerToggle = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === 'Artifact Viewer',
  ) as HTMLButtonElement;
  await act(async () => viewerToggle.click());
  for (let i = 0; i < 30 && !document.querySelector('.om-sa-viewer iframe'); i++) {
    await flush();
  }

  const viewer = document.querySelector('.om-sa-viewer')!;
  const iframe = viewer.querySelector('iframe') as HTMLIFrameElement;
  expect(iframe).toBeTruthy();
  const bridgeToken = new URL(iframe.getAttribute('src')!, 'http://localhost').searchParams.get('omBridge')!;
  expect(bridgeToken).toBeTruthy();

  // Dispatch runtime error & warning from sandboxed game bridge
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'om:preview-console', token: bridgeToken, level: 'error', text: 'ReferenceError: boss is undefined', timestamp: 1 },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'om:preview-console', token: bridgeToken, level: 'warn', text: 'Low FPS warning', timestamp: 2 },
    }));
  });
  await flush();

  expect(viewer.querySelector('.om-sa-console-toolbar-badge')?.textContent).toBe('1');
  const consoleBtn = viewer.querySelector('button[aria-label="Open console"]') as HTMLButtonElement;
  await act(async () => consoleBtn.click());
  await flush();

  const drawer = viewer.querySelector('.om-sa-console-drawer')!;
  expect(drawer.textContent).toContain('ReferenceError: boss is undefined');
  const errorsFilter = [...drawer.querySelectorAll('.om-sa-console-filter-btn')].find(b => b.textContent === 'Errors') as HTMLButtonElement;
  await act(async () => errorsFilter.click());
  await flush();
  expect(drawer.textContent).not.toContain('Low FPS warning');

  const fixBtn = [...drawer.querySelectorAll('button')].find(b => b.textContent?.includes('Fix with Agent')) as HTMLButtonElement;
  await act(async () => fixBtn.click());
  await flush();
  expect(turns.length).toBe(1);
  expect(turns[0].attachments?.[0]?.annotation?.mode).toBe('console');
  expect(turns[0].attachments?.[0]?.annotation?.consoleErrors?.[0]).toContain('boss is undefined');

  // Toggle Annotate -> verify Select (picked via bridge) and Draw freehand stroke
  const annotBtn = viewer.querySelector('button[aria-label="Annotate elements, regions, and drawings"]') as HTMLButtonElement;
  await act(async () => annotBtn.click());
  await flush();

  const overlay = viewer.querySelector('.om-sa-annot-layer') as HTMLElement;
  expect(overlay.textContent).toContain('Select');
  const frameEl = viewer.querySelector('.om-sa-iframe-frame') as HTMLElement;
  frameEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'om:preview-pick',
        token: bridgeToken,
        element: {
          tagName: 'canvas',
          selector: '#game-canvas',
          label: 'GameCanvas',
          htmlPreview: '<canvas id="game-canvas"></canvas>',
          styles: { display: 'block' },
          rect: { x: 10, y: 10, width: 300, height: 200 },
          viewport: { width: 800, height: 600 },
        },
        viewport: { width: 800, height: 600 },
        rect: { x: 10, y: 10, width: 300, height: 200 },
      },
    }));
  });
  await flush();
  expect(viewer.querySelector('.om-sa-annot-badge')?.textContent).toContain('#game-canvas');

  // Clear element pin, switch to Draw mode, draw a stroke, and Attach
  const clearDraftBtn = [...overlay.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Clear') as HTMLButtonElement;
  await act(async () => clearDraftBtn.click());
  const drawBtn = [...overlay.querySelectorAll('button')].find(b => b.textContent?.includes('Draw')) as HTMLButtonElement;
  await act(async () => drawBtn.click());
  await flush();

  const backdrop = overlay.querySelector('.om-sa-annot-backdrop') as HTMLElement;
  backdrop.setPointerCapture = vi.fn();

  await act(async () => {
    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 60 }));
  });
  await act(async () => {
    backdrop.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 140 }));
  });
  await act(async () => {
    backdrop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 120, clientY: 140 }));
  });
  await flush();

  const noteInput = viewer.querySelector('.om-sa-annot-input') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(noteInput, 'Add explosion glow here');
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const attachBtn = viewer.querySelector('.om-sa-annot-attach-btn') as HTMLButtonElement;
  await act(async () => attachBtn.click());
  for (let i = 0; i < 80 && !document.querySelector('.om-sa-composer-chips .om-sa-attachment-chip[data-kind="browser-annotation"]'); i++) {
    await flush();
  }

  const chip = document.querySelector('.om-sa-composer-chips .om-sa-attachment-chip[data-kind="browser-annotation"]');
  expect(chip?.textContent).toContain('Add explosion glow here');

  const sendBtn = document.querySelector('.om-sa-send-btn') as HTMLButtonElement;
  await act(async () => sendBtn.click());
  await flush();
  expect(turns.length).toBe(2);
  expect(turns[1].attachments?.[0]?.annotation?.mode).toBe('draw');
  expect(turns[1].attachments?.[0]?.annotation?.strokeCount).toBe(1);
  expect(turns[1].attachments?.[0]?.annotation?.strokeBounds).toBeTruthy();
});

it('auto-opens and re-opens the right Artifact Viewer tab whenever a game artifact is presented via presentedAt', async () => {
  const GAME_CHAT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const GAME_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const baseChat: SuperAgentChat = {
    id: GAME_CHAT_ID,
    title: 'Celestial Star Journey',
    engine: 'codex',
    model: 'gpt-5',
    intent: 'game',
    permissionMode: 'auto',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'running',
    messages: [
      { id: 'u-1', role: 'user', text: 'Build Celestial Star Journey', createdAt: 1000 },
    ],
    artifacts: [],
    approvals: [],
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/settings/agents')) {
      return json({
        agents: [{ id: 'codex', label: 'Codex', detected: true, binary: '/usr/local/bin/codex', models: [{ id: 'gpt-5', label: 'GPT-5' }] }],
        defaultAgent: 'codex',
      });
    }
    if (url.endsWith('/super-agent/resources')) return json(sampleResources);
    if (url.endsWith('/super-agent/chats')) return json({ conversations: [{ ...baseChat, messageCount: 1, artifactCount: 0 }] });
    if (url.endsWith(`/super-agent/chats/${GAME_CHAT_ID}`)) return json({ conversation: baseChat });
    if (url.includes(`/games/${GAME_ID}/files`)) return json({ files: [{ path: 'index.html', bytes: 64 }] });
    if (url.includes('/api/account')) return json({ signedIn: false });
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={GAME_CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenGameStudio={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  // While building with no ready artifact, the Artifact Viewer stays closed.
  expect(document.querySelector('.om-sa-viewer')).toBeNull();

  const sse = MockEventSource.instances.at(-1)!;
  expect(sse).toBeTruthy();
  const emitChat = async (next: SuperAgentChat) => {
    const listeners = sse.listeners.get('chat') ?? [];
    await act(async () => {
      for (const fn of listeners) {
        fn({ data: JSON.stringify(next) } as MessageEvent);
      }
    });
    await flush();
  };

  // Once the game finishes and calls unified presentation (presentedAt = 5000), viewer auto-opens with the game tab.
  const presentedOnce: SuperAgentChat = {
    ...baseChat,
    state: 'idle',
    updatedAt: 5000,
    activeArtifactId: `game:${GAME_ID}`,
    artifacts: [
      {
        id: `game:${GAME_ID}`,
        kind: 'game-project',
        title: 'Celestial Star Journey',
        subtitle: 'story · Game Studio',
        projectId: GAME_ID,
        scenario: 'landscape',
        revision: 'rev-1',
        url: `/motion-api/games/${GAME_ID}/play/index.html`,
        createdAt: 5000,
        updatedAt: 5000,
        presentedAt: 5000,
      },
    ],
  };
  await emitChat(presentedOnce);

  let viewer = document.querySelector('.om-sa-viewer')!;
  expect(viewer).toBeTruthy();
  let iframe = viewer.querySelector('iframe');
  expect(iframe?.getAttribute('src')).toContain(`/motion-api/games/${GAME_ID}/play/index.html`);
  expect(iframe?.getAttribute('src')).toContain('p=5000');

  // User closes the Artifact Viewer pane manually.
  const closeBtn = viewer.querySelector('button[aria-label="Close viewer"]') as HTMLButtonElement;
  expect(closeBtn).toBeTruthy();
  await act(async () => closeBtn.click());
  await flush();
  expect(document.querySelector('.om-sa-viewer')).toBeNull();

  // Passive revision update mid-turn (presentedAt unchanged) must NOT unexpectedly reopen the closed viewer.
  await emitChat({
    ...presentedOnce,
    state: 'running',
    updatedAt: 6000,
    artifacts: [
      {
        ...presentedOnce.artifacts[0],
        revision: 'rev-2',
        updatedAt: 6000,
      },
    ],
  });
  expect(document.querySelector('.om-sa-viewer')).toBeNull();

  // Explicit presentation / turn-end completion advances presentedAt -> automatically re-opens the side pane and reloads iframe.
  await emitChat({
    ...presentedOnce,
    state: 'idle',
    updatedAt: 7000,
    artifacts: [
      {
        ...presentedOnce.artifacts[0],
        revision: 'rev-2',
        updatedAt: 7000,
        presentedAt: 7000,
      },
    ],
  });
  viewer = document.querySelector('.om-sa-viewer')!;
  expect(viewer).toBeTruthy();
  iframe = viewer.querySelector('iframe');
  expect(iframe?.getAttribute('src')).toContain('p=7000');
});

it.each([
  ['New task', '.om-sa-new-chat-btn'],
  ['the Super Agent sidebar title', 'button[aria-label="Super Agent · Back to home"]'],
])('clicking %s resets to a clean draft without creating a persisted chat until submission', async (_label, selector) => {
  const onChatIdChange = vi.fn();
  const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={onChatIdChange}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  const button = document.querySelector<HTMLButtonElement>(selector)!;
  expect(button).toBeTruthy();

  fetchSpy.mockClear();
  await act(async () => button.click());
  await flush();

  const createCalls = fetchSpy.mock.calls.filter(
    ([input, init]) => String(input) === `${SUPER_AGENT_API}/chats` && init?.method === 'POST',
  );
  expect(createCalls).toHaveLength(0);
  expect(onChatIdChange).toHaveBeenCalledWith(null);
  expect(document.body.textContent).toContain('What can I create for you?');
  expect(document.querySelector('.om-sa-viewer')).toBeNull();
});

it('renders persistent live progress dock, ticking step timers, and Continue recovery card for stopped or failed runs', async () => {
  const onContinue = vi.fn();

  // 1. Live progress dock with determinate plan progress & streaming reasoning/tool timers
  const baseChat: SuperAgentChat = {
    id: CHAT_ID,
    title: 'Build Racing Game Studio Project',
    intent: 'game',
    engine: 'antigravity',
    permissionMode: 'on-request',
    createdAt: Date.now() - 20_000,
    updatedAt: Date.now(),
    state: 'idle',
    messages: [],
    artifacts: [],
    approvals: [],
  };

  const liveChat: SuperAgentChat = {
    ...baseChat,
    state: 'running',
    updatedAt: Date.now(),
    lastTurnDurationMs: undefined,
    turnActivity: {
      phase: 'thinking',
      label: 'Antigravity',
      startedAt: Date.now() - 12_400,
      updatedAt: Date.now(),
      plan: [
        { content: 'Read workflow guide', status: 'completed' },
        { content: 'Build racing game canvas', status: 'in_progress' },
        { content: 'Verify and present', status: 'pending' },
      ],
    },
    messages: [
      { id: 'u-1', role: 'user', text: 'Build a racing game', createdAt: Date.now() - 15_000 },
      {
        id: 't-1',
        role: 'tool',
        text: 'openmotion_game_write_files',
        createdAt: Date.now() - 4_000,
        toolEvent: {
          callId: 'call-write',
          tool: 'openmotion_game_write_files',
          label: 'Write game files',
          status: 'running',
          category: 'file_write',
          startedAt: Date.now() - 3_200,
        },
      },
      { id: 'r-empty', role: 'reasoning', text: '', status: 'streaming', createdAt: Date.now() - 3_000 },
      {
        id: 'r-1',
        role: 'reasoning',
        text: 'Preparing track physics and HUD...',
        status: 'streaming',
        createdAt: Date.now() - 2_300,
      },
    ],
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <div>
          <ExecutionTimeline
            chat={liveChat}
            busy
            sending={false}
            hideInlineStatus
            engineLabel="Antigravity"
            onOpenArtifactId={vi.fn()}
            onPreviewAttachment={vi.fn()}
            onCopyText={vi.fn()}
            onApprove={vi.fn()}
            onContinue={onContinue}
          />
          <SuperAgentLiveProgressDock
            chat={liveChat}
            busy
            sending={false}
            engineLabel="Antigravity"
          />
        </div>
      </I18nProvider>,
    );
  });
  await flush();

  const dock = document.querySelector('.om-sa-progress-dock')!;
  expect(dock).toBeTruthy();
  expect(dock.textContent).toContain('Thinking…');
  expect(dock.textContent).toContain('1/3 tasks');
  const progressBar = dock.querySelector('.om-sa-progress-bar') as HTMLElement;
  expect(progressBar.getAttribute('data-determinate')).toBe('true');
  expect(progressBar.style.width).toBe('33%');
  expect(document.querySelector('.om-sa-work-summary-timer')).toBeTruthy();
  expect(document.querySelectorAll('.om-sa-reasoning-row')).toHaveLength(1);
  expect(document.querySelector('.om-sa-reasoning-label')?.textContent).toMatch(/Thinking… · \d+(?:\.\d+)?s/);
  expect(document.querySelector('.om-sa-work-summary-label')?.textContent).toMatch(/Working for \d+/);

  // 2. Cancelled mid-run turn renders recovery card with step summary and Continue button
  const cancelledChat: SuperAgentChat = {
    ...baseChat,
    state: 'cancelled',
    error: undefined,
    lastTurnDurationMs: 116_000,
    messages: [
      { id: 'u-1', role: 'user', text: 'Build a racing game', createdAt: 1000 },
      {
        id: 't-done',
        role: 'tool',
        text: 'openmotion_read_workflow',
        createdAt: 2000,
        toolEvent: {
          callId: 'c-done',
          tool: 'openmotion_read_workflow',
          label: 'Read workflow guidance',
          status: 'completed',
          category: 'mcp',
          startedAt: 2000,
          finishedAt: 2006,
          durationMs: 6,
          inputPreview: JSON.stringify({ workflow: 'game', section: 'review' }),
        },
      },
      { id: 'r-old-empty', role: 'reasoning', text: '', status: 'completed', durationMs: 110_000, createdAt: 3000 },
      {
        id: 'r-done',
        role: 'reasoning',
        text: 'Considering 2D widescreen racing...',
        status: 'completed',
        durationMs: 54_000,
        createdAt: 3500,
      },
    ],
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={cancelledChat}
          busy={false}
          sending={false}
          engineLabel="Antigravity"
          onOpenArtifactId={vi.fn()}
          onPreviewAttachment={vi.fn()}
          onCopyText={vi.fn()}
          onApprove={vi.fn()}
          onContinue={onContinue}
        />
      </I18nProvider>,
    );
  });
  await flush();

  const interruptedCard = document.querySelector('.om-sa-interrupted-card')!;
  expect(interruptedCard).toBeTruthy();
  expect(interruptedCard.textContent).toContain('Stopped before finishing');
  expect(interruptedCard.textContent).toContain('2 steps');
  expect(document.querySelectorAll('.om-sa-reasoning-row')).toHaveLength(1);
  expect(document.querySelector('.om-sa-tool-summary')?.textContent).toBe('Game review rubric');
  expect(document.querySelector('.om-sa-step-time')?.textContent).toBe('6ms');
  const continueBtn = interruptedCard.querySelector('.om-sa-continue-btn') as HTMLButtonElement;
  expect(continueBtn.textContent).toContain('Continue');
  await act(async () => continueBtn.click());
  expect(onContinue).toHaveBeenCalledTimes(1);

  // 3. Failed turn with chat.error also offers Continue inside .om-sa-error-card
  const failedChat: SuperAgentChat = {
    ...cancelledChat,
    state: 'failed',
    error: 'Server restarted while the Agent was running. Click Continue to resume from where it left off.',
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={failedChat}
          busy={false}
          sending={false}
          engineLabel="Antigravity"
          onOpenArtifactId={vi.fn()}
          onPreviewAttachment={vi.fn()}
          onCopyText={vi.fn()}
          onApprove={vi.fn()}
          onContinue={onContinue}
        />
      </I18nProvider>,
    );
  });
  await flush();

  const errorCard = document.querySelector('.om-sa-error-card')!;
  expect(errorCard).toBeTruthy();
  expect(errorCard.textContent).toContain('Server restarted while the Agent was running.');
  const errorContinueBtn = errorCard.querySelector('.om-sa-continue-btn') as HTMLButtonElement;
  expect(errorContinueBtn).toBeTruthy();
  await act(async () => errorContinueBtn.click());
  expect(onContinue).toHaveBeenCalledTimes(2);
});

it('auto-enters Game mode when opened from Game Studio, plays games in Artifact Viewer without creating empty chats, and supports remix selection', async () => {
  let chatCreateCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    if (url.includes('/motion-api/super-agent/chats') && method === 'POST') {
      chatCreateCalls += 1;
    }
    if (url.includes('/motion-api/super-agent/chats')) return jsonResponse({ conversations: [] });
    if (url.includes('/motion-api/super-agent/resources')) return jsonResponse({ items: [], counts: { assets: 0, designProjects: 0, motionProjects: 0, brandKits: 0, templates: 0, skills: 0, total: 0 } });
    if (url.includes('/motion-api/settings/agents')) return jsonResponse({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    if (url.includes('/motion-api/settings/agent-runtimes')) return jsonResponse({ localDirectAvailable: true, runtimes: [] });
    if (url.includes('/motion-api/games')) return jsonResponse({ games: [] });
    return jsonResponse({});
  }));

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="game"
          requestedGameId="community-little-prince"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  // Auto-switched into Game mode with fanned hero, search input, sort combobox, and masonry waterfall
  expect(container.querySelector('.om-sa-stream')?.getAttribute('data-mode')).toBe('game');
  expect(container.querySelectorAll('.om-sa-game-fan-card').length).toBeGreaterThan(0);
  expect(container.querySelectorAll('.om-sa-game-fan-actions .om-sa-game-tile-play').length).toBe(1);
  expect(container.querySelector('.om-sa-game-search input')).toBeTruthy();
  expect(container.querySelector('.om-sa-game-sort [role="combobox"]')).toBeTruthy();
  expect(container.querySelectorAll('.om-sa-game-tile').length).toBeGreaterThan(0);

  // requestedGameId opens immediately in the right-hand Artifact Viewer without creating an empty chat
  const viewer = container.querySelector('.om-sa-viewer');
  expect(viewer).toBeTruthy();
  expect(viewer?.textContent).toContain('The Little Prince: Star Journey');
  expect(chatCreateCalls).toBe(0);

  // Clicking "Remix" inside the Artifact Viewer selects the playing game into the Agent composer
  const viewerUseBtn = viewer?.querySelector('.om-sa-game-use-btn') as HTMLButtonElement;
  expect(viewerUseBtn).toBeTruthy();
  expect(viewerUseBtn.textContent).toContain('Remix');
  await act(async () => viewerUseBtn.click());
  await flush();
  expect(container.querySelector('.om-sa-composer-chips')?.textContent).toContain('The Little Prince: Star Journey');

  const gameInput = getComposerEditor(container);
  expect(gameInput.textContent).toBe(communityGames.find(game => game.id === 'community-little-prince')!.description);

  // Top fanned Hero carousel rotates smoothly via Next/Previous controls and side-card clicks
  const initialCenterLabel = container.querySelector('.om-sa-game-fan-item[data-slot="0"] .om-sa-game-fan-card')?.getAttribute('aria-label');
  const nextFanBtn = container.querySelector('.om-sa-game-fan-nav[data-side="next"]') as HTMLButtonElement;
  expect(nextFanBtn).toBeTruthy();
  await act(async () => nextFanBtn.click());
  await flush();
  const nextCenterLabel = container.querySelector('.om-sa-game-fan-item[data-slot="0"] .om-sa-game-fan-card')?.getAttribute('aria-label');
  expect(nextCenterLabel).not.toBe(initialCenterLabel);

  // Clicking the center Hero card selects it into the Agent composer (not jarring auto-play)
  const fanCenterCard = container.querySelector('.om-sa-game-fan-item[data-slot="0"] .om-sa-game-fan-card') as HTMLButtonElement;
  expect(fanCenterCard).toBeTruthy();
  await act(async () => fanCenterCard.click());
  await flush();
  expect(container.querySelector('.om-sa-composer-chips')?.textContent).toContain('Remix ·');

  // Clicking a bottom masonry card cover selects it into the composer. The Try game button opens the viewer.
  const listCoverBtn = container.querySelector('.om-sa-game-tile .om-sa-game-tile-cover') as HTMLButtonElement;
  expect(listCoverBtn).toBeTruthy();
  await act(async () => listCoverBtn.click());
  await flush();
  expect(container.querySelector('.om-sa-composer-chips')?.textContent).toContain('Remix ·');

  const racingGame = communityGames.find(game => game.id === 'community-turbo-kart')!;
  const racingCard = container.querySelector<HTMLButtonElement>(`.om-sa-game-tile-cover[aria-label="Remix: ${racingGame.title}"]`)!;
  await act(async () => racingCard.click());
  expect(gameInput.textContent).toBe(racingGame.description);
  await act(async () => racingCard.click());
  expect(gameInput.textContent).toBe('');
  await act(async () => racingCard.click());
  await typeInComposer(gameInput, ' Make the race three laps.');
  await act(async () => racingCard.click());
  expect(gameInput.textContent).toBe(`${racingGame.description} Make the race three laps.`);

  const listPlayBtn = container.querySelector('.om-sa-game-tile .om-sa-game-tile-play') as HTMLButtonElement;
  expect(listPlayBtn).toBeTruthy();
  expect(listPlayBtn.textContent).toContain('Try game');
  await act(async () => listPlayBtn.click());
  await flush();
  expect(container.querySelector('.om-sa-viewer')).toBeTruthy();

  const evensong = communityGames.find(game => game.id === 'community-evensong')!;
  const evensongPlay = container.querySelector<HTMLButtonElement>(`button[aria-label="Try game: ${evensong.title}"]`)!;
  const origin = new URL(evensong.external!.url).origin;
  await act(async () => evensongPlay.focus());
  expect(document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)).toBeTruthy();

  await act(async () => evensongPlay.click());
  const gameFrame = () => container.querySelector<HTMLIFrameElement>(`iframe[title="${evensong.title}"]`);
  const originalFrame = gameFrame();
  expect(originalFrame?.getAttribute('src')).toBe(evensong.external!.url);

  await act(async () => evensongPlay.click());
  expect(gameFrame()).toBe(originalFrame);

  const reload = container.querySelector<HTMLButtonElement>('.om-sa-viewer button[aria-label="Reload"]')!;
  await act(async () => reload.click());
  expect(gameFrame()).not.toBe(originalFrame);
});

it('consumes Cloud deploy requests across viewer remounts and aborts deploy when opening a game fails', async () => {
  let failPatch = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/motion-api/web-publish/')) {
      return new Response(
        JSON.stringify({
          targetKind: 'game',
          targetId: 'community-little-prince',
          projectId: 'community-little-prince',
          accountSignedIn: false,
          accountState: 'signed-out',
          publications: [],
          deployments: [],
          active: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/motion-api/settings/account')) {
      return new Response(JSON.stringify({ state: 'signed-out' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}` && init?.method === 'PATCH' && failPatch) {
      return new Response(JSON.stringify({ error: 'Network unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return origFetch(input, init);
  }) as any;

  // 1) Deploy once, close viewer (unmounts WebPublishPopover), then Play another game -> popover must NOT auto-open again
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="game"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  const deployBtn = container.querySelector('.om-sa-game-fan-actions .om-sa-game-tile-deploy') as HTMLButtonElement;
  expect(deployBtn).toBeTruthy();
  await act(async () => deployBtn.click());
  await flush();
  expect(document.querySelector('.om-web-publish-popover')).toBeTruthy();

  // Close the viewer so WebPublishPopover unmounts
  const closeViewerBtn = container.querySelector('button[aria-label="Close viewer"]') as HTMLButtonElement;
  expect(closeViewerBtn).toBeTruthy();
  await act(async () => closeViewerBtn.click());
  await flush();
  expect(container.querySelector('.om-sa-viewer')).toBeNull();
  expect(document.querySelector('.om-web-publish-popover')).toBeNull();

  // Click Play on a masonry game card -> viewer remounts, but Cloud share popover must stay closed
  const playBtn = container.querySelector('.om-sa-game-tile .om-sa-game-tile-play') as HTMLButtonElement;
  expect(playBtn).toBeTruthy();
  await act(async () => playBtn.click());
  await flush();
  expect(container.querySelector('.om-sa-viewer')).toBeTruthy();
  expect(document.querySelector('.om-web-publish-popover')).toBeNull();

  // 2) With an active chat that has game A selected, failing PATCH on Cloud deploy for game B must NOT open game A's popover
  const emptyGameChat: SuperAgentChat = {
    ...sampleChat,
    messages: [],
    artifacts: [
      {
        id: 'game:game-a',
        kind: 'game-project',
        title: 'Game A',
        projectId: 'game-a',
        url: '/motion-api/games/game-a/play/index.html',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    activeArtifactId: 'game:game-a',
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}` && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ conversation: emptyGameChat }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return prevFetch(input, init);
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          requestedMode="game"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  failPatch = true;
  const deployGameBBtn = container.querySelector('.om-sa-game-tile .om-sa-game-tile-deploy') as HTMLButtonElement;
  expect(deployGameBBtn).toBeTruthy();
  await act(async () => deployGameBBtn.click());
  await flush();
  expect(document.querySelector('.om-web-publish-popover')).toBeNull();
});

it('keeps Skill handoff instructions out of visible user messages and renders human-readable approval cards with collapsed technical details', async () => {
  let turnBody: any = null;
  let approveBody: any = null;
  const APPROVAL_CHAT_ID = '66666666-6666-4666-8666-666666666666';
  const rawScriptDetail = JSON.stringify({
    command: 'python3 - <<\'OPENMOTION_SCORE\'\nfrom pathlib import Path\ndestination = Path("欢快背景音乐.wav")\nOPENMOTION_SCORE',
    availableDecisions: ['accept', 'cancel'],
  }, null, 2);

  let currentChat: SuperAgentChat = {
    id: APPROVAL_CHAT_ID,
    title: '2024小游戏',
    intent: 'game',
    engine: 'codex',
    permissionMode: 'on-request',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'idle',
    messages: [],
    artifacts: [],
    approvals: [],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json({
        counts: { assets: 0, brandKits: 0, officialBrandKits: 0, motionTemplates: 0, designTemplates: 0, skills: 0, designSkills: 0, designProjects: 0, motionProjects: 0, mediaProvidersAvailable: 0, workflows: 0, models: 0, games: 0 },
        items: [],
        generatedAt: Date.now(),
      });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({ conversations: [] });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'POST') {
      return json({ conversation: currentChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${APPROVAL_CHAT_ID}` && method === 'GET') {
      return json({ conversation: currentChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${APPROVAL_CHAT_ID}/turn` && method === 'POST') {
      turnBody = JSON.parse(String(init?.body || '{}'));
      currentChat = {
        ...currentChat,
        state: 'waiting',
        messages: [
          {
            id: 'msg-u1',
            role: 'user',
            text: turnBody.text,
            createdAt: 2001,
            attachments: turnBody.attachments,
            contextTags: turnBody.contextTags,
          },
        ],
        approvals: [
          {
            id: 'appr-audio-1',
            kind: 'command',
            title: 'Command approval',
            detail: rawScriptDetail,
          },
        ],
      };
      return json({ conversation: currentChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${APPROVAL_CHAT_ID}/approve` && method === 'POST') {
      approveBody = JSON.parse(String(init?.body || '{}'));
      currentChat = {
        ...currentChat,
        state: 'idle',
        permissionMode: approveBody.alwaysAllow ? 'auto' : currentChat.permissionMode,
        approvals: [],
      };
      return json({ conversation: currentChat });
    }
    return json({});
  }) as any;

  queueSuperAgentHandoff(buildSuperAgentHandoff(
    { kind: 'game-project', id: 'game-2024', title: '我想做一个2024小游戏', genre: 'casual' },
    {
      prompt: '我想做一个2024小游戏',
      hiddenInstructions: 'Use the openmotion-game Skill to build game game-2024. Read openmotion://workflow/game/start.',
      contextTags: [
        { kind: 'mode', label: 'Game', icon: 'gamepad-line', tone: 'agent' },
        { kind: 'param', label: 'Casual' },
        { kind: 'param', label: '9:16' },
        { kind: 'param', label: 'Single player' },
      ],
      locale: 'zh-CN',
      autoSend: true,
      newChat: true,
    },
  ));

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  // Hidden Skill instructions go to the backend turn payload, never into the visible user bubble
  expect(turnBody?.text).toBe('我想做一个2024小游戏');
  expect(turnBody?.hiddenInstructions).toContain('openmotion-game Skill');
  const userBubble = container.querySelector('.om-sa-user-bubble');
  expect(userBubble?.textContent).toContain('我想做一个2024小游戏');
  expect(userBubble?.textContent).not.toContain('openmotion-game Skill');
  expect(userBubble?.textContent).not.toContain('openmotion://workflow/game/start');

  // Mode + parameter tags render cleanly above the user bubble, while duplicate draft game chip is suppressed
  const tagLabels = [...container.querySelectorAll('.om-sa-context-tag')].map(el => el.textContent?.trim());
  expect(tagLabels).toEqual(['Game', 'Casual', '9:16', 'Single player']);
  expect(container.querySelectorAll('.om-sa-msg-attachments .om-sa-attachment-chip').length).toBe(0);

  // Approval card renders plain-language summary + target chip, with technical details collapsed by default
  const approvalCard = container.querySelector('.om-sa-approval')!;
  expect(approvalCard).toBeTruthy();
  expect(approvalCard.querySelector('.om-sa-approval-title')?.textContent).toBe('Create audio file');
  expect(approvalCard.querySelector('.om-sa-approval-target')?.textContent).toBe('欢快背景音乐.wav');
  expect(approvalCard.querySelector('.om-sa-approval-summary')?.textContent).toContain('欢快背景音乐.wav');
  const detailsEl = approvalCard.querySelector('details.om-sa-approval-details') as HTMLDetailsElement;
  expect(detailsEl).toBeTruthy();
  expect(detailsEl.open).toBe(false);
  expect(detailsEl.querySelector('.om-sa-approval-pre')?.textContent).not.toContain('availableDecisions');

  // Clicking "Always allow" sends alwaysAllow: true and clears the card
  const alwaysAllowBtn = [...approvalCard.querySelectorAll('button')].find(
    b => b.textContent?.trim() === 'Always allow',
  ) as HTMLButtonElement;
  expect(alwaysAllowBtn).toBeTruthy();
  await act(async () => alwaysAllowBtn.click());
  await flush();
  expect(approveBody).toEqual({
    approvalId: 'appr-audio-1',
    accepted: true,
    alwaysAllow: true,
  });
  expect(container.querySelector('.om-sa-approval')).toBeNull();
});

it('FilesChangedCard renders collapsible folder tree, inline diff/image preview, and Open in Code Viewer', async () => {
  const onCopyText = vi.fn();
  const onOpenChangedFile = vi.fn();
  const treeChat: SuperAgentChat = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Action Shooter',
    intent: 'game',
    engine: 'antigravity',
    permissionMode: 'auto',
    projectDir: '/tmp/workspace/games/game-9',
    projectKind: 'game',
    createdAt: 1000,
    updatedAt: 4500,
    state: 'idle',
    artifacts: [
      {
        id: 'game:game-9',
        kind: 'game-project',
        title: 'Action Shooter',
        projectId: 'game-9',
        createdAt: 2000,
        updatedAt: 3000,
      },
    ],
    turnChangedFiles: {
      u1: [
        { action: 'create', path: 'design/plan.md', addedLines: 4, diffPreview: '+# Plan', artifactId: 'game:game-9' },
        { action: 'create', path: 'design/assets.csv', addedLines: 2, diffPreview: '+name,type', artifactId: 'game:game-9' },
        { action: 'create', path: 'design/verification.md', addedLines: 3, diffPreview: '+# Verified', artifactId: 'game:game-9' },
        { action: 'create', path: 'assets/icon.svg', addedLines: 1, diffPreview: '+<svg/>', artifactId: 'game:game-9', previewUrl: '/motion-api/games/game-9/play/assets/icon.svg' },
        { action: 'create', path: 'assets/cover.png', binary: true, sizeBytes: 12400, artifactId: 'game:game-9', previewUrl: '/motion-api/games/game-9/play/assets/cover.png' },
        { action: 'create', path: 'index.html', addedLines: 10, diffPreview: '+<!doctype html>', artifactId: 'game:game-9' },
        { action: 'create', path: 'style.css', addedLines: 8, diffPreview: '+body { margin: 0; }', artifactId: 'game:game-9' },
        { action: 'edit', path: 'client.js', addedLines: 5, removedLines: 1, diffPreview: '-old()\n+new()', artifactId: 'game:game-9' },
        { action: 'create', path: 'logic.js', addedLines: 12, diffPreview: '+export const meta = {};', artifactId: 'game:game-9' },
      ],
    },
    approvals: [],
    messages: [
      { id: 'u1', role: 'user', text: 'Build action game', createdAt: 1000 },
      { id: 'a1', role: 'assistant', text: 'Done.', createdAt: 4000, status: 'completed' },
    ],
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={treeChat}
          busy={false}
          sending={false}
          engineLabel="Antigravity"
          onOpenArtifactId={vi.fn()}
          onOpenChangedFile={onOpenChangedFile}
          onPreviewAttachment={vi.fn()}
          onCopyText={onCopyText}
          onApprove={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  const card = container.querySelector('.om-sa-files-changed')!;
  expect(card.textContent).toContain('Files changed (9)');
  expect(card.textContent).toContain('+45');
  expect(card.textContent).toContain('-1');

  const folderNames = [...card.querySelectorAll('.om-sa-file-folder-name')].map(el => el.textContent);
  expect(folderNames).toEqual(['assets', 'design']);
  expect(card.textContent).toContain('index.html');
  expect(card.textContent).toContain('cover.png');
  expect(card.textContent).toContain('assets.csv');

  // Collapse all folders via header action, then re-expand
  const collapseAllBtn = card.querySelector<HTMLButtonElement>('.om-sa-files-head-action-btn')!;
  expect(collapseAllBtn.textContent).toContain('Collapse all');
  await act(async () => collapseAllBtn.click());
  await flush();
  expect(card.textContent).not.toContain('cover.png');
  expect(card.textContent).not.toContain('plan.md');
  expect(card.querySelector('.om-sa-files-head-action-btn')?.textContent).toContain('Expand all');

  await act(async () => collapseAllBtn.click());
  await flush();
  expect(card.textContent).toContain('cover.png');

  // Collapse a single folder (assets)
  const assetsFolderBtn = [...card.querySelectorAll<HTMLButtonElement>('.om-sa-file-folder-trigger')].find(
    el => el.textContent?.includes('assets'),
  )!;
  await act(async () => assetsFolderBtn.click());
  await flush();
  expect(card.textContent).not.toContain('cover.png');
  expect(card.textContent).toContain('plan.md');
  await act(async () => assetsFolderBtn.click());
  await flush();

  // Clicking binary image opens inline preview drawer
  const coverBtn = [...card.querySelectorAll<HTMLButtonElement>('.om-sa-file-row-trigger')].find(
    el => el.title === 'assets/cover.png',
  )!;
  await act(async () => coverBtn.click());
  await flush();
  const imgPreview = card.querySelector<HTMLImageElement>('.om-sa-file-preview-img');
  expect(imgPreview?.getAttribute('src')).toBe('/motion-api/games/game-9/play/assets/cover.png');

  // Clicking "Open in Code Viewer" invokes callback with index.html
  const openViewerBtn = [...card.querySelectorAll<HTMLButtonElement>('.om-sa-file-copy-btn')].find(
    btn => btn.getAttribute('aria-label') === 'Open in Code Viewer' && btn.closest('.om-sa-file-change-row')?.textContent?.includes('index.html'),
  )!;
  expect(openViewerBtn).toBeTruthy();
  await act(async () => openViewerBtn.click());
  await flush();
  expect(onOpenChangedFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'index.html', artifactId: 'game:game-9' }));

  // Project directory footer button copies canonical directory
  const dirFootBtn = card.querySelector<HTMLButtonElement>('.om-sa-files-dir-btn')!;
  expect(dirFootBtn.textContent).toContain('/tmp/workspace/games/game-9');
  await act(async () => dirFootBtn.click());
  expect(onCopyText).toHaveBeenCalledWith('/tmp/workspace/games/game-9');

  // Card header toggles full collapse
  const cardHeadBtn = card.querySelector<HTMLButtonElement>('.om-sa-files-changed-head-btn')!;
  await act(async () => cardHeadBtn.click());
  await flush();
  expect(card.querySelector('.om-sa-files-changed-list')).toBeNull();
});

it('SuperAgentWorkspace shows task project directory in header and opens changed file in Code Viewer', async () => {
  const GAME_TREE_CHAT_ID = '22222222-2222-4222-8222-222222222222';
  const chatPayload: SuperAgentChat = {
    id: GAME_TREE_CHAT_ID,
    title: 'Neon Runner',
    intent: 'game',
    engine: 'antigravity',
    permissionMode: 'auto',
    projectDir: '/tmp/data/games/game-neon-1',
    projectKind: 'game',
    createdAt: 1000,
    updatedAt: 5000,
    state: 'idle',
    artifacts: [
      {
        id: 'game:game-neon-1',
        kind: 'game-project',
        title: 'Neon Runner',
        projectId: 'game-neon-1',
        url: '/motion-api/games/game-neon-1/play/index.html',
        revision: 'rev-1',
        createdAt: 2000,
        updatedAt: 3000,
      },
    ],
    activeArtifactId: 'game:game-neon-1',
    turnChangedFiles: {
      u1: [
        { action: 'create', path: 'index.html', addedLines: 5, diffPreview: '+<!doctype html>', artifactId: 'game:game-neon-1' },
        { action: 'create', path: 'style.css', addedLines: 3, diffPreview: '+.hud { color: red; }', artifactId: 'game:game-neon-1' },
      ],
    },
    approvals: [],
    messages: [
      { id: 'u1', role: 'user', text: 'Create Neon Runner', createdAt: 1000 },
      { id: 'a1', role: 'assistant', text: 'Ready!', createdAt: 4000, status: 'completed' },
    ],
  };

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'antigravity', label: 'Antigravity', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({ localDirectAvailable: true, defaultRuntimeId: 'local:direct', runtimes: [] });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json({
        counts: { assets: 0, brandKits: 0, officialBrandKits: 0, motionTemplates: 0, designTemplates: 0, skills: 0, designSkills: 0, designProjects: 0, motionProjects: 0, mediaProvidersAvailable: 0, workflows: 0, models: 0, games: 1 },
        items: [],
        generatedAt: Date.now(),
      });
    }
    if (url === `${SUPER_AGENT_API}/chats`) {
      return json({ conversations: [{ ...chatPayload, artifactCount: 1, messageCount: 2 }] });
    }
    if (url === `${SUPER_AGENT_API}/chats/${GAME_TREE_CHAT_ID}`) {
      return json({ conversation: chatPayload });
    }
    if (url.includes('/motion-api/games/catalog')) {
      return json({ games: [{ id: 'game-neon-1', title: 'Neon Runner', status: 'ready', source: 'mine', genre: 'arcade', multiplayer: false }] });
    }
    if (url.includes('/motion-api/games/game-neon-1/files')) {
      return json({ files: [{ path: 'index.html', bytes: 64 }, { path: 'style.css', bytes: 42 }] });
    }
    if (url.includes('/motion-api/games/game-neon-1/play/style.css')) {
      return new Response('.hud { color: red; }', { status: 200, headers: { 'Content-Type': 'text/css' } });
    }
    if (url.includes('/motion-api/games/game-neon-1/play/index.html')) {
      return new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={GAME_TREE_CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  const dirHeaderBtn = container.querySelector<HTMLButtonElement>('.om-sa-head-dir-btn')!;
  expect(dirHeaderBtn).toBeTruthy();
  expect(dirHeaderBtn.textContent).toContain('games/game-neon-1');
  await act(async () => dirHeaderBtn.click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/tmp/data/games/game-neon-1');

  // Click Open in Code Viewer on style.css
  const openStyleBtn = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-file-copy-btn')].find(
    btn => btn.getAttribute('aria-label') === 'Open in Code Viewer' && btn.closest('.om-sa-file-change-row')?.textContent?.includes('style.css'),
  )!;
  expect(openStyleBtn).toBeTruthy();
  await act(async () => openStyleBtn.click());
  await flush();
  await flush();
  await flush();

  const selectedTab = [...container.querySelectorAll<HTMLElement>('.om-sa-code-file-row')].find(
    el => el.getAttribute('aria-selected') === 'true',
  );
  expect(selectedTab?.textContent).toContain('style.css');
  expect(container.textContent).toContain('.hud { color: red; }');
});

function setupDesignStudioMocks({ assetLoadFailures = 0 } = {}) {
  const createdChats: any[] = [];
  const turnBodies: any[] = [];
  let chatCounter = 0;

  const designItems = [
    {
      id: 'tpl-proto-1',
      kind: 'design-template',
      title: 'Fintech Interactive Landing',
      subtitle: 'prototype',
      scenario: 'prototype',
      previewUrl: '/motion-api/design/catalog/templates/tpl-proto-1/preview/index.html',
      tags: ['saas', 'landing'],
    },
    {
      id: 'tpl-mobile-1',
      kind: 'design-template',
      title: 'Fitness Tracker App',
      subtitle: 'mobile-app',
      scenario: 'mobile-app',
      previewUrl: '/motion-api/design/catalog/templates/tpl-mobile-1/preview/index.html',
      tags: ['mobile', 'health'],
    },
    {
      id: 'tpl-deck-1',
      kind: 'design-template',
      title: 'Series A Pitch Deck',
      subtitle: 'deck',
      scenario: 'deck',
      previewUrl: '/motion-api/design/catalog/templates/tpl-deck-1/preview/index.html',
      tags: ['pitch', 'slides'],
    },
    {
      id: 'tpl-doc-1',
      kind: 'design-template',
      title: 'Executive Finance Report',
      subtitle: 'document',
      scenario: 'document',
      previewUrl: '/motion-api/design/catalog/templates/tpl-doc-1/preview/index.html',
      tags: ['report', 'a4'],
    },
    {
      id: 'tpl-clone-1',
      kind: 'design-template',
      title: 'Developer Docs Clone',
      subtitle: 'web-clone',
      scenario: 'web-clone',
      previewUrl: '/motion-api/design/catalog/templates/tpl-clone-1/preview/index.html',
      tags: ['docs', 'clone'],
    },
    {
      id: 'tpl-live-1',
      kind: 'design-template',
      title: 'Live Sales Telemetry',
      subtitle: 'live-artifact',
      scenario: 'live-artifact',
      previewUrl: '/motion-api/design/catalog/templates/tpl-live-1/preview/index.html',
      tags: ['kpi', 'data'],
    },
    {
      id: 'tpl-webgl-1',
      kind: 'design-template',
      title: '3D Shader Stage',
      subtitle: 'webgl',
      scenario: 'webgl',
      previewUrl: '/motion-api/design/catalog/templates/tpl-webgl-1/preview/index.html',
      tags: ['shader', '3d'],
    },
  ];
  const designProjects = [
    {
      id: 'dproj-custom-1',
      kind: 'design-project',
      title: 'My Custom Landing',
      subtitle: 'prototype',
      scenario: 'prototype',
      previewUrl: '/motion-api/design/raw/dproj-custom-1/index.html',
    },
  ];
  const brandKits = [
    {
      id: 'catalog:vercel',
      kind: 'brand-kit',
      title: 'Vercel',
      subtitle: 'Developer Tools · Official Brand Kit',
      swatches: ['#000000', '#ffffff'],
    },
  ];
  const designSkills = [
    {
      id: 'design-editorial',
      kind: 'design-skill',
      title: 'Editorial Layout Skill',
      subtitle: 'document',
      scenario: 'document',
    },
  ];
  const assets = [
    {
      id: 'asset-poster-1',
      kind: 'asset',
      title: 'Product Hero Poster',
      subtitle: 'image',
      modality: 'image',
      versionId: 'v1',
      previewUrl: '/motion-api/assets/asset-poster-1/versions/v1/media',
    },
    {
      id: 'asset-clip-1',
      kind: 'asset',
      title: 'Product Video',
      modality: 'video',
      versionId: 'v1',
      previewUrl: '/motion-api/assets/asset-clip-1/versions/v1/file',
    },
  ];

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({
        agents: [
          {
            id: 'codex',
            label: 'Codex',
            icon: 'codex',
            installed: true,
            auth: 'signed-in',
            models: [{ id: 'gpt-5', label: 'GPT-5', reasoning: ['medium'] }],
          },
        ],
      });
    }
    if (url.startsWith('/motion-api/agent-runtimes')) {
      return json({
        runtimes: [
          {
            id: 'local-direct',
            kind: 'local-direct',
            name: 'This computer',
            status: 'online',
            agents: [{ id: 'codex', label: 'Codex', icon: 'codex', installed: true, auth: 'signed-in', models: [] }],
            runnableAgentIds: ['codex'],
          },
        ],
      });
    }
    if (url === '/motion-api/models/capabilities') {
      return json({
        providers: [{ id: 'openai', ready: true, configured: true }],
        routes: { image: 'openai:gpt-image-1.5' },
      });
    }
    if (url.startsWith('/motion-api/models')) {
      return json({
        models: [
          {
            id: 'openai:gpt-image-1.5',
            provider: 'openai',
            modelId: 'gpt-image-1.5',
            label: 'GPT Image 1.5',
            modality: 'image',
            mode: 'text-to-image',
            source: 'builtin',
            supportsImageReference: true,
          },
        ],
        nextOffset: null,
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      const parsed = new URL(url, 'http://localhost');
      const kind = parsed.searchParams.get('kind');
      if (kind === 'asset' && assetLoadFailures > 0) {
        assetLoadFailures -= 1;
        return json({ error: 'Resource fetch failed' }, 503);
      }
      const items = kind === 'design-template'
        ? designItems
        : kind === 'design-project'
          ? designProjects
          : kind === 'brand-kit'
            ? brandKits
            : kind === 'design-skill'
              ? designSkills
              : kind === 'asset'
                ? assets
                : [...designItems, ...designProjects, ...brandKits, ...designSkills, ...assets];
      return json({ counts: sampleResources.counts, items, generatedAt: Date.now() });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({ conversations: [] });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      chatCounter += 1;
      const chat: SuperAgentChat = {
        id: `dddd0000-0000-0000-0000-00000000000${chatCounter}`,
        title: 'Design Task',
        intent: body.intent ?? 'design',
        engine: 'codex',
        model: 'gpt-5',
        permissionMode: 'on-request',
        createdAt: 1000,
        updatedAt: 1000,
        state: 'idle',
        messages: [],
        artifacts: [],
        approvals: [],
      };
      createdChats.push({ body, chat });
      return json({ conversation: chat });
    }
    const turnMatch = url.match(new RegExp(`^${SUPER_AGENT_API}/chats/([^/]+)/turn$`));
    if (turnMatch && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      turnBodies.push(body);
      const found = createdChats.find(c => c.chat.id === turnMatch[1])?.chat ?? { ...sampleChat, id: turnMatch[1], intent: 'design', state: 'running', artifacts: [], approvals: [], messages: [] };
      return json({
        conversation: {
          ...found,
          state: 'running',
          messages: [{ id: 'u-1', role: 'user', text: body.text, createdAt: 2000 }],
        },
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/chats/`)) {
      const id = url.split('/').pop();
      const found = createdChats.find(c => c.chat.id === id)?.chat;
      if (found) return json({ conversation: found });
    }
    return json({});
  }) as any;

  return { createdChats, turnBodies };
}

it('enters Design Studio from starter card with all 8 modules, floating option pills, synchronized showcase tabs, and search filtering', async () => {
  setupDesignStudioMocks({ assetLoadFailures: 1 });
  const flushMore = async () => {
    await flush();
    await flush();
  };

  vi.stubGlobal('IntersectionObserver', NearScreenIntersectionObserver);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={null}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await flushMore();

    const designCard = [...container.querySelectorAll('.om-sa-starter-card')].find(
      b => b.textContent?.includes('Design Studio'),
    ) as HTMLButtonElement;
    expect(designCard).toBeTruthy();
    await act(async () => designCard.click());
    await flushMore();

    // All 8 Design Studio modules appear in the hero switcher with Image design first & active by default
    expect(container.textContent).toContain('Design anything, from visuals to live HTML');
    const moduleLabels = [...container.querySelectorAll('.om-sa-design-module-card')].map(el => el.textContent?.trim());
    expect(moduleLabels).toEqual([
      'Image design',
      'Prototype',
      'Mobile App',
      'Slide deck',
      'Document',
      'Website clone',
      'Live artifact',
      'WebGL',
    ]);

    // Default active module is Image design with rich floating option pills
    const topBar = container.querySelector('.om-sa-composer-top-bar')!;
    expect(topBar).toBeTruthy();
    expect(topBar.textContent).toContain('Image design');
    expect(topBar.textContent).toContain('Text to image');
    expect(topBar.textContent).toContain('GPT Image 1.5');
    expect(topBar.textContent).toContain('Style & Mood');
    expect(topBar.textContent).toContain('Reference');
    expect(topBar.textContent).toContain('Brand Kit');
    expect(container.querySelector('.om-sa-showcase-tabs')?.textContent).toContain('All image scenes');

    const imageTabs = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-tab')];
    const brandTab = imageTabs.find(tab => tab.textContent?.startsWith('Brand Kits'))!;
    const assetTab = imageTabs.find(tab => tab.textContent?.startsWith('Workspace Assets'))!;
    const badge = (tab: HTMLButtonElement) => tab.querySelector('.om-sa-tab-count')?.textContent;
    expect(badge(brandTab)).toBe('1');
    expect(badge(assetTab)).toBeUndefined();
    await act(async () => assetTab.click());
    const imageGrid = container.querySelector('.om-sa-showcase-grid')!;
    expect(imageGrid.textContent).toContain('Could not load workspace resources');
    const retry = [...imageGrid.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Retry')!;
    await act(async () => retry.click());
    await flushMore();
    expect(badge(assetTab)).toBe('1');
    expect(imageGrid.textContent).toContain('Product Hero Poster');
    expect(imageGrid.textContent).not.toContain('Product Video');

    const imageSearch = container.querySelector<HTMLInputElement>('input[aria-label="Filter templates…"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(imageSearch, 'Vercel');
      imageSearch.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(badge(assetTab)).toBe('0');
    expect(badge(brandTab)).toBe('1');
    expect(imageGrid.textContent).toContain('No matching resources found');
    await act(async () => brandTab.click());
    expect(imageGrid.textContent).toContain('Vercel');

    // Switching to Prototype switches top bar to HTML Design pills & filters to Prototype templates (?thumb=1)
    const protoCard = [...container.querySelectorAll('.om-sa-design-module-card')].find(
      el => el.textContent?.trim() === 'Prototype',
    ) as HTMLButtonElement;
    await act(async () => protoCard.click());
    await flushMore();

    expect(topBar.textContent).toContain('HTML Design');
    expect(topBar.textContent).toContain('Prototype');
    expect(topBar.textContent).toContain('Responsive');
    expect(topBar.textContent).toContain('Style & Theme');
    expect(topBar.textContent).toContain('Brand Kit');
    expect(topBar.textContent).toContain('Import from…');
    expect(container.textContent).toContain('Fintech Interactive Landing');
    expect(container.textContent).not.toContain('3D Shader Stage');
    expect(container.querySelector('.om-sa-showcase-iframe-wrap .om-design-card-thumb iframe')?.getAttribute('src')).toContain('?thumb=1');

    // Switching to WebGL via the module strip updates top bar, placeholder, quick ideas, and showcase cards
    const webglCard = [...container.querySelectorAll('.om-sa-design-module-card')].find(
      el => el.textContent?.trim() === 'WebGL',
    ) as HTMLButtonElement;
    await act(async () => webglCard.click());
    await flushMore();

    expect(topBar.textContent).toContain('WebGL');
    expect(topBar.textContent).toContain('Particle field · Pointer');
    expect(getComposerEditor(container).getAttribute('data-placeholder')).toContain('WebGL');
    expect(container.textContent).toContain('Reactive particle hero');
    expect(container.textContent).toContain('3D Shader Stage');
    expect(container.textContent).not.toContain('Fintech Interactive Landing');

    // Switching back to All templates and filtering by search input narrows visible items
    const allTab = [...container.querySelectorAll('.om-sa-showcase-tab')].find(
      el => el.textContent?.includes('All templates'),
    ) as HTMLButtonElement;
    await act(async () => allTab.click());
    await flushMore();

    const searchInput = container.querySelector<HTMLInputElement>('input[aria-label="Filter templates…"]')!;
    expect(searchInput).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(searchInput, 'Sales Telemetry');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    expect(container.textContent).toContain('Live Sales Telemetry');
    expect(container.textContent).not.toContain('3D Shader Stage');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('switches HTML Design modules via floating pill dropdown and updates contextual viewport/slides/doc/URL pills', async () => {
  setupDesignStudioMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="design"
          requestedDesignModule="prototype"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  const topBar = container.querySelector('.om-sa-composer-top-bar')!;
  const pickModule = async (currentPillText: string, nextModuleLabel: string) => {
    const trigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes(currentPillText)) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    await act(async () => trigger.click());
    await flush();
    const row = [...document.querySelectorAll('.om-sa-game-choice-row')].find(
      b => b.querySelector('strong')?.textContent === nextModuleLabel,
    ) as HTMLButtonElement;
    expect(row).toBeTruthy();
    await act(async () => row.click());
    await flushMore();
  };

  // Mobile App -> automatically selects Mobile viewport
  await pickModule('Prototype', 'Mobile App');
  expect(topBar.textContent).toContain('Mobile App');
  expect(topBar.textContent).toContain('Mobile');

  // Slide deck -> swaps Viewport pill for Slides · 8-12 pill
  await pickModule('Mobile App', 'Slide deck');
  expect(topBar.textContent).toContain('Slides');
  expect(topBar.textContent).not.toContain('Responsive');

  // Document -> shows A4 Portrait format pill
  await pickModule('Slide deck', 'Document');
  expect(topBar.textContent).toContain('A4 Portrait');

  // Website clone -> promotes Reference URL pill immediately beside module selector + Faithful clone
  await pickModule('Document', 'Website clone');
  const pillLabels = [...topBar.querySelectorAll('.om-sa-composer-top-pill')].map(el => el.textContent?.trim());
  expect(pillLabels[1]).toContain('Website clone');
  expect(pillLabels[2]).toContain('Reference URL');
  expect(pillLabels[3]).toContain('Faithful clone');

  // Live artifact -> shows KPI Dashboard pill
  await pickModule('Website clone', 'Live artifact');
  expect(topBar.textContent).toContain('KPI Dashboard');
});

it('configures rich Image design scene/style/lighting/background options and sends clean visible prompts with hiddenInstructions', async () => {
  const { createdChats, turnBodies } = setupDesignStudioMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="design"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  // Default Design Studio entry opens on Image design with rich configuration pills
  const topBar = container.querySelector('.om-sa-composer-top-bar')!;
  expect(topBar.textContent).toContain('Image design');
  expect(topBar.textContent).toContain('GPT Image 1.5');
  expect(topBar.textContent).toContain('Standard · 1×');
  expect(topBar.textContent).toContain('Reference');
  expect(topBar.textContent).toContain('Brand Kit');
  expect(container.querySelector('.om-sa-showcase-tabs')?.textContent).toContain('All image scenes');

  // Pick Image scene -> Relight
  const sceneTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Text to image')) as HTMLButtonElement;
  await act(async () => sceneTrigger.click());
  await flush();
  const relightOption = [...document.querySelectorAll('.om-sa-game-choice-row')].find(
    b => b.querySelector('strong')?.textContent === 'Relight',
  ) as HTMLButtonElement;
  await act(async () => relightOption.click());
  await flushMore();
  expect(topBar.textContent).toContain('Relight');

  // Pick Style & Mood -> Editorial + Neon + Transparent
  const styleTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Style & Mood')) as HTMLButtonElement;
  await act(async () => styleTrigger.click());
  await flush();
  for (const label of ['Editorial', 'Neon', 'Transparent']) {
    const pill = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.trim() === label) as HTMLButtonElement;
    expect(pill).toBeTruthy();
    await act(async () => pill.click());
    await flush();
  }
  expect(topBar.textContent).toContain('Editorial · Neon');

  await typeInComposer(getComposerEditor(container), 'Neon product hero artwork');
  await flush();
  const sendBtn = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
  await act(async () => sendBtn.click());
  await flushMore();

  expect(createdChats[0]?.body?.intent).toBe('design');
  expect(turnBodies[0]?.mode).toBe('design');
  expect(turnBodies[0]?.text).toBe('Neon product hero artwork');
  expect(turnBodies[0]?.hiddenInstructions).toContain('Mode: Design Studio · Image Artwork');
  expect(turnBodies[0]?.hiddenInstructions).toContain('Scene: Relight');
  expect(turnBodies[0]?.hiddenInstructions).toContain('Style: Editorial');
  expect(turnBodies[0]?.hiddenInstructions).toContain('Lighting: Neon');
  expect(turnBodies[0]?.hiddenInstructions).toContain('Background: Transparent');
  expect(turnBodies[0]?.hiddenInstructions).toContain('openmotion_assets_use');
  expect(container.querySelector('.om-sa-user-bubble')?.textContent).toBe('Neon product hero artwork');
});

it('submits HTML Design Website clone with Reference URL, attached template, and hidden design instructions', async () => {
  const { createdChats, turnBodies } = setupDesignStudioMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="design"
          requestedDesignModule="web-clone"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  const refUrlTrigger = [...container.querySelectorAll('.om-sa-composer-top-pill')].find(
    b => b.textContent?.includes('Reference URL'),
  ) as HTMLButtonElement;
  expect(refUrlTrigger).toBeTruthy();
  await act(async () => refUrlTrigger.click());
  await flush();
  const urlInput = document.querySelector<HTMLInputElement>('.om-sa-mode-url-input')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(urlInput, 'https://example.org/pricing');
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const applyBtn = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.trim() === 'Apply') as HTMLButtonElement;
  await act(async () => applyBtn.click());
  await flush();

  // Pick Style & Theme -> Bento + Dark
  const styleThemeBtn = [...container.querySelectorAll('.om-sa-composer-top-pill')].find(
    b => b.textContent?.includes('Style & Theme'),
  ) as HTMLButtonElement;
  expect(styleThemeBtn).toBeTruthy();
  await act(async () => styleThemeBtn.click());
  await flush();
  for (const label of ['Bento', 'Dark']) {
    const pill = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.trim() === label) as HTMLButtonElement;
    expect(pill).toBeTruthy();
    await act(async () => pill.click());
    await flush();
  }

  // Attach the matching Design template card from the showcase
  const cloneCard = [...container.querySelectorAll('.om-sa-showcase-card')].find(
    el => el.textContent?.includes('Developer Docs Clone'),
  ) as HTMLButtonElement;
  expect(cloneCard).toBeTruthy();
  await act(async () => cloneCard.click());
  await flush();

  await typeInComposer(getComposerEditor(container), 'Rebuild pricing comparison section');
  await flush();
  const sendBtn = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
  await act(async () => sendBtn.click());
  await flushMore();

  expect(createdChats[0]?.body?.intent).toBe('design');
  expect(turnBodies[0]?.mode).toBe('design');
  expect(turnBodies[0]?.text).toBe('Rebuild pricing comparison section');
  expect(turnBodies[0]?.attachments?.some((att: any) => att.id === 'tpl-clone-1')).toBe(true);
  expect(turnBodies[0]?.hiddenInstructions).toContain('scenario="web-clone"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('Style: Bento');
  expect(turnBodies[0]?.hiddenInstructions).toContain('Theme: Dark');
  expect(turnBodies[0]?.hiddenInstructions).toContain('https://example.org/pricing');
  expect(turnBodies[0]?.hiddenInstructions).toContain('openmotion_design_project');
  expect(container.querySelector('.om-sa-user-bubble')?.textContent).toBe('Rebuild pricing comparison section');
});

it('preserves legacy website/deck/image requested modes, Explore more shortcuts, and design-template handoffs inside Design Studio', async () => {
  setupDesignStudioMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  const cases: Array<{ mode: 'website' | 'deck' | 'document' | 'image'; designModule?: 'webgl'; expectedPill: string }> = [
    { mode: 'website', expectedPill: 'Prototype' },
    { mode: 'deck', expectedPill: 'Slide deck' },
    { mode: 'document', expectedPill: 'Document' },
    { mode: 'image', expectedPill: 'Image design' },
  ];

  for (const item of cases) {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={null}
            requestedMode={item.mode}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await flushMore();
    expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain(item.expectedPill);
  }

  // Queued handoff from Design Studio (WebGL template) opens Design Studio WebGL with attachment
  queueSuperAgentHandoff(buildSuperAgentHandoff(
    { kind: 'design-template', id: 'tpl-webgl-1', title: '3D Shader Stage', scenario: 'webgl' },
    { prompt: 'Customize 3D Shader Stage', autoSend: false },
  ));

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('WebGL');
  expect(container.querySelector('.om-sa-composer-chips')?.textContent).toContain('3D Shader Stage');
  expect(getComposerEditor(container).textContent).toContain('Customize 3D Shader Stage');
});

it('opens Design Studio Image design from Explore more -> Generate image', async () => {
  setupDesignStudioMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  const moreBtn = container.querySelector<HTMLButtonElement>('.om-sa-starter-card-more')!;
  expect(moreBtn).toBeTruthy();
  await act(async () => moreBtn.click());
  await flushMore();

  const imageStarter = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-more-menu .om-sa-more-item')].find(
    el => el.textContent?.includes('Generate image'),
  )!;
  expect(imageStarter).toBeTruthy();
  await act(async () => imageStarter.click());
  await flushMore();

  expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Image design');
  expect(container.querySelector('.om-sa-showcase-tabs')?.textContent).toContain('All image scenes');
});

it('docks pending approvals above the locked composer and keeps failed tool steps collapsed by default', async () => {
  clearSuperAgentCache();
  const DOCK_CHAT_ID = '22222222-2222-4222-8222-222222222222';
  let currentChat: SuperAgentChat = {
    id: DOCK_CHAT_ID,
    title: 'Witch Artwork',
    intent: 'image',
    engine: 'codex',
    permissionMode: 'on-request',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'waiting',
    messages: [
      { id: 'u-1', role: 'user', text: 'Generate witch artwork', createdAt: 1001 },
      {
        id: 'r-1',
        role: 'reasoning',
        text: 'Inspecting workspace media provider configuration.',
        durationMs: 2200,
        createdAt: 1002,
      },
      {
        id: 't-fail-1',
        role: 'tool',
        text: 'Generated media',
        createdAt: 1003,
        toolEvent: {
          id: 'tool-fail-1',
          category: 'tool',
          label: 'Generated media',
          summary: 'project',
          status: 'failed',
          inputPreview: '{"prompt":"Sparks and Young Witch"}',
          outputPreview: 'Timed out',
        },
      },
    ],
    artifacts: [],
    approvals: [
      {
        id: 'appr-dock-1',
        kind: 'mcp',
        title: 'Generate image',
        detail: 'nano-banana-2-lite',
      },
      {
        id: 'appr-dock-2',
        kind: 'command',
        title: 'Run verification script',
        detail: 'npm run check',
      },
    ],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json({
        counts: { assets: 0, brandKits: 0, officialBrandKits: 0, motionTemplates: 0, designTemplates: 0, skills: 0, designSkills: 0, designProjects: 0, motionProjects: 0, mediaProvidersAvailable: 0, workflows: 0, models: 0, games: 0 },
        items: [],
        generatedAt: Date.now(),
      });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({
        conversations: [{
          id: currentChat.id,
          title: currentChat.title,
          intent: currentChat.intent,
          engine: currentChat.engine,
          createdAt: currentChat.createdAt,
          updatedAt: currentChat.updatedAt,
          state: currentChat.state,
          messageCount: currentChat.messages.length,
          approvalCount: currentChat.approvals.length,
        }],
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/${DOCK_CHAT_ID}` && method === 'GET') {
      return json({ conversation: currentChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${DOCK_CHAT_ID}/approve` && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      const remaining = currentChat.approvals.filter(item => item.id !== body.approvalId);
      currentChat = {
        ...currentChat,
        updatedAt: currentChat.updatedAt + 1,
        state: remaining.length > 0 ? 'waiting' : 'idle',
        approvals: remaining,
      };
      return json({ conversation: currentChat });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={DOCK_CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('.om-sa-tool-row')).toBeTruthy();
  }, { timeout: 5000 });

  // Failed tool steps default collapsed and toggle cleanly via .om-sa-tool-trigger
  const toolRow = container.querySelector('.om-sa-tool-row')!;
  const toolTrigger = toolRow.querySelector<HTMLButtonElement>('.om-sa-tool-trigger')!;
  expect(toolRow.hasAttribute('data-open')).toBe(false);
  expect(toolRow.querySelector('.om-sa-tool-body')).toBeNull();
  expect(toolTrigger.getAttribute('aria-expanded')).toBe('false');

  await act(async () => toolTrigger.click());
  expect(toolRow.getAttribute('data-open')).toBe('true');
  expect(toolTrigger.getAttribute('aria-expanded')).toBe('true');
  expect(toolRow.querySelector('.om-sa-tool-body')?.textContent).toContain('Sparks and Young Witch');

  await act(async () => toolTrigger.click());
  expect(toolRow.hasAttribute('data-open')).toBe(false);
  expect(toolRow.querySelector('.om-sa-tool-body')).toBeNull();

  // Pending approvals render inside .om-sa-composer-wrap .om-sa-approval-dock (not inside .om-sa-messages)
  expect(container.querySelector('.om-sa-messages .om-sa-approval')).toBeNull();
  expect(container.querySelectorAll('.om-sa-composer-wrap .om-sa-approval-dock .om-sa-approval')).toHaveLength(2);
  expect(container.querySelector('.om-sa-head-status-badge[data-state="waiting"]')?.textContent).toBe('Approval needed');

  const composer = container.querySelector('.om-sa-composer')!;
  expect(composer.getAttribute('data-approval-pending')).toBe('true');
  expect(composer.querySelector('.om-sa-composer-approval-notice')?.textContent).toContain(
    'Confirm 2 pending actions above before sending your next message',
  );
  const editor = getComposerEditor(container);
  expect(editor.getAttribute('aria-disabled')).toBe('true');
  expect(editor.getAttribute('contenteditable')).toBe('false');
  expect(editor.getAttribute('data-placeholder')).toBe('Confirm or decline the pending action above to continue…');
  const attachBtn = composer.querySelector<HTMLButtonElement>('button[aria-label="Attach workspace resources"]')!;
  expect(attachBtn.disabled).toBe(true);

  // Approve first pending action -> 1 remaining pending approval
  const approveFirst = [...container.querySelectorAll('.om-sa-approval-dock button')].find(
    b => b.textContent?.trim() === 'Approve',
  ) as HTMLButtonElement;
  await act(async () => approveFirst.click());
  await flush();

  expect(container.querySelectorAll('.om-sa-composer-wrap .om-sa-approval-dock .om-sa-approval')).toHaveLength(1);
  expect(composer.querySelector('.om-sa-composer-approval-notice')?.textContent).toContain(
    'Confirm the pending action above before sending your next message',
  );
  expect(editor.getAttribute('aria-disabled')).toBe('true');

  // Approve final pending action -> returns to idle and unlocks composer
  const approveSecond = [...container.querySelectorAll('.om-sa-approval-dock button')].find(
    b => b.textContent?.trim() === 'Approve',
  ) as HTMLButtonElement;
  await act(async () => approveSecond.click());
  await flush();

  expect(container.querySelector('.om-sa-composer-wrap .om-sa-approval-dock')).toBeNull();
  expect(container.querySelector('.om-sa-approval')).toBeNull();
  expect(composer.hasAttribute('data-approval-pending')).toBe(false);
  expect(composer.querySelector('.om-sa-composer-approval-notice')).toBeNull();
  expect(editor.hasAttribute('aria-disabled')).toBe(false);
  expect(editor.getAttribute('contenteditable')).toBe('true');
  expect(editor.getAttribute('data-placeholder')).not.toBe('Confirm or decline the pending action above to continue…');
  expect(attachBtn.disabled).toBe(false);
});

async function setupMultimodalSsotMocks() {
  const { builtinModels } = await import('../../../gateway/catalog');
  const { generationOptions } = await import('../../../shared/generation-options');
  const { invalidateGatewayCache } = await import('../motion/gatewayClient');
  invalidateGatewayCache();

  const models = builtinModels
    .filter(m =>
      [
        'atlascloud:google/nano-banana-2/text-to-image',
        'fal:fal-ai/flux/schnell',
        'codex:image-generation',
        'atlascloud:bytedance/seedance-2.0/text-to-video',
        'fal:fal-ai/wan/v2.2-a14b/text-to-video',
        'atlascloud:suno/chirp-v4',
        'fal:fal-ai/kokoro/american-english',
        'fal:fal-ai/elevenlabs/sound-effects/v2',
      ].includes(m.id),
    )
    .map(m => ({ ...m, generationOptions: generationOptions(m) }));

  const createdChats: Array<{ body: any; chat: SuperAgentChat }> = [];
  const turnBodies: any[] = [];
  let chatCounter = 0;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url === '/motion-api/models/capabilities') {
      return json({
        providers: [
          { id: 'atlascloud', ready: true, configured: true },
          { id: 'fal', ready: true, configured: true },
          { id: 'codex', ready: true, configured: true },
        ],
        routes: {
          image: 'atlascloud:google/nano-banana-2/text-to-image',
          video: 'atlascloud:bytedance/seedance-2.0/text-to-video',
          audio: 'atlascloud:suno/chirp-v4',
        },
      });
    }
    if (url.startsWith('/motion-api/models')) {
      return json({ models, nextOffset: null });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json({
        counts: { assets: 0, brandKits: 0, officialBrandKits: 0, motionTemplates: 0, designTemplates: 0, skills: 0, designSkills: 0, designProjects: 0, motionProjects: 0, mediaProvidersAvailable: 3, workflows: 0, models: models.length, games: 0 },
        items: [],
        generatedAt: Date.now(),
      });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({ conversations: [] });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      chatCounter += 1;
      const chat: SuperAgentChat = {
        id: `eeee0000-0000-0000-0000-00000000000${chatCounter}`,
        title: 'SSOT Task',
        intent: body.intent ?? 'image',
        engine: 'codex',
        model: 'gpt-5',
        permissionMode: 'on-request',
        createdAt: 1000,
        updatedAt: 1000,
        state: 'idle',
        messages: [],
        artifacts: [],
        approvals: [],
      };
      createdChats.push({ body, chat });
      return json({ conversation: chat });
    }
    const turnMatch = url.match(new RegExp(`^${SUPER_AGENT_API}/chats/([^/]+)/turn$`));
    if (turnMatch && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      turnBodies.push(body);
      const found = createdChats.find(c => c.chat.id === turnMatch[1])?.chat;
      return json({
        conversation: {
          ...(found ?? { id: turnMatch[1], title: 'SSOT', intent: 'image', engine: 'codex', permissionMode: 'on-request', createdAt: 1000, updatedAt: 1000, artifacts: [], approvals: [] }),
          state: 'running',
          messages: [{ id: 'u-1', role: 'user', text: body.text, createdAt: 2000 }],
        },
      });
    }
    return json({});
  }) as any;

  return { createdChats, turnBodies };
}

it('drives Image SSOT model switching, collapsible advanced parameters, parameter migration, and structured Agent submission', async () => {
  const { turnBodies } = await setupMultimodalSsotMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="design"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  const topBar = container.querySelector('.om-sa-composer-top-bar')!;
  expect(topBar.textContent).toContain('Nano Banana 2');

  // Switch model to FLUX Schnell and verify SSOT primary pill adapts to FLUX output count
  const modelTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Nano Banana 2')) as HTMLButtonElement;
  await act(async () => modelTrigger.click());
  await flush();
  const fluxRow = [...document.querySelectorAll('.om-sa-mode-model-row')].find(el => el.textContent?.includes('FLUX Schnell')) as HTMLButtonElement;
  expect(fluxRow).toBeTruthy();
  await act(async () => fluxRow.click());
  await flushMore();

  // Check the FLUX Schnell count bounds, then set PNG and Seed in Advanced parameters.
  const paramTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('1×')) as HTMLButtonElement;
  expect(paramTrigger).toBeTruthy();
  await act(async () => paramTrigger.click());
  await flush();

  const outputCount = document.querySelector<HTMLInputElement>('input[type="number"][aria-label="Output count"]');
  expect(outputCount?.min).toBe('1');
  expect(outputCount?.max).toBe('4');
  expect(outputCount?.step).toBe('1');

  const advDetails = document.querySelector('details.om-sa-adv-params') as HTMLDetailsElement;
  expect(advDetails).toBeTruthy();
  expect(advDetails.open).toBe(false);
  const advSummary = advDetails.querySelector('summary')!;
  await act(async () => advSummary.click());
  await flush();

  const pngPill = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.trim() === 'png') as HTMLButtonElement;
  expect(pngPill).toBeTruthy();
  await act(async () => pngPill.click());
  await flush();

  const seedInput = document.querySelector('input[type="number"][aria-label="Seed"]') as HTMLInputElement;
  expect(seedInput).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(seedInput, '123');
    seedInput.dispatchEvent(new Event('input', { bubbles: true }));
    seedInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();

  // Close Parameters popover & switch back to Nano Banana 2 -> output_format='png' & seed=123 migrate via SSOT standardKey!
  await act(async () => paramTrigger.click());
  await flush();
  const fluxTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('FLUX Schnell')) as HTMLButtonElement;
  await act(async () => fluxTrigger.click());
  await flush();
  const nanoRow = [...document.querySelectorAll('.om-sa-mode-model-row')].find(el => el.textContent?.includes('Nano Banana 2')) as HTMLButtonElement;
  await act(async () => nanoRow.click());
  await flushMore();

  expect(topBar.querySelector('.om-sa-param-badge')?.textContent).toBe('+2');

  await typeInComposer(getComposerEditor(container), 'Studio lighting watch render');
  await flush();
  await act(async () => (container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).click());
  await flushMore();

  expect(turnBodies[0]?.hiddenInstructions).toContain('model="atlascloud:google/nano-banana-2/text-to-image"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('"output_format":"png"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('"seed":123');
});

it('drives AI Video SSOT engine switch, choice constraints, advanced parameters, and submission', async () => {
  const { turnBodies } = await setupMultimodalSsotMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="media"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  const topBar = container.querySelector('.om-sa-composer-top-bar')!;
  expect(topBar.textContent).toContain('AI Video');

  // Switch Engine -> Motion graphics and back -> AI Video
  const engineTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('AI Video')) as HTMLButtonElement;
  await act(async () => engineTrigger.click());
  await flush();
  const motionChoice = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.includes('Motion graphics')) as HTMLButtonElement;
  await act(async () => motionChoice.click());
  await flushMore();
  expect(topBar.textContent).toContain('Motion graphics');

  const motionEngineTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Motion graphics')) as HTMLButtonElement;
  await act(async () => motionEngineTrigger.click());
  await flush();
  const aiVideoChoice = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.includes('AI Video')) as HTMLButtonElement;
  await act(async () => aiVideoChoice.click());
  await flushMore();

  expect(topBar.textContent).toContain('Seedance 2.0');
  expect(topBar.textContent).toContain('First frame');

  // Open Seedance Parameters popover: select 4k resolution (enforces ratio='16:9') + Advanced Bitrate='high'
  const paramTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Audio')) as HTMLButtonElement;
  expect(paramTrigger).toBeTruthy();
  await act(async () => paramTrigger.click());
  await flush();

  const fourKPill = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.trim() === '4k') as HTMLButtonElement;
  await act(async () => fourKPill.click());
  await flush();

  const advSummary = document.querySelector('details.om-sa-adv-params summary')!;
  await act(async () => advSummary.click());
  await flush();
  const highBitrate = [...document.querySelectorAll('.om-sa-adv-body .om-sa-popover-pill')].find(
    b => b.textContent?.trim().toLowerCase() === 'high',
  ) as HTMLButtonElement;
  expect(highBitrate).toBeTruthy();
  await act(async () => highBitrate.click());
  await flush();

  await typeInComposer(getComposerEditor(container), 'Aerial drone shot of ocean cliffs');
  await flush();
  await act(async () => (container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).click());
  await flushMore();

  expect(turnBodies[0]?.hiddenInstructions).toContain('modality="video"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('model="atlascloud:bytedance/seedance-2.0/text-to-video"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('"resolution":"4k"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('"ratio":"16:9"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('"bitrate_mode":"high"');
});

it('drives Audio SSOT sub-type switching, speech model parameters, and Voiceover submission', async () => {
  const { turnBodies } = await setupMultimodalSsotMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="audio"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  const topBar = container.querySelector('.om-sa-composer-top-bar')!;
  expect(topBar.textContent).toContain('Music');

  // Explicitly choose Suno v4 under Music, then switch Audio type -> Sound FX: incompatible Suno v4 resets to SFX model
  const audioModelTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Suno')) as HTMLButtonElement;
  expect(audioModelTrigger).toBeTruthy();
  await act(async () => audioModelTrigger.click());
  await flush();
  const sunoRow = [...document.querySelectorAll('.om-sa-mode-model-row')].find(el => el.textContent?.includes('Suno')) as HTMLButtonElement;
  expect(sunoRow).toBeTruthy();
  await act(async () => sunoRow.click());
  await flushMore();

  const musicTypeTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Music')) as HTMLButtonElement;
  await act(async () => musicTypeTrigger.click());
  await flush();
  const sfxPill = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.includes('Sound FX')) as HTMLButtonElement;
  expect(sfxPill).toBeTruthy();
  await act(async () => sfxPill.click());
  await flushMore();

  expect(topBar.textContent).toContain('ElevenLabs Sound Effects');
  expect(topBar.textContent).not.toContain('Suno');

  // Switch Audio type -> Voiceover (prioritizes Kokoro)
  const audioTypeTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Sound FX')) as HTMLButtonElement;
  await act(async () => audioTypeTrigger.click());
  await flush();
  const voiceoverPill = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.includes('Voiceover')) as HTMLButtonElement;
  await act(async () => voiceoverPill.click());
  await flushMore();

  expect(topBar.textContent).toContain('Kokoro');

  // Open Voice pill and choose af_bella
  const voiceTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Heart')) as HTMLButtonElement;
  expect(voiceTrigger).toBeTruthy();
  await act(async () => voiceTrigger.click());
  await flush();
  const bellaPill = [...document.querySelectorAll('.om-sa-popover-pill')].find(b => b.textContent?.trim() === 'Bella') as HTMLButtonElement;
  await act(async () => bellaPill.click());
  await flush();

  // Open Parameters popover (only remaining field is advanced Speech speed -> auto-expanded)
  const paramTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Parameters')) as HTMLButtonElement;
  await act(async () => paramTrigger.click());
  await flush();
  const advDetails = document.querySelector('details.om-sa-adv-params') as HTMLDetailsElement;
  expect(advDetails.open).toBe(true);

  const speedInput = document.querySelector('input[type="number"][aria-label="Speech speed"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(speedInput, '1.2');
    speedInput.dispatchEvent(new Event('input', { bubbles: true }));
    speedInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();

  await typeInComposer(getComposerEditor(container), 'Narrate product launch opener');
  await flush();
  await act(async () => (container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).click());
  await flushMore();

  expect(turnBodies[0]?.hiddenInstructions).toContain('modality="audio"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('mode="text-to-speech"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('model="fal:fal-ai/kokoro/american-english"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('"voice":"af_bella"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('"speed":1.2');
});

it('defaults to Steer while running and flips to Queue on Ctrl/Cmd+Enter', async () => {
  clearSuperAgentCache();
  localStorage.removeItem('hf-studio-ui-preferences');
  setFollowUpBehavior('steer');
  const STEER_CHAT_ID = '33333333-3333-4333-8333-333333333333';
  const turnBodies: any[] = [];
  const queueBodies: any[] = [];
  let currentChat: SuperAgentChat = {
    id: STEER_CHAT_ID,
    title: 'Active Task',
    intent: 'coding',
    engine: 'codex',
    permissionMode: 'on-request',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'running',
    messages: [{ id: 'u1', role: 'user', text: 'Initial running prompt', createdAt: 1001 }],
    artifacts: [],
    approvals: [],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json({ counts: { assets: 0, brandKits: 0, officialBrandKits: 0, motionTemplates: 0, designTemplates: 0, skills: 0, designSkills: 0, designProjects: 0, motionProjects: 0, mediaProvidersAvailable: 0 }, items: [], generatedAt: Date.now() });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({ conversations: [{ id: currentChat.id, title: currentChat.title, intent: currentChat.intent, engine: currentChat.engine, createdAt: 1000, updatedAt: currentChat.updatedAt, state: currentChat.state, artifactCount: 0, messageCount: currentChat.messages.length }] });
    }
    if (url === `${SUPER_AGENT_API}/chats/${STEER_CHAT_ID}` && method === 'GET') {
      return json({ conversation: currentChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${STEER_CHAT_ID}/turn` && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      turnBodies.push(body);
      currentChat = {
        ...currentChat,
        updatedAt: currentChat.updatedAt + 1,
        state: 'running',
        messages: [...currentChat.messages, { id: `u-${turnBodies.length + 1}`, role: 'user', text: body.text, createdAt: Date.now() }],
      };
      return json({ conversation: currentChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${STEER_CHAT_ID}/queue` && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      queueBodies.push(body);
      const qId = `q-${queueBodies.length}`;
      currentChat = {
        ...currentChat,
        updatedAt: currentChat.updatedAt + 1,
        queuedMessages: [
          ...(currentChat.queuedMessages ?? []),
          { id: qId, requestId: body.requestId, text: body.text, createdAt: Date.now(), updatedAt: Date.now() },
        ],
      };
      return json({ conversation: currentChat });
    }
    return json({});
  }) as any;

  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={STEER_CHAT_ID}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await vi.waitFor(async () => {
      await flush();
      expect(container.querySelector('button[aria-label="Stop"]')).toBeTruthy();
    }, { timeout: 5000 });

    // No composer Steer/Queue entry pill is rendered; behavior follows Settings
    expect(container.querySelector('.om-sa-followup-pill')).toBeNull();

    const editor = getComposerEditor(container);

    await typeInComposer(editor, 'Redirect current task');
    await flush();

    expect(container.querySelector('button[aria-label="Stop"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Steer"]')).toBeTruthy();

    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(editor.textContent).toBe('');
    await flush();
    expect(turnBodies).toHaveLength(1);
    expect(turnBodies[0]).toMatchObject({ text: 'Redirect current task', followUpBehavior: 'steer' });

    // Ctrl+Enter sends the opposite behavior (Queue) for a single message and clears composer
    await typeInComposer(editor, 'Queue this after steer', { clear: true });
    await flush();
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(editor.textContent).toBe('');
    await flush();

    expect(queueBodies).toHaveLength(1);
    expect(queueBodies[0].text).toBe('Queue this after steer');
    expect(container.querySelector('.om-sa-queue-panel .om-sa-queue-count')?.textContent).toBe('1');
    expect(container.querySelector('.om-sa-queue-panel')?.textContent).toContain('Queue this after steer');
  } finally {
    setFollowUpBehavior('steer');
    localStorage.removeItem('hf-studio-ui-preferences');
  }
});

it('queues follow-ups with attachments and supports Edit backfill, Send Now, and Delete', async () => {
  clearSuperAgentCache();
  localStorage.removeItem('hf-studio-ui-preferences');
  setFollowUpBehavior('steer');
  const QUEUE_CHAT_ID = '44444444-4444-4444-8444-444444444444';
  const patchCalls: any[] = [];
  let seq = 0;
  let currentChat: SuperAgentChat = {
    id: QUEUE_CHAT_ID,
    title: 'Queue Task',
    intent: 'design',
    engine: 'codex',
    permissionMode: 'on-request',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'running',
    messages: [{ id: 'u1', role: 'user', text: 'Working on layout', createdAt: 1001 }],
    artifacts: [],
    approvals: [],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json(sampleResources);
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({ conversations: [{ id: currentChat.id, title: currentChat.title, intent: currentChat.intent, engine: currentChat.engine, createdAt: 1000, updatedAt: currentChat.updatedAt, state: currentChat.state, artifactCount: 0, messageCount: currentChat.messages.length }] });
    }
    if (url === `${SUPER_AGENT_API}/chats/${QUEUE_CHAT_ID}` && method === 'GET') {
      return json({ conversation: currentChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${QUEUE_CHAT_ID}/queue` && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      seq += 1;
      currentChat = {
        ...currentChat,
        updatedAt: currentChat.updatedAt + 1,
        queuedMessages: [
          ...(currentChat.queuedMessages ?? []),
          {
            id: `q-${seq}`,
            requestId: body.requestId,
            text: body.text,
            ...(body.segments?.length ? { segments: body.segments } : {}),
            ...(body.attachments?.length ? { attachments: body.attachments } : {}),
            ...(body.contextTags?.length ? { contextTags: body.contextTags } : {}),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      };
      return json({ conversation: currentChat });
    }
    const patchMatch = url.match(new RegExp(`^${SUPER_AGENT_API}/chats/${QUEUE_CHAT_ID}/queue/([^/]+)$`));
    if (patchMatch && method === 'PATCH') {
      const qId = decodeURIComponent(patchMatch[1]);
      const body = JSON.parse(String(init?.body || '{}'));
      patchCalls.push({ qId, body });
      currentChat = {
        ...currentChat,
        updatedAt: currentChat.updatedAt + 1,
        queuedMessages: (currentChat.queuedMessages ?? []).map(item =>
          item.id === qId
            ? {
                ...item,
                text: body.text,
                ...(body.segments ? { segments: body.segments } : {}),
                attachments: body.attachments,
                updatedAt: Date.now(),
              }
            : item,
        ),
      };
      return json({ conversation: currentChat });
    }
    if (patchMatch && method === 'DELETE') {
      const qId = decodeURIComponent(patchMatch[1]);
      const rest = (currentChat.queuedMessages ?? []).filter(item => item.id !== qId);
      currentChat = {
        ...currentChat,
        updatedAt: currentChat.updatedAt + 1,
        queuedMessages: rest.length ? rest : undefined,
      };
      return json({ conversation: currentChat });
    }
    const sendMatch = url.match(new RegExp(`^${SUPER_AGENT_API}/chats/${QUEUE_CHAT_ID}/queue/([^/]+)/send$`));
    if (sendMatch && method === 'POST') {
      const qId = decodeURIComponent(sendMatch[1]);
      const target = currentChat.queuedMessages?.find(item => item.id === qId);
      const rest = (currentChat.queuedMessages ?? []).filter(item => item.id !== qId);
      currentChat = {
        ...currentChat,
        updatedAt: currentChat.updatedAt + 1,
        state: 'running',
        queuedMessages: rest.length ? rest : undefined,
        messages: target ? [...currentChat.messages, { id: `u-${qId}`, role: 'user', text: target.text, createdAt: Date.now() }] : currentChat.messages,
      };
      return json({ conversation: currentChat });
    }
    return json({});
  }) as any;

  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={QUEUE_CHAT_ID}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await vi.waitFor(async () => {
      await flush();
      expect(container.querySelector('button[aria-label="Stop"]')).toBeTruthy();
    }, { timeout: 5000 });

    // Composer never renders Steer/Queue toggle pill; Agent settings popover only holds approval & settings links
    expect(container.querySelector('.om-sa-followup-pill')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Agent settings"]')!.click());
    await flush();
    const popoverText = document.querySelector('.om-sa-settings-popover')?.textContent ?? '';
    expect(popoverText).not.toContain('Follow-up behavior');
    expect(popoverText).not.toContain('Queue after current run');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Agent settings"]')!.click());
    await flush();

    // Follow-up behavior is configured via Settings and picked up reactively without a composer pill
    await act(async () => setFollowUpBehavior('queue'));
    await flush();
    expect(container.querySelector('.om-sa-followup-pill')).toBeNull();

    // Attach workspace asset ("Neon Arcade") while agent is running & queue 1st item
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Attach workspace resources"]')!.click());
    await vi.waitFor(async () => {
      await flush();
      expect([...document.querySelectorAll('.om-sa-mention-row')].some(r => r.textContent?.includes('Neon Arcade'))).toBe(true);
    }, { timeout: 3000 });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('.om-sa-mention-row')].find(r => r.textContent?.includes('Neon Arcade'))!.click();
    });
    await flush();
    expect(container.querySelector('.om-sa-composer .om-sa-inline-mention')?.textContent).toContain('Neon Arcade');

    const editor = getComposerEditor(container);
    await typeInComposer(editor, 'Inspect attached resource first');
    await flush();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Queue message"]')!.click());
    expect(editor.textContent).toBe('');
    await flush();

    // Queue 2nd item
    await typeInComposer(editor, 'Second follow-up check');
    await flush();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Queue message"]')!.click());
    expect(editor.textContent).toBe('');
    await flush();

    expect(container.querySelector('.om-sa-queue-count')?.textContent).toBe('2');
    const firstRow = container.querySelectorAll('.om-sa-queue-row')[0];
    expect(firstRow.textContent).toContain('Inspect attached resource first');

    // Edit 1st queued item -> backfills structured mention + text into composer -> save updates in place
    await act(async () => firstRow.querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!.click());
    await flush();
    expect(container.querySelector('.om-sa-composer')?.getAttribute('data-editing-queued')).toBe('true');
    expect(container.querySelector('.om-sa-composer-edit-banner')?.textContent).toContain('Editing queued message');
    expect(editor.textContent).toContain('Inspect attached resource first');
    expect(container.querySelector('.om-sa-composer .om-sa-inline-mention')?.textContent).toContain('Neon Arcade');

    await typeInComposer(editor, ' updated');
    await flush();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Save queued message"]')!.click());
    await flush();

    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].body.text).toContain('Inspect attached resource first updated');
    expect(patchCalls[0].body.attachments?.length).toBeGreaterThan(0);
    expect(container.querySelector('.om-sa-queue-panel')?.textContent).toContain('Inspect attached resource first updated');

    // Send Now on 1st item -> removes it from queue and starts turn immediately
    await act(async () => container.querySelectorAll('.om-sa-queue-row')[0].querySelector<HTMLButtonElement>('button[aria-label="Send Now"]')!.click());
    await flush();
    expect(container.querySelector('.om-sa-queue-count')?.textContent).toBe('1');
    expect(container.querySelector('.om-sa-queue-panel')?.textContent).not.toContain('Inspect attached resource first updated');
    expect(container.querySelector('.om-sa-queue-panel')?.textContent).toContain('Second follow-up check');

    // Delete remaining queued item -> removes queue panel
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!.click());
    await flush();
    expect(container.querySelector('.om-sa-queue-panel')).toBeNull();
  } finally {
    setFollowUpBehavior('steer');
    localStorage.removeItem('hf-studio-ui-preferences');
  }
});

it('opens categorized mention menu via + and @ triggers, filters categories, and combines inline text + file + Brand Kit + Skill + Conversation', async () => {
  clearSuperAgentCache();
  const REF_CHAT_ID = '77777777-7777-4777-8777-777777777777';
  const richResources: SuperAgentResourceCatalog = {
    counts: { ...sampleResources.counts, skills: 1, designTemplates: 1 },
    generatedAt: Date.now(),
    items: [
      ...sampleResources.items,
      { id: 'skill-brand-motion', kind: 'skill', title: 'Kinetic Brand Titles', subtitle: 'Broadcast opener skill' },
      { id: 'motion-full-chain', kind: 'workflow', title: 'Idea to Motion Film' },
      { id: 'tpl-saas-hero', kind: 'design-template', title: 'SaaS Hero Kit', subtitle: 'prototype · Marketing', scenario: 'prototype' },
    ],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json(richResources);
    }
    if (url.startsWith(`${SUPER_AGENT_API}/files`)) {
      return json({
        items: [
          {
            id: 'custom:skills/demo/agents',
            kind: 'folder',
            title: 'agents',
            subtitle: 'skills/demo',
            filePath: 'skills/demo/agents',
            rootKey: 'custom',
          },
          {
            id: 'custom:AGENTS.md',
            kind: 'file',
            title: 'AGENTS.md',
            subtitle: 'repo',
            filePath: 'AGENTS.md',
            rootKey: 'custom',
            sizeBytes: 4096,
            mimeType: 'text/markdown',
          },
          {
            id: 'custom:docs',
            kind: 'folder',
            title: 'docs',
            subtitle: 'repo/docs',
            filePath: 'docs',
            rootKey: 'custom',
          },
        ],
      });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({
        conversations: [
          {
            id: REF_CHAT_ID,
            title: 'Q4 Design System Spec',
            intent: 'design',
            engine: 'codex',
            state: 'idle',
            artifactCount: 1,
            messageCount: 8,
            createdAt: 1000,
            updatedAt: 5000,
          },
        ],
      });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  const editor = getComposerEditor(container);

  // 1. Typing @ places Add actions first and Commands second (without top category tabs or bottom hint footer); typing @AGENTS ranks exact/stem match #1
  await typeInComposer(editor, 'Compare @');
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-mention-menu')).toBeTruthy();
    expect(document.querySelector('.om-sa-mention-cats-bar')).toBeNull();
    expect(document.querySelector('.om-sa-mention-foot')).toBeNull();
    const sectionLabels = [...document.querySelectorAll('.om-sa-mention-section-label')].map(el => el.textContent?.trim());
    expect(sectionLabels[0]).toBe('Add');
    expect(sectionLabels[1]).toBe('Commands');
    const firstRows = [...document.querySelectorAll('.om-sa-mention-row')].slice(0, 5).map(r => r.textContent ?? '');
    expect(firstRows[0]).toContain('Upload files');
    expect(firstRows[1]).toContain('Attach folder');
    expect(firstRows[2]).toContain('Compact');
    expect(firstRows[3]).toContain('Export');
    expect(firstRows[4]).toContain('Feedback');
  }, { timeout: 3000 });

  await typeInComposer(editor, 'AGENTS');
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-mention-menu')).toBeTruthy();
    const firstRow = document.querySelector('.om-sa-mention-row');
    expect(firstRow?.textContent).toContain('AGENTS.md');
  }, { timeout: 3000 });

  await act(async () => {
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-mention-menu')).toBeNull();
  }, { timeout: 3000 });
  expect(editor.querySelector('.om-sa-inline-mention')?.textContent?.trim()).toBe('AGENTS.md');
  expect(editor.textContent).not.toContain('@AGENTS');

  // 2. Opening via + shows clean search input (no category tabs/footer) -> add Conversation, Brand Kit, and Skill
  const pickViaPlusMenu = async (itemTitle: string) => {
    if (!document.querySelector('.om-sa-mention-menu')) {
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Attach workspace resources"]')!.click());
      await flush();
    }
    expect(document.querySelector('.om-sa-mention-cats-bar')).toBeNull();
    expect(document.querySelector('.om-sa-mention-foot')).toBeNull();
    await vi.waitFor(async () => {
      await flush();
      expect([...document.querySelectorAll('.om-sa-mention-row')].some(r => r.textContent?.includes(itemTitle))).toBe(true);
    }, { timeout: 3000 });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('.om-sa-mention-row')].find(r => r.textContent?.includes(itemTitle))!.click();
    });
    await flush();
  };

  await pickViaPlusMenu('Q4 Design System Spec');
  await pickViaPlusMenu('Vercel');
  await pickViaPlusMenu('Kinetic Brand Titles');

  const inlineChips = [...container.querySelectorAll('.om-sa-composer .om-sa-inline-mention')].map(el => el.textContent?.trim());
  expect(inlineChips).toEqual(['AGENTS.md', 'Q4 Design System Spec', 'Vercel', 'Kinetic Brand Titles']);
  // Inline mentions should not duplicate inside the separate tray bar
  expect(container.querySelector('.om-sa-composer-chips')).toBeNull();

  // 3. Chinese and English title searches both find the workflow in the English UI.
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Attach workspace resources"]')!.click());
  await flush();
  const searchInput = document.querySelector<HTMLInputElement>('.om-sa-mention-search input')!;
  expect(searchInput).toBeTruthy();
  const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (const query of ['创意到动效短片', 'Idea to Motion Film']) {
    await act(async () => {
      setInputValue.call(searchInput, query);
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await vi.waitFor(async () => {
      await flush();
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) =>
        String(url).startsWith(`${SUPER_AGENT_API}/resources?`)
        && new URL(String(url), location.href).searchParams.get('query') === query,
      )).toBe(true);
      expect(document.querySelector('.om-sa-mention-list')?.textContent).toContain('Idea to Motion Film');
    }, { timeout: 3000 });
  }
  // Escape closes the menu while searching.
  await act(async () => {
    searchInput.focus();
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-mention-menu')).toBeNull();
  }, { timeout: 3000 });

  // 3b. Typing /feed opens slash Commands menu and Enter launches the Feedback dialog cleanly
  await typeInComposer(editor, ' /feed');
  await vi.waitFor(async () => {
    await flush();
    const menu = document.querySelector('.om-sa-mention-menu');
    expect(menu?.getAttribute('data-source')).toBe('slash');
    const firstRow = document.querySelector('.om-sa-mention-row');
    expect(firstRow?.textContent).toContain('Feedback');
  }, { timeout: 3000 });

  await act(async () => {
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-feedback-dialog')).toBeTruthy();
  }, { timeout: 3000 });
  expect(editor.textContent).not.toContain('/feed');
  await act(async () => {
    document.querySelector<HTMLButtonElement>('.om-sa-feedback-cancel-btn')!.click();
  });
  await flush();

  // 4. Toggling active={false} dismisses an open mention menu cleanly
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Attach workspace resources"]')!.click());
  await flush();
  expect(document.querySelector('.om-sa-mention-menu')).toBeTruthy();
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active={false}
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-mention-menu')).toBeNull();
  }, { timeout: 3000 });
});

it('renders scenario icons instead of broken HTML preview images and falls back on broken image error in mention menu', async () => {
  clearSuperAgentCache();
  const catalogWithHtmlAndBrokenImg: SuperAgentResourceCatalog = {
    counts: { ...sampleResources.counts, designTemplates: 1, motionTemplates: 1, designProjects: 1 },
    generatedAt: Date.now(),
    items: [
      {
        id: 'velar',
        kind: 'design-template',
        title: 'Velar Luxury Real Estate',
        subtitle: 'Prototype · design',
        scenario: 'prototype',
        previewUrl: '/motion-api/design/catalog/templates/velar/preview/index.html',
      },
      {
        id: 'kinetic-reel',
        kind: 'motion-template',
        title: 'Kinetic Reel',
        subtitle: '16:9 · Motion',
        previewUrl: '/motion-api/templates/kinetic-reel/poster.png',
      },
      {
        id: 'proj-resume',
        kind: 'design-project',
        title: 'Interactive Resume',
        subtitle: 'Prototype',
        scenario: 'prototype',
        previewUrl: '/motion-api/design/raw/proj-resume/index.html',
      },
    ],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json(catalogWithHtmlAndBrokenImg);
    }
    if (url.startsWith(`${SUPER_AGENT_API}/files`)) {
      return json({ items: [] });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/chats`)) {
      return json({ conversations: [] });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Attach workspace resources"]')!.click());
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-mention-menu')).toBeTruthy();
    expect([...document.querySelectorAll('.om-sa-mention-row')].some(r => r.textContent?.includes('Velar Luxury Real Estate'))).toBe(true);
  }, { timeout: 3000 });

  const findRow = (title: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.om-sa-mention-row')].find(r => r.textContent?.includes(title));

  const designTplRow = findRow('Velar Luxury Real Estate')!;
  expect(designTplRow).toBeTruthy();
  expect(designTplRow.querySelectorAll('img')).toHaveLength(0);
  expect(designTplRow.querySelector('.om-sa-mention-row-thumb svg')).toBeTruthy();

  const designProjRow = findRow('Interactive Resume')!;
  expect(designProjRow).toBeTruthy();
  expect(designProjRow.querySelectorAll('img')).toHaveLength(0);
  expect(designProjRow.querySelector('.om-sa-mention-row-thumb svg')).toBeTruthy();

  const motionTplRow = findRow('Kinetic Reel')!;
  expect(motionTplRow).toBeTruthy();
  const motionImg = motionTplRow.querySelector<HTMLImageElement>('.om-sa-mention-row-thumb img')!;
  expect(motionImg).toBeTruthy();
  expect(motionImg.getAttribute('src')).toBe('/motion-api/templates/kinetic-reel/poster.png');

  await act(async () => {
    motionImg.dispatchEvent(new Event('error'));
  });
  await flush();

  expect(motionTplRow.querySelectorAll('img')).toHaveLength(0);
  expect(motionTplRow.querySelector('.om-sa-mention-row-thumb svg')).toBeTruthy();
});

it('uploads arbitrary non-media files via file input, drag-and-drop, and clipboard paste into inline composer mentions', async () => {
  clearSuperAgentCache();
  const uploadCalls: { name: string; contentType: string }[] = [];
  let seq = 0;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json(sampleResources);
    }
    if (url === `${SUPER_AGENT_API}/chats`) {
      return json({ conversations: [] });
    }
    if (url === `${SUPER_AGENT_API}/uploads` && init?.method === 'POST') {
      seq += 1;
      const headers = new Headers(init.headers);
      const decodedName = decodeURIComponent(headers.get('X-File-Name') || `file-${seq}.txt`);
      uploadCalls.push({ name: decodedName, contentType: headers.get('Content-Type') || '' });
      return json({
        attachment: {
          id: `up-${seq}`,
          kind: 'file',
          title: decodedName,
          subtitle: 'Uploaded file',
          rootKey: 'upload',
          filePath: decodedName,
          sizeBytes: 128,
          mimeType: headers.get('Content-Type') || 'text/plain',
          previewUrl: `${SUPER_AGENT_API}/uploads/up-${seq}`,
        },
      });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // 1. File input upload (.md)
  const fileInputs = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  expect(fileInputs.length).toBeGreaterThanOrEqual(2);
  const mdFile = new File(['# Notes\nhello'], 'spec.md', { type: 'text/markdown' });
  await act(async () => {
    Object.defineProperty(fileInputs[0], 'files', { value: [mdFile], configurable: true });
    fileInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
  });

  // 2. Drag & drop (.json) onto conversation stream
  const jsonFile = new File(['{"tokens":true}'], 'tokens.json', { type: 'application/json' });
  const streamEl = container.querySelector<HTMLElement>('.om-sa-stream')!;
  await act(async () => {
    const dropEv = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(dropEv, 'dataTransfer', { value: { files: [jsonFile], types: ['Files'] } });
    streamEl.dispatchEvent(dropEv);
    await flush();
  });

  // 3. Clipboard paste (.csv) into Lexical editor
  const csvFile = new File(['col1,col2\na,b'], 'metrics.csv', { type: 'text/csv' });
  const editor = getComposerEditor(container);
  await act(async () => {
    editor.focus();
    const pasteEv = new Event('paste', { bubbles: true, cancelable: true }) as unknown as ClipboardEvent;
    Object.defineProperty(pasteEv, 'clipboardData', {
      value: {
        getData: () => '',
        files: [csvFile],
        items: [{ kind: 'file', getAsFile: () => csvFile }],
      },
    });
    editor.dispatchEvent(pasteEv);
    await flush();
  });

  expect(uploadCalls.map(u => u.name)).toEqual(['spec.md', 'tokens.json', 'metrics.csv']);
  const inlineTitles = [...container.querySelectorAll('.om-sa-composer .om-sa-inline-mention')].map(el => el.textContent?.trim());
  expect(inlineTitles).toEqual(['spec.md', 'tokens.json', 'metrics.csv']);
});

it('renders clickable inline mention chips in UserMessageBubble, previews workspace files in draft mode without creating a chat, and switches referenced conversations', async () => {
  clearSuperAgentCache();
  const REF_CHAT_ID = '88888888-8888-4888-8888-888888888888';
  const CREATED_CHAT_ID = '99999999-9999-4999-8999-999999999999';
  const createChatCalls: any[] = [];
  const turnBodies: any[] = [];
  const onChatIdChange = vi.fn();
  let createdChat: SuperAgentChat | null = null;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }] });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: [{ id: 'codex', label: 'Codex', installed: true, auth: 'signed-in', models: [] }],
          runnableAgentIds: ['codex'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json(sampleResources);
    }
    if (url.startsWith(`${SUPER_AGENT_API}/files`)) {
      return json({
        items: [
          {
            id: 'custom:README.md',
            kind: 'file',
            title: 'README.md',
            subtitle: 'repo',
            filePath: 'README.md',
            rootKey: 'custom',
            sizeBytes: 1024,
            mimeType: 'text/markdown',
          },
        ],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/file-content`)) {
      return json({
        path: 'README.md',
        content: '# OpenMotion\nSuper Agent workspace documentation.\n',
        binary: false,
        sizeBytes: 49,
        mimeType: 'text/markdown',
      });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({
        conversations: [
          {
            id: REF_CHAT_ID,
            title: 'Prior Research Thread',
            intent: 'chat',
            engine: 'codex',
            state: 'idle',
            artifactCount: 0,
            messageCount: 4,
            createdAt: 1000,
            updatedAt: 5000,
          },
        ],
      });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'POST') {
      createChatCalls.push(JSON.parse(String(init?.body || '{}')));
      createdChat = {
        id: CREATED_CHAT_ID,
        title: 'New conversation',
        engine: 'codex',
        permissionMode: 'on-request',
        createdAt: 6000,
        updatedAt: 6000,
        state: 'idle',
        messages: [],
        artifacts: [],
        approvals: [],
      };
      return json({ conversation: createdChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CREATED_CHAT_ID}/turn` && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      turnBodies.push(body);
      createdChat = {
        ...createdChat!,
        state: 'running',
        updatedAt: 6001,
        messages: [
          {
            id: 'u-mention-1',
            role: 'user',
            text: body.text,
            segments: body.segments,
            attachments: body.attachments,
            createdAt: 6001,
          },
        ],
      };
      return json({ conversation: createdChat });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={onChatIdChange}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // Attach README.md and Prior Research Thread inline
  await typeInComposer(getComposerEditor(container), 'Summarize @README');
  await vi.waitFor(async () => {
    await flush();
    expect([...document.querySelectorAll('.om-sa-mention-row')].some(r => r.textContent?.includes('README.md'))).toBe(true);
  }, { timeout: 3000 });
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('.om-sa-mention-row')].find(r => r.textContent?.includes('README.md'))!.click();
  });
  await flush();

  // Clicking the draft inline README.md chip previews it in ArtifactBrowserPane WITHOUT creating a server chat
  const draftFileChip = container.querySelector<HTMLButtonElement>('.om-sa-composer .om-sa-inline-mention[data-kind="file"]')!;
  expect(draftFileChip).toBeTruthy();
  await act(async () => draftFileChip.click());
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('.om-sa-workspace-file-view .om-sa-markdown-doc')?.textContent).toContain('OpenMotion');
  }, { timeout: 3000 });
  expect(createChatCalls).toHaveLength(0);

  // Also add referenced conversation chip inline, then submit
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Attach workspace resources"]')!.click());
  await vi.waitFor(async () => {
    await flush();
    expect([...document.querySelectorAll('.om-sa-mention-row')].some(r => r.textContent?.includes('Prior Research Thread'))).toBe(true);
  }, { timeout: 3000 });
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('.om-sa-mention-row')].find(r => r.textContent?.includes('Prior Research Thread'))!.click();
  });
  await flush();

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click());
  await flush();

  expect(turnBodies).toHaveLength(1);
  expect(turnBodies[0].segments?.some((s: any) => s.type === 'mention' && s.kind === 'file')).toBe(true);
  expect(turnBodies[0].segments?.some((s: any) => s.type === 'mention' && s.kind === 'chat')).toBe(true);

  // UserMessageBubble renders both clickable inline chips and avoids duplicating them above the bubble
  const sentInlineChips = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-user-bubble .om-sa-inline-mention')];
  expect(sentInlineChips.map(el => el.textContent?.trim())).toEqual(['README.md', 'Prior Research Thread']);
  expect(container.querySelector('.om-sa-message[data-role="user"] .om-sa-msg-attachments')).toBeNull();

  // Clicking the referenced conversation chip switches to that chat
  await act(async () => sentInlineChips[1].click());
  expect(onChatIdChange).toHaveBeenCalledWith(REF_CHAT_ID);
});

it('auto-attaches sample reference images for edit cards, syncs scene/audioType, and sends clean asset directives', async () => {
  const sentTurns: any[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({
        agents: [
          {
            id: 'antigravity',
            label: 'Antigravity',
            icon: 'antigravity',
            installed: true,
            auth: 'signed-in',
            models: [{ id: 'default', label: 'Default' }],
          },
        ],
      });
    }
    if (url.startsWith('/motion-api/models/gateway')) {
      return json({
        status: {
          providers: [
            {
              id: 'account',
              label: 'OpenDesign',
              enabled: true,
              configured: true,
              available: true,
              credentialSource: 'account',
              verification: 'unverified',
              mediaEntitlement: 'included',
            },
          ],
          routes: {
            image: 'account:gpt-image-2.6-flare',
            audio: 'account:elevenlabs-music-v2',
          },
          capabilities: [],
        },
        models: [
          {
            id: 'account:gpt-image-2.6-flare',
            provider: 'account',
            modelId: 'gpt-image-2.6-flare',
            label: 'gpt-image-2.6-flare',
            modality: 'image',
            mode: 'text-to-image',
            source: 'live',
            supportsImageReference: true,
            maxInputImages: 1,
          },
          {
            id: 'account:elevenlabs-music-v2',
            provider: 'account',
            modelId: 'elevenlabs-music-v2',
            label: 'ElevenLabs Music',
            modality: 'audio',
            mode: 'text-to-audio',
            source: 'builtin',
          },
          {
            id: 'account:elevenlabs-v3',
            provider: 'account',
            modelId: 'elevenlabs-v3',
            label: 'ElevenLabs Voice',
            modality: 'audio',
            mode: 'text-to-speech',
            source: 'builtin',
          },
        ],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) return json(sampleResources);
    if (url === `${SUPER_AGENT_API}/chats` && init?.method === 'POST') {
      return json({
        conversation: {
          ...sampleChat,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          messages: [],
          artifacts: [],
          approvals: [],
          state: 'idle',
        },
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` && (!init?.method || init.method === 'GET')) {
      return json({
        conversation: {
          ...sampleChat,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          messages: [],
          artifacts: [],
          approvals: [],
          state: 'idle',
        },
      });
    }
    if (url === `${SUPER_AGENT_API}/chats`) return json({ conversations: [] });
    if (url.includes('/motion-api/assets/upload')) {
      return json({
        asset: {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'speaker-studio.webp',
          modality: 'image',
          currentVersionId: '22222222-2222-4222-8222-222222222222',
          versions: [{ id: '22222222-2222-4222-8222-222222222222', mimeType: 'image/webp' }],
        },
      });
    }
    if (url.endsWith('.webp') || url.endsWith('.jpg') || url.startsWith('data:')) {
      return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'Content-Type': 'image/webp' } });
    }
    if (url.endsWith('/turn') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      sentTurns.push(body);
      return json({
        conversation: {
          ...sampleChat,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          state: 'running',
          messages: [{ id: 'u1', role: 'user', text: body.text, createdAt: Date.now() }],
        },
      });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // Open Design Studio -> defaults to Image design -> click "From studio to living room" edit card
  await act(async () => {
    [...container.querySelectorAll<HTMLButtonElement>('.om-sa-starter-card')].find(b => b.textContent?.includes('Design Studio'))!.click();
  });
  await flush();

  const editCard = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-card')].find(
    b => b.textContent?.includes('From studio to living room'),
  )!;
  expect(editCard).toBeTruthy();
  await act(async () => editCard.click());
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('.om-sa-composer-chips')?.textContent).toContain('speaker-studio.webp');
  }, { timeout: 3000 });

  // Switch to Text to image tab and click a text-to-image card -> clears auto-attached sample
  const t2iTab = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-tab')].find(
    b => b.textContent?.includes('Text to image'),
  )!;
  expect(t2iTab).toBeTruthy();
  await act(async () => t2iTab.click());
  await flush();

  const t2iCard = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-card')].find(
    b => b.textContent?.includes('Product portrait'),
  )!;
  expect(t2iCard).toBeTruthy();
  await act(async () => t2iCard.click());
  await flush();
  expect(container.querySelector('.om-sa-composer-chips')).toBeNull();

  // Switch back to All image scenes, click the edit card again, and submit
  const allImageTab = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-tab')].find(
    b => b.textContent?.includes('All image scenes'),
  )!;
  await act(async () => allImageTab.click());
  await flush();
  const editCardAgain = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-card')].find(
    b => b.textContent?.includes('From studio to living room'),
  )!;
  await act(async () => editCardAgain.click());
  await vi.waitFor(async () => {
    await flush();
    expect(container.querySelector('.om-sa-composer-chips')?.textContent).toContain('speaker-studio.webp');
  }, { timeout: 3000 });

  const editor = getComposerEditor(container);
  expect(editor.textContent).toContain('Keep the speaker in place');

  // Verify immediate optimistic clear even while /turn request is still in-flight, and failure rollback
  let failFirstTurn = true;
  let releasePendingTurn!: () => void;
  const origFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/turn') && init?.method === 'POST') {
      if (failFirstTurn) {
        failFirstTurn = false;
        return new Response(JSON.stringify({ error: 'Transient network error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      await new Promise<void>(resolve => { releasePendingTurn = resolve; });
    }
    return origFetch(input, init);
  }) as any;

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click());
  // Failed turn restores draft text & sample attachment cleanly
  await flush();
  expect(editor.textContent).toContain('Keep the speaker in place');
  expect(container.querySelector('.om-sa-composer-chips')?.textContent).toContain('speaker-studio.webp');

  // Now submit while /turn fetch stays in-flight: composer must clear immediately before response resolves
  let sendClickDone = false;
  let sendClickPromise!: Promise<void>;
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click();
    sendClickPromise = Promise.resolve().then(() => { sendClickDone = true; });
    await sendClickPromise;
  });
  expect(sendClickDone).toBe(true);
  await vi.waitFor(() => {
    expect(editor.textContent).toBe('');
    expect(container.querySelector('.om-sa-composer-chips')).toBeNull();
  }, { timeout: 2000 });
  expect(container.querySelector('.om-sa-followup-pill')).toBeNull();

  await act(async () => {
    releasePendingTurn();
    await flush();
  });

  expect(sentTurns).toHaveLength(1);
  expect(sentTurns[0].attachments.some((a: any) => a.id === '11111111-1111-4111-8111-111111111111')).toBe(true);
  expect(sentTurns[0].hiddenInstructions).toContain('scene="image-edit"');
  expect(sentTurns[0].hiddenInstructions).toContain('"assetId":"11111111-1111-4111-8111-111111111111"');
  expect(sentTurns[0].hiddenInstructions).toContain('openmotion_present_artifact(kind="asset", assetId=..., versionId=...)');
  expect(editor.textContent).toBe('');
  expect(container.querySelector('.om-sa-followup-pill')).toBeNull();
});

it('clamps out-of-range bounded numeric SSOT parameters on blur and emits clamped wire value', async () => {
  const { turnBodies } = await setupMultimodalSsotMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          requestedMode="media"
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  const topBar = container.querySelector('.om-sa-composer-top-bar')!;
  const videoModelTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('Seedance 2.0')) as HTMLButtonElement;
  await act(async () => videoModelTrigger.click());
  await flush();
  const wanRow = [...document.querySelectorAll('.om-sa-mode-model-row')].find(el => el.textContent?.includes('Wan 2.2')) as HTMLButtonElement;
  await act(async () => wanRow.click());
  await flushMore();

  const paramTrigger = [...topBar.querySelectorAll('button')].find(b => b.textContent?.includes('720p')) as HTMLButtonElement;
  await act(async () => paramTrigger.click());
  await flush();

  const advSummary = document.querySelector('details.om-sa-adv-params summary')!;
  await act(async () => advSummary.click());
  await flush();

  const framesInput = document.querySelector('input[type="number"][aria-label="Frames"]') as HTMLInputElement;
  expect(framesInput).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(framesInput, '999');
    framesInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
  await act(async () => {
    framesInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    framesInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await flush();
  expect(framesInput.value).toBe('161');

  await typeInComposer(getComposerEditor(container), 'Clamped Wan 2.2 render');
  await flush();
  await act(async () => (container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).click());
  await flushMore();

  expect(turnBodies[0]?.hiddenInstructions).toContain('model="fal:fal-ai/wan/v2.2-a14b/text-to-video"');
  expect(turnBodies[0]?.hiddenInstructions).toContain('"num_frames":161');
});

it('exposes Motion graphics as a primary entry, moves Create audio into Explore more, and separates AI Video vs Motion Graphics templates', async () => {
  setupDesignStudioMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  // 1) Create audio is tucked inside Explore more
  const moreBtn = [...container.querySelectorAll('.om-sa-starter-card')].find(
    el => el.textContent?.includes('Explore more'),
  ) as HTMLButtonElement;
  await act(async () => moreBtn.click());
  await flush();
  expect(document.querySelector('.om-sa-more-menu')?.textContent).toContain('Create audio');
  await act(async () => moreBtn.click());
  await flush();

  // 2) Clicking Motion graphics opens Video mode on the Motion graphics engine with pure Motion Graphics templates
  const motionStarter = [...container.querySelectorAll('.om-sa-starter-card')].find(
    el => el.textContent?.includes('Motion graphics'),
  ) as HTMLButtonElement;
  expect(motionStarter).toBeTruthy();
  await act(async () => motionStarter.click());
  await flushMore();

  expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Motion graphics');
  expect(container.textContent).toContain('Direct an editable Motion film');
  const motionTabsText = container.querySelector('.om-sa-showcase-tabs')?.textContent ?? '';
  expect(motionTabsText).toContain('TOP 100 brands');
  expect(motionTabsText).not.toContain('AI Video & Seedance');
  expect(motionTabsText).not.toContain('All video');

  // 3) Switching Engine pill to AI Video swaps showcase to pure AI Video templates
  const engineTrigger = [...container.querySelectorAll('.om-sa-composer-top-bar button')].find(
    b => b.textContent?.includes('Motion graphics'),
  ) as HTMLButtonElement;
  await act(async () => engineTrigger.click());
  await flush();
  const aiVideoChoice = [...document.querySelectorAll('.om-sa-popover-pill')].find(
    b => b.textContent?.includes('AI Video'),
  ) as HTMLButtonElement;
  expect(aiVideoChoice).toBeTruthy();
  await act(async () => aiVideoChoice.click());
  await flushMore();

  expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('AI Video');
  expect(container.textContent).toContain('Direct cinema shots');
  const videoTabsText = container.querySelector('.om-sa-showcase-tabs')?.textContent ?? '';
  expect(videoTabsText).toContain('All video');
  expect(videoTabsText).toContain('Cinema Studio');
  expect(videoTabsText).toContain('Seedance 2.5');
  expect(videoTabsText).not.toContain('TOP 100 brands');
  expect(videoTabsText).not.toContain('Motion graphics');

  // 4) Closing back to home and clicking Make a video directly opens AI Video with pure Video templates
  const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
  await act(async () => closeBtn.click());
  await flush();
  const videoStarter = [...container.querySelectorAll('.om-sa-starter-card')].find(
    el => el.textContent?.includes('Make a video'),
  ) as HTMLButtonElement;
  expect(videoStarter).toBeTruthy();
  await act(async () => videoStarter.click());
  await flushMore();

  expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('AI Video');
  expect(container.querySelector('.om-sa-showcase-tabs')?.textContent).toContain('All video');
  expect(container.querySelector('.om-sa-showcase-tabs')?.textContent).not.toContain('TOP 100 brands');

  const assetTab = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-tab')].find(
    tab => tab.textContent?.startsWith('Workspace Assets'),
  )!;
  await act(async () => assetTab.click());
  const videoCard = container.querySelector('.om-sa-showcase-grid .om-sa-showcase-card')!;
  expect(videoCard.textContent).toContain('Product Video');
  expect(videoCard.querySelector('[data-modality="video"] [data-thumbnail-loading]')).toBeTruthy();
  expect(videoCard.querySelector('video')).toBeNull();
});

it('embeds Motion Studio Editor in Super Agent without remounting on revision updates and supports selection attach + open-file', async () => {
  const MOTION_CHAT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  let currentMotionChat: SuperAgentChat = {
    id: MOTION_CHAT_ID,
    title: 'Motion Reel Edit',
    engine: 'codex',
    model: 'gpt-5',
    permissionMode: 'auto',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'idle',
    messages: [
      {
        id: 'mm1',
        role: 'user',
        text: 'Create an intro reel',
        createdAt: 1001,
      },
      {
        id: 'mm2',
        role: 'tool',
        text: 'openmotion_create_project: IntroReel',
        createdAt: 1002,
        toolEvent: {
          callId: 'mc1',
          tool: 'openmotion_create_project',
          label: 'Created Motion project',
          status: 'completed',
          summary: 'IntroReel',
          artifactId: 'motion:mproj-1',
          startedAt: 1002,
          finishedAt: 1003,
          fileOperations: [{ kind: 'modify', path: 'scenes/intro.html', artifactId: 'motion:mproj-1' }],
        },
      },
      {
        id: 'mm3',
        role: 'assistant',
        text: 'Created your **IntroReel** project.',
        createdAt: 1004,
      },
    ],
    artifacts: [
      {
        id: 'motion:mproj-1',
        kind: 'motion-project',
        title: 'IntroReel',
        subtitle: 'motion',
        projectId: 'mproj-1',
        revision: 'mrev-1',
        createdAt: 1003,
        updatedAt: 1003,
        presentedAt: 1003,
      },
    ],
    activeArtifactId: 'motion:mproj-1',
    approvals: [],
  };

  const baseFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url === `${SUPER_AGENT_API}/chats/${MOTION_CHAT_ID}` && (!init?.method || init.method === 'GET')) {
      return json({ conversation: currentMotionChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${MOTION_CHAT_ID}` && init?.method === 'PATCH') {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      currentMotionChat = { ...currentMotionChat, ...body };
      return json({ conversation: currentMotionChat });
    }
    return baseFetch(input, init);
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={MOTION_CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // Open viewer via deliverable card primary action ("Open editor")
  const openEditorBtn = [...container.querySelectorAll('.om-sa-deliverable-btn[data-primary]')].find(
    b => b.textContent?.includes('Open editor'),
  ) as HTMLButtonElement;
  expect(openEditorBtn).toBeTruthy();
  await act(async () => openEditorBtn.click());
  await vi.waitFor(async () => {
    await flush();
    expect(document.querySelector('.om-sa-viewer iframe')).toBeTruthy();
  }, { timeout: 5000 });

  const iframe = document.querySelector('.om-sa-viewer iframe') as HTMLIFrameElement;
  const src = iframe.getAttribute('src') ?? '';
  expect(src).toContain('project=mproj-1');
  expect(src).toContain('superAgent=1');
  expect(src).toContain('saBridge=');
  const bridgeToken = new URLSearchParams(src.split('?')[1].split('#')[0]).get('saBridge')!;
  expect(bridgeToken).toBeTruthy();

  const postedToIframe: unknown[] = [];
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (data: unknown) => {
        postedToIframe.push(data);
      },
    },
  });

  // Notify parent that iframe bridge is ready
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'om:sa-motion-ready', token: bridgeToken, projectId: 'mproj-1' },
    }));
  });
  await flush();

  // Revision bump via SSE snapshot must keep exact same iframe node (zero remount)
  currentMotionChat = {
    ...currentMotionChat,
    artifacts: [{ ...currentMotionChat.artifacts[0], revision: 'mrev-2', updatedAt: 3000 }],
    updatedAt: 3000,
  };
  const es = MockEventSource.instances.at(-1);
  if (es) {
    const snapListeners = es.listeners.get('snapshot') ?? es.listeners.get('message') ?? [];
    for (const fn of snapListeners) {
      await act(async () => {
        fn(new MessageEvent('snapshot', { data: JSON.stringify({ conversation: currentMotionChat }) }));
      });
    }
    await flush();
  }
  expect(document.querySelector('.om-sa-viewer iframe')).toBe(iframe);

  // Incoming om:sa-motion-selection updates the toolbar attach chip label
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: {
        type: 'om:sa-motion-selection',
        token: bridgeToken,
        snapshot: {
          projectId: 'mproj-1',
          activeCompPath: 'scenes/intro.html',
          editingFile: 'scenes/intro.html',
          currentTime: 1.5,
          duration: 8,
          fps: 30,
          inPoint: null,
          outPoint: null,
          rangeSelection: null,
          domSelection: { label: 'Title Card', tagName: 'h1', selector: '#title-card', sourceFile: 'scenes/intro.html' },
          groupSelections: [],
          timelineClips: [{ id: 'clip-1', label: 'Title Card', start: 0, duration: 3 }],
          keyframeCount: 1,
          consoleErrors: [],
        },
      },
    }));
  });
  await flush();

  const motionAttachBtn = document.querySelector('.om-sa-motion-attach-btn') as HTMLButtonElement;
  expect(motionAttachBtn).toBeTruthy();
  expect(motionAttachBtn.getAttribute('data-has-selection')).toBe('true');
  expect(motionAttachBtn.textContent).toContain('Title Card · 1.5s');

  // Clicking toolbar attach button sends attach-selection command into iframe
  await act(async () => motionAttachBtn.click());
  expect(postedToIframe.some((m: any) => m?.command === 'attach-selection')).toBe(true);

  // Receiving om:sa-motion-attach adds the selection chip into the composer
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: {
        type: 'om:sa-motion-attach',
        token: bridgeToken,
        kind: 'selection',
        sendImmediately: false,
        snapshot: {
          projectId: 'mproj-1',
          activeCompPath: 'scenes/intro.html',
          editingFile: 'scenes/intro.html',
          currentTime: 1.5,
          duration: 8,
          fps: 30,
          inPoint: null,
          outPoint: null,
          rangeSelection: null,
          domSelection: { label: 'Title Card', tagName: 'h1', selector: '#title-card', sourceFile: 'scenes/intro.html' },
          groupSelections: [],
          timelineClips: [{ id: 'clip-1', label: 'Title Card', start: 0, duration: 3 }],
          keyframeCount: 1,
          consoleErrors: [],
        },
      },
    }));
  });
  await flush();
  expect(container.querySelector('.om-sa-composer')?.textContent).toContain('Title Card · 1.5s');

  // Opening changed file for Motion project posts open-file command into iframe
  const changedFilePill = [...container.querySelectorAll('button')].find(
    b => b.textContent?.includes('scenes/intro.html'),
  ) as HTMLButtonElement | undefined;
  if (changedFilePill) {
    await act(async () => changedFilePill.click());
    await flush();
    expect(postedToIframe.some((m: any) => m?.command === 'open-file' && m?.filePath === 'scenes/intro.html')).toBe(true);
  }
});

it('enters Slide deck from primary Create slides card and Document from Explore more', async () => {
  setupDesignStudioMocks();
  const flushMore = async () => {
    await flush();
    await flush();
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flushMore();

  // 1) Primary Create slides -> Design Studio Slide deck module
  const slidesCard = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-starter-card')].find(
    el => el.textContent?.includes('Create slides'),
  )!;
  expect(slidesCard).toBeTruthy();
  await act(async () => slidesCard.click());
  await flushMore();

  expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Slide deck');
  expect(container.querySelector('.om-sa-showcase-tabs [data-active="true"]')?.textContent).toContain('Slide deck');
  expect(container.textContent).toContain('Series A Pitch Deck');

  // Clear mode back to home
  await act(async () => container.querySelector<HTMLButtonElement>('.om-sa-chip-remove[aria-label="Clear mode"]')?.click());
  await flushMore();

  // 2) Explore more -> Document -> Design Studio Document module + A4 Portrait pill + scaffold
  const moreBtn = container.querySelector<HTMLButtonElement>('.om-sa-starter-card-more')!;
  await act(async () => moreBtn.click());
  await flushMore();

  const docItem = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-more-menu .om-sa-more-item')].find(
    el => el.textContent?.includes('Document'),
  )!;
  expect(docItem).toBeTruthy();
  await act(async () => docItem.click());
  await flushMore();

  expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Document');
  expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('A4 Portrait');
  expect(container.querySelector('.om-sa-showcase-tabs [data-active="true"]')?.textContent).toContain('Document');
  expect(container.textContent).toContain('Executive Finance Report');
});

it('opens Research a topic with deliverable quick-switch, floating pills, skill pinning, and Design Studio auto-scaffolding', async () => {
  clearSuperAgentCache();
  const { createdChats, turnBodies } = setupDesignStudioMocks();
  const baseFetch = globalThis.fetch as any;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${SUPER_AGENT_API}/resources`) && url.includes('kind=design-skill')) {
      return new Response(
        JSON.stringify({
          counts: {},
          items: [
            { id: 'frontend-dev', kind: 'design-skill', title: 'Frontend Dev Skill', subtitle: 'prototype', scenario: 'prototype' },
            { id: 'research-decision-room', kind: 'design-skill', title: 'Research Decision Room', subtitle: 'document', scenario: 'document' },
          ],
          generatedAt: Date.now(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return baseFetch(input, init);
  }) as any;

  const createProjectSpy = vi.spyOn(designClient, 'createProject').mockResolvedValue({
    project: {
      id: 'dproj-research-1',
      title: 'Sync engine decision room',
      scenario: 'prototype',
      entry: 'index.html',
      revision: 'rev-r1',
      createdAt: 1,
      updatedAt: 1,
    },
  } as any);

  const flushMore = async () => {
    await flush();
    await flush();
  };

  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={null}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await flushMore();

    await act(async () => container.querySelector<HTMLButtonElement>('.om-sa-starter-card-more')!.click());
    await flushMore();
    const researchItem = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-more-menu .om-sa-more-item')].find(
      el => el.textContent?.includes('Research a topic'),
    )!;
    await act(async () => researchItem.click());
    await flushMore();

    // Quick-switch deliverable cards & floating pills
    const stripLabels = [...container.querySelectorAll('.om-sa-design-module-card')].map(el => el.textContent?.trim());
    expect(stripLabels).toEqual(['Visual Report', 'Decision Room', 'Research Deck', 'Briefing Memo']);
    expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Visual Report');
    expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Balanced');
    expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Charts & citations');

    // Open Research depth pill and select Deep dive
    const depthBtn = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-composer-top-pill')].find(
      el => el.textContent?.includes('Balanced'),
    )!;
    await act(async () => depthBtn.click());
    await flushMore();
    const deepChoice = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-game-choice-row')].find(
      el => el.textContent?.includes('Deep dive'),
    )!;
    expect(deepChoice).toBeTruthy();
    await act(async () => deepChoice.click());
    await flushMore();
    expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Deep dive');

    // Switch deliverable quick-switch card to Decision Room -> filters to Decision Boards
    const decisionCard = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-design-module-card')].find(
      el => el.textContent?.includes('Decision Room'),
    )!;
    await act(async () => decisionCard.click());
    await flushMore();
    expect(container.querySelector('.om-sa-showcase-tabs [data-active="true"]')?.textContent).toContain('Decision Boards');
    expect(container.textContent).toContain('Live Sales Telemetry');

    // Design Skills tab pins research-decision-room first
    const skillsTab = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-tabs button')].find(
      el => el.textContent?.includes('Design Skills'),
    )!;
    await act(async () => skillsTab.click());
    await flushMore();
    const firstSkill = container.querySelector('.om-sa-showcase-grid')?.textContent ?? '';
    expect(firstSkill.indexOf('Research Decision Room')).toBeGreaterThan(-1);
    expect(firstSkill.indexOf('Research Decision Room')).toBeLessThan(firstSkill.indexOf('Frontend Dev Skill'));

    // Submit prompt -> auto-scaffolds prototype Decision Room and sends research intent
    await typeInComposer(getComposerEditor(container), 'Compare SQLite sync vs Postgres');
    await flushMore();
    const sendBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"], .om-sa-send-btn')!;
    await act(async () => sendBtn.click());
    await flushMore();

    expect(createProjectSpy).toHaveBeenCalledWith(expect.objectContaining({ scenario: 'prototype' }));
    expect(createdChats[0]?.body?.intent).toBe('research');
    expect(turnBodies[0]?.mode).toBe('research');
    expect(turnBodies[0]?.hiddenInstructions).toContain('Decision Room');
  } finally {
    createProjectSpy.mockRestore();
  }
});

it('opens Visualization with type quick-switch, Engine & Data pills, skill pinning, and WebGL auto-scaffolding', async () => {
  clearSuperAgentCache();
  const { createdChats, turnBodies } = setupDesignStudioMocks();
  const baseFetch = globalThis.fetch as any;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${SUPER_AGENT_API}/resources`) && url.includes('kind=design-skill')) {
      return new Response(
        JSON.stringify({
          counts: {},
          items: [
            { id: 'frontend-dev', kind: 'design-skill', title: 'Frontend Dev Skill', subtitle: 'prototype', scenario: 'prototype' },
            { id: 'd3-visualization', kind: 'design-skill', title: 'D3 Visualization', subtitle: 'live-artifact', scenario: 'live-artifact' },
          ],
          generatedAt: Date.now(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return baseFetch(input, init);
  }) as any;

  const createProjectSpy = vi.spyOn(designClient, 'createProject').mockResolvedValue({
    project: {
      id: 'dproj-viz-1',
      title: '3D point cloud map',
      scenario: 'webgl',
      entry: 'index.html',
      revision: 'rev-v1',
      createdAt: 1,
      updatedAt: 1,
    },
  } as any);

  const flushMore = async () => {
    await flush();
    await flush();
  };

  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={null}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await flushMore();

    await act(async () => container.querySelector<HTMLButtonElement>('.om-sa-starter-card-more')!.click());
    await flushMore();
    const vizItem = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-more-menu .om-sa-more-item')].find(
      el => el.textContent?.includes('Visualization'),
    )!;
    await act(async () => vizItem.click());
    await flushMore();

    const stripLabels = [...container.querySelectorAll('.om-sa-design-module-card')].map(el => el.textContent?.trim());
    expect(stripLabels).toEqual(['KPI Dashboard', 'Chart & Graph', 'Infographic', 'Diagram & Map', '3D & WebGL']);
    expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('KPI Dashboard');
    expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Interactive HTML & SVG');

    // Design Skills pins d3-visualization ahead of generic skills
    const skillsTab = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-showcase-tabs button')].find(
      el => el.textContent?.includes('Design Skills'),
    )!;
    await act(async () => skillsTab.click());
    await flushMore();
    const firstSkill = container.querySelector('.om-sa-showcase-grid')?.textContent ?? '';
    expect(firstSkill.indexOf('D3 Visualization')).toBeGreaterThan(-1);
    expect(firstSkill.indexOf('D3 Visualization')).toBeLessThan(firstSkill.indexOf('Frontend Dev Skill'));

    // Click 3D & WebGL card -> updates engine to Canvas / WebGL & filters to 3D & WebGL templates
    const webglCard = [...container.querySelectorAll<HTMLButtonElement>('.om-sa-design-module-card')].find(
      el => el.textContent?.includes('3D & WebGL'),
    )!;
    await act(async () => webglCard.click());
    await flushMore();
    expect(container.querySelector('.om-sa-showcase-tabs [data-active="true"]')?.textContent).toContain('3D & WebGL');
    expect(container.querySelector('.om-sa-composer-top-bar')?.textContent).toContain('Canvas / WebGL');
    expect(container.textContent).toContain('3D Shader Stage');

    // Submit prompt -> auto-scaffolds webgl project and sends visualization intent
    await typeInComposer(getComposerEditor(container), 'Build a 3D particle point-cloud explorer');
    await flushMore();
    const sendBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"], .om-sa-send-btn')!;
    await act(async () => sendBtn.click());
    await flushMore();

    expect(createProjectSpy).toHaveBeenCalledWith(expect.objectContaining({ scenario: 'webgl' }));
    expect(createdChats[0]?.body?.intent).toBe('visualization');
    expect(turnBodies[0]?.mode).toBe('visualization');
    expect(turnBodies[0]?.hiddenInstructions).toContain('3D & WebGL');
  } finally {
    createProjectSpy.mockRestore();
  }
});

it('switches Agent, model, thinking level across Antigravity/Claude/Codex and bookmarks favorites in the 3-column model picker', async () => {
  localStorage.removeItem('om.superAgent.favoriteModels.v1');
  localStorage.removeItem('om.superAgent.agentMemory.v1');
  const turnBodies: any[] = [];
  let chatCounter = 0;

  const multiAgents = [
    {
      id: 'antigravity',
      label: 'Antigravity',
      icon: 'antigravity',
      installed: true,
      auth: 'signed-in',
      checkedAt: '2026-11-24T00:00:00.000Z',
      models: [
        { id: 'gemini-4-neon', label: 'Gemini 4 Neon', source: 'cli', reasoning: ['low', 'medium', 'high', 'xhigh'] },
        { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', source: 'cli', reasoning: ['low', 'medium', 'high'] },
      ],
    },
    {
      id: 'codex',
      label: 'Codex',
      icon: 'codex',
      installed: true,
      auth: 'signed-in',
      checkedAt: '2026-11-24T00:00:00.000Z',
      models: [
        { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', source: 'cli', reasoning: ['low', 'medium', 'high', 'xhigh'] },
      ],
    },
    {
      id: 'claude',
      label: 'Claude Code',
      icon: 'claude-code',
      installed: true,
      auth: 'signed-in',
      checkedAt: '2026-11-24T00:00:00.000Z',
      models: [
        { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', source: 'cli', reasoning: ['low', 'medium', 'high'] },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', source: 'cli' },
      ],
    },
  ];

  const json = (data: unknown) =>
    new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.startsWith('/motion-api/settings/agents')) {
      return json({ agents: multiAgents, default: { agent: 'antigravity', model: 'gemini-4-neon', reasoning: 'high' } });
    }
    if (url.startsWith('/motion-api/settings/agent-runtimes')) {
      return json({
        localDirectAvailable: true,
        defaultRuntimeId: 'local:direct',
        runtimes: [{
          id: 'local:direct',
          kind: 'local-direct',
          name: 'This computer',
          status: 'online',
          agents: multiAgents,
          runnableAgentIds: ['antigravity', 'codex', 'claude'],
        }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json(sampleResources);
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'GET') {
      return json({ conversations: [] });
    }
    if (url === `${SUPER_AGENT_API}/chats` && method === 'POST') {
      chatCounter += 1;
      const body = JSON.parse(String(init?.body || '{}'));
      return json({
        conversation: {
          id: `ffff0000-0000-0000-0000-00000000000${chatCounter}`,
          title: 'Model Picker Task',
          engine: body.engine ?? 'antigravity',
          model: body.model,
          reasoning: body.reasoning,
          permissionMode: 'on-request',
          createdAt: 1000,
          updatedAt: 1000,
          state: 'idle',
          messages: [],
          artifacts: [],
          approvals: [],
        },
      });
    }
    const turnMatch = url.match(new RegExp(`^${SUPER_AGENT_API}/chats/([^/]+)/turn$`));
    if (turnMatch && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      turnBodies.push(body);
      return json({
        conversation: {
          id: turnMatch[1],
          title: 'Model Picker Task',
          engine: body.engine,
          model: body.model,
          reasoning: body.reasoning,
          permissionMode: 'on-request',
          createdAt: 1000,
          updatedAt: 2000,
          state: 'running',
          messages: [{ id: 'u-1', role: 'user', text: body.text, createdAt: 2000 }],
          artifacts: [],
          approvals: [],
        },
      });
    }
    return json({});
  }) as any;

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();

  // Trigger shows Antigravity's Gemini 4 Neon + High thinking badge
  const trigger = container.querySelector<HTMLButtonElement>('.om-sa-model-trigger')!;
  expect(trigger).toBeTruthy();
  expect(trigger.textContent).toContain('Gemini 4 Neon');
  expect(trigger.textContent).toContain('High');

  // Open 3-column popover: Thinking level column is visible for Antigravity (not limited to Codex!)
  await act(async () => trigger.click());
  await flush();
  const thinkingOptions = [...document.querySelectorAll('.om-sa-model-thinking-option')].map(el => el.textContent?.trim());
  expect(thinkingOptions).toEqual(['Default', 'Low', 'Medium', 'High', 'Extra']);

  // Bookmark Gemini 4 Neon for Favorites tab
  const favBtn = document.querySelector<HTMLButtonElement>('.om-sa-model-row[data-active] .om-sa-model-fav-btn')!;
  expect(favBtn).toBeTruthy();
  await act(async () => favBtn.click());
  await flush();

  // Switch left rail to Claude Code, search "Opus", pick Claude Opus 4.6 -> preserves compatible 'high' thinking level
  const claudeTab = document.querySelector<HTMLButtonElement>('.om-sa-model-rail-btn[aria-label="Claude Code"]')!;
  expect(claudeTab).toBeTruthy();
  await act(async () => claudeTab.click());
  await flush();

  const searchInput = document.querySelector<HTMLInputElement>('.om-sa-model-search input')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(searchInput, 'Opus');
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
  expect(document.querySelectorAll('.om-sa-model-row-main').length).toBe(1);

  const opusRow = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-model-row-main')].find(
    el => el.textContent?.includes('Claude Opus 4.6'),
  )!;
  await act(async () => opusRow.click());
  await flush();

  // Thinking level column updates to Claude Opus 4.6 (Default, Low, Medium, High) and keeps High selected
  expect([...document.querySelectorAll('.om-sa-model-thinking-option')].map(el => el.textContent?.trim())).toEqual([
    'Default',
    'Low',
    'Medium',
    'High',
  ]);
  expect(document.querySelector('.om-sa-model-thinking-option[data-active]')?.textContent?.trim()).toBe('High');

  // Switch to Favorites tab -> click bookmarked Gemini 4 Neon -> pick Extra (xhigh) thinking level
  const favTab = document.querySelector<HTMLButtonElement>('.om-sa-model-rail-btn[aria-label="Favorites"]')!;
  await act(async () => favTab.click());
  await flush();
  const favNeonRow = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-model-row-main')].find(
    el => el.textContent?.includes('Gemini 4 Neon'),
  )!;
  expect(favNeonRow).toBeTruthy();
  await act(async () => favNeonRow.click());
  await flush();

  const extraOption = [...document.querySelectorAll<HTMLButtonElement>('.om-sa-model-thinking-option')].find(
    el => el.textContent?.trim() === 'Extra',
  )!;
  expect(extraOption).toBeTruthy();
  await act(async () => extraOption.click());
  await flush();

  // Popover closed, trigger shows Gemini 4 Neon + Extra, and submitting sends engine/model/reasoning cleanly
  expect(document.querySelector('.om-sa-model-grid')).toBeNull();
  expect(trigger.textContent).toContain('Gemini 4 Neon');
  expect(trigger.textContent).toContain('Extra');

  await typeInComposer(getComposerEditor(container), 'Verify Antigravity Extra thinking');
  await flush();
  const sendBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"], .om-sa-send-btn')!;
  await act(async () => sendBtn.click());
  await flush();
  await flush();

  expect(turnBodies[0]?.engine).toBe('antigravity');
  expect(turnBodies[0]?.model).toBe('gemini-4-neon');
  expect(turnBodies[0]?.reasoning).toBe('xhigh');
});

it('shows game validation failures in the step list without relying on an expanded output', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const rowResults = [
    { tool: 'openmotion_game_validate', outputPreview: '{"id":"old","passed":false,"diagnostics":[\n…' },
    { tool: 'openmotion_game_validate', validationPassed: false, outputPreview: 'Truncated MCP output' },
    { tool: 'openmotion_game_validate', outputPreview: '{"passed":true,"diagnostics":[]}' },
    { tool: 'other_tool', outputPreview: '{"passed":false}' },
  ];
  try {
    await act(async () => root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={{ ...sampleChat, state: 'idle', approvals: [], artifacts: [], messages: [
            { id: 'user', role: 'user', text: 'Validate game', createdAt: 1000 },
            ...rowResults.map((event, index) => ({
              id: `row-${index}`,
              role: 'tool' as const,
              text: event.tool,
              createdAt: 2000 + index,
              toolEvent: {
                ...event, callId: `call-${index}`,
                label: event.tool === 'other_tool' ? 'Other tool' : 'Validated game build',
                status: 'completed' as const, startedAt: 2000 + index,
              },
            })),
            { id: 'assistant', role: 'assistant', text: 'Done checking', createdAt: 3000 },
          ] }}
          busy={false}
          sending={false}
          engineLabel="Codex"
          onOpenArtifactId={vi.fn()}
          onPreviewAttachment={vi.fn()}
          onCopyText={vi.fn()}
          onApprove={vi.fn()}
        />
      </I18nProvider>,
    ));
    const toggle = container.querySelector<HTMLButtonElement>('.om-sa-work-summary-btn')!;
    if (toggle.getAttribute('aria-expanded') === 'false') await act(async () => toggle.click());
    const rows = [...container.querySelectorAll('.om-sa-tool-row')];
    expect(rows.map(row => row.querySelector('.om-sa-tool-label')?.textContent)).toEqual([
      'Game validation failed', 'Game validation failed', 'Validated game build', 'Other tool',
    ]);
    expect(rows.map(row => row.querySelector('.om-sa-tool-status')?.getAttribute('data-status'))).toEqual([
      'failed', 'failed', 'completed', 'completed',
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('formats measured step durations without a minimum or a 60-second remainder', () => {
  expect(formatElapsedDuration(0)).toBe('<1ms');
  expect(formatElapsedDuration(1)).toBe('1ms');
  expect(formatElapsedDuration(8)).toBe('8ms');
  expect(formatElapsedDuration(119_999)).toBe('2m 0s');
});
