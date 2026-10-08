<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount, tick } from 'svelte';
  import {
    AlertTriangle,
    ArrowRight,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleDollarSign,
    Clock3,
    Flag,
    Gauge,
    Pencil,
    RefreshCw,
    Route,
    Save,
    Sparkles,
    Target,
    X
  } from '@lucide/svelte';
  import PromotionImpactPanel from '$lib/components/plans/PromotionImpactPanel.svelte';
  import {
    PlanService,
    ScenarioService,
    budgetForExtra,
    comparePlanProjections,
    extraPaymentForBudget,
    minimumPaymentTotal,
    paginateRows,
    planStartMonth,
    type SavedScenarioView
  } from '$lib/application';
  import type { CalculationFailure, Currency, PayoffAlgorithm, PlanProjection } from '$lib/domain';
  import { getDatabase, getPersistenceMode, type PlanSettings } from '$lib/persistence';
  import { currentLocalMonth, formatYearMonth } from '$lib/utils/dates';
  import { formatMoney, formatMoneyInput, parseMoneyInput } from '$lib/utils/money';

  const PAGE_SIZE = 24;
  const RECALCULATION_DELAY_MS = 120;
  const database = getDatabase();
  const memoryOnly = getPersistenceMode() === 'memory';
  const planService = new PlanService(database);
  const scenarioService = new ScenarioService(database);

  // Drafts snapshot today's balances, so they start no earlier than the current month.
  function draftStartMonth(scenarioStartMonth: string): string {
    return planStartMonth(scenarioStartMonth, currentLocalMonth());
  }

  type ActivationMode = 'selected' | 'draft';

  let plans = $state<SavedScenarioView[]>([]);
  let settings = $state<PlanSettings | null>(null);
  let selectedId = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let calculating = $state(false);
  let pageError = $state('');
  let statusMessage = $state('');
  let expandedDebtId = $state<string | null>(null);
  let schedulePage = $state(0);
  let budgetInput = $state('0.00');
  let extraInput = $state('0.00');
  let scenarioName = $state('Alternative plan');
  let draftProjection = $state<PlanProjection | null>(null);
  let draftFailure = $state<CalculationFailure | null>(null);
  let draftAlgorithm = $state<PayoffAlgorithm>('snowball');
  let renaming = $state(false);
  let renameInput = $state('');
  let activationMode = $state<ActivationMode | null>(null);
  let activationTrigger = $state<HTMLButtonElement>();
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;

  let selected = $derived(plans.find((plan) => plan.scenario.id === selectedId) ?? null);
  let selectedProjection = $derived(selected?.projection ?? null);
  let interestWarnings = $derived(
    draftProjection?.warnings.filter(
      (warning) =>
        warning.code === 'PROMOTION_EXPIRES_BEFORE_PAYOFF' || warning.code === 'UNKNOWN_APR'
    ) ?? []
  );
  let currency = $derived<Currency>(settings?.currency ?? 'GBP');
  let activeScenarioId = $derived(settings?.activeScenarioId ?? null);
  let minimumBudgetMinor = $derived(minimumPaymentTotal(selected?.scenario.debtSnapshot ?? []));
  let comparison = $derived(
    selectedProjection && draftProjection
      ? comparePlanProjections(selectedProjection, draftProjection)
      : null
  );
  let expandedMilestone = $derived(
    selectedProjection?.milestones.find((milestone) => milestone.debtId === expandedDebtId) ?? null
  );
  let amortizationRows = $derived.by(() => {
    if (!selectedProjection || !expandedMilestone) return [];
    return selectedProjection.months
      .filter((month) => month.monthNumber <= expandedMilestone.payoffMonthNumber)
      .map((month) => ({
        month,
        debt: month.debts.find((debt) => debt.debtId === expandedMilestone.debtId)
      }))
      .filter((row) => row.debt && (row.debt.openingBalanceMinor > 0 || row.debt.paymentMinor > 0));
  });
  let pageCount = $derived(Math.max(1, Math.ceil(amortizationRows.length / PAGE_SIZE)));
  let visibleRows = $derived(paginateRows(amortizationRows, schedulePage, PAGE_SIZE));

  function applyPlanToPlanner(plan: SavedScenarioView): void {
    const budget = plan.scenario.monthlyBudgetMinor;
    const minimums = minimumPaymentTotal(plan.scenario.debtSnapshot);
    budgetInput = formatMoneyInput(budget);
    extraInput = formatMoneyInput(extraPaymentForBudget(budget, minimums));
    scenarioName = `${plan.scenario.name} alternative`;
    draftAlgorithm = plan.scenario.algorithm;
    draftProjection = plan.projection;
    draftFailure = null;
  }

  async function loadWorkspace(preferredId?: string): Promise<void> {
    const [workspace, savedSettings] = await Promise.all([
      scenarioService.workspace(),
      planService.getSettings()
    ]);
    plans = workspace;
    settings = savedSettings ?? null;
    const nextId =
      preferredId && workspace.some((plan) => plan.scenario.id === preferredId)
        ? preferredId
        : savedSettings?.activeScenarioId &&
            workspace.some((plan) => plan.scenario.id === savedSettings.activeScenarioId)
          ? savedSettings.activeScenarioId
          : (workspace[0]?.scenario.id ?? '');
    selectedId = nextId;
    const nextPlan = workspace.find((plan) => plan.scenario.id === nextId);
    if (nextPlan) applyPlanToPlanner(nextPlan);
  }

  onMount(() => {
    void (async () => {
      try {
        await loadWorkspace();
      } catch (cause) {
        pageError =
          cause instanceof Error ? cause.message : 'Your saved plans could not be loaded.';
      } finally {
        loading = false;
      }
    })();
    return () => {
      if (debounceHandle) clearTimeout(debounceHandle);
    };
  });

  function selectPlan(plan: SavedScenarioView): void {
    selectedId = plan.scenario.id;
    expandedDebtId = null;
    schedulePage = 0;
    renaming = false;
    statusMessage = '';
    applyPlanToPlanner(plan);
  }

  function inputFailure(message: string): CalculationFailure {
    return { status: 'failure', code: 'INVALID_INPUT', message, details: {} };
  }

  function schedulePreview(budgetMinor: number): void {
    if (debounceHandle) clearTimeout(debounceHandle);
    draftFailure = null;
    debounceHandle = setTimeout(() => void recalculateDraft(budgetMinor), RECALCULATION_DELAY_MS);
  }

  async function recalculateDraft(budgetMinor: number): Promise<void> {
    if (!selected) return;
    calculating = true;
    try {
      const result = await scenarioService.preview({
        monthlyBudgetMinor: budgetMinor,
        startMonth: draftStartMonth(selected.scenario.startMonth),
        algorithm: draftAlgorithm
      });
      if (result.status === 'success') {
        draftProjection = result;
        draftFailure = null;
      } else {
        draftFailure = result;
      }
    } catch (cause) {
      draftFailure = inputFailure(
        cause instanceof Error ? cause.message : 'This plan could not be recalculated.'
      );
    } finally {
      calculating = false;
    }
  }

  function updateBudget(value: string): void {
    budgetInput = value;
    const parsed = parseMoneyInput(value);
    if (parsed === null || parsed <= 0) {
      if (debounceHandle) clearTimeout(debounceHandle);
      draftFailure = inputFailure('Enter a monthly budget greater than zero.');
      return;
    }
    extraInput = formatMoneyInput(extraPaymentForBudget(parsed, minimumBudgetMinor));
    schedulePreview(parsed);
  }

  function updateExtra(value: string): void {
    extraInput = value;
    const parsed = parseMoneyInput(value);
    if (parsed === null) {
      if (debounceHandle) clearTimeout(debounceHandle);
      draftFailure = inputFailure('Enter a valid extra payment amount.');
      return;
    }
    const budget = budgetForExtra(minimumBudgetMinor, parsed);
    budgetInput = formatMoneyInput(budget);
    schedulePreview(budget);
  }

  function addExtra(amountMinor: number): void {
    const current = parseMoneyInput(extraInput) ?? 0;
    updateExtra(formatMoneyInput(current + amountMinor));
  }

  function updateAlgorithm(algorithm: PayoffAlgorithm): void {
    draftAlgorithm = algorithm;
    if (debounceHandle) clearTimeout(debounceHandle);
    const budgetMinor = parseMoneyInput(budgetInput);
    if (budgetMinor !== null && budgetMinor > 0) void recalculateDraft(budgetMinor);
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    saving = true;
    pageError = '';
    statusMessage = '';
    try {
      await action();
    } catch (cause) {
      pageError = cause instanceof Error ? cause.message : 'The saved plan could not be updated.';
    } finally {
      saving = false;
    }
  }

  async function saveScenario(): Promise<void> {
    if (!selected || !draftProjection || draftFailure) return;
    const name = scenarioName.trim();
    if (!name) {
      pageError = 'Enter a name for this saved plan.';
      return;
    }
    await runAction(async () => {
      const scenario = await scenarioService.create({
        name,
        monthlyBudgetMinor: parseMoneyInput(budgetInput)!,
        startMonth: draftStartMonth(selected.scenario.startMonth),
        algorithm: draftAlgorithm,
        sourceScenarioId: selected.scenario.id
      });
      await loadWorkspace(scenario.id);
      statusMessage = memoryOnly
        ? `${scenario.name} is available for this session.`
        : `${scenario.name} was saved on this device.`;
    });
  }

  async function renameSelected(): Promise<void> {
    if (!selected) return;
    await runAction(async () => {
      const renamed = await scenarioService.rename(selected.scenario.id, renameInput);
      await loadWorkspace(renamed.id);
      renaming = false;
      statusMessage = `Plan renamed to ${renamed.name}.`;
    });
  }

  async function refreshSelected(): Promise<void> {
    if (!selected) return;
    await runAction(async () => {
      const refreshed = await scenarioService.refresh(selected.scenario.id);
      await loadWorkspace(refreshed.id);
      statusMessage = `${refreshed.name} now uses your current balances.`;
    });
  }

  function openActivation(mode: ActivationMode, trigger: EventTarget | null): void {
    activationMode = mode;
    if (trigger instanceof HTMLButtonElement) activationTrigger = trigger;
  }

  async function closeActivation(): Promise<void> {
    activationMode = null;
    await tick();
    activationTrigger?.focus();
  }

  async function confirmActivation(): Promise<void> {
    if (!selected || !activationMode) return;
    const mode = activationMode;
    await runAction(async () => {
      const activated =
        mode === 'selected'
          ? await scenarioService.activate(selected.scenario.id)
          : await scenarioService.createAndActivate({
              name: scenarioName.trim() || 'Alternative plan',
              monthlyBudgetMinor: parseMoneyInput(budgetInput)!,
              startMonth: draftStartMonth(selected.scenario.startMonth),
              algorithm: draftAlgorithm,
              sourceScenarioId: selected.scenario.id
            });
      activationMode = null;
      await loadWorkspace(activated.id);
      statusMessage = `${activated.name} is now your active plan.`;
    });
  }

  function toggleMilestone(debtId: string): void {
    expandedDebtId = expandedDebtId === debtId ? null : debtId;
    schedulePage = 0;
  }

  function modal(node: HTMLDialogElement) {
    node.showModal();
    return {
      destroy() {
        if (node.open) node.close();
      }
    };
  }
