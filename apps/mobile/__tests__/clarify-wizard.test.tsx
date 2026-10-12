/**
 * Component tests — the Clarify / Re-clarify wizard (components/clarify-wizard).
 *
 * The step machine itself is unit-tested in lib/clarify-flow.test.ts; here
 * we render the component with the db mocked at the package boundary and
 * cover: step walking (question wording untouched — R3), the required-field
 * interception (Chinese copy), the do-now immediate path, the reclarify Q2
 * entry, the submit success/failure → done/error rendering, and the
 * Paper Serenity rework (design §3.4): the progress line (步骤 n/m), the
 * "GTD 决策摘要" card (answered highlighted / unanswered muted, reclarify
 * hides q1/q1b), the preview step (no db write until 确认保存; 上一步修改
 * restores the form with fields preserved; non-preview forms submit
 * directly), and the context multi-select (chips → preview, reclarify
 * prefill).
 */
jest.mock('@nextdo/db', () => {
  return {
    applyClarify: jest.fn(),
    reclarifyAction: jest.fn(),
    listInboxItems: jest.fn(),
    listNextActions: jest.fn(),
    listCalendarActions: jest.fn(async () => []),
    getStoredBackendConfig: async () => null,
    wrapDb: () => ({}),
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => ({ data: [], error: undefined }),
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

// The wizard's calendar submission triggers the contextual permission ask
// (task 09-30 D4) — the native adapter drives expo-notifications (jest
// runs as Platform 'ios'); mocked with the idle OS state.
jest.mock('expo-notifications', () => mockExpoNotifications);

import { mockExpoNotifications } from './mocks/expo-notifications';

// Q2b's project list — one active (attachable) + one on-hold (filtered
// out by the wizard). proj-1 is act-1's current project (reclarify marker).
jest.mock('@/hooks/use-projects', () => ({ useProjects: jest.fn() }));

// The context multi-select's data (design §3.2.6).
jest.mock('@/hooks/use-contexts', () => ({ useContexts: jest.fn() }));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: jest.fn(),
    navigate: jest.fn(),
    setParams: jest.fn(),
    // go-back.ts (web deep-load fallback) — the stack normally HAS a parent.
    canGoBack: jest.fn(() => true),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn((cb: () => void) => cb()),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ValidationNextdoError } from '@nextdo/core';
import { applyClarify, listInboxItems, listNextActions, reclarifyAction } from '@nextdo/db';
import { router } from 'expo-router';
import { useProjects } from '@/hooks/use-projects';
import { useContexts } from '@/hooks/use-contexts';
import { formatLocalDateTime } from '@/lib/format';
import { ClarifyWizard, WizardBody } from '../components/clarify-wizard';

const mockedApplyClarify = applyClarify as jest.Mock;
const mockedReclarifyAction = reclarifyAction as jest.Mock;
const mockedListInboxItems = listInboxItems as jest.Mock;
const mockedListNextActions = listNextActions as jest.Mock;
const mockedUseProjects = useProjects as jest.Mock;
const mockedUseContexts = useContexts as jest.Mock;

const INBOX_ITEM = {
  id: 'inbox-1',
  createdAt: '2026-09-22T02:00:00.000Z',
  updatedAt: '2026-09-22T02:00:00.000Z',
  deletedAt: null,
  title: '订下周去杭州的高铁票',
  capturedAt: '2026-09-22T02:00:00.000Z',
};

const NEXT_ACTION = {
  id: 'act-1',
  createdAt: '2026-09-22T02:00:00.000Z',
  updatedAt: '2026-09-22T02:00:00.000Z',
  deletedAt: null,
  title: '写季度总结',
  projectId: 'proj-1',
  contextIds: [] as string[],
  estMinutes: 30,
  value: 3,
  category: null,
  dueDate: null,
  deadline: null,
  dependsOnId: null,
  windowStart: null,
  windowEnd: null,
  windowDays: null,
  consecutiveSkips: 3,
  status: 'open',
  sourceInboxId: null,
  replacesActionId: null,
};

const ACTIVE_PROJECT = {
  id: 'proj-1',
  createdAt: '2026-09-22T02:00:00.000Z',
  updatedAt: '2026-09-22T02:00:00.000Z',
  deletedAt: null,
  title: '毕业论文实验',
  outcome: 'baseline A/B 跑完并写入论文 §4',
  value: 4,
  status: 'active',
  hasOpenAction: true,
};
const ON_HOLD_PROJECT = {
  ...ACTIVE_PROJECT,
  id: 'proj-2',
  title: '搬家计划',
  value: 2,
  status: 'on-hold',
  hasOpenAction: false,
};

const CONTEXTS = [
  { id: 'ctx-computer', createdAt: '2026-09-22T02:00:00.000Z', updatedAt: '2026-09-22T02:00:00.000Z', deletedAt: null, name: 'computer' },
  { id: 'ctx-phone', createdAt: '2026-09-22T02:00:00.000Z', updatedAt: '2026-09-22T02:00:00.000Z', deletedAt: null, name: 'phone' },
  { id: 'ctx-home', createdAt: '2026-09-22T02:00:00.000Z', updatedAt: '2026-09-22T02:00:00.000Z', deletedAt: null, name: 'home' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseProjects.mockReturnValue({ data: [ACTIVE_PROJECT, ON_HOLD_PROJECT], error: null });
  mockedUseContexts.mockReturnValue({ data: CONTEXTS, error: null, add: jest.fn(async () => undefined), reload: jest.fn() });
  mockedListInboxItems.mockResolvedValue([INBOX_ITEM]);
  mockedListNextActions.mockResolvedValue([NEXT_ACTION]);
  mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'next-action', source: 'clarified' }, createdIds: ['a1'] });
  mockedReclarifyAction.mockResolvedValue({ outcome: { kind: 'next-action', source: 'clarified' }, createdIds: ['a2'] });
});

