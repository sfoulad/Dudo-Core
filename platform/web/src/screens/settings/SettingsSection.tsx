/**
 * One settings section, rendered from its registry entry.
 *
 * ===========================================================================
 * ONE SCREEN FOR TEN SECTIONS, AND THAT IS NOT A SHORTCUT
 * ===========================================================================
 *
 * Ten near-identical files, each rendering `NotBuiltYet` with different props,
 * is ten places to update when the "not built" wording changes and ten chances
 * for one of them to keep the old shape. **The differences between these
 * sections today are DATA — a title, a purpose, a contract path, a status, a
 * list of blockers — and data belongs in `lib/settings-sections.ts`, which is
 * already the single source the navigation and the route tree read.**
 *
 * It is also the shape `workflow.md` §9 exists to protect: ten near-identical
 * files is exactly the situation where a script starts to feel reasonable.
 * There is nothing to batch here.
 *
 * **WHEN A SECTION BECOMES REAL IT GETS ITS OWN FILE**, and the route tree
 * points at that instead. This screen is not extended to accommodate it — a
 * section with data has its own loading, empty, forbidden and failure states,
 * and folding those into a component whose whole job is to say *"there is no
 * data"* is how a broken screen comes to look merely quiet.
 *
 * **No override table is declared for that day**, deliberately: an empty
 * `Partial<Record<SectionId, ComponentType>>` is machinery nothing reaches, and
 * `workflow.md` §11a is clear that a branch nothing executes is a branch
 * nothing tests. The route tree names components directly; changing one line
 * there is the whole mechanism.
 */

import { NotBuiltYet } from '@/components/settings/NotBuiltYet';
import { findSection, type SectionId } from '@/lib/settings-sections';
import { useT } from '@/lib/i18n';

export function SettingsSection({ id }: { id: SectionId }) {
  const t = useT();
  const section = findSection(id);

  /*
   * THE INDEX HAS NO `data` RECORD AND MUST NOT REACH HERE. `SettingsOverview`
   * renders it. The throw is not defensive decoration: `findSection` is total
   * over the id union, so the only way to arrive here with `data === null` is a
   * route pointing the overview at this component — a mistake that would
   * otherwise render an empty definition list and read as a styling fault.
   */
  if (section.data === null) {
    throw new Error(
      `The settings section "${id}" carries no contract record, so it cannot be rendered as a ` +
        'not-built section. The index section is rendered by SettingsOverview.',
    );
  }

  return (
    <NotBuiltYet
      headingId={`settings-${id}`}
      title={t(section.titleKey)}
      purpose={t(section.purposeKey)}
      contract={section.data.contract}
      contractStatus={t(section.data.contractStatusKey)}
      blockedOn={section.data.blockedOnKeys.map((key) => t(key))}
      labels={{
        badge: t('notBuilt.badge'),
        nothing: t('notBuilt.nothing'),
        noRequest: t('notBuilt.noRequest'),
        contract: t('notBuilt.contract'),
        status: t('notBuilt.status'),
        waitingOn: t('notBuilt.waitingOn'),
        noneDrafted: t('notBuilt.noneDrafted'),
      }}
    />
  );
}
