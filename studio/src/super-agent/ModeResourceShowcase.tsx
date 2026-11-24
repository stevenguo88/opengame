import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { preconnect } from 'react-dom';
import { blackFridayTemplates } from '../../../shared/black-friday-collection';
import type { GalleryTemplate } from '../../../shared/catalog';
import { designScenarios, isDesignScenario } from '../../../shared/design-project';
import { rankSearchResults } from '../../../shared/fuzzy-search';
import { gameGenres, type GameCard, type GameGenre } from '../../../shared/game-contract';
import type { SuperAgentDesignModuleId, SuperAgentResourceAttachment } from '../../../shared/super-agent';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { VideoFrameThumbnail } from '../components/ui/VideoFrameThumbnail';
import { ScaledPreviewThumb } from '../design/ScaledPreviewThumb';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { groupBrandSeries, rankDiscoverySeries } from '../motion/brandStoryData';
import { cinemaTemplates } from '../motion/cinemaTemplates';
import { gptImageStory, seedanceStory } from '../motion/exploreModelStories';
import { GameMasonry, interleavePortrait } from '../motion/game/GameMasonry';
import {
  bundledGames,
  communityGames,
  coverUrl,
  formatPlays,
  gameApi,
  genreCovers,
  genreLabels,
} from '../motion/game/gameCatalog';
import {
  GAME_STUDIO_QUICK_IDEAS,
  localizedGameTitle,
  toGameResourceAttachment,
} from '../motion/game/gameSuperAgent';
import lunarRef from '../motion/scene-art/apollo-11.jpg';
import speakerRoomRef from '../motion/scene-art/speaker-room.webp';
import speakerStudioRef from '../motion/scene-art/speaker-studio.webp';
import { sceneExamples } from '../motion/sceneShowcase';
import { motionSkills, skillCategories, type MotionSkill, type SkillCategory } from '../motion/skillCatalog';
import { templateCollectionFacets, templatesInCollection, type TemplateCollection } from '../motion/templateCollections';
import { aiTechnologyIndustry, purposeOrder } from '../motion/templateDiscoveryTaxonomy';
import { useCoveredTemplates } from '../motion/useCoveredTemplates';
import {
  designScenarioOptionsPatch,
  RESEARCH_FORMAT_CHOICES,
  visualizationOptionsPatch,
  VIZ_TYPE_CHOICES,
  type ImageDesignScene,
  type ModeComposerOptions,
  type ResearchDeliverableFormat,
  type VisualizationType,
} from './ModeComposerControls';
import { resourceDisplaySubtitle, resourceDisplayTitle, resourceIcon, resourceKey, type ResourceCategoryTab } from './ResourcePickerDialog';
import { fetchWorkspaceResources } from './superAgentClient';

function preconnectGame(game: GameCard) {
  if (!game.external?.embeddable) return;
  const url = new URL(game.external.url);
  if (url.protocol === 'https:') preconnect(url.origin);
}

export type SuperAgentCreationModeId = 'coding' | 'design' | 'research' | 'visualization' | 'game' | 'website' | 'motion' | 'deck' | 'document' | 'image' | 'media' | 'audio';

export type CuratedReferenceImage = {
  url: string;
  filename: string;
  title: string;
  fallbackUrl?: string;
};

export type PickPromptMeta = {
  optionsPatch?: Partial<ModeComposerOptions>;
  referenceImage?: CuratedReferenceImage | null;
};

export type SuperAgentModeSpec = {
  id: SuperAgentCreationModeId;
  tone: 'coding' | 'agent' | 'image' | 'video' | 'audio';
  icon: string;
  label: string;
  title: string;
  subtitle?: string;
  placeholder: string;
  defaultPrompt: string;
  pickerCategory: ResourceCategoryTab;
  quickIdeas: readonly { title: string; prompt: string; optionsPatch?: Partial<ModeComposerOptions> }[];
};

export const SUPER_AGENT_MODES: readonly SuperAgentModeSpec[] = [
  {
    id: 'design',
    tone: 'image',
    icon: 'palette-line',
    label: 'Design Studio',
    title: 'Design anything, from visuals to live HTML',
    subtitle: 'Switch between HTML Design Studio modules and AI Image design below, attach templates or Brand Kits, and describe what you want to create.',
    placeholder: 'Describe the website, mobile app, slide deck, or visual artwork you want to design…',
    defaultPrompt: 'Design a modern interactive website prototype with a bold hero, interactive feature tabs, pricing toggle, and responsive mobile layout, then open it in the Artifact Viewer.',
    pickerCategory: 'design-template',
    quickIdeas: [
      { title: 'AI product landing page', prompt: 'Build a responsive AI product landing page with interactive feature switcher, pricing toggle, and customer proof.' },
      { title: 'Mobile app prototype', prompt: 'Design a mobile app prototype in a 390x844 phone viewport with bottom tab navigation and smooth transitions.' },
      { title: 'Investor pitch deck', prompt: 'Create an 8-slide investor pitch deck covering problem, solution, traction KPIs, and roadmap with speaker notes.' },
    ],
  },
  {
    id: 'coding',
    tone: 'coding',
    icon: 'code-s-slash-line',
    label: 'Coding',
    title: 'Code, debug & ship',
    subtitle: 'Pure coding workspace for inspecting repositories, editing files, running shell commands, and reviewing diffs.',
    placeholder: 'Ask your coding agent to inspect files, fix a bug, refactor, or run tests…',
    defaultPrompt: 'Inspect the working directory, run git status or check the files present, and summarize the structure.',
    pickerCategory: 'all',
    quickIdeas: [
      { title: 'Inspect repo & architecture', prompt: 'Inspect the repository structure and explain the main modules and entry points.' },
      { title: 'Debug & fix an issue', prompt: 'Reproduce and diagnose the bug, apply a minimal clean fix, and verify with tests.' },
      { title: 'Write & run tests', prompt: 'Add focused unit tests for the changed behavior and run the test suite to verify everything passes.' },
      { title: 'Refactor & review diff', prompt: 'Refactor the duplicated logic into a small clean helper, then review the git diff.' },
    ],
  },
  {
    id: 'research',
    tone: 'agent',
    icon: 'book-open-line',
    label: 'Research',
    title: 'Investigate deeply, present clearly',
    subtitle: 'Synthesize sources into visual reports, decision rooms, or research decks with cited charts and structured tables.',
    placeholder: 'Describe the topic, market, paper, or comparison you want to research…',
    defaultPrompt: 'Research the 2026 enterprise AI agent platform landscape with cited market figures, architecture comparisons, and risk tradeoffs, then build an interactive Visual Report in Design Studio and open it in the Artifact Viewer.',
    pickerCategory: 'design-template',
    quickIdeas: [
      {
        title: 'Market landscape report',
        prompt: 'Compare the top 6 AI coding and agent platforms on pricing, architecture, latency, and enterprise governance in a Visual Report.',
        optionsPatch: { researchFormat: 'report', researchDepth: 'deep', researchVisuals: true, researchCitations: true },
      },
      {
        title: 'Technical architecture decision room',
        prompt: 'Build an interactive Decision Room comparing local-first SQLite sync engines versus cloud Postgres architectures with an evidence ledger and tradeoff matrix.',
        optionsPatch: { researchFormat: 'decision-room', researchDepth: 'deep', researchVisuals: true, researchCitations: true },
      },
      {
        title: 'Executive research deck',
        prompt: 'Synthesize recent multimodal reasoning benchmarks into an 8-slide Research Deck with comparative charts and speaker notes.',
        optionsPatch: { researchFormat: 'deck', researchDepth: 'balanced', researchVisuals: true, researchCitations: true },
      },
      {
        title: 'Policy & competitive briefing memo',
        prompt: 'Write a concise two-page Briefing Memo analyzing regulatory shifts and competitive responses for executive leadership.',
        optionsPatch: { researchFormat: 'memo', researchDepth: 'quick', researchVisuals: false, researchCitations: true },
      },
    ],
  },
  {
    id: 'visualization',
    tone: 'coding',
    icon: 'bar-chart-box-line',
    label: 'Visualization',
    title: 'Turn data into interactive visuals',
    subtitle: 'Pick a chart, KPI dashboard, editorial infographic, or 3D WebGL scene below and attach live templates or Design Skills.',
    placeholder: 'Describe the dataset, chart type, metrics, or visual story you want to build…',
    defaultPrompt: 'Build an interactive KPI and cohort analytics visualization backed by data.json with responsive D3/SVG charts, hover tooltips, filter controls, and theme parity, then open it in the Artifact Viewer.',
    pickerCategory: 'design-template',
    quickIdeas: [
      {
        title: 'Live SaaS telemetry cockpit',
        prompt: 'Build an interactive KPI Dashboard powered by data.json with revenue trends, cohort retention curves, and regional drilldowns.',
        optionsPatch: { ...visualizationOptionsPatch('dashboard'), vizStyle: 'dark-terminal' },
      },
      {
        title: 'Interactive D3 chart story',
        prompt: 'Design an editorial multi-series D3 chart with annotations, hover scrubbing, logarithmic scale toggle, and source footnotes.',
        optionsPatch: { ...visualizationOptionsPatch('chart'), vizStyle: 'editorial' },
      },
      {
        title: 'System architecture & flow map',
        prompt: 'Create an interactive node-and-edge knowledge architecture diagram with clickable subsystems, dataflow highlighting, and search filter.',
        optionsPatch: { ...visualizationOptionsPatch('diagram'), vizStyle: 'minimal' },
      },
      {
        title: '3D spatial & WebGL data field',
        prompt: 'Author an interactive WebGL2 3D point-cloud visualization with orbit camera controls, category color filtering, and fluid point transitions.',
        optionsPatch: { ...visualizationOptionsPatch('webgl'), vizStyle: 'dark-terminal' },
      },
    ],
  },
  {
    id: 'website',
    tone: 'agent',
    icon: 'layout-line',
    label: 'Website & App',
    title: 'Your idea, live on the web',
    subtitle: 'Pick a Design Studio template or Brand Kit below to attach as context, then describe what you want to build.',
    placeholder: 'Describe the website, dashboard, or mobile app you want to build…',
    defaultPrompt: 'Design a modern interactive website prototype with a bold hero, interactive feature tabs, pricing toggle, and responsive mobile layout, then open it in the Artifact Viewer.',
    pickerCategory: 'design-template',
    quickIdeas: [
      { title: 'AI product landing page', prompt: 'Build a responsive AI product landing page with interactive feature switcher, pricing toggle, and customer proof.' },
      { title: 'Interactive SaaS dashboard', prompt: 'Create a live analytics dashboard with KPI cards, interactive filters, and trend charts.' },
      { title: 'Mobile app prototype', prompt: 'Design a mobile app prototype in a 390x844 phone viewport with bottom tab navigation and smooth transitions.' },
    ],
  },
  {
    id: 'motion',
    tone: 'video',
    icon: 'movie-line',
    label: 'Motion Video',
    title: 'Direct an editable Motion film',
    subtitle: 'Select Motion Studio templates, Skills, or Brand Kits to feed into Super Agent and generate editable HyperFrames timelines.',
    placeholder: 'Describe the motion video you want to create…',
    defaultPrompt: 'Create an editable 15-second Motion Studio product launch video using HyperFrames HTML and GSAP timelines with bold kinetic typography and smooth transitions, then open it in the Artifact Viewer.',
    pickerCategory: 'motion-template',
    quickIdeas: [
      { title: '15s product launch reel', prompt: 'Create a 15-second product launch video with bold kinetic typography, feature callouts, and a crisp logo outro.' },
      { title: 'Website to launch video', prompt: 'Turn a product story into a fast-paced 20-second launch film with UI screen choreography.' },
      { title: 'Brand commercial intro', prompt: 'Design a sleek 12-second brand commercial opener with bold kinetic typography and crisp geometric transitions.' },
    ],
  },
  {
    id: 'deck',
    tone: 'audio',
    icon: 'slideshow-line',
    label: 'Slides & Docs',
    title: 'Make a deck. Tell it clearly.',
    subtitle: 'Choose a Design Studio presentation or document template to attach, and export to PDF or PPTX anytime.',
    placeholder: 'Describe your presentation or document topic…',
    defaultPrompt: 'Create a clean 8-slide investor pitch deck in Design Studio with speaker notes, KPI visualizations, and keyboard slide navigation, then present it in the Artifact Viewer.',
    pickerCategory: 'design-template',
    quickIdeas: [
      { title: 'Investor pitch deck', prompt: 'Create an 8-slide investor pitch deck covering problem, solution, traction KPIs, and roadmap with speaker notes.' },
      { title: 'Quarterly business review', prompt: 'Build a quarterly performance deck with metric comparisons, key milestones, and next-quarter priorities.' },
      { title: 'Competitor landscape report', prompt: 'Draft a structured competitor analysis report with positioning matrix and executive summary.' },
    ],
  },
  {
    id: 'game',
    tone: 'agent',
    icon: 'gamepad-line',
    label: 'Game Studio',
    title: 'Create a playable game in minutes',
    placeholder: 'Describe the game you want to make',
    defaultPrompt: 'Build a playable retro neon arcade space-shooter game in HTML5 Canvas with keyboard and mouse controls, score & wave HUD, particle explosions, and a restart button. Preview it in the Artifact Viewer.',
    pickerCategory: 'projects',
    quickIdeas: GAME_STUDIO_QUICK_IDEAS,
  },
  {
    id: 'image',
    tone: 'image',
    icon: 'image-line',
    label: 'Image Artwork',
    title: 'Generate or remix visual assets',
    subtitle: 'Start from curated Image Studio cases, or attach your own workspace assets and Brand Kits as visual references.',
    placeholder: 'Describe the image artwork or reference edit you want to generate…',
    defaultPrompt: 'Check my configured image models and generate a cinematic product hero illustration in the workspace asset library, inspect the result, and display it in the Artifact Viewer.',
    pickerCategory: 'asset',
    quickIdeas: [
      { title: 'Cinematic product hero', prompt: 'Generate a studio-lit matte ceramic wireless speaker hero visual with warm rim lighting on a dark slate surface.', optionsPatch: { imageScene: 'text-to-image' } },
      { title: 'Character concept sheet', prompt: 'Create a consistent character concept illustration in 16:9 widescreen framing.', optionsPatch: { imageScene: 'text-to-image' } },
      { title: 'Editorial poster artwork', prompt: 'Design a bold editorial campaign visual with dramatic lighting and clean composition.', optionsPatch: { imageScene: 'text-to-image' } },
    ],
  },
  {
    id: 'media',
    tone: 'video',
    icon: 'clapperboard-line',
    label: 'Cinema Video',
    title: 'Direct cinema shots',
    subtitle: 'Choose a Cinema Studio shot template or Seedance scene to seed your prompt, or switch to Motion graphics anytime.',
    placeholder: 'Describe the cinema video shot, camera motion, and lighting you want to generate…',
    defaultPrompt: 'Inspect my configured video models and help me generate a short cinematic shot in workspace assets, then show it in the Artifact Viewer.',
    pickerCategory: 'asset',
    quickIdeas: [
      { title: 'Cinematic B-roll shot', prompt: 'Generate a 5-second cinematic slow push-in shot of a sunlit minimalist courtyard with drifting leaf shadows.' },
      { title: 'Product slow-motion reveal', prompt: 'Direct a 5-second studio macro slow-motion product reveal with dramatic rim lighting.' },
      { title: 'Multi-shot story sequence', prompt: 'Create a 3-shot cinematic sequence with matching lighting and smooth camera push-in.' },
    ],
  },
  {
    id: 'audio',
    tone: 'audio',
    icon: 'music-2-line',
    label: 'Audio & Sound',
    title: 'Create sound & audio',
    subtitle: 'Compose original soundtracks, studio voiceovers, podcast intros, or crisp sound effects into workspace assets.',
    placeholder: 'Describe the soundtrack, voiceover, podcast, or sound effect you want to create…',
    defaultPrompt: 'Inspect my configured audio models and help me compose a 30-second product launch soundtrack or narration in workspace assets, then preview it in the Artifact Viewer.',
    pickerCategory: 'asset',
    quickIdeas: [
      { title: 'Product launch soundtrack', prompt: 'Compose an upbeat 30-second electronic product launch soundtrack with a clean build-up and crisp finale.', optionsPatch: { audioType: 'music', audioModelId: 'auto' } },
      { title: 'Warm narration voiceover', prompt: 'Every idea deserves to be seen. This is where our story begins.', optionsPatch: { audioType: 'voiceover', audioModelId: 'auto' } },
      { title: 'UI & transition sound effects', prompt: 'Create a soft two-note notification chime with a light airy tail for a UI transition.', optionsPatch: { audioType: 'sfx', audioModelId: 'auto' } },
    ],
  },
];