function renderWizard(
  props: {
    mode?: 'clarify' | 'reclarify';
    id?: string;
    actionKind?: 'next' | 'calendar' | null;
    defaultTitle?: string;
    currentProjectId?: string | null;
    capturedAt?: string | null;
    initialContextIds?: string[];
  } = {},
) {
  return render(
    <WizardBody
      mode={props.mode ?? 'clarify'}
      id={props.id ?? 'inbox-1'}
      actionKind={props.actionKind ?? null}
      defaultTitle={props.defaultTitle ?? '订下周去杭州的高铁票'}
      currentProjectId={props.currentProjectId ?? null}
      capturedAt={props.capturedAt ?? null}
      initialContextIds={props.initialContextIds ?? []}
    />,
  );
}

/** q2 → q2b → q3 → q4 → q5 → the action form (both modes re-enter at q2). */
function walkToActionForm() {
  fireEvent.press(screen.getByText('否，一步能完成'));
  fireEvent.press(screen.getByText('不属于项目'));
  expect(screen.getAllByText('大约 2 分钟内能完成吗？').length).toBeGreaterThan(0);
  fireEvent.press(screen.getByText('否'));
  expect(screen.getAllByText('应该由你完成吗？').length).toBeGreaterThan(0);
  fireEvent.press(screen.getByText('是，我的事'));
  expect(screen.getAllByText('必须在固定日期/时间执行吗？').length).toBeGreaterThan(0);
  fireEvent.press(screen.getByText('否，普通行动'));
  expect(screen.getByText('记成一个行动')).toBeTruthy();
}

