import type { FilamentPlan } from '../types/api';

type Step = FilamentPlan['steps'][number];

function millimetres(value: number): string {
  return `${Number(value.toFixed(3))} mm`;
}

/** Where a step starts: printer layer (when known) and height. */
export function stepPosition(step: Step): string {
  const z = `Z ${millimetres(step.z_mm)}`;
  return step.layer === null ? z : `Layer ${step.layer} · ${z}`;
}

/** Plain-text plan, e.g. to paste into print notes. */
export function planText(plan: FilamentPlan): string {
  const lines = plan.steps.map((step, index) =>
    index === 0 ? `Start with ${step.color}` : `${stepPosition(step)}: change to ${step.color}`,
  );
  lines.push(`Finish at ${millimetres(plan.height_mm)}`);
  for (const conflict of plan.conflicts) {
    lines.push(
      `Warning: ${conflict.colors.join(', ')} all end at ${millimetres(conflict.z_mm)} and need a multi-material printer`,
    );
  }
  return lines.join('\n');
}