const DESIGN_MODULE_QUICK_IDEAS: Record<SuperAgentDesignModuleId, readonly { title: string; prompt: string; optionsPatch?: Partial<ModeComposerOptions> }[]> = {
  prototype: [
    { title: 'AI product landing page', prompt: 'Build a responsive AI product landing page with interactive feature switcher, pricing toggle, and customer proof.' },
    { title: 'Interactive SaaS dashboard', prompt: 'Create a live analytics dashboard with KPI cards, interactive filters, and trend charts.' },
    { title: 'Editorial studio showcase', prompt: 'Design a kinetic editorial agency portfolio website with bold typography and interactive project previews.' },
  ],
  'mobile-app': [
    { title: 'Fitness coaching app', prompt: 'Prototype a mobile fitness coaching app covering goal setup, weekly plans, workout check-ins and progress review.' },
    { title: 'Personal finance wallet', prompt: 'Design an iOS personal finance app with account balance, recent transactions, budget rings and quick transfer.' },
    { title: 'Travel itinerary companion', prompt: 'Create a mobile travel companion app with itinerary timeline, boarding pass card and offline city tips.' },
  ],
  deck: [
    { title: 'Investor pitch deck', prompt: 'Create an 8-slide investor pitch deck covering problem, solution, traction KPIs, and roadmap with speaker notes.' },
    { title: 'Quarterly business review', prompt: 'Build a quarterly performance deck with metric comparisons, key milestones, and next-quarter priorities.' },
    { title: 'Product launch keynote', prompt: 'Design a clean 10-slide keynote presentation announcing a new hardware & AI product with bold visual slides.' },
  ],
  document: [
    { title: 'One-page designer resume', prompt: 'Draft a one-page resume for a senior product designer with summary, experience, skills and selected work.' },
    { title: 'Quarterly finance report', prompt: 'Write a two-page quarterly finance report with KPIs, charts and commentary.' },
    { title: 'Competitor landscape brief', prompt: 'Draft a structured competitor analysis report with positioning matrix and executive summary.' },
  ],
  'web-clone': [
    { title: 'Clone a SaaS home page', prompt: 'Rebuild a modern developer-tool landing page as clean, responsive, editable HTML with interactive tabs.' },
    { title: 'Rebuild an editorial blog', prompt: 'Recreate an editorial publication homepage with featured stories, reading list, and dark/light theme.' },
    { title: 'Responsive pricing page clone', prompt: 'Rebuild a multi-tier pricing page with billing toggle, feature comparison table, and FAQ accordion.' },
  ],
  'live-artifact': [
    { title: 'Live sales KPI dashboard', prompt: 'Create a live sales dashboard driven by data.json with KPIs, a trend chart and a top-accounts table.' },
    { title: 'Real-time metrics board', prompt: 'Build an operational telemetry dashboard backed by data.json with live filter chips and status breakdown.' },
    { title: 'Interactive cohort explorer', prompt: 'Design a retention cohort analysis viewer powered by data.json with date-range and segment controls.' },
  ],
  webgl: [
    { title: 'Reactive particle hero', prompt: 'Build a WebGL2 hero with a flowing particle field that reacts to the pointer and scroll.' },
    { title: 'Interactive 3D product stage', prompt: 'Create a WebGL2 interactive 3D showcase with smooth camera orbit, studio lighting, and material presets.' },
    { title: 'Fluid shader background', prompt: 'Author an interactive GLSL shader canvas with live color palette controls and pointer ripples.' },
  ],
  image: [
    { title: 'Cinematic product hero', prompt: 'Generate a studio-lit matte ceramic wireless speaker hero visual with warm rim lighting on a dark slate surface.', optionsPatch: { imageScene: 'text-to-image' } },
    { title: 'Editorial poster artwork', prompt: 'Design a bold editorial campaign visual with dramatic lighting and clean composition.', optionsPatch: { imageScene: 'text-to-image' } },
    { title: 'Brand campaign visual', prompt: 'Create a cohesive key visual artwork tailored for social launch banners and product thumbnails.', optionsPatch: { imageScene: 'text-to-image' } },
  ],
};

const RESEARCH_SKILL_IDS = new Set([
  'research-decision-room',
  'data-report',
  'doc-kami-parchment',
  'article-magazine',
  'writing-guidelines',
  'design-brief',
  'frontend-slides',
  'deck-swiss-international',
]);

const VIZ_SKILL_IDS = new Set([
  'd3-visualization',
  'frame-data-chart-nyt',
  'frame-flowchart-sticky',
  'hand-drawn-diagrams',
  'data-report',
  'algorithmic-art',
]);

function resourceSearchHaystack(item: SuperAgentResourceAttachment): string {
  return [item.id, item.title, item.subtitle, ...(item.tags ?? [])].filter(Boolean).join(' ');
}

function isResearchReportTemplate(item: SuperAgentResourceAttachment): boolean {
  return item.scenario === 'document';
}

function isResearchBoardTemplate(item: SuperAgentResourceAttachment): boolean {
  return item.scenario === 'live-artifact' || /decision|matrix|orbit-|pm-spec|visualizer|codex|brief/i.test(item.id);
}

function isResearchDeckTemplate(item: SuperAgentResourceAttachment): boolean {
  return item.scenario === 'deck'
    && /report|graph|blueprint|swiss|editorial|academic|pitch|weekly|research/i.test(resourceSearchHaystack(item));
}

function isResearchTemplate(item: SuperAgentResourceAttachment): boolean {
  return isResearchReportTemplate(item) || isResearchBoardTemplate(item) || isResearchDeckTemplate(item);
}

function researchFormatToFilter(format: ResearchDeliverableFormat): string {
  if (format === 'decision-room') return 'boards';
  if (format === 'deck') return 'decks';
  return 'reports';
}

function isVizDashboardTemplate(item: SuperAgentResourceAttachment): boolean {
  return item.scenario === 'live-artifact'
    || /dashboard|trading|telemetry|analytics|metrics|matrix/i.test(resourceSearchHaystack(item));
}

function isVizChartOrDiagramTemplate(item: SuperAgentResourceAttachment): boolean {
  return item.scenario === 'live-artifact'
    || /chart|sparkline|graph|d3|data-report|finance-report|pentagram|diagram|blueprint|visualizer|map|flow|orbit|codex|architecture/i.test(resourceSearchHaystack(item));
}

function isVizInfographicTemplate(item: SuperAgentResourceAttachment): boolean {
  return (item.scenario === 'document' && /data|finance|article|critique|eguide/i.test(item.id))
    || /infographic|bauhaus|broadside|cobalt/i.test(resourceSearchHaystack(item));
}

function isVizTemplate(item: SuperAgentResourceAttachment): boolean {
  return item.scenario === 'webgl'
    || isVizDashboardTemplate(item)
    || isVizChartOrDiagramTemplate(item)
    || isVizInfographicTemplate(item);
}

function vizTypeToFilter(type: VisualizationType): string {
  if (type === 'dashboard') return 'dashboards';
  if (type === 'chart' || type === 'diagram') return 'charts';
  if (type === 'webgl') return 'webgl';
  return 'all';
}

export function findSuperAgentMode(id: string | null): SuperAgentModeSpec | null {
  return id ? SUPER_AGENT_MODES.find(item => item.id === id) ?? null : null;
}