describe('WizardBody — step walking (clarify)', () => {
  it('walks q1 → q2 → q2b(新建项目) → the project form, previews, then submits applyClarify', async () => {
    mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'project' }, createdIds: ['p1', 'a1'] });
    renderWizard();
    expect(screen.getAllByText('可以变成下一步行动吗？').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByText('可以，是行动'));
    expect(screen.getAllByText('需要多个步骤才能完成吗？').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByText('是，拆成项目'));
    // Multi-step items walk Q2b too (它属于哪个项目？) — the attachable
    // project rows + 新建项目. 不属于项目 is hidden for multi-step.
    expect(screen.getAllByText('它属于哪个项目？').length).toBeGreaterThan(0);
    expect(screen.queryByText('不属于项目')).toBeNull();
    fireEvent.press(screen.getByText('新建项目'));
    expect(screen.getByText('项目名')).toBeTruthy();
    expect(screen.getByPlaceholderText('用一句话描述完成的样貌')).toBeTruthy();

    // Required-field interception: empty outcome + no estimate → Chinese error,
    // no transaction.
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('请填写项目结果（"完成"是什么样）')).toBeTruthy();
    expect(mockedApplyClarify).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByPlaceholderText('用一句话描述完成的样貌'), '完成订票');
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('请选择或填写预估时长（分钟）')).toBeTruthy();
    expect(mockedApplyClarify).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('10 分钟'));
    // D5: PREVIEW_FORMS (project) confirm through the preview step — the
    // first 保存 must NOT write the db.
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    expect(mockedApplyClarify).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('确认保存'));
    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    const call = mockedApplyClarify.mock.calls[0][1];
    expect(call.inboxId).toBe('inbox-1');
    expect(call.answers).toMatchObject({
      actionable: true,
      multipleSteps: true,
      projectOutcome: '完成订票',
      twoMinutes: false,
      myResponsibility: true,
      fixedTime: false,
    });
    expect(call.target).toMatchObject({
      projectTitle: '订下周去杭州的高铁票',
      projectValue: 3,
      actionTitle: '订下周去杭州的高铁票',
      estMinutes: 10,
    });

    // Done step shows the Chinese outcome summary.
    await waitFor(() => expect(screen.getByText('已整理为「项目 + 首个行动」')).toBeTruthy());
  });

  describe('WizardBody — step back navigation & neutral options', () => {
    it('options have neutral styling without primary bias and support stepping back', () => {
      renderWizard();
      // At Q1: options have neutral secondary style (border border-border)
      const actionBtn = screen.getByLabelText('可以，是行动');
      const noBtn = screen.getByLabelText('不行');
      expect(actionBtn.props.className).toContain('border-border');
      expect(noBtn.props.className).toContain('border-border');

      // Click "可以，是行动" to go to Q2
      fireEvent.press(actionBtn);
      expect(screen.getAllByText('需要多个步骤才能完成吗？').length).toBeGreaterThan(0);

      // At Q2, both card bottom and header have "← 上一步"
      const backButtons = screen.getAllByText('← 上一步');
      expect(backButtons.length).toBeGreaterThan(0);

      // Pressing back returns to Q1
      fireEvent.press(backButtons[0]!);
      expect(screen.getAllByText('可以变成下一步行动吗？').length).toBeGreaterThan(0);

      // Go to Q1b
      fireEvent.press(screen.getByText('不行'));
      expect(screen.getAllByText('那它更接近哪一类？').length).toBeGreaterThan(0);

      // Step back from Q1b to Q1
      const backFromQ1b = screen.getAllByText('← 上一步');
      fireEvent.press(backFromQ1b[0]!);
      expect(screen.getAllByText('可以变成下一步行动吗？').length).toBeGreaterThan(0);
    });

    it('form step supports stepping back to the previous question', () => {
      renderWizard();
      fireEvent.press(screen.getByText('可以，是行动'));
      fireEvent.press(screen.getByText('否，一步能完成'));
      fireEvent.press(screen.getByText('新建项目'));

      // Now at project form
      expect(screen.getAllByText('新建项目').length).toBeGreaterThan(0);
      expect(screen.getByText('上一步')).toBeTruthy();

      // Press "上一步" in form
      fireEvent.press(screen.getByText('上一步'));
      expect(screen.getAllByText('它属于哪个项目？').length).toBeGreaterThan(0);
    });
  });

  it('q2 yes → q2b: attach to the existing project submits a project-attach action', async () => {
    mockedApplyClarify.mockResolvedValue({
      inboxId: 'inbox-1',
      outcome: { kind: 'next-action', source: 'project-attach' },
      createdIds: ['a3'],
    });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('是，拆成项目'));
    // The attachable project row — its title + value are the row text.
    expect(screen.queryByText('不属于项目')).toBeNull();
    fireEvent.press(screen.getByText('毕业论文实验（价值 4）'));
    // The action form with the attachment fixed (the preview shows 所属项目).
    expect(screen.getByText('记成一个行动')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    // The preview's 所属项目 row carries the attachment (the title also
    // appears in the GTD 决策摘要 answer row — getAllByText on purpose).
    expect(screen.getByText('所属项目')).toBeTruthy();
    expect(screen.getAllByText('毕业论文实验').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByText('确认保存'));
    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    const call = mockedApplyClarify.mock.calls[0][1];
    // project-attach encoding: NO new project (multipleSteps=false) +
    // the existing project id — value defaults to the project's (4).
    expect(call.answers).toMatchObject({
      actionable: true,
      multipleSteps: false,
      twoMinutes: false,
      myResponsibility: true,
      fixedTime: false,
      projectId: 'proj-1',
    });
    await waitFor(() => expect(screen.getByText('已整理为「项目行动（挂接已有项目）」')).toBeTruthy());
  });

  it('the do-now path (q3 yes → q3b yes) submits immediately, no form', async () => {
    mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'do-now-completed' }, createdIds: ['r1'] });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));
    // q2 (no) now leads to Q2b — opt out of a project to reach Q3.
    fireEvent.press(screen.getByText('不属于项目'));
    expect(screen.getAllByText('大约 2 分钟内能完成吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('是，2 分钟内'));
    expect(screen.getAllByText('现在就做掉吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('是，现在就做完'));

    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    const call = mockedApplyClarify.mock.calls[0][1];
    expect(call.answers).toMatchObject({
      actionable: true,
      multipleSteps: false,
      twoMinutes: true,
      completedOnTheSpot: true,
      myResponsibility: true,
      fixedTime: false,
    });
    await waitFor(() => expect(screen.getByText('已整理为「当场完成」')).toBeTruthy());
  });

  it('a failing transaction surfaces the Chinese mapped error, no done step', async () => {
    mockedApplyClarify.mockRejectedValue(new ValidationNextdoError('action.not-found', 'No live next action with id x'));
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));
    // q2 (no) now leads to Q2b — opt out of a project to reach Q3.
    fireEvent.press(screen.getByText('不属于项目'));
    expect(screen.getAllByText('大约 2 分钟内能完成吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('否'));
    expect(screen.getAllByText('应该由你完成吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('是，我的事'));
    expect(screen.getAllByText('必须在固定日期/时间执行吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('否，普通行动'));
    // action form: est prefill is null → pick one, then submit.
    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    fireEvent.press(screen.getByText('确认保存'));

    await waitFor(() => expect(screen.getByText('这个行动不存在了（可能已被删除）')).toBeTruthy());
    expect(screen.queryByText(/已整理为/)).toBeNull();
  });
});

describe('WizardBody — reclarify entry', () => {
  it('re-enters at q2 (no q1) and submits reclarifyAction', async () => {
    renderWizard({ mode: 'reclarify', id: 'act-1', actionKind: 'next', defaultTitle: '写季度总结', currentProjectId: 'proj-1' });
    expect(screen.queryByText('可以变成下一步行动吗？')).toBeNull();
    expect(screen.getAllByText('需要多个步骤才能完成吗？').length).toBeGreaterThan(0);

    walkToActionForm();
    fireEvent.press(screen.getByLabelText('20 分钟'));
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    fireEvent.press(screen.getByText('确认保存'));

    await waitFor(() => expect(mockedReclarifyAction).toHaveBeenCalledTimes(1));
    const call = mockedReclarifyAction.mock.calls[0][1];
    expect(call.actionKind).toBe('next');
    expect(call.actionId).toBe('act-1');
    expect(call.answers).toMatchObject({
      multipleSteps: false,
      twoMinutes: false,
      myResponsibility: true,
      fixedTime: false,
    });
    expect('actionable' in call.answers).toBe(false);
    expect(call.target).toMatchObject({ title: '写季度总结', estMinutes: 20 });
  });
});

describe('WizardBody — progress line + GTD 决策摘要 (design §3.4)', () => {
  it('clarify: 步骤 1/7 at q1, 步骤 2/7 after answering q1', () => {
    renderWizard();
    expect(screen.getByText('步骤 1/7')).toBeTruthy();
    fireEvent.press(screen.getByText('可以，是行动'));
    expect(screen.getByText('步骤 2/7')).toBeTruthy();
  });

  it('reclarify entry: 步骤 1/6', () => {
    renderWizard({ mode: 'reclarify', id: 'act-1', actionKind: 'next', currentProjectId: 'proj-1' });
    expect(screen.getByText('步骤 1/6')).toBeTruthy();
  });

  it('the form step reaches 步骤 7/7 on the full clarify chain', () => {
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();
    expect(screen.getByText('步骤 7/7')).toBeTruthy();
  });

  it('decision summary: collapsed by default, expandable on tap to show question chain', () => {
    renderWizard();
    expect(screen.getByText('GTD 决策摘要')).toBeTruthy();
    // Default collapsed: chain questions are hidden to avoid clutter.
    expect(screen.queryByText('那它更接近哪一类？')).toBeNull();

    // Expand on tap.
    fireEvent.press(screen.getByLabelText('展开GTD决策摘要'));
    expect(screen.getByText('那它更接近哪一类？')).toBeTruthy();
    expect(screen.getByText('必须在固定日期/时间执行吗？')).toBeTruthy();

    // Answering q1 highlights the row with the tapped button text.
    fireEvent.press(screen.getByText('可以，是行动'));
    expect(screen.getByText('可以，是行动')).toBeTruthy();
  });

  it('reclarify decision summary: collapsed by default, expanded q1/q1b rows are not shown', () => {
    renderWizard({ mode: 'reclarify', id: 'act-1', actionKind: 'next', currentProjectId: 'proj-1' });
    expect(screen.getByText('GTD 决策摘要')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('展开GTD决策摘要'));
    expect(screen.queryByText('可以变成下一步行动吗？')).toBeNull();
    expect(screen.queryByText('那它更接近哪一类？')).toBeNull();
    expect(screen.getAllByText('需要多个步骤才能完成吗？').length).toBeGreaterThan(0);
  });
});

describe('WizardBody — preview step (design §3.4)', () => {
  it('action form: 保存 → preview (no db write) → 确认保存 → one submit → done', async () => {
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();
    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));

    // The preview card replaces the form; the progress line shows 决策摘要预览.
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    expect(screen.getByText('决策摘要预览')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('确认保存')).toBeTruthy();
    expect(screen.getByText('上一步修改')).toBeTruthy();
    expect(mockedApplyClarify).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('确认保存'));
    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('已整理为「下一步行动」')).toBeTruthy());
    expect(mockedApplyClarify).toHaveBeenCalledTimes(1);
  });

  it('上一步修改 restores the form with the fields preserved', async () => {
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();
    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.changeText(screen.getByDisplayValue('订下周去杭州的高铁票'), '改过的行动标题');
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();

    fireEvent.press(screen.getByText('上一步修改'));
    // Back on the form — the edits survived the round trip.
    expect(screen.getByText('记成一个行动')).toBeTruthy();
    expect(screen.getByDisplayValue('改过的行动标题')).toBeTruthy();
    expect(screen.getByLabelText('10 分钟').props.accessibilityState.selected).toBe(true);
    expect(mockedApplyClarify).not.toHaveBeenCalled();

    // Re-confirming submits the (updated) form exactly once.
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    fireEvent.press(screen.getByText('确认保存'));
    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    expect(mockedApplyClarify.mock.calls[0][1].target).toMatchObject({ title: '改过的行动标题' });
  });

  it('reference form: 保存 submits directly (no preview)', async () => {
    mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'reference' }, createdIds: [] });
    renderWizard();
    fireEvent.press(screen.getByText('不行'));
    fireEvent.press(screen.getByText('资料（留个参考）'));
    expect(screen.getByPlaceholderText('https://…')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('https://…'), 'https://example.com');
    fireEvent.press(screen.getByText('保存'));

    expect(screen.queryByText('确认保存')).toBeNull();
    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('已整理为「资料」')).toBeTruthy());
  });

  it('trash form: 确认删除 submits directly (no preview)', async () => {
    renderWizard();
    fireEvent.press(screen.getByText('不行'));
    fireEvent.press(screen.getByText('删除'));
    expect(screen.getByText('删除这条捕获？')).toBeTruthy();
    fireEvent.press(screen.getByText('确认删除'));

    expect(screen.queryByText('确认保存')).toBeNull();
    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
  });
});

