/**
 * The directory's URL state, validated.
 *
 * ===========================================================================
 * THIS ZOD SCHEMA DOES NOT RESTATE A CONTRACT, AND THE DISTINCTION MATTERS
 * ===========================================================================
 *
 * ADR 0036 attaches a rule to Zod and ADR 0037 sharpens it: **a hand-written Zod
 * schema that restates a contract is the same defect as a hand-written type,
 * wearing a validator's clothes.** Contract shapes are `architecture-agent`'s
 * generator output; a client that authors its own copy is choosing to reproduce
 * `0034` — where the console sends `identifier` and the contract publishes
 * `target_identifier`, and it works because the client read the code.
 *
 * WHAT IS VALIDATED HERE IS NOT A CONTRACT SHAPE. It is this screen's own URL:
 * four query parameters that no Action has ever heard of, whose names are the
 * client's to choose, and which exist so that a filtered directory survives a
 * refresh, a bookmark and the Back button.
 *
 * THE ONE PLACE A CONTRACT VALUE APPEARS, IT IS IMPORTED RATHER THAN RETYPED.
 * `status` accepts exactly `STATUS_FILTERS`, which is the transcription that
 * already exists — so when `0037`'s generator replaces `src/contracts/**`, this
 * file follows it automatically instead of becoming a second, divergent list of
 * the same four strings. Retyping them here is precisely the duplication
 * `workflow.md` §12 records as producing five restatements that had drifted and
 * one that had not.
 *
 * ===========================================================================
 * `pending_deletion` IS ACCEPTED HERE AND WAS SILENTLY REWRITTEN BEFORE
 * ===========================================================================
 *
 * The hand-rolled router resolved the status by looking it up in the THREE TABS
 * the screen draws and falling back to `active` for anything else — so
 * `?status=pending_deletion`, a value the contract permits, showed the active
 * directory under a URL that said otherwise.
 *
 * It is accepted now: the schema takes every contract value and the tab strip
 * simply shows none of its three as pressed. A URL that says one thing and
 * displays another is the worse of the two behaviours, and the contract already
 * requires this client to tolerate a status it cannot produce.
 *
 * `.catch()` handles genuine rubbish — `?status=banana` — without throwing a
 * person out of the application over a mistyped address.
 */

import { z } from 'zod';
import { STATUS_FILTERS, type StatusFilter } from '@/contracts/customer-directory';

/**
 * EVERY FIELD IS OPTIONAL, INCLUDING `status`, AND THAT IS LOAD-BEARING RATHER
 * THAN LAZY.
 *
 * `status` was first written as `.default('active')`, which makes it REQUIRED in
 * the parsed output — and TanStack Router types `<Link search>` against that
 * output, so every link in the application then had to supply a complete search
 * object. The visible cost was `?status=active` welded onto every URL in the
 * console, including the plain unfiltered directory.
 *
 * Optional-plus-a-default-at-READ-time gives the same typed value where it is
 * used (`search.status ?? DEFAULT_STATUS`) and keeps the address bar honest:
 * a parameter appears when someone chose it, and not otherwise.
 */
export const customerListSearchSchema = z.object({
  /** The search term. Absent rather than empty when there is none, so a cleared box leaves no `?q=` behind. */
  q: z.string().optional(),
  status: z.enum(STATUS_FILTERS).optional().catch(undefined),
  business: z.string().optional(),
  /** An opaque cursor. Its meaning is the server's; this only carries it. */
  cursor: z.string().optional(),
});

export type CustomerListSearch = z.infer<typeof customerListSearchSchema>;

/** What an absent `status` means. The one place it is decided. */
export const DEFAULT_STATUS: StatusFilter = 'active';

/**
 * Drops the empty values so they never reach the address bar.
 *
 * `?q=&business=&cursor=` is three parameters saying nothing, and it makes two
 * identical directories look like two different pages — to a person reading the
 * URL, and to any cache keyed on it.
 */
export function tidySearch(search: CustomerListSearch): CustomerListSearch {
  const tidied: CustomerListSearch = {};
  if (search.q) tidied.q = search.q;
  if (search.status && search.status !== DEFAULT_STATUS) tidied.status = search.status;
  if (search.business) tidied.business = search.business;
  if (search.cursor) tidied.cursor = search.cursor;
  return tidied;
}