const PAGE_BATCH_SIZE = 24;

type CuratedShowcaseCard = {
  id: string;
  title: string;
  subtitle: string[];
  seconds?: number;
  poster: string;
  posterPosition?: string;
  prompt: string;
  optionsPatch?: Partial<ModeComposerOptions>;
  referenceImage?: CuratedReferenceImage;
};

function buildImageCardsByCategory(category: string, isZh: boolean): CuratedShowcaseCard[] {
  const gpt: CuratedShowcaseCard[] = gptImageStory.cases.map((item, idx) => {
    const isEdit = item.destination.scene.id === 'image-edit';
    return {
      id: `gpt-${idx}`,
      title: item.example.title,
      subtitle: ['GPT Image 2.6', 'Image'],
      poster: item.example.poster,
      posterPosition: item.example.posterPosition,
      prompt: item.example.prompt,
      optionsPatch: { imageScene: isEdit ? 'image-edit' : 'text-to-image' },
      ...(isEdit
        ? {
            referenceImage: {
              url: speakerStudioRef,
              filename: 'speaker-studio.webp',
              title: 'Speaker studio reference',
            },
          }
        : {}),
    };
  });
  const t2i: CuratedShowcaseCard[] = sceneExamples['text-to-image'].map((ex, idx) => ({
    id: `t2i-${idx}`,
    title: ex.title,
    subtitle: ['Text to image'],
    poster: ex.poster,
    posterPosition: ex.posterPosition,
    prompt: ex.prompt,
    optionsPatch: { imageScene: 'text-to-image' },
  }));
  const edit: CuratedShowcaseCard[] = sceneExamples['image-edit'].map((ex, idx) => ({
    id: `edit-${idx}`,
    title: ex.title,
    subtitle: ['Image editing'],
    poster: ex.poster,
    posterPosition: ex.posterPosition,
    prompt: ex.prompt,
    optionsPatch: { imageScene: 'image-edit' },
    referenceImage: {
      url: speakerStudioRef,
      filename: 'speaker-studio.webp',
      title: 'Speaker studio reference',
    },
  }));
  const bg: CuratedShowcaseCard[] = sceneExamples['remove-background'].map((ex, idx) => ({
    id: `bg-${idx}`,
    title: ex.title,
    subtitle: ['Remove background'],
    poster: ex.poster,
    posterPosition: ex.posterPosition,
    prompt: ex.prompt,
    optionsPatch: { imageScene: 'remove-background' },
    referenceImage: {
      url: speakerStudioRef,
      filename: 'speaker-studio.webp',
      title: 'Speaker studio reference',
    },
  }));
  const relight: CuratedShowcaseCard[] = sceneExamples.relight.map((ex, idx) => ({
    id: `relight-${idx}`,
    title: ex.title,
    subtitle: ['Relight'],
    poster: ex.poster,
    posterPosition: ex.posterPosition,
    prompt: ex.prompt,
    optionsPatch: { imageScene: 'relight' },
    referenceImage: {
      url: speakerRoomRef,
      filename: 'speaker-room.webp',
      title: 'Speaker room reference',
    },
  }));
  const blend: CuratedShowcaseCard[] = sceneExamples['image-blend'].map((ex, idx) => ({
    id: `image-blend-${idx}`,
    title: ex.title,
    subtitle: ['Image blend'],
    poster: ex.poster,
    posterPosition: ex.posterPosition,
    prompt: ex.prompt,
    optionsPatch: { imageScene: 'image-blend' },
    referenceImage: {
      url: lunarRef,
      filename: 'apollo-11.jpg',
      title: 'Astronaut reference',
    },
  }));

  const cinemaStills: CuratedShowcaseCard[] = [
    ...cinemaTemplates
      .filter(tpl => tpl.scene !== 'image-to-video')
      .map(tpl => {
        const copy = isZh ? tpl.zh : tpl.en;
        return {
          id: `still-cinema-${tpl.id}`,
          title: copy.title,
          subtitle: ['Cinema still', 'Visual reference'],
          poster: tpl.poster,
          prompt: copy.prompt,
          optionsPatch: { imageScene: 'text-to-image' as const },
        };
      }),
    ...seedanceStory.cases
      .filter(item => item.destination.scene.id !== 'image-to-video')
      .map((item, idx) => ({
        id: `still-seedance-${idx}`,
        title: item.example.title,
        subtitle: ['Key visual', 'Art direction'],
        poster: item.example.poster,
        posterPosition: item.example.posterPosition,
        prompt: item.example.prompt,
        optionsPatch: { imageScene: 'text-to-image' as const },
      })),
  ];

  if (category === 'gpt-image') return gpt;
  if (category === 'text-to-image') return t2i;
  if (category === 'image-edit') return edit;
  if (category === 'remove-background') return bg;
  if (category === 'image-blend') return blend;
  if (category === 'relight') return relight;

  const seenTitles = new Set<string>();
  const seenPosters = new Set<string>();
  const primary: CuratedShowcaseCard[] = [];
  const secondary: CuratedShowcaseCard[] = [];
  for (const item of [...gpt, ...t2i, ...edit, ...bg, ...blend, ...relight, ...cinemaStills]) {
    if (seenTitles.has(item.title)) continue;
    seenTitles.add(item.title);
    if (item.poster && !seenPosters.has(item.poster)) {
      seenPosters.add(item.poster);
      primary.push(item);
    } else {
      secondary.push(item);
    }
  }
  return [...primary, ...secondary];
}

function buildCinemaCardsByCategory(
  category: string,
  isZh: boolean,
  modeId?: SuperAgentCreationModeId,
): CuratedShowcaseCard[] {
  const videoOptionsPatch: Partial<ModeComposerOptions> | undefined = modeId === 'motion'
    ? { motionEngine: 'video-model' }
    : modeId === 'media'
      ? { mediaSubMode: 'video' }
      : undefined;
  const cinema: CuratedShowcaseCard[] = cinemaTemplates.map(tpl => {
    const copy = isZh ? tpl.zh : tpl.en;
    const referenceImage: CuratedReferenceImage | undefined = tpl.scene === 'image-to-video'
      ? (tpl.id === 'interior-first-frame'
          ? { url: speakerRoomRef, filename: 'speaker-room.webp', title: 'Interior first frame' }
          : { url: tpl.poster, filename: `${tpl.id}.webp`, title: copy.title, fallbackUrl: speakerStudioRef })
      : undefined;
    return {
      id: `cinema-${tpl.id}`,
      title: copy.title,
      subtitle: [tpl.model.name, tpl.aspect],
      seconds: tpl.duration,
      poster: tpl.poster,
      prompt: copy.prompt,
      ...(videoOptionsPatch ? { optionsPatch: videoOptionsPatch } : {}),
      ...(referenceImage ? { referenceImage } : {}),
    };
  });
  const seedance: CuratedShowcaseCard[] = seedanceStory.cases.map((item, idx) => {
    const referenceImage: CuratedReferenceImage | undefined = item.destination.scene.id === 'image-to-video'
      ? {
          url: item.example.poster,
          filename: 'product-first-frame.webp',
          title: item.example.title,
          fallbackUrl: speakerStudioRef,
        }
      : undefined;
    return {
      id: `seedance-${idx}`,
      title: item.example.title,
      subtitle: ['Seedance 2.5', 'Video'],
      poster: item.example.poster,
      posterPosition: item.example.posterPosition,
      prompt: item.example.prompt,
      ...(videoOptionsPatch ? { optionsPatch: videoOptionsPatch } : {}),
      ...(referenceImage ? { referenceImage } : {}),
    };
  });
  const videoScenes: CuratedShowcaseCard[] = (['video-camera-control', 'video-multi-shot'] as const).flatMap(sceneKey =>
    sceneExamples[sceneKey].map((ex, idx) => ({
      id: `${sceneKey}-${idx}`,
      title: ex.title,
      subtitle: [sceneKey === 'video-camera-control' ? 'Camera control' : 'Multi-shot'],
      poster: ex.poster,
      posterPosition: ex.posterPosition,
      prompt: ex.prompt,
      ...(videoOptionsPatch ? { optionsPatch: videoOptionsPatch } : {}),
    })),
  );
  const music: CuratedShowcaseCard[] = sceneExamples.music.map((ex, idx) => ({
    id: `audio-${idx}`,
    title: ex.title,
    subtitle: ex.model ? [ex.kind ?? 'Audio', ex.model] : [ex.kind ?? 'Audio'],
    seconds: ex.seconds,
    poster: ex.poster,
    prompt: ex.prompt,
    optionsPatch: {
      audioType: ex.kind === 'Sound effect' ? 'sfx' : 'music',
      audioModelId: 'auto',
    },
  }));
  const speech: CuratedShowcaseCard[] = sceneExamples.speech.map((ex, idx) => ({
    id: `speech-${idx}`,
    title: ex.title,
    subtitle: ['Text to speech'],
    poster: ex.poster,
    prompt: ex.prompt,
    optionsPatch: {
      audioType: 'voiceover',
      audioModelId: 'auto',
    },
  }));
  const audio: CuratedShowcaseCard[] = [...music, ...speech];

  const dedupe = (list: CuratedShowcaseCard[]) => {
    const seenTitles = new Set<string>();
    const seenPosters = new Set<string>();
    const primary: CuratedShowcaseCard[] = [];
    const secondary: CuratedShowcaseCard[] = [];
    for (const item of list) {
      if (seenTitles.has(item.title)) continue;
      seenTitles.add(item.title);
      if (item.poster && !seenPosters.has(item.poster)) {
        seenPosters.add(item.poster);
        primary.push(item);
      } else {
        secondary.push(item);
      }
    }
    return [...primary, ...secondary];
  };

  if (category === 'all-media') return dedupe([...cinema, ...seedance, ...videoScenes]);
  if (category === 'ai-video') return dedupe([...cinema, ...seedance, ...videoScenes]);
  if (category === 'cinema') return cinema;
  if (category === 'seedance') return seedance;
  if (category === 'video-scenes') return videoScenes;
  if (category === 'all-audio' || category === 'audio') return dedupe(audio);
  if (category === 'music') return dedupe(music);
  if (category === 'speech') return dedupe(speech);
  return dedupe([...cinema, ...seedance, ...videoScenes]);
}

function motionTemplateToAttachment(tpl: GalleryTemplate): SuperAgentResourceAttachment {
  return {
    id: tpl.id,
    kind: 'motion-template',
    title: tpl.title,
    subtitle: tpl.brand || tpl.subtitle || tpl.collection || 'Motion',
    previewUrl: tpl.posterUrl,
    tags: tpl.tags,
  };
}

function motionSkillToAttachment(skill: MotionSkill): SuperAgentResourceAttachment {
  return {
    id: skill.id,
    kind: 'skill',
    title: skill.title,
    subtitle: `${skill.category} · ${skill.useWhen}`,
    previewUrl: skill.cover?.poster || skill.cover?.gif,
    tags: [skill.category],
  };
}

type FilterOption = { id: string; label: string; count?: number };

function ResourceShowcaseThumb({ item, active = true }: { item: SuperAgentResourceAttachment; active?: boolean }) {
  const { t } = useI18n();
  const [imgFailed, setImgFailed] = useState(false);

  if ((item.kind === 'design-template' || item.kind === 'design-project') && item.previewUrl) {
    return (
      <div className="om-sa-showcase-thumb om-sa-showcase-iframe-wrap" aria-hidden="true">
        <ScaledPreviewThumb src={item.previewUrl} title={item.title} active={active} />
      </div>
    );
  }

  if (item.kind === 'asset' && item.modality === 'video' && item.previewUrl) {
    return (
      <div className="om-sa-showcase-thumb" data-modality="video" aria-hidden="true">
        <VideoFrameThumbnail key={item.previewUrl} src={item.previewUrl} fallbackLabel={t('Preview unavailable')} />
      </div>
    );
  }

  const showImg =
    !imgFailed
    && Boolean(item.previewUrl)
    && (
      item.kind === 'motion-template'
      || item.kind === 'brand-kit'
      || item.kind === 'skill'
      || (item.kind === 'asset' && item.modality === 'image')
    );

  if (showImg) {
    return (
      <div className="om-sa-showcase-thumb" aria-hidden="true">
        <img src={item.previewUrl} alt="" loading="lazy" decoding="async" onError={() => setImgFailed(true)} />
      </div>
    );
  }

  if (item.swatches?.length) {
    return (
      <div className="om-sa-showcase-thumb om-sa-showcase-swatches" aria-hidden="true">
        {item.swatches.slice(0, 5).map((hex, i) => (
          <span key={`${hex}-${i}`} style={{ background: hex }} />
        ))}
      </div>
    );
  }

  return (
    <div className="om-sa-showcase-thumb om-sa-showcase-icon-fallback" aria-hidden="true">
      <RemixIcon name={resourceIcon(item)} size={24} />
    </div>
  );
}