describe('WizardBody — context multi-select (design §3.4)', () => {
  it('action form: two toggled chips appear in the preview and the submission', async () => {
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();
    expect(screen.getByText('在哪里做？（可多选，不选 = 随处可执行）')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('选择情境：computer'));
    fireEvent.press(screen.getByLabelText('选择情境：phone'));
    fireEvent.press(screen.getByLabelText('10 分钟'));
    // Nothing selected yet → 随处可执行; with two chips → the two names.
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    expect(screen.getByText('computer')).toBeTruthy();
    expect(screen.getByText('phone')).toBeTruthy();
    expect(screen.queryByText('随处可执行')).toBeNull();
    expect(screen.queryByText('home')).toBeNull();
    expect(mockedApplyClarify).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('确认保存'));
    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    expect(mockedApplyClarify.mock.calls[0][1].target).toMatchObject({ contextIds: ['ctx-computer', 'ctx-phone'] });
  });

  it('no chips selected: the preview shows 随处可执行', async () => {
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();
    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    expect(screen.getByText('随处可执行')).toBeTruthy();
  });

  // Regression (found by running the app, 2026-10-07): the five default
  // contexts are seeded SERVER-side (domain-model.md "Context" — the
  // single-writer decision), so any client that has not connected to the
  // sync backend yet has an EMPTY contexts table. The multi-select then
  // rendered a bare 「在哪里做？」label over nothing — no chips, no empty
  // state, and no way to create one from inside the wizard (only the Now
  // screen's scene bar had that). A dead end.
  // Context multi-select: scene management is centralized via /contexts
  // route — inline quick-create is removed from the form to keep it clean.
  it('no contexts: the multi-select explains the state and provides scene management entry', async () => {
    mockedUseContexts.mockReturnValue({ data: [], error: null, add: jest.fn(async () => undefined), reload: jest.fn() });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();

    // The empty state says what an empty selection means…
    expect(screen.getByText(/还没有场景/)).toBeTruthy();
    expect(screen.getByText(/不选即随处可执行/)).toBeTruthy();

    // The management entry is reachable via header action.
    expect(screen.getByLabelText('管理场景')).toBeTruthy();
    expect(screen.queryByLabelText('新建场景')).toBeNull();
    expect(screen.queryByLabelText('新场景名称')).toBeNull();
  });

  it('the 管理场景 button navigates to /contexts', async () => {
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();

    fireEvent.press(screen.getByLabelText('管理场景'));
    expect(router.push).toHaveBeenCalledWith('/contexts');
  });

  it('does not render inline quick-create in the form', async () => {
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();

    expect(screen.queryByLabelText('新建场景')).toBeNull();
    expect(screen.queryByLabelText('新场景名称')).toBeNull();
  });

  it('triggers reload on focus so returning from /contexts reflects newly created scenes', async () => {
    const reload = jest.fn();
    mockedUseContexts.mockReturnValue({
      data: [{ id: 'ctx-1', name: '办公室' }],
      error: null,
      add: jest.fn(async () => undefined),
      reload,
    });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    walkToActionForm();

    expect(screen.getByText('办公室')).toBeTruthy();
    expect(reload).toHaveBeenCalled();
  });
});

