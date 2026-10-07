import { useState } from 'react';
import { planText, stepPosition } from '../lib/filamentPlan';
import type { FilamentPlan } from '../types/api';

/** Filament changes for printing the 3D export on a printer with a single extruder. */
export function FilamentPlanView({ plan }: { plan: FilamentPlan }) {
  const [copied, setCopied] = useState(false);
  const hasLayers = plan.steps.some((step) => step.layer !== null);

  const copy = () => {
    navigator.clipboard
      .writeText(planText(plan))
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <section className="filament-plan" aria-label="Filament changes">
      <div className="field__header">
        <span>Filament changes (single extruder)</span>
        <button type="button" className="link" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <ol>
        {plan.steps.map((step, index) => (
          <li key={`${step.z_mm}-${step.color}`}>
            <span className="swatch" style={{ background: step.color }} />
            {index === 0 ? (
              <span>
                Start with <code>{step.color}</code>
              </span>
            ) : (
              <span>
                {stepPosition(step)}: change to <code>{step.color}</code>
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="hint">
        Add a pause / filament change at these heights in the slicer; the print ends at{' '}
        {Number(plan.height_mm.toFixed(3))} mm.
        {!hasLayers && ' Set the printer layer height to see layer numbers.'}
      </p>
      {plan.conflicts.map((conflict) => (
        <p key={conflict.z_mm} className="field-error">
          {conflict.colors.join(', ')} all end at {Number(conflict.z_mm.toFixed(3))} mm, so filament
          changes cannot separate them. Give them different heights or use a multi-material printer
          (3MF).
        </p>
      ))}
    </section>
  );
}