type GameSort = 'relevance' | 'plays' | 'newest';

const GAME_STATUS_LABELS: Partial<Record<GameCard['status'], string>> = {
  draft: 'Waiting for your Agent',
  building: 'Agent is running',
  ready: 'Ready to publish',
  failed: 'Not finished',
};

type ResourceListState =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; items: SuperAgentResourceAttachment[] };

function useShowcaseResourceList(kind: 'asset' | 'brand-kit', enabled: boolean) {
  const [state, setState] = useState<ResourceListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchWorkspaceResources({ kind, limit: 1000 }).then(({ items }) => {
      if (!Array.isArray(items)) throw new Error('Invalid workspace resource list');
      if (!cancelled) setState({ status: 'ready', items });
    }).catch(() => {
      if (!cancelled) setState({ status: 'error' });
    });
    return () => { cancelled = true; };
  }, [kind, enabled, attempt]);

  return {
    state,
    retry: () => {
      setState({ status: 'loading' });
      setAttempt(value => value + 1);
    },
  };
}

function filterByShowcaseQuery(items: SuperAgentResourceAttachment[], query: string) {
  if (!query) return items;
  return items.filter(item =>
    [item.id, item.title, item.subtitle, item.scenario, ...(item.tags ?? [])]
      .some(text => text?.toLocaleLowerCase().includes(query)),
  );
}