describe('WizardBody — calendar form (design §15: date/time pickers, no typed ISO)', () => {
  it('q5-yes → pickers fill 开始日期/开始时间; the preview shows 开始; submit carries the composed ISO', async () => {
    mockedApplyClarify.mockResolvedValue({
      inboxId: 'inbox-1',
      outcome: { kind: 'calendar-action' },
      createdIds: ['c1'],
    });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));
    fireEvent.press(screen.getByText('不属于项目'));
    fireEvent.press(screen.getByText('否'));
    fireEvent.press(screen.getByText('是，我的事'));
    fireEvent.press(screen.getByText('是，固定时间'));
    expect(screen.getByText('固定时间行动')).toBeTruthy();

    // The free-text ISO inputs are gone — the fields are picker buttons.
    expect(screen.queryByPlaceholderText('2026-09-30')).toBeNull();
    expect(screen.queryByPlaceholderText('09:30')).toBeNull();

    // 开始日期: open the picker and pick {this year}-09-30 with explicit
    // chips (the picker's defaults come from the app clock — run-day
    // dependent — so every cell is tapped on purpose).
    const year = new Date().getFullYear();
    fireEvent.press(screen.getByLabelText('选择开始日期'));
    fireEvent.press(screen.getByLabelText(`年 ${year}`));
    fireEvent.press(screen.getByLabelText('月 9'));
    fireEvent.press(screen.getByLabelText('日 30'));
    fireEvent.press(screen.getByText('确定'));
    expect(screen.getByText(`${year}-09-30`)).toBeTruthy();

    // 开始时间: pick 09:30.
    fireEvent.press(screen.getByLabelText('选择开始时间'));
    fireEvent.press(screen.getByLabelText('小时 09'));
    fireEvent.press(screen.getByLabelText('分钟 30'));
    fireEvent.press(screen.getByText('确定'));
    expect(screen.getByText('09:30')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));

    // The preview shows the composed 开始 line, formatted exactly like the
    // app renders it (device-local — locale-dependent, matched via the
    // same helper).
    const startsAt = new Date(year, 8, 30, 9, 30).toISOString();
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    expect(screen.getByText(formatLocalDateTime(startsAt))).toBeTruthy();

    fireEvent.press(screen.getByText('确认保存'));
    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    const call = mockedApplyClarify.mock.calls[0][1];
    expect(call.answers.fixedTime).toBe(true);
    expect(call.target.startsAt).toBe(startsAt);
    expect(call.target.estMinutes).toBe(10);
  });
});