</script>

<svelte:head><title>Plan | Debt Tracker</title></svelte:head>

<div class="page-stack plan-page">
  <section class="page-heading heading-row">
    <div>
      <p class="eyebrow">Saved payoff plans</p>
      <h1>Plan</h1>
      <p>Choose a saved plan, inspect its timeline, or compare a different monthly budget.</p>
    </div>
    {#if plans.length}<span class="plan-count"
        >{plans.length} saved {plans.length === 1 ? 'plan' : 'plans'}</span
      >{/if}
  </section>

  {#if pageError}<p class="form-error page-alert" role="alert">{pageError}</p>{/if}
  {#if statusMessage}<p class="success-message" role="status">{statusMessage}</p>{/if}

  {#if loading}
    <section class="timeline-shell loading-card" aria-label="Loading saved plans">
      Loading your saved plans…
    </section>
  {:else if !plans.length}
    <section class="empty-state" aria-labelledby="plan-empty-title">
      <span class="empty-icon"><Route size={27} aria-hidden="true" /></span>
      <h2 id="plan-empty-title">Add your first debt to build a payoff plan</h2>
      <p>Once setup is complete, your saved plans and payoff timeline will appear here.</p>
      <a class="button primary" href={resolve('/setup')}
        >Start setup <ArrowRight size={18} aria-hidden="true" /></a
      >
    </section>
  {:else if selected && selectedProjection}
    <div class="plan-workspace">
      <aside class="saved-plan-panel" aria-labelledby="saved-plans-title">
        <div class="saved-plan-heading">
          <div>
            <p class="eyebrow">Your scenarios</p>
            <h2 id="saved-plans-title">Saved plans</h2>
          </div>
          <Save size={19} aria-hidden="true" />
        </div>
        <div class="saved-plan-list">
          {#each plans as plan (plan.scenario.id)}
            <button
              type="button"
              class:active={plan.scenario.id === selectedId}
              aria-pressed={plan.scenario.id === selectedId}
              onclick={() => selectPlan(plan)}
            >
              <span class="saved-plan-name">{plan.scenario.name}</span>
              <span class="saved-plan-meta"
                >{formatMoney(plan.scenario.monthlyBudgetMinor, currency)} monthly</span
              >
              <span class="saved-plan-badges">
                {#if plan.scenario.id === activeScenarioId}<span class="active-badge"
                    ><CheckCircle2 size={13} aria-hidden="true" /> Active</span
                  >{/if}
                {#if plan.isStale}<span class="stale-badge"
                    ><AlertTriangle size={13} aria-hidden="true" /> Needs update</span
                  >{/if}
              </span>
            </button>
          {/each}
        </div>
      </aside>

      <div class="selected-plan-stack">
        <section class="selected-plan-header" aria-labelledby="selected-plan-title">
          <div>
            <p class="eyebrow">Selected plan</p>
            {#if renaming}
              <form
                class="rename-form"
                onsubmit={(event) => {
                  event.preventDefault();
                  void renameSelected();
                }}
              >
                <label for="plan-rename">Plan name</label>
                <div>
                  <input id="plan-rename" bind:value={renameInput} maxlength="80" required />
                  <button class="button primary" type="submit" disabled={saving}>Save name</button>
                  <button
                    class="icon-button"
                    type="button"
                    aria-label="Cancel rename"
                    onclick={() => (renaming = false)}><X size={17} aria-hidden="true" /></button
                  >
                </div>
              </form>
            {:else}
              <div class="selected-plan-title-row">
                <h2 id="selected-plan-title">{selected.scenario.name}</h2>
                <button
                  class="icon-button"
                  type="button"
                  aria-label={`Rename ${selected.scenario.name}`}
                  onclick={() => {
                    renameInput = selected.scenario.name;
                    renaming = true;
                  }}><Pencil size={16} aria-hidden="true" /></button
                >
              </div>
            {/if}
            <p>
              Starts {formatYearMonth(selected.scenario.startMonth)} · Saved snapshot with {selected
                .scenario.debtSnapshot.length} debts
            </p>
          </div>
          {#if selected.scenario.id === activeScenarioId}
            <span class="selected-active-state"
              ><CheckCircle2 size={16} aria-hidden="true" /> Active plan</span
            >
          {:else}
            <button
              class="button secondary"
              type="button"
              disabled={saving || selected.isStale}
              onclick={(event) => openActivation('selected', event.currentTarget)}
            >
              Make active plan
            </button>
          {/if}
        </section>

        {#if selected.isStale}
          <section class="stale-plan-notice" aria-labelledby="stale-plan-title">
            <AlertTriangle size={21} aria-hidden="true" />
            <div>
              <h2 id="stale-plan-title">This plan uses older balances</h2>
              <p>
                Its saved timeline stays unchanged until you choose to refresh it with current
                balances.
              </p>
            </div>
            <button
              class="button secondary"
              type="button"
              disabled={saving}
              onclick={refreshSelected}
              ><RefreshCw size={17} aria-hidden="true" /> Refresh current balances</button
            >
          </section>
        {/if}

        <section class="plan-summary-grid" aria-label="Selected plan summary">
          <article>
            <CalendarDays size={19} aria-hidden="true" /><span>Debt-free estimate</span><strong
              >{formatYearMonth(selectedProjection.debtFreeMonth)}</strong
            >
          </article>
          <article>
            <Clock3 size={19} aria-hidden="true" /><span>Monthly payments</span><strong
              >{selectedProjection.durationMonths}</strong
            >
          </article>
          <article>
            <CircleDollarSign size={19} aria-hidden="true" /><span>Projected interest</span><strong
              >{formatMoney(selectedProjection.totalInterestMinor, currency)}</strong
            >
          </article>
        </section>

        {#if draftProjection?.promotionImpacts.length}
          <PromotionImpactPanel
            impacts={draftProjection.promotionImpacts}
            {currency}
            algorithm={draftAlgorithm}
            disabled={saving || calculating || selected.isStale}
            onalgorithmchange={updateAlgorithm}
          />
        {/if}

        {#if interestWarnings.length}
          <section class="projection-warning-list" aria-labelledby="interest-warning-title">
            <AlertTriangle size={21} aria-hidden="true" />
            <div>
              <h2 id="interest-warning-title">Check upcoming interest</h2>
              <ul>
                {#each interestWarnings as warning (`${warning.code}-${warning.debtId ?? 'plan'}`)}
                  <li>{warning.message}</li>
                {/each}
              </ul>
            </div>
          </section>
        {/if}

        <section class="payoff-timeline" aria-labelledby="timeline-title">
          <div class="workspace-section-heading">
            <div>
              <p class="eyebrow">Payoff milestones</p>
              <h2 id="timeline-title">Timeline and monthly schedule</h2>
              <p>Select a milestone to inspect its amortization rows.</p>
            </div>
            <Flag size={21} aria-hidden="true" />
          </div>
          <ol class="milestone-list">
            {#each selectedProjection.milestones as milestone, index (milestone.debtId)}
              <li>
                <span class="milestone-marker" aria-hidden="true">{index + 1}</span>
                <article>
                  <button
                    class="milestone-toggle"
                    type="button"
                    aria-expanded={expandedDebtId === milestone.debtId}
                    aria-controls={`schedule-${milestone.debtId}`}
                    onclick={() => toggleMilestone(milestone.debtId)}
                  >
                    <span
                      ><strong>{milestone.name}</strong><small
                        >Projected paid off {formatYearMonth(milestone.payoffMonth)}</small
                      ></span
                    >
                    <span class="milestone-values">
                      <span
                        >Final payment <strong
                          >{formatMoney(milestone.finalPaymentMinor, currency)}</strong
                        ></span
                      >
                      <span
                        >Next debt gets <strong
                          >{formatMoney(milestone.nextTargetPaymentMinor, currency)}</strong
                        ></span
                      >
                    </span>
                    <ChevronDown size={19} aria-hidden="true" />
                  </button>
                  {#if expandedDebtId === milestone.debtId}
                    <div class="amortization-panel" id={`schedule-${milestone.debtId}`}>
                      <div class="table-scroll">
                        <table>
                          <caption>{milestone.name} monthly amortization</caption>
                          <thead
                            ><tr
                              ><th scope="col">Month</th><th scope="col">Opening</th><th scope="col"
                                >Interest</th
                              ><th scope="col">Payment</th><th scope="col">Closing</th></tr
                            ></thead
                          >
                          <tbody>
                            {#each visibleRows as row (row.month.month)}
                              {@const debt = row.debt!}
                              <tr
                                ><th scope="row">{formatYearMonth(row.month.month)}</th><td
                                  >{formatMoney(debt.openingBalanceMinor, currency)}</td
                                ><td>{formatMoney(debt.interestMinor, currency)}</td><td
                                  >{formatMoney(debt.paymentMinor, currency)}</td
                                ><td>{formatMoney(debt.closingBalanceMinor, currency)}</td></tr
                              >
                            {/each}
                          </tbody>
                        </table>
                      </div>
                      {#if pageCount > 1}
                        <nav
                          class="schedule-pagination"
                          aria-label={`${milestone.name} schedule pages`}
                        >
                          <button
                            class="icon-button"
                            type="button"
                            aria-label="Previous schedule page"
                            disabled={schedulePage === 0}
                            onclick={() => (schedulePage -= 1)}
                            ><ChevronLeft size={17} aria-hidden="true" /></button
                          >
                          <span
                            >Page {schedulePage + 1} of {pageCount} · {amortizationRows.length} months</span
                          >
                          <button
                            class="icon-button"
                            type="button"
                            aria-label="Next schedule page"
                            disabled={schedulePage >= pageCount - 1}
                            onclick={() => (schedulePage += 1)}
                            ><ChevronRight size={17} aria-hidden="true" /></button
                          >
                        </nav>
                      {/if}
                    </div>
                  {/if}
                </article>
              </li>
            {/each}
          </ol>
        </section>

        <section class="scenario-planner" aria-labelledby="planner-title">
          <div class="workspace-section-heading">
            <div>
              <p class="eyebrow">Try another budget</p>
              <h2 id="planner-title">Scenario planner</h2>
              <p>Inputs stay in memory until you save or activate the result.</p>
            </div>
            <Gauge size={21} aria-hidden="true" />
          </div>
          {#if selected.isStale}<p class="warning-note">
              Refresh this saved plan before comparing a new budget.
            </p>{/if}
          <div class="planner-split">
            <form class="planner-controls" onsubmit={(event) => event.preventDefault()}>
              <div class="field-group">
                <label for="planner-budget">Total monthly budget</label><input
                  id="planner-budget"
                  inputmode="decimal"
                  value={budgetInput}
                  disabled={selected.isStale}
                  aria-invalid={draftFailure?.code === 'INVALID_INPUT' ||
                    draftFailure?.code === 'INSUFFICIENT_BUDGET'}
                  oninput={(event) => updateBudget(event.currentTarget.value)}
                />
              </div>
              <div class="field-group">
                <label for="planner-extra">Extra payment above minimums</label><input
                  id="planner-extra"
                  inputmode="decimal"
                  value={extraInput}
                  disabled={selected.isStale}
                  oninput={(event) => updateExtra(event.currentTarget.value)}
                /><span class="field-hint"
                  >Minimum payments total {formatMoney(minimumBudgetMinor, currency)}.</span
                >
              </div>
              <div class="quick-increments" aria-label="Add to extra payment">
                {#each [2500, 5000, 10000] as amount (amount)}<button
                    type="button"
                    disabled={selected.isStale}
                    onclick={() => addExtra(amount)}>+{formatMoney(amount, currency)}</button
                  >{/each}
              </div>
              <div class="field-group">
                <label for="scenario-name">Saved plan name</label><input
                  id="scenario-name"
                  bind:value={scenarioName}
                  maxlength="80"
                  disabled={selected.isStale}
                />
              </div>
              {#if draftFailure}<p class="form-error planner-error" role="alert">
                  {draftFailure.message}
                </p>{/if}
              <div class="planner-actions">
                <button
                  class="button secondary"
                  type="button"
                  disabled={saving ||
                    calculating ||
                    !draftProjection ||
                    Boolean(draftFailure) ||
                    selected.isStale}
                  onclick={saveScenario}
                  ><Save size={17} aria-hidden="true" /> Save as scenario</button
                >
                <button
                  class="button primary"
                  type="button"
                  disabled={saving ||
                    calculating ||
                    !draftProjection ||
                    Boolean(draftFailure) ||
                    selected.isStale}
                  onclick={(event) => openActivation('draft', event.currentTarget)}
                  >Make active plan <ArrowRight size={17} aria-hidden="true" /></button
                >
              </div>
            </form>
            <div
              class="planner-results"
              role="region"
              aria-label="Live comparison"
              aria-live="polite"
              aria-busy={calculating}
            >
              <div class="planner-result-heading">
                <div>
                  <p class="eyebrow">Live comparison</p>
                  <h3>{calculating ? 'Calculating…' : 'Compared with selected plan'}</h3>
                </div>
                <Sparkles size={20} aria-hidden="true" />
              </div>
              {#if comparison && draftProjection}
                <dl class="comparison-list">
                  <div>
                    <dt>Debt-free date</dt>
                    <dd class="comparison-value">
                      {formatYearMonth(draftProjection.debtFreeMonth)}
                    </dd>
                    <dd class:better={comparison.debtFreeMonthDelta < 0} class="comparison-detail">
                      {comparison.debtFreeMonthDelta === 0
                        ? 'No change'
                        : `${Math.abs(comparison.debtFreeMonthDelta)} months ${comparison.debtFreeMonthDelta < 0 ? 'earlier' : 'later'}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Projected interest</dt>
                    <dd class="comparison-value">
                      {formatMoney(draftProjection.totalInterestMinor, currency)}
                    </dd>
                    <dd class:better={comparison.interestDeltaMinor < 0} class="comparison-detail">
                      {comparison.interestDeltaMinor === 0
                        ? 'No change'
                        : `${formatMoney(Math.abs(comparison.interestDeltaMinor), currency)} ${comparison.interestDeltaMinor < 0 ? 'less' : 'more'}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Monthly budget</dt>
                    <dd class="comparison-value">
                      {formatMoney(parseMoneyInput(budgetInput) ?? 0, currency)}
                    </dd>
                    <dd class="comparison-detail">Draft only until saved</dd>
                  </div>
                </dl>
              {/if}
              <p class="estimate-note">
                This plan is an estimate. Lenders may calculate interest and fees differently.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  {/if}
</div>

{#if activationMode && selected}
  <dialog
    use:modal
    class="activation-dialog"
    aria-labelledby="activation-title"
    oncancel={(event) => {
      event.preventDefault();
      void closeActivation();
    }}
  >
    <div class="activation-dialog-heading">
      <span><Target size={21} aria-hidden="true" /></span>
      <div>
        <p class="eyebrow">Confirmation required</p>
        <h2 id="activation-title">Make this your active plan?</h2>
      </div>
    </div>
    <p>
      {activationMode === 'selected'
        ? `${selected.scenario.name} will replace your current active plan.`
        : `${scenarioName.trim() || 'This scenario'} will be saved and replace your current active plan.`}
    </p>
    <p class="estimate-note">Your other saved plans will remain available.</p>
    <div class="confirmation-actions">
      <button class="button secondary" type="button" onclick={closeActivation}>Cancel</button
      ><button class="button primary" type="button" disabled={saving} onclick={confirmActivation}
        >{saving ? 'Saving…' : 'Make active plan'}</button
      >
    </div>
  </dialog>
{/if}