export function ModeResourceShowcase({
  active = true,
  mode,
  attachments,
  modeOptions,
  playingGameId = null,
  onChangeModeOptions,
  onToggleAttachment,
  onPlayGame,
  onDeployGame,
  onFocusComposer,
  onPickPrompt,
  onOpenAllResources,
  onClose,
}: {
  active?: boolean;
  mode: SuperAgentModeSpec;
  attachments: SuperAgentResourceAttachment[];
  modeOptions?: ModeComposerOptions;
  playingGameId?: string | null;
  onChangeModeOptions?: (patch: Partial<ModeComposerOptions>) => void;
  onToggleAttachment: (item: SuperAgentResourceAttachment) => boolean | void;
  onPlayGame?: (game: GameCard) => void;
  onDeployGame?: (game: GameCard) => void;
  onFocusComposer?: () => void;
  onPickPrompt: (prompt: string, meta?: PickPromptMeta) => void;
  onOpenAllResources: (category: ResourceCategoryTab) => void;
  onOpenGameStudio?: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const isZh = locale === 'zh-CN';
  const templateHeadingId = useId();

  // Motion & Cinema modes share Explore's full covered Motion template catalog.
  const coveredMotion = useCoveredTemplates(locale, mode.id === 'motion' || mode.id === 'media', { showFirstPage: true });
  const motionCatalog = useMemo(
    () => coveredMotion.catalog ?? coveredMotion.firstPage?.items ?? [],
    [coveredMotion.catalog, coveredMotion.firstPage],
  );
  const motionPurposes = useMemo(
    () => (coveredMotion.catalog ? templateCollectionFacets(coveredMotion.catalog).purposes : purposeOrder),
    [coveredMotion.catalog],
  );

  // Catalogs loaded when the associated mode or tab needs them.
  const [designTemplates, setDesignTemplates] = useState<SuperAgentResourceAttachment[] | null>(null);
  const [designProjects, setDesignProjects] = useState<SuperAgentResourceAttachment[] | null>(null);
  const [designSkills, setDesignSkills] = useState<SuperAgentResourceAttachment[] | null>(null);
  const [gameCatalog, setGameCatalog] = useState<GameCard[]>(() => [...communityGames, ...bundledGames]);
  const [loadingKind, setLoadingKind] = useState<string | null>(null);

  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [activeSkillCategory, setActiveSkillCategory] = useState<SkillCategory | 'all'>('all');
  const [designQuery, setDesignQuery] = useState('');
  const [gameQuery, setGameQuery] = useState('');
  const [gameSort, setGameSort] = useState<GameSort>('relevance');
  const [visibleCount, setVisibleCount] = useState(PAGE_BATCH_SIZE);
  const [fanIndex, setFanIndex] = useState(0);
  const [fanPaused, setFanPaused] = useState(false);
  const showcaseRef = useRef<HTMLElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const publishedGameTemplates = useMemo(
    () => gameCatalog.filter(g => g.source !== 'mine' && g.status === 'published'),
    [gameCatalog],
  );
  const fannedGames = useMemo(
    () => publishedGameTemplates.filter(g => Boolean(coverUrl(g))),
    [publishedGameTemplates],
  );
  const myGames = useMemo(
    () => gameCatalog.filter(g => g.source === 'mine').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [gameCatalog],
  );

  // Auto-rotate the fanned game showcase smoothly when visible and idle.
  useEffect(() => {
    if (!active || mode.id !== 'game' || fannedGames.length <= 1 || fanPaused) return;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setFanIndex(prev => (prev + 1) % fannedGames.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [active, mode.id, fannedGames.length, fanPaused]);

  const fanSlots = useMemo(() => {
    const total = fannedGames.length;
    if (total === 0) return [];
    const center = ((fanIndex % total) + total) % total;
    const maxOffset = Math.min(3, Math.floor((total - 1) / 2));
    const offsets: number[] = [];
    for (let d = -maxOffset; d <= maxOffset; d += 1) {
      offsets.push(d);
    }
    if (total % 2 === 0 && maxOffset < 3) {
      offsets.push(maxOffset + 1);
    }
    return offsets.map(offset => {
      const idx = (center + offset + total) % total;
      return { game: fannedGames[idx]!, index: idx, offset };
    });
  }, [fannedGames, fanIndex]);

  const isVideoMode = mode.id === 'motion' || mode.id === 'media';
  const isMotionGraphicsView =
    (mode.id === 'motion' && modeOptions?.motionEngine !== 'video-model')
    || (mode.id === 'media' && modeOptions?.mediaSubMode === 'motion');
  const isPureVideoView = isVideoMode && !isMotionGraphicsView;
  const effectiveHeroMode = isPureVideoView
    ? (findSuperAgentMode('media') ?? mode)
    : isMotionGraphicsView
      ? (findSuperAgentMode('motion') ?? mode)
      : mode;
  // Build real categories & live counts per mode.
  const filters = useMemo<FilterOption[]>(() => {
    const motionGraphicsFilters = (): FilterOption[] => {
      const hasFull = Boolean(coveredMotion.catalog);
      return [
        { id: 'all', label: 'All', count: hasFull ? motionCatalog.length : undefined },
        { id: 'top-100-brands', label: 'TOP 100 brands' },
        ...motionPurposes.map(purpose => ({
          id: `purpose:${purpose}`,
          label: purpose,
          count: hasFull ? templatesInCollection(motionCatalog, `purpose:${purpose}` as TemplateCollection).length : undefined,
        })),
        { id: 'ai-technology', label: aiTechnologyIndustry, count: hasFull ? templatesInCollection(motionCatalog, 'ai-technology').length : undefined },
        { id: 'black-friday', label: 'Black Friday collection' },
        { id: 'skills', label: 'Skill library', count: motionSkills.length },
        { id: 'brand-kit', label: 'Brand Kits' },
      ];
    };
    const pureVideoFilters = (): FilterOption[] => [
      { id: 'all-media', label: 'All video', count: buildCinemaCardsByCategory('all-media', isZh).length },
      { id: 'cinema', label: 'Cinema Studio', count: cinemaTemplates.length },
      { id: 'seedance', label: 'Seedance 2.5', count: seedanceStory.cases.length },
      { id: 'video-scenes', label: 'Camera & multi-shot', count: buildCinemaCardsByCategory('video-scenes', isZh).length },
      { id: 'asset', label: 'Workspace Assets' },
    ];
    switch (mode.id) {
      case 'design': {
        if (modeOptions?.designFormat === 'image') {
          return [
            { id: 'all-image', label: 'All image scenes', count: buildImageCardsByCategory('all-image', isZh).length },
            { id: 'gpt-image', label: 'GPT Image 2.6', count: gptImageStory.cases.length },
            { id: 'text-to-image', label: 'Text to image', count: sceneExamples['text-to-image'].length },
            { id: 'image-edit', label: 'Image edit', count: sceneExamples['image-edit'].length },
            { id: 'remove-background', label: 'Remove background', count: sceneExamples['remove-background'].length },
            { id: 'relight', label: 'Relight', count: sceneExamples.relight.length },
            { id: 'image-blend', label: 'Image blend', count: sceneExamples['image-blend'].length },
            { id: 'asset', label: 'Workspace Assets' },
            { id: 'brand-kit', label: 'Brand Kits' },
          ];
        }
        return [
          { id: 'all', label: 'All templates', count: designTemplates ? designTemplates.length : undefined },
          ...designScenarios.map(sc => ({
            id: sc.id,
            label: sc.label,
            count: designTemplates ? designTemplates.filter(i => i.scenario === sc.id).length : undefined,
          })),
          ...(designProjects && designProjects.length > 0
            ? [{ id: 'my-designs', label: 'My designs', count: designProjects.length }]
            : []),
          { id: 'brand-kit', label: 'Brand Kits' },
          { id: 'design-skill', label: 'Design Skills', count: designSkills?.length },
        ];
      }
      case 'coding':
        return [];
      case 'research': {
        const all = (designTemplates ?? []).filter(isResearchTemplate);
        const reports = all.filter(isResearchReportTemplate);
        const boards = all.filter(isResearchBoardTemplate);
        const decks = all.filter(isResearchDeckTemplate);
        return [
          { id: 'all', label: 'All templates', count: designTemplates ? all.length : undefined },
          { id: 'reports', label: 'Reports & Memos', count: designTemplates ? reports.length : undefined },
          { id: 'boards', label: 'Decision Boards', count: designTemplates ? boards.length : undefined },
          { id: 'decks', label: 'Research Decks', count: designTemplates ? decks.length : undefined },
          ...(designProjects && designProjects.length > 0
            ? [{ id: 'my-designs', label: 'My designs', count: designProjects.length }]
            : []),
          { id: 'brand-kit', label: 'Brand Kits' },
          { id: 'design-skill', label: 'Design Skills', count: designSkills?.length },
        ];
      }
      case 'visualization': {
        const all = (designTemplates ?? []).filter(isVizTemplate);
        const dashboards = all.filter(isVizDashboardTemplate);
        const charts = all.filter(isVizChartOrDiagramTemplate);
        const webgl = all.filter(item => item.scenario === 'webgl');
        return [
          { id: 'all', label: 'All templates', count: designTemplates ? all.length : undefined },
          { id: 'dashboards', label: 'Dashboards', count: designTemplates ? dashboards.length : undefined },
          { id: 'charts', label: 'Charts & Diagrams', count: designTemplates ? charts.length : undefined },
          { id: 'webgl', label: '3D & WebGL', count: designTemplates ? webgl.length : undefined },
          ...(designProjects && designProjects.length > 0
            ? [{ id: 'my-designs', label: 'My designs', count: designProjects.length }]
            : []),
          { id: 'brand-kit', label: 'Brand Kits' },
          { id: 'design-skill', label: 'Design Skills', count: designSkills?.length },
        ];
      }
      case 'website': {
        const all = (designTemplates ?? []).filter(i => i.scenario !== 'deck' && i.scenario !== 'document' && i.scenario !== 'webgl');
        const proto = (designTemplates ?? []).filter(i => i.scenario === 'prototype');
        const mobile = (designTemplates ?? []).filter(i => i.scenario === 'mobile-app');
        const live = (designTemplates ?? []).filter(i => i.scenario === 'live-artifact');
        const clone = (designTemplates ?? []).filter(i => i.scenario === 'web-clone');
        return [
          { id: 'all', label: 'All templates', count: designTemplates ? all.length : undefined },
          { id: 'prototype', label: 'Prototype', count: designTemplates ? proto.length : undefined },
          { id: 'mobile-app', label: 'Mobile App', count: designTemplates ? mobile.length : undefined },
          { id: 'live-artifact', label: 'Live artifact', count: designTemplates ? live.length : undefined },
          ...(clone.length ? [{ id: 'web-clone', label: 'Website clone', count: clone.length }] : []),
          { id: 'brand-kit', label: 'Brand Kits' },
          { id: 'design-skill', label: 'Design Skills', count: designSkills?.length },
        ];
      }
      case 'deck':
      case 'document': {
        const decks = (designTemplates ?? []).filter(i => i.scenario === 'deck');
        const docs = (designTemplates ?? []).filter(i => i.scenario === 'document');
        return [
          { id: 'all', label: 'All templates', count: designTemplates ? decks.length + docs.length : undefined },
          { id: 'deck', label: 'Slide deck', count: designTemplates ? decks.length : undefined },
          { id: 'document', label: 'Document', count: designTemplates ? docs.length : undefined },
          { id: 'brand-kit', label: 'Brand Kits' },
          { id: 'design-skill', label: 'Design Skills', count: designSkills?.length },
        ];
      }
      case 'game': {
        const portraitCount = publishedGameTemplates.filter(g => g.orientation === 'portrait').length;
        return [
          { id: 'all', label: 'All games', count: publishedGameTemplates.length },
          ...(myGames.length > 0 ? [{ id: 'mine', label: 'My games', count: myGames.length }] : []),
          ...gameGenres
            .map(g => ({
              id: `genre:${g}`,
              label: genreLabels[g],
              count: publishedGameTemplates.filter(item => item.genre === g).length,
            }))
            .filter(item => item.count > 0),
          ...(portraitCount > 0 ? [{ id: 'portrait', label: 'Portrait games', count: portraitCount }] : []),
          { id: 'brand-kit', label: 'Brand Kits' },
        ];
      }
      case 'motion':
      case 'media': {
        return isPureVideoView ? pureVideoFilters() : motionGraphicsFilters();
      }
      case 'image': {
        return [
          { id: 'all-image', label: 'All image scenes', count: buildImageCardsByCategory('all-image', isZh).length },
          { id: 'gpt-image', label: 'GPT Image 2.6', count: gptImageStory.cases.length },
          { id: 'text-to-image', label: 'Text to image', count: sceneExamples['text-to-image'].length },
          { id: 'image-edit', label: 'Image editing', count: sceneExamples['image-edit'].length },
          { id: 'remove-background', label: 'Remove background', count: sceneExamples['remove-background'].length },
          { id: 'image-blend', label: 'Image blend', count: sceneExamples['image-blend'].length },
          { id: 'relight', label: 'Relight', count: sceneExamples.relight.length },
          { id: 'design-template', label: 'Design templates', count: designTemplates?.length },
          { id: 'asset', label: 'Workspace Assets' },
          { id: 'brand-kit', label: 'Brand Kits' },
        ];
      }
      case 'audio': {
        return [
          { id: 'all-audio', label: 'All audio', count: buildCinemaCardsByCategory('all-audio', isZh).length },
          { id: 'music', label: 'Music & Soundtracks', count: sceneExamples.music.length },
          { id: 'speech', label: 'Voiceover & Speech', count: sceneExamples.speech.length },
          { id: 'asset', label: 'Workspace Audio' },
        ];
      }
    }
  }, [mode.id, modeOptions?.designFormat, isPureVideoView, designTemplates, designProjects, designSkills, publishedGameTemplates, myGames, coveredMotion.catalog, motionCatalog, motionPurposes, isZh]);

  const brandKitList = useShowcaseResourceList('brand-kit', active && filters.some(filter => filter.id === 'brand-kit'));
  const assetList = useShowcaseResourceList('asset', active && filters.some(filter => filter.id === 'asset'));
  const resourceQuery = mode.id === 'design' || mode.id === 'research' || mode.id === 'visualization'
    ? designQuery.trim().toLocaleLowerCase()
    : '';
  const assetModality = mode.id === 'audio' ? 'audio' : isPureVideoView ? 'video' : 'image';
  const brandKits = useMemo(() => brandKitList.state.status === 'ready'
    ? filterByShowcaseQuery(brandKitList.state.items, resourceQuery)
    : null, [brandKitList.state, resourceQuery]);
  const assets = useMemo(() => assetList.state.status === 'ready'
    ? filterByShowcaseQuery(assetList.state.items.filter(asset => asset.modality === assetModality), resourceQuery)
    : null, [assetList.state, assetModality, resourceQuery]);
  const activeResourceList = activeFilter === 'brand-kit' ? brandKitList : activeFilter === 'asset' ? assetList : null;
  const workspaceCounts: Record<string, number | undefined> = { 'brand-kit': brandKits?.length, asset: assets?.length };

  // Reset active tab when switching mode.
  useEffect(() => {
    if (mode.id !== 'design' && !isVideoMode) {
      setActiveFilter(filters[0]?.id ?? 'all');
    }
    setActiveSkillCategory('all');
    setDesignQuery('');
    setGameQuery('');
    setGameSort('relevance');
    setVisibleCount(PAGE_BATCH_SIZE);
  }, [mode.id]);

  // Sync Video showcase filter when switching between AI Video and Motion Graphics.
  useEffect(() => {
    if (!isVideoMode) return;
    setActiveFilter(isPureVideoView ? 'all-media' : 'all');
  }, [isVideoMode, isPureVideoView]);

  const prevAudioTypeRef = useRef(modeOptions?.audioType);
  useEffect(() => {
    const nextAudioType = modeOptions?.audioType;
    const prevAudioType = prevAudioTypeRef.current;
    prevAudioTypeRef.current = nextAudioType;
    if (mode.id === 'audio' && nextAudioType && prevAudioType && nextAudioType !== prevAudioType) {
      setActiveFilter(nextAudioType === 'voiceover' ? 'speech' : 'music');
    }
  }, [mode.id, modeOptions?.audioType]);

  const prevImageSceneRef = useRef<ImageDesignScene | undefined>(modeOptions?.imageScene);

  // Sync Design Studio showcase filter with the selected design medium & module.
  useEffect(() => {
    if (mode.id !== 'design') return;
    setActiveFilter(
      modeOptions?.designFormat === 'image'
        ? 'all-image'
        : (modeOptions?.designScenario ?? 'prototype'),
    );
  }, [mode.id, modeOptions?.designFormat, modeOptions?.designScenario]);

  // Sync Image scene pill changes into the Image showcase tab.
  useEffect(() => {
    const nextScene = modeOptions?.imageScene;
    const prevScene = prevImageSceneRef.current;
    prevImageSceneRef.current = nextScene;
    if (mode.id === 'design' && modeOptions?.designFormat === 'image' && nextScene && prevScene && nextScene !== prevScene) {
      setActiveFilter(nextScene);
    }
  }, [mode.id, modeOptions?.designFormat, modeOptions?.imageScene]);

  useEffect(() => {
    if (mode.id === 'design') setDesignQuery('');
  }, [mode.id, modeOptions?.designFormat]);

  const prevResearchFormatRef = useRef<ResearchDeliverableFormat | undefined>(modeOptions?.researchFormat);
  useEffect(() => {
    const next = modeOptions?.researchFormat;
    const prev = prevResearchFormatRef.current;
    prevResearchFormatRef.current = next;
    if (mode.id === 'research' && next && prev && next !== prev) {
      setActiveFilter(researchFormatToFilter(next));
    }
  }, [mode.id, modeOptions?.researchFormat]);

  const prevVizTypeRef = useRef<VisualizationType | undefined>(modeOptions?.vizType);
  useEffect(() => {
    const next = modeOptions?.vizType;
    const prev = prevVizTypeRef.current;
    prevVizTypeRef.current = next;
    if (mode.id === 'visualization' && next && prev && next !== prev) {
      setActiveFilter(vizTypeToFilter(next));
    }
  }, [mode.id, modeOptions?.vizType]);

  // Reset visible scroll window when filter changes.
  useEffect(() => {
    setVisibleCount(PAGE_BATCH_SIZE);
  }, [activeFilter, activeSkillCategory, designQuery, gameQuery, gameSort]);

  // Fetch the remaining design and game catalogs as needed.
  useEffect(() => {
    let cancelled = false;
    const ensure = async (kind: 'design-template' | 'design-project' | 'design-skill') => {
      if (kind === 'design-template' && designTemplates !== null) return;
      if (kind === 'design-project' && designProjects !== null) return;
      if (kind === 'design-skill' && designSkills !== null) return;
      setLoadingKind(kind);
      try {
        const res = await fetchWorkspaceResources({ kind, limit: 600 });
        if (cancelled) return;
        if (kind === 'design-template') setDesignTemplates(res.items);
        if (kind === 'design-project') setDesignProjects(res.items);
        if (kind === 'design-skill') setDesignSkills(res.items);
      } catch {
        if (cancelled) return;
        if (kind === 'design-template') setDesignTemplates([]);
        if (kind === 'design-project') setDesignProjects([]);
        if (kind === 'design-skill') setDesignSkills([]);
      } finally {
        if (!cancelled) setLoadingKind(prev => (prev === kind ? null : prev));
      }
    };

    if (mode.id === 'design') {
      if (modeOptions?.designFormat !== 'image') {
        void ensure('design-template');
        void ensure('design-project');
        if (activeFilter === 'design-skill') void ensure('design-skill');
      }
    } else if (mode.id === 'website' || mode.id === 'deck' || mode.id === 'research' || mode.id === 'visualization') {
      void ensure('design-template');
      if (mode.id === 'research' || mode.id === 'visualization') {
        void ensure('design-project');
      }
      if (activeFilter === 'design-skill') void ensure('design-skill');
    } else if (mode.id === 'game') {
      void gameApi.catalog().then(res => {
        if (!cancelled && Array.isArray(res?.games)) {
          setGameCatalog([...communityGames, ...(res.games.length ? res.games : bundledGames)]);
        }
      }).catch(() => { /* fallback keeps bundled + community games */ });
    } else if (mode.id === 'image' && activeFilter === 'design-template') {
      void ensure('design-template');
    }

    return () => {
      cancelled = true;
    };
  }, [mode.id, modeOptions?.designFormat, activeFilter, designTemplates, designProjects, designSkills]);

  // Resolve active curated cards (Image / Cinema / Audio / AI Video).
  const curatedCards = useMemo<CuratedShowcaseCard[] | null>(() => {
    if (mode.id === 'design' && modeOptions?.designFormat === 'image' && activeFilter !== 'asset' && activeFilter !== 'brand-kit') {
      const base = buildImageCardsByCategory(activeFilter, isZh);
      const needle = designQuery.trim().toLocaleLowerCase();
      if (!needle) return base;
      return base.filter(card =>
        [card.title, t(card.title), ...(Array.isArray(card.subtitle) ? card.subtitle : [card.subtitle]), card.prompt]
          .some(text => text.toLocaleLowerCase().includes(needle)),
      );
    }
    if (mode.id === 'image' && activeFilter !== 'asset' && activeFilter !== 'brand-kit' && activeFilter !== 'design-template') {
      return buildImageCardsByCategory(activeFilter, isZh);
    }
    if ((isPureVideoView || mode.id === 'audio') && activeFilter !== 'asset') {
      return buildCinemaCardsByCategory(activeFilter, isZh, mode.id);
    }
    return null;
  }, [mode.id, modeOptions?.designFormat, isPureVideoView, activeFilter, designQuery, isZh, t]);

  // Resolve full resource items for all other tabs (NO 12-item cap!).
  const resourceItems = useMemo<SuperAgentResourceAttachment[]>(() => {
    if (curatedCards) return [];
    const applyDesignSearch = (items: SuperAgentResourceAttachment[]) => filterByShowcaseQuery(items, resourceQuery);
    if ((mode.id === 'design' || mode.id === 'research' || mode.id === 'visualization') && activeFilter === 'my-designs') {
      return applyDesignSearch(designProjects ?? []);
    }
    if (activeFilter === 'brand-kit') return brandKits ?? [];
    if (activeFilter === 'design-template') return applyDesignSearch(designTemplates ?? []);
    if (activeFilter === 'design-skill') {
      const all = designSkills ?? [];
      if (mode.id === 'design') {
        const activeScen = modeOptions?.designScenario ?? 'prototype';
        return applyDesignSearch([...all].sort((a, b) => Number(b.scenario === activeScen) - Number(a.scenario === activeScen)));
      }
      if (mode.id === 'research') {
        const score = (s: SuperAgentResourceAttachment) =>
          (RESEARCH_SKILL_IDS.has(s.id) ? 2 : 0) + (s.scenario === 'document' || s.scenario === 'deck' ? 1 : 0);
        return applyDesignSearch([...all].sort((a, b) => score(b) - score(a)));
      }
      if (mode.id === 'visualization') {
        const score = (s: SuperAgentResourceAttachment) =>
          (VIZ_SKILL_IDS.has(s.id) ? 2 : 0) + (s.scenario === 'live-artifact' || s.scenario === 'webgl' ? 1 : 0);
        return applyDesignSearch([...all].sort((a, b) => score(b) - score(a)));
      }
      if (mode.id === 'deck') {
        const scoped = all.filter(s => s.scenario === 'deck' || s.scenario === 'document');
        return scoped.length ? scoped : all;
      }
      if (mode.id === 'game') {
        const scoped = all.filter(s => s.scenario === 'webgl' || s.scenario === 'live-artifact' || s.scenario === 'prototype');
        return scoped.length ? scoped : all;
      }
      return all;
    }
    if (activeFilter === 'asset') return assets ?? [];
    if (isMotionGraphicsView) {
      if (activeFilter === 'skills') {
        const list = activeSkillCategory === 'all'
          ? motionSkills
          : motionSkills.filter(s => s.category === activeSkillCategory);
        return list.map(motionSkillToAttachment);
      }
      if (activeFilter === 'top-100-brands') {
        return rankDiscoverySeries(groupBrandSeries(motionCatalog)).map(b => motionTemplateToAttachment(b.items[0]));
      }
      if (activeFilter === 'black-friday') {
        return blackFridayTemplates(motionCatalog, locale).flatMap(stage => stage.items).map(motionTemplateToAttachment);
      }
      if (activeFilter !== 'all') {
        return templatesInCollection(motionCatalog, activeFilter as TemplateCollection).map(motionTemplateToAttachment);
      }
      return motionCatalog.map(motionTemplateToAttachment);
    }
    // Design templates (design / research / visualization / website / deck / game)
    const all = designTemplates ?? [];
    if (mode.id === 'design') {
      const scoped = activeFilter === 'all' ? all : all.filter(i => i.scenario === activeFilter);
      return applyDesignSearch(scoped);
    }
    if (mode.id === 'research') {
      const scoped = activeFilter === 'reports'
        ? all.filter(isResearchReportTemplate)
        : activeFilter === 'boards'
          ? all.filter(isResearchBoardTemplate)
          : activeFilter === 'decks'
            ? all.filter(isResearchDeckTemplate)
            : all.filter(isResearchTemplate);
      return applyDesignSearch(scoped);
    }
    if (mode.id === 'visualization') {
      const scoped = activeFilter === 'dashboards'
        ? all.filter(isVizDashboardTemplate)
        : activeFilter === 'charts'
          ? all.filter(isVizChartOrDiagramTemplate)
          : activeFilter === 'webgl'
            ? all.filter(i => i.scenario === 'webgl')
            : all.filter(isVizTemplate);
      return applyDesignSearch(scoped);
    }
    if (activeFilter !== 'all') return all.filter(i => i.scenario === activeFilter);
    if (mode.id === 'deck') return all.filter(i => i.scenario === 'deck' || i.scenario === 'document');
    if (mode.id === 'game') return all.filter(i => i.scenario === 'webgl' || i.scenario === 'live-artifact' || i.scenario === 'prototype');
    return all.filter(i => i.scenario !== 'deck' && i.scenario !== 'document' && i.scenario !== 'webgl');
  }, [curatedCards, activeFilter, activeSkillCategory, mode.id, modeOptions?.designFormat, modeOptions?.designScenario, isMotionGraphicsView, resourceQuery, brandKits, designSkills, assets, motionCatalog, locale, designTemplates, designProjects]);

  const showGameCards = mode.id === 'game' && activeFilter !== 'brand-kit';

  const filteredGames = useMemo<GameCard[]>(() => {
    if (!showGameCards) return [];
    const needle = gameQuery.trim();
    const base = activeFilter === 'mine'
      ? myGames
      : activeFilter === 'portrait'
        ? publishedGameTemplates.filter(g => g.orientation === 'portrait')
        : activeFilter.startsWith('genre:')
          ? publishedGameTemplates.filter(item => item.genre === (activeFilter.slice(6) as GameGenre))
          : publishedGameTemplates;
    const ranked = needle
      ? rankSearchResults(base, needle, game => ({
          id: game.id,
          title: game.i18n?.[locale]?.title ?? game.title,
          subtitle: t(genreLabels[game.genre]),
          description: game.i18n?.[locale]?.description ?? game.description,
          tags: [game.genre, ...(game.style ? [game.style] : []), ...(game.setting ? [game.setting] : [])],
          aliases: [
            game.title,
            game.description,
            ...Object.values(game.i18n ?? {}).flatMap(loc => [loc?.title ?? '', loc?.description ?? '']),
          ],
        }))
      : base.map(item => ({ item, score: 1 }));
    const matched = ranked.map(r => r.item);
    if (activeFilter === 'mine') return matched;
    if (gameSort === 'plays') return [...matched].sort((a, b) => b.plays - a.plays);
    if (gameSort === 'newest') return [...matched].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (needle) return matched;
    return interleavePortrait(matched);
  }, [showGameCards, activeFilter, publishedGameTemplates, myGames, gameQuery, gameSort, locale, t]);

  const totalCount = showGameCards
    ? filteredGames.length
    : curatedCards
      ? curatedCards.length
      : resourceItems.length;
  const hasMore = visibleCount < totalCount;

  // Automatic continuous scrolling via IntersectionObserver.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisibleCount(prev => Math.min(totalCount, prev + PAGE_BATCH_SIZE));
        }
      },
      { rootMargin: '280px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, totalCount]);

  const isLoading = activeResourceList ? activeResourceList.state.status === 'loading' : !curatedCards
    && (
      (isMotionGraphicsView && activeFilter !== 'skills' && activeFilter !== 'black-friday' && motionCatalog.length === 0 && !coveredMotion.failed)
      || (activeFilter === 'design-skill' && designSkills === null)
      || (activeFilter === 'my-designs' && designProjects === null)
      || ((mode.id === 'website' || mode.id === 'deck' || mode.id === 'research' || mode.id === 'visualization' || (mode.id === 'design' && modeOptions?.designFormat !== 'image'))
        && activeFilter !== 'design-skill'
        && activeFilter !== 'my-designs'
        && designTemplates === null)
      || (loadingKind !== null && totalCount === 0)
    );

  const selectedKeys = useMemo(() => new Set(attachments.map(resourceKey)), [attachments]);
  const selectGameForAgent = (game: GameCard) => {
    if (game.multiplayer) return;
    const title = localizedGameTitle(game, locale);
    if (game.source === 'mine') {
      const att = toGameResourceAttachment(game, title);
      const alreadyAttached = selectedKeys.has(resourceKey(att));
      onToggleAttachment(att);
      if (!alreadyAttached) onFocusComposer?.();
      return;
    }
    const isSelected = modeOptions?.gameTemplate?.id === game.id;
    onChangeModeOptions?.({
      gameTemplate: isSelected ? null : game,
      ...(!isSelected
        ? {
            gameGenre: game.genre,
            gameStyle: game.style,
            gameSetting: game.setting,
            gameOrientation: game.orientation ?? 'landscape',
            gamePlayableAd: Boolean(game.playableAd),
          }
        : {}),
    });
    if (!isSelected) {
      onFocusComposer?.();
    }
  };
  const visibleGames = showGameCards ? filteredGames.slice(0, visibleCount) : null;
  const visibleCurated = !showGameCards && curatedCards ? curatedCards.slice(0, visibleCount) : null;
  const visibleResources = !showGameCards && !curatedCards ? resourceItems.slice(0, visibleCount) : [];

  return (
    <div className="om-sa-mode-showcase">
      <div className="om-sa-mode-hero">
        <div className="om-sa-mode-hero-close">
          <IconButton
            variant="ghost"
            className="motion-icon-button"
            aria-label={t('Close')}
            onClick={onClose}
            icon={<RemixIcon name="close-line" size={16} />}
          />
        </div>
        {mode.id === 'game' && fanSlots.length > 0 ? (
          <div
            className="om-sa-game-fan"
            role="region"
            aria-roledescription="carousel"
            aria-label={t('Game Studio')}
            onMouseEnter={() => setFanPaused(true)}
            onMouseLeave={() => setFanPaused(false)}
            onFocusCapture={() => setFanPaused(true)}
            onBlurCapture={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setFanPaused(false);
              }
            }}
            onKeyDown={event => {
              if (fannedGames.length <= 1) return;
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setFanIndex(prev => (prev - 1 + fannedGames.length) % fannedGames.length);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                setFanIndex(prev => (prev + 1) % fannedGames.length);
              }
            }}
          >
            {fannedGames.length > 1 && (
              <IconButton
                variant="plain"
                type="button"
                className="om-sa-game-fan-nav"
                data-side="prev"
                aria-label={t('Previous')}
                onClick={() => setFanIndex(prev => (prev - 1 + fannedGames.length) % fannedGames.length)}
                icon={<RemixIcon name="arrow-left-line" size={16} />}
              />
            )}
            {fanSlots.map(({ game, index, offset }) => {
              const title = localizedGameTitle(game, locale);
              const cover = coverUrl(game);
              const isSelected = modeOptions?.gameTemplate?.id === game.id;
              const isPlaying = playingGameId === game.id;
              const isCenter = offset === 0;
              const isEdgeHidden = Math.abs(offset) > 2;
              return (
                <div
                  key={game.id}
                  className="om-sa-game-fan-item"
                  data-slot={offset}
                  data-center={isCenter || undefined}
                  data-selected={isSelected || undefined}
                  data-playing={isPlaying || undefined}
                  aria-hidden={isEdgeHidden || undefined}
                  inert={isEdgeHidden || undefined}
                >
                  <Button
                    variant="plain"
                    type="button"
                    className="om-sa-game-fan-card"
                    aria-pressed={isCenter && !game.multiplayer ? isSelected : undefined}
                    aria-label={isCenter
                      ? game.multiplayer ? t('Play {title}', { title }) : `${t('Remix')}: ${title}`
                      : title}
                    disabled={isCenter && game.multiplayer && !onPlayGame}
                    onClick={() => {
                      if (!isCenter) {
                        setFanIndex(index);
                        return;
                      }
                      if (game.multiplayer) {
                        onPlayGame?.(game);
                        return;
                      }
                      selectGameForAgent(game);
                    }}
                  >
                    {cover && <img src={cover} alt="" />}
                    {isCenter && !game.multiplayer && (
                      <span
                        className="om-sa-game-select-cue"
                        data-selected={isSelected || undefined}
                        aria-hidden="true"
                      >
                        <RemixIcon name={isSelected ? 'check-line' : 'sparkling-line'} size={13} />
                        <span>{isSelected ? t('Selected') : t('Remix')}</span>
                      </span>
                    )}
                    <span className="om-sa-game-fan-label">{t(genreLabels[game.genre])}</span>
                  </Button>
                  {isCenter && (onPlayGame || onDeployGame) && (
                    <div className="om-sa-game-tile-actions om-sa-game-fan-actions">
                      {onDeployGame && (game.status === 'ready' || game.status === 'published') && (
                        <IconButton
                          variant="plain"
                          type="button"
                          className="om-sa-game-tile-deploy"
                          title={t('Share')}
                          aria-label={`${t('Share')}: ${title}`}
                          onClick={() => onDeployGame(game)}
                          icon={<RemixIcon name="share-forward-line" size={13} />}
                        />
                      )}
                      {onPlayGame && (
                        <Button
                          variant="plain"
                          type="button"
                          className="om-sa-game-tile-play"
                          data-playing={isPlaying || undefined}
                          title={t('Try game: {title}', { title })}
                          aria-label={t('Try game: {title}', { title })}
                          onPointerEnter={() => preconnectGame(game)}
                          onFocus={() => preconnectGame(game)}
                          onClick={() => onPlayGame(game)}
                        >
                          <RemixIcon name="play-fill" size={12} />
                          <span>{t('Try game')}</span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {fannedGames.length > 1 && (
              <IconButton
                variant="plain"
                type="button"
                className="om-sa-game-fan-nav"
                data-side="next"
                aria-label={t('Next')}
                onClick={() => setFanIndex(prev => (prev + 1) % fannedGames.length)}
                icon={<RemixIcon name="arrow-right-line" size={16} />}
              />
            )}
          </div>
        ) : (
          <span className="om-creation-icon om-sa-mode-hero-icon" data-tone={effectiveHeroMode.tone} aria-hidden="true">
            <RemixIcon name={effectiveHeroMode.icon} size={22} />
          </span>
        )}
        <div className="om-sa-mode-hero-copy">
          <h2>{t(effectiveHeroMode.title)}</h2>
          {effectiveHeroMode.subtitle && <p className="om-muted">{t(effectiveHeroMode.subtitle)}</p>}
        </div>

        {mode.id === 'game' && (
          <div className="om-sa-game-genre-strip" role="group" aria-label={t('Genre')}>
            {gameGenres.map(id => {
              const selected = modeOptions?.gameGenre === id;
              const cover = genreCovers[id];
              return (
                <Button
                  key={id}
                  variant="plain"
                  type="button"
                  className="om-sa-game-genre-card"
                  aria-pressed={selected}
                  data-active={selected || undefined}
                  onClick={() => onChangeModeOptions?.({ gameGenre: selected ? null : id })}
                >
                  <span className="om-sa-game-genre-art" aria-hidden="true">
                    {cover ? <img src={cover} alt="" /> : <RemixIcon name="gamepad-line" size={22} />}
                  </span>
                  <span>{t(genreLabels[id])}</span>
                </Button>
              );
            })}
          </div>
        )}

        {mode.id === 'design' && (() => {
          const isHtml = modeOptions?.designFormat !== 'image';
          const activeScenario = modeOptions?.designScenario ?? 'prototype';
          return (
            <div className="om-sa-design-module-strip" role="group" aria-label={t('Design module')}>
              <Button
                variant="plain"
                type="button"
                className="om-sa-design-module-card"
                aria-pressed={!isHtml}
                data-active={!isHtml || undefined}
                onClick={() => {
                  onChangeModeOptions?.({ designFormat: 'image' });
                  setActiveFilter('all-image');
                }}
              >
                <span className="om-sa-design-module-icon" aria-hidden="true">
                  <RemixIcon name="image-line" size={15} />
                </span>
                <span>{t('Image design')}</span>
              </Button>
              {designScenarios.map(sc => {
                const selected = isHtml && activeScenario === sc.id;
                return (
                  <Button
                    key={sc.id}
                    variant="plain"
                    type="button"
                    className="om-sa-design-module-card"
                    aria-pressed={selected}
                    data-active={selected || undefined}
                    onClick={() => {
                      onChangeModeOptions?.(designScenarioOptionsPatch(sc.id));
                      setActiveFilter(sc.id);
                    }}
                  >
                    <span className="om-sa-design-module-icon" aria-hidden="true">
                      <RemixIcon name={sc.icon} size={15} />
                    </span>
                    <span>{t(sc.label)}</span>
                  </Button>
                );
              })}
            </div>
          );
        })()}

        {mode.id === 'research' && (() => {
          const activeFormat = modeOptions?.researchFormat ?? 'report';
          return (
            <div className="om-sa-design-module-strip" role="group" aria-label={t('Deliverable')}>
              {RESEARCH_FORMAT_CHOICES.map(choice => {
                const selected = activeFormat === choice.id;
                return (
                  <Button
                    key={choice.id}
                    variant="plain"
                    type="button"
                    className="om-sa-design-module-card"
                    aria-pressed={selected}
                    data-active={selected || undefined}
                    onClick={() => {
                      onChangeModeOptions?.({ researchFormat: choice.id });
                      setActiveFilter(researchFormatToFilter(choice.id));
                    }}
                  >
                    <span className="om-sa-design-module-icon" aria-hidden="true">
                      <RemixIcon name={choice.icon} size={15} />
                    </span>
                    <span>{t(choice.label)}</span>
                  </Button>
                );
              })}
            </div>
          );
        })()}

        {mode.id === 'visualization' && (() => {
          const activeType = modeOptions?.vizType ?? 'dashboard';
          return (
            <div className="om-sa-design-module-strip" data-cols="5" role="group" aria-label={t('Visual type')}>
              {VIZ_TYPE_CHOICES.map(choice => {
                const selected = activeType === choice.id;
                return (
                  <Button
                    key={choice.id}
                    variant="plain"
                    type="button"
                    className="om-sa-design-module-card"
                    aria-pressed={selected}
                    data-active={selected || undefined}
                    onClick={() => {
                      onChangeModeOptions?.(visualizationOptionsPatch(choice.id));
                      setActiveFilter(vizTypeToFilter(choice.id));
                    }}
                  >
                    <span className="om-sa-design-module-icon" aria-hidden="true">
                      <RemixIcon name={choice.icon} size={15} />
                    </span>
                    <span>{t(choice.label)}</span>
                  </Button>
                );
              })}
            </div>
          );
        })()}

        <div className="om-sa-mode-ideas">
          {mode.id === 'design' ? (
            DESIGN_MODULE_QUICK_IDEAS[
              modeOptions?.designFormat === 'image' ? 'image' : (modeOptions?.designScenario ?? 'prototype')
            ].map(idea => (
              <Button
                key={idea.title}
                variant="plain"
                type="button"
                className="om-sa-idea-chip"
                onClick={() => onPickPrompt(t(idea.prompt), {
                  ...(idea.optionsPatch ? { optionsPatch: idea.optionsPatch } : {}),
                  referenceImage: null,
                })}
              >
                <span className="om-sa-tone-icon" data-tone={mode.tone} aria-hidden="true">
                  <RemixIcon name="sparkling-line" size={12} />
                </span>
                <span>{t(idea.title)}</span>
              </Button>
            ))
          ) : mode.id === 'game' ? (
            GAME_STUDIO_QUICK_IDEAS.map(idea => (
              <Button
                key={idea.title}
                variant="plain"
                type="button"
                className="om-sa-idea-chip"
                onClick={() => {
                  onChangeModeOptions?.({
                    gameGenre: idea.genre,
                    gameStyle: idea.style,
                    gameSetting: idea.setting,
                    gameOrientation: idea.orientation,
                    gamePlayableAd: Boolean(idea.playableAd),
                    gameTemplate: null,
                  });
                  onPickPrompt(t(idea.prompt), { referenceImage: null });
                }}
              >
                <span className="om-sa-tone-icon" data-tone={mode.tone} aria-hidden="true">
                  <RemixIcon name="sparkling-line" size={12} />
                </span>
                <span>{t(idea.title)}</span>
              </Button>
            ))
          ) : (
            effectiveHeroMode.quickIdeas.map(idea => (
              <Button
                key={idea.title}
                variant="plain"
                type="button"
                className="om-sa-idea-chip"
                onClick={() => onPickPrompt(t(idea.prompt), {
                  ...(idea.optionsPatch ? { optionsPatch: idea.optionsPatch } : {}),
                  referenceImage: null,
                })}
              >
                <span className="om-sa-tone-icon" data-tone={effectiveHeroMode.tone} aria-hidden="true">
                  <RemixIcon name="sparkling-line" size={12} />
                </span>
                <span>{t(idea.title)}</span>
              </Button>
            ))
          )}
        </div>
      </div>

      {mode.id !== 'coding' && (
      <section ref={showcaseRef} className="om-sa-showcase-panel" aria-labelledby={templateHeadingId}>
        <h3 id={templateHeadingId} className="om-sa-showcase-heading">{t('Discover templates')}</h3>
        <div className="om-sa-showcase-bar" data-game-bar={showGameCards || undefined}>
          <div className="om-sa-showcase-tabs" role="tablist" aria-label={t('Template filters')}>
            {filters.map(({ id, label, count = workspaceCounts[id] }) => (
              <Button
                key={id}
                variant="plain"
                type="button"
                role="tab"
                aria-selected={activeFilter === id}
                data-active={activeFilter === id || undefined}
                className="om-sa-showcase-tab"
                onClick={() => {
                  setActiveFilter(id);
                  if (mode.id === 'design') {
                    if (modeOptions?.designFormat === 'image') {
                      if (
                        id === 'text-to-image'
                        || id === 'image-edit'
                        || id === 'remove-background'
                        || id === 'relight'
                        || id === 'image-blend'
                      ) {
                        onChangeModeOptions?.({ imageScene: id });
                      }
                    } else if (isDesignScenario(id)) {
                      onChangeModeOptions?.(designScenarioOptionsPatch(id));
                    }
                  } else if (mode.id === 'image') {
                    if (
                      id === 'text-to-image'
                      || id === 'image-edit'
                      || id === 'remove-background'
                      || id === 'relight'
                      || id === 'image-blend'
                    ) {
                      onChangeModeOptions?.({ imageScene: id });
                    }
                  } else if (mode.id === 'audio') {
                    if (id === 'music') {
                      onChangeModeOptions?.({ audioType: 'music', audioModelId: 'auto' });
                    } else if (id === 'speech') {
                      onChangeModeOptions?.({ audioType: 'voiceover', audioModelId: 'auto' });
                    }
                  }
                }}
              >
                <span>{t(label)}</span>
                {typeof count === 'number' && <span className="om-sa-tab-count">{count}</span>}
              </Button>
            ))}
          </div>
          {(mode.id === 'design' || mode.id === 'research' || mode.id === 'visualization') ? (
            <div className="om-sa-design-bar-controls">
              <span className="om-field om-sa-game-search om-sa-design-search">
                <RemixIcon name="search-line" size={14} />
                <input
                  value={designQuery}
                  placeholder={t('Filter templates…')}
                  aria-label={t('Filter templates…')}
                  onChange={event => setDesignQuery(event.target.value)}
                />
                {designQuery && (
                  <IconButton
                    variant="plain"
                    className="om-sa-game-search-clear"
                    aria-label={t('Clear')}
                    onClick={() => setDesignQuery('')}
                    icon={<RemixIcon name="close-line" size={12} />}
                  />
                )}
              </span>
              <Button
                variant="plain"
                type="button"
                className="om-sa-showcase-more"
                onClick={() => onOpenAllResources(
                  activeFilter === 'brand-kit' ? 'brand-kit'
                    : activeFilter === 'asset' ? 'asset'
                    : activeFilter === 'skills' || activeFilter === 'design-skill' ? 'skills'
                    : activeFilter === 'my-designs' ? 'projects'
                    : modeOptions?.designFormat === 'image' ? 'asset'
                    : mode.pickerCategory,
                )}
              >
                <span>{t('View all')}</span>
                <RemixIcon name="arrow-right-up-line" size={13} />
              </Button>
            </div>
          ) : (
            <Button
              variant="plain"
              type="button"
              className="om-sa-showcase-more"
              onClick={() => {
                if (showGameCards) {
                  setVisibleCount(totalCount);
                  showcaseRef.current?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
                  return;
                }
                onOpenAllResources(
                  activeFilter === 'brand-kit' ? 'brand-kit'
                    : activeFilter === 'asset' ? 'asset'
                    : activeFilter === 'skills' || activeFilter === 'design-skill' ? 'skills'
                    : isPureVideoView ? 'asset'
                    : isMotionGraphicsView ? 'motion-template'
                    : mode.pickerCategory,
                );
              }}
            >
              <span>{t('View all')}</span>
              <RemixIcon name={showGameCards ? 'arrow-down-s-line' : 'arrow-right-up-line'} size={13} />
            </Button>
          )}
        </div>
        {showGameCards && (
          <div className="om-sa-game-bar-controls">
            <span className="om-field om-sa-game-search">
              <RemixIcon name="search-line" size={14} />
              <input
                value={gameQuery}
                placeholder={t('Search')}
                aria-label={t('Search games')}
                onChange={event => setGameQuery(event.target.value)}
              />
              {gameQuery && (
                <IconButton
                  variant="plain"
                  className="om-sa-game-search-clear"
                  aria-label={t('Clear')}
                  onClick={() => setGameQuery('')}
                  icon={<RemixIcon name="close-line" size={12} />}
                />
              )}
            </span>
            {activeFilter !== 'mine' && (
              <div className="om-sa-game-sort">
                <Select
                  label={t('Sort')}
                  value={gameSort}
                  onCommit={next => setGameSort(next as GameSort)}
                  options={[
                    { value: 'relevance', label: t('Default sort') },
                    { value: 'plays', label: t('Most played') },
                    { value: 'newest', label: t('Newest') },
                  ]}
                />
              </div>
            )}
          </div>
        )}

        {isMotionGraphicsView && activeFilter === 'skills' && (
          <div className="om-sa-showcase-subtabs" role="tablist" aria-label={t('Skill categories')}>
            <Button
              variant="plain"
              type="button"
              role="tab"
              aria-selected={activeSkillCategory === 'all'}
              data-active={activeSkillCategory === 'all' || undefined}
              className="om-sa-showcase-subtab"
              onClick={() => setActiveSkillCategory('all')}
            >
              <span>{t('All')}</span>
              <span className="om-sa-tab-count">{motionSkills.length}</span>
            </Button>
            {skillCategories.map(cat => {
              const count = motionSkills.filter(s => s.category === cat).length;
              return (
                <Button
                  key={cat}
                  variant="plain"
                  type="button"
                  role="tab"
                  aria-selected={activeSkillCategory === cat}
                  data-active={activeSkillCategory === cat || undefined}
                  className="om-sa-showcase-subtab"
                  onClick={() => setActiveSkillCategory(cat)}
                >
                  <span>{t(cat)}</span>
                  <span className="om-sa-tab-count">{count}</span>
                </Button>
              );
            })}
          </div>
        )}

        {visibleGames ? (
          visibleGames.length === 0 ? (
            <div className="om-sa-showcase-empty">
              <p className="om-muted">{t('No matching games')}</p>
            </div>
          ) : (
            <GameMasonry
              games={visibleGames}
              minColumn={248}
              gap={12}
              className="om-sa-game-masonry"
              columnClassName="om-sa-game-masonry-column"
              render={game => {
                const title = localizedGameTitle(game, locale);
                const cover = coverUrl(game) ?? (game.source === 'mine' ? genreCovers[game.genre] : null);
                const isMine = game.source === 'mine';
                const mineAttachment = isMine ? toGameResourceAttachment(game, title) : null;
                const isSelected = isMine
                  ? Boolean(mineAttachment && selectedKeys.has(resourceKey(mineAttachment)))
                  : modeOptions?.gameTemplate?.id === game.id;
                const isPlaying = playingGameId === game.id;
                const status = isMine ? GAME_STATUS_LABELS[game.status] : undefined;

                return (
                  <article
                    key={game.id}
                    className="om-sa-game-tile om-sa-game-showcase-card"
                    data-orientation={game.orientation === 'portrait' ? 'portrait' : undefined}
                    data-selected={isSelected || undefined}
                    data-playing={isPlaying || undefined}
                  >
                    <Button
                      variant="plain"
                      type="button"
                      className="om-sa-game-tile-cover"
                      data-composer-source={!game.multiplayer || undefined}
                      aria-pressed={game.multiplayer ? undefined : isSelected}
                      aria-label={game.multiplayer
                        ? t('Play {title}', { title })
                        : `${t(isMine ? 'Attach' : 'Remix')}: ${title}`}
                      disabled={game.multiplayer && !onPlayGame}
                      onClick={() => game.multiplayer ? onPlayGame?.(game) : selectGameForAgent(game)}
                    >
                      {/* Portrait games share the 16:9 card: the cover sits whole in the middle over a blurred copy of itself. */}
                      {cover && game.orientation === 'portrait' && (
                        <img className="om-sa-game-tile-backdrop" src={cover} alt="" loading="lazy" decoding="async" />
                      )}
                      {cover ? (
                        <img src={cover} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <div className="om-sa-game-tile-placeholder">
                          <RemixIcon name="gamepad-line" size={24} />
                          <span>{title}</span>
                        </div>
                      )}
                      {!game.multiplayer && (
                        <span
                          className="om-sa-game-select-cue"
                          data-selected={isSelected || undefined}
                          aria-hidden="true"
                        >
                          <RemixIcon name={isSelected ? 'check-line' : 'sparkling-line'} size={13} />
                          <span>{isSelected ? t('Selected') : isMine ? t('Attach') : t('Remix')}</span>
                        </span>
                      )}
                      {status && (
                        <span className="om-sa-game-status" data-tone={game.status}>
                          {game.status === 'building' && <RemixIcon name="loader-4-line" size={12} />}
                          {t(status)}
                        </span>
                      )}
                      {game.external && !game.external.embeddable && (
                        <span className="om-sa-game-status">
                          <RemixIcon name="external-link-line" size={12} />
                          {t('External link')}
                        </span>
                      )}
                      {game.multiplayer && !status && (
                        <span className="om-sa-game-status">
                          <RemixIcon name="group-line" size={12} />
                          {t('{count} players', { count: game.maxPlayers })}
                        </span>
                      )}
                    </Button>

                    {(onPlayGame || onDeployGame) && (
                      <div className="om-sa-game-tile-actions">
                        {onDeployGame && (game.status === 'ready' || game.status === 'published') && (
                          <IconButton
                            variant="plain"
                            type="button"
                            className="om-sa-game-tile-deploy"
                            title={t('Share')}
                            aria-label={`${t('Share')}: ${title}`}
                            onClick={() => onDeployGame(game)}
                            icon={<RemixIcon name="share-forward-line" size={13} />}
                          />
                        )}
                        {onPlayGame && (
                          <Button
                            variant="plain"
                            type="button"
                            className="om-sa-game-tile-play"
                            data-playing={isPlaying || undefined}
                            title={t('Try game: {title}', { title })}
                            aria-label={t('Try game: {title}', { title })}
                            onPointerEnter={() => preconnectGame(game)}
                            onFocus={() => preconnectGame(game)}
                            onClick={() => onPlayGame(game)}
                          >
                            <RemixIcon name="play-fill" size={12} />
                            <span>{t('Try game')}</span>
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="om-sa-game-tile-meta">
                      {cover && (
                        <span className="om-sa-game-tile-icon" aria-hidden="true">
                          <img src={cover} alt="" />
                        </span>
                      )}
                      <strong>{title}</strong>
                      {game.external ? (
                        <a
                          className="om-sa-game-tile-author"
                          href={game.external.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {game.external.author}
                        </a>
                      ) : game.plays > 0 ? (
                        <span className="om-sa-game-tile-plays">
                          <RemixIcon name="play-circle-line" size={13} />
                          {formatPlays(game.plays, locale)}
                        </span>
                      ) : null}
                    </div>
                  </article>
                );
              }}
            />
          )
        ) : (
        <div className="om-sa-showcase-grid" aria-busy={isLoading}>
          {visibleCurated && visibleCurated.length > 0 ? (
            visibleCurated.map(card => (
              <Button
                key={card.id}
                variant="plain"
                type="button"
                className="om-sa-showcase-card"
                onClick={() => onPickPrompt(t(card.prompt), {
                  ...(card.optionsPatch ? { optionsPatch: card.optionsPatch } : {}),
                  referenceImage: card.referenceImage ?? null,
                })}
              >
                <div className="om-sa-showcase-thumb" aria-hidden="true">
                  <img
                    src={card.poster}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={card.posterPosition ? { objectPosition: card.posterPosition } : undefined}
                  />
                </div>
                <span className="om-sa-showcase-check" aria-hidden="true">
                  <RemixIcon name="arrow-right-up-line" size={13} />
                </span>
                <div className="om-sa-showcase-meta">
                  <strong>{t(card.title)}</strong>
                  <small>{[...card.subtitle.map(label => t(label)), ...(card.seconds ? [t('{count}s', { count: card.seconds })] : [])].join(' · ')}</small>
                </div>
              </Button>
            ))
          ) : visibleCurated ? (
            <div className="om-sa-showcase-empty">
              <p className="om-muted">{t('No matching resources found')}</p>
              {designQuery && (
                <Button
                  variant="ghost"
                  className="om-button h-auto"
                  onClick={() => setDesignQuery('')}
                >
                  {t('Clear')}
                </Button>
              )}
            </div>
          ) : isLoading ? (
            Array.from({ length: 10 }, (_, idx) => (
              <div key={idx} className="om-sa-showcase-skeleton">
                <Skeleton style={{ width: '100%', height: 130 }} />
              </div>
            ))
          ) : activeResourceList?.state.status === 'error' ? (
            <div className="om-sa-showcase-empty">
              <p className="om-muted" role="status">{t('Could not load workspace resources')}</p>
              <Button variant="ghost" type="button" className="om-button h-auto" onClick={activeResourceList.retry}>
                {t('Retry')}
              </Button>
            </div>
          ) : !visibleResources.length ? (
            <div className="om-sa-showcase-empty">
              <p className="om-muted">{t('No matching resources found')}</p>
              <Button
                variant="ghost"
                className="om-button h-auto"
                onClick={() => onOpenAllResources(activeFilter === 'asset' || activeFilter === 'brand-kit' ? activeFilter : mode.pickerCategory)}
              >
                {t('Browse workspace resources')}
              </Button>
            </div>
          ) : (
            visibleResources.map(item => {
              const isSelected = selectedKeys.has(resourceKey(item));
              const subtitle = resourceDisplaySubtitle(item, t);
              return (
                <Button
                  key={resourceKey(item)}
                  variant="plain"
                  type="button"
                  className="om-sa-showcase-card"
                  data-composer-source
                  aria-pressed={isSelected}
                  data-selected={isSelected || undefined}
                  onClick={() => {
                    onToggleAttachment(item);
                  }}
                >
                  <ResourceShowcaseThumb item={item} active={active} />
                  <span className="om-sa-showcase-check" aria-hidden="true">
                    <RemixIcon name={isSelected ? 'check-line' : 'add-line'} size={13} />
                  </span>
                  <div className="om-sa-showcase-meta">
                    <strong>{resourceDisplayTitle(item, t)}</strong>
                    {subtitle && <small>{subtitle}</small>}
                  </div>
                </Button>
              );
            })
          )}
        </div>
        )}

        {hasMore && (
          <div ref={sentinelRef} className="om-sa-showcase-load-more">
            <Button
              variant="plain"
              type="button"
              className="om-sa-load-more-btn"
              onClick={() => setVisibleCount(prev => Math.min(totalCount, prev + PAGE_BATCH_SIZE))}
            >
              <span>{t('Load more')}</span>
              <span className="om-sa-tab-count">{totalCount - visibleCount}</span>
            </Button>
          </div>
        )}
      </section>
      )}
    </div>
  );
}