describe('ClarifyWizard — title loading', () => {
  it('loads the inbox item title, then shows the wizard', async () => {
    render(<ClarifyWizard mode="clarify" id="inbox-1" />);
    await waitFor(() => expect(screen.getAllByText('可以变成下一步行动吗？').length).toBeGreaterThan(0));
  });

  it('reclarify loads the existing action title into the forms', async () => {
    render(<ClarifyWizard mode="reclarify" id="act-1" actionKind="next" />);
    await waitFor(() => expect(screen.getAllByText('需要多个步骤才能完成吗？').length).toBeGreaterThan(0));
    walkToActionForm();
    const titleInput = screen.getByDisplayValue('写季度总结');
    expect(titleInput).toBeTruthy();
  });

  it('a missing target shows the not-found state with a back button', async () => {
    render(<ClarifyWizard mode="clarify" id="inbox-missing" />);
    await waitFor(() => expect(screen.getByText('这条收件箱记录不存在了')).toBeTruthy());
    expect(screen.getByText('返回')).toBeTruthy();
  });

  it('reclarify without a resolvable kind shows the unsupported state (no infinite loading)', async () => {
    render(<ClarifyWizard mode="reclarify" id="act-1" actionKind={null} />);
    await waitFor(
      () => expect(screen.getByText('这个行动不能重新明晰（习惯请编辑习惯本身）')).toBeTruthy(),
    );
    expect(screen.queryByText('加载中…')).toBeNull();
  });

  it('reclarify: the existing action contextIds prefill the form chips', async () => {
    mockedListNextActions.mockResolvedValue([{ ...NEXT_ACTION, contextIds: ['ctx-computer', 'ctx-phone'] }]);
    render(<ClarifyWizard mode="reclarify" id="act-1" actionKind="next" />);
    await waitFor(() => expect(screen.getAllByText('需要多个步骤才能完成吗？').length).toBeGreaterThan(0));
    walkToActionForm();

    expect(screen.getByLabelText('选择情境：computer').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('选择情境：phone').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('选择情境：home').props.accessibilityState.selected).toBe(false);

    fireEvent.press(screen.getByLabelText('20 分钟'));
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('computer')).toBeTruthy();
    expect(screen.getByText('phone')).toBeTruthy();
    fireEvent.press(screen.getByText('确认保存'));
    await waitFor(() => expect(mockedReclarifyAction).toHaveBeenCalledTimes(1));
    expect(mockedReclarifyAction.mock.calls[0][1].target).toMatchObject({
      contextIds: ['ctx-computer', 'ctx-phone'],
    });
  });
});

describe('WizardBody — q2b project ownership', () => {
  function walkToQ2b(mode: 'clarify' | 'reclarify' = 'clarify') {
    renderWizard({ mode, currentProjectId: mode === 'reclarify' ? 'proj-1' : null });
    if (mode === 'clarify') fireEvent.press(screen.getByText('可以，是行动'));
    // Re-clarify re-enters at Q2 — there is no Q1.
    fireEvent.press(screen.getByText('否，一步能完成'));
    expect(screen.getAllByText('它属于哪个项目？').length).toBeGreaterThan(0);
  }

  it('lists only ACTIVE projects (value shown); on-hold is filtered out', () => {
    walkToQ2b();
    expect(screen.getByText('毕业论文实验（价值 4）')).toBeTruthy();
    expect(screen.queryByText(/搬家计划/)).toBeNull();
    expect(screen.getByText('新建项目')).toBeTruthy();
    expect(screen.getByText('不属于项目')).toBeTruthy();
  });

  it('attaching opens the action form with the read-only project row and the value prefilled', async () => {
    walkToQ2b();
    fireEvent.press(screen.getByLabelText('挂到项目：毕业论文实验'));
    // The action form shows the fixed attachment (read-only) and skips Q3–Q5.
    expect(screen.getByText('所属项目：毕业论文实验')).toBeTruthy();
    expect(screen.getByText('记成一个行动')).toBeTruthy();
    // The attach skips Q3–Q5: the question card is gone (the button is the
    // signal — the title also appears in the summary card).
    expect(screen.queryByText('是，2 分钟内')).toBeNull();

    fireEvent.press(screen.getByLabelText('10 分钟'));
    fireEvent.press(screen.getByText('保存'));
    expect(screen.getByText('决策摘要预览 · 归位就绪')).toBeTruthy();
    fireEvent.press(screen.getByText('确认保存'));

    await waitFor(() => expect(mockedApplyClarify).toHaveBeenCalledTimes(1));
    const call = mockedApplyClarify.mock.calls[0][1];
    expect(call.answers).toMatchObject({ projectId: 'proj-1', twoMinutes: false, fixedTime: false });
    // The value defaults to the project's value (4) — the user did not change it.
    expect(call.target).toMatchObject({ value: 4, estMinutes: 10 });
  });

  it('re-clarify marks the action\'s current project (可保持 / 改挂 / 解除)', () => {
    walkToQ2b('reclarify');
    expect(screen.getByText('当前')).toBeTruthy();
  });

  it('no projects → only the two fallback buttons', () => {
    mockedUseProjects.mockReturnValue({ data: [], error: null });
    walkToQ2b();
    expect(screen.queryByLabelText('挂到项目：毕业论文实验')).toBeNull();
    expect(screen.getByText('新建项目')).toBeTruthy();
    expect(screen.getByText('不属于项目')).toBeTruthy();
  });
});

describe('WizardBody — done step (explicit exits, no auto-back)', () => {
  async function walkToDone() {
    mockedApplyClarify.mockResolvedValue({ inboxId: 'inbox-1', outcome: { kind: 'do-now-completed' }, createdIds: ['r1'] });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));
    fireEvent.press(screen.getByText('不属于项目'));
    expect(screen.getAllByText('大约 2 分钟内能完成吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('是，2 分钟内'));
    expect(screen.getAllByText('现在就做掉吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('是，现在就做完'));
    await waitFor(() => expect(screen.getByText('已整理为「当场完成」')).toBeTruthy());
  }

  it('shows 再记一条 / 完成 and does NOT auto-return', async () => {
    await walkToDone();
    expect(screen.getByText('再记一条')).toBeTruthy();
    expect(screen.getByText('完成')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('再记一条 → navigate to the inbox tab with recapture=1', async () => {
    await walkToDone();
    fireEvent.press(screen.getByText('再记一条'));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: '/(tabs)/inbox', params: { recapture: '1' } });
  });

  it('完成 → router.back (same shape in reclarify mode)', async () => {
    mockedReclarifyAction.mockResolvedValue({ outcome: { kind: 'do-now-completed' }, createdIds: [] });
    renderWizard({ mode: 'reclarify', id: 'act-1', actionKind: 'next', currentProjectId: 'proj-1' });
    fireEvent.press(screen.getByText('否，一步能完成'));
    fireEvent.press(screen.getByText('不属于项目'));
    expect(screen.getAllByText('大约 2 分钟内能完成吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('是，2 分钟内'));
    expect(screen.getAllByText('现在就做掉吗？').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('是，现在就做完'));
    await waitFor(() => expect(screen.getByText('已整理为「当场完成」')).toBeTruthy());
    fireEvent.press(screen.getByText('完成'));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('deep-load without a parent: 完成 replaces to the origin tab instead of back', async () => {
    await walkToDone();
    // Simulate a web deep-load (refresh / bookmark): the stack has no parent,
    // so goBack falls back to the screen the wizard was pushed from.
    jest.mocked(router.canGoBack).mockReturnValueOnce(false);
    fireEvent.press(screen.getByText('完成'));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/inbox');
  });
});

/**
 * Keyboard navigation (issue #17).
 *
 * The hook only registers DOM handlers under `Platform.OS === 'web'`, and
 * jest runs this suite as iOS — so each test here pretends to be the desktop
 * shell first, exactly like the settings suite's `pretendDesktopMac`.
 */
describe('WizardBody — keyboard navigation (desktop)', () => {
  const ORIGINAL_OS = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: ORIGINAL_OS, configurable: true });
  });

  /**
   * The class list of the pressable wrapping `label` — the ring rides on the
   * option, which sits a few wrappers above the `Text` that carries the label
   * (RN's `Pressable` inserts its own views), so walk up to find it.
   */
  function ringOn(label: string): string {
    return ringOnElement(screen.getByText(label));
  }

  /** Same, for an element the test already resolved (labels can repeat). */
  function ringOnElement(start: ReturnType<typeof screen.getByText>): string {
    let node: ReturnType<typeof screen.getByText> | null = start;
    // RN interleaves composite wrappers, so walk generously.
    for (let depth = 0; node !== null && depth < 8; depth += 1) {
      const className = node.props?.className;
      // Every navigable option carries its own base border (the
      // `secondary` button variant, the q2b row), so that is the marker
      // for "this wrapper IS the option".
      if (typeof className === 'string' && className.includes('border-border')) return className;
      node = node.parent;
    }
    return '';
  }

  /**
   * Fire a key on the option list. The handler is on the wrapper, so the
   * event is fired on a child and RNTL walks up to it — the same bubbling a
   * real keystroke does.
   */
  function pressKey(label: string, key: string): void {
    fireEvent(screen.getByText(label), 'keyDown', { key, preventDefault: jest.fn() });
  }

  it('opens on the first option with the ring lit, and no other option ringed', () => {
    renderWizard();
    expect(ringOn('可以，是行动')).toContain('border-accent');
    expect(ringOn('不行')).not.toContain('border-accent');
  });

  it('↓ / ↑ move the ring and wrap around the ends', () => {
    renderWizard();
    pressKey('可以，是行动', 'ArrowDown');
    expect(ringOn('不行')).toContain('border-accent');
    expect(ringOn('可以，是行动')).not.toContain('border-accent');

    // Wraps forward from the last option back to the first…
    pressKey('不行', 'ArrowDown');
    expect(ringOn('可以，是行动')).toContain('border-accent');
    // …and backward from the first to the last.
    pressKey('可以，是行动', 'ArrowUp');
    expect(ringOn('不行')).toContain('border-accent');
  });

  it('Enter presses the LIT option — ↓ then Enter answers 「不行」, not 「可以」', () => {
    renderWizard();
    pressKey('可以，是行动', 'ArrowDown');
    pressKey('可以，是行动', 'Enter');
    // 「不行」 branches to q1b; 「可以」 would have gone to q2. Landing on
    // q1b is the proof that Enter acted on the moved selection.
    expect(screen.getAllByText('那它更接近哪一类？').length).toBeGreaterThan(0);
  });

  it('Enter on the untouched first option takes the 「可以」 branch', () => {
    renderWizard();
    pressKey('可以，是行动', 'Enter');
    expect(screen.getAllByText('需要多个步骤才能完成吗？').length).toBeGreaterThan(0);
  });

  it('a new question resets the ring to its own first option', () => {
    renderWizard();
    // Park the ring on q1's SECOND answer, then answer with the mouse.
    pressKey('可以，是行动', 'ArrowDown');
    fireEvent.press(screen.getByText('可以，是行动'));

    // q2's own list starts at its own first answer — the ring does not carry
    // over, and focus has already been handed back to the new question.
    expect(ringOn('是，拆成项目')).toContain('border-accent');
    expect(ringOn('否，一步能完成')).not.toContain('border-accent');
  });

  it('q2b: ↓ walks from the project rows into the fall-through answers', () => {
    mockedUseProjects.mockReturnValue({
      data: [ACTIVE_PROJECT, { ...ACTIVE_PROJECT, id: 'proj-3', title: '读书笔记', value: 3 }],
      error: null,
    });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));

    // Two projects + 新建项目 + 不属于项目 — the ring starts on the first row.
    expect(ringOn('毕业论文实验（价值 4）')).toContain('border-accent');
    pressKey('毕业论文实验（价值 4）', 'ArrowDown');
    expect(ringOn('读书笔记（价值 3）')).toContain('border-accent');
    pressKey('读书笔记（价值 3）', 'ArrowDown');
    expect(ringOn('新建项目')).toContain('border-accent');
    pressKey('新建项目', 'ArrowDown');
    expect(ringOn('不属于项目')).toContain('border-accent');
  });

  it('Enter on the last q2b answer submits that choice (the ring really moved)', () => {
    mockedUseProjects.mockReturnValue({
      data: [ACTIVE_PROJECT],
      error: null,
    });
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    fireEvent.press(screen.getByText('否，一步能完成'));
    pressKey('毕业论文实验（价值 4）', 'End');
    // End jumps to the LAST answer, not to the last project row.
    expect(ringOn('不属于项目')).toContain('border-accent');
    pressKey('毕业论文实验（价值 4）', 'Enter');
    // 「不属于项目」 → q3 (the regular chain), not the project form.
    expect(screen.getAllByText('大约 2 分钟内能完成吗？').length).toBeGreaterThan(0);
  });

  it('the back control sits outside the keyboard list (no arrow lands on it)', () => {
    renderWizard();
    fireEvent.press(screen.getByText('可以，是行动'));
    expect(screen.getAllByText('← 上一步').length).toBeGreaterThan(0);
    // `Choices` renders the back button as a sibling of the navigable
    // container, so no arrow can ever put the ring on it. (The summary card
    // renders its own 「← 上一步」, hence the getAll.)
    for (const back of screen.getAllByText('← 上一步')) {
      expect(ringOnElement(back)).not.toContain('border-accent');
    }
  });
});
