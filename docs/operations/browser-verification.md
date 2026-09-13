# Browser verification — how a Dudo surface is actually rendered and checked

**Owner: Team Lead.** Written 2026-09-13, when the render loop was first established.

**This document exists because Milestone 1 reported *"nothing in the client pass has been rendered in
a browser"* eight times and closed it zero times.** Every client check up to that point was static:
the type checker, the CSS-existence check, the parser tests, the smoke test that proves the router
boots. **None of them opens a page.** The user's Milestone 2 instruction — *real browser rendering
from the beginning* — is what turned this from a known gap into a required instrument.

---

## 1. ⚠ `resize_window` REPORTS SUCCESS AND DOES NOTHING. MEASURED, NOT SUSPECTED.

**This is the first thing to know, because it is the failure that produces a confident false
report.**

```
resize_window(834 x 1112)  ->  "Successfully resized window containing tab … to 834x1112 pixels"

immediately after, in the page:
  innerWidth 1512   outerWidth 1512   visualViewport 1512   documentElement.clientWidth 1512
  matchMedia('(max-width: 834px)').matches  ->  FALSE
```

**Nothing moved. Not one of the five measurements.** The window was not maximised and not fullscreen
(`screen.availWidth` 2560 against an outer width of 1512), so the usual explanation does not apply.

> **A tool that returns a success string while doing nothing is `§11a`'s runner lesson in its purest
> form.** Had the success string been trusted, *"verified at iPad viewport"* would have been reported
> about a render that happened at 1512 pixels — **and the screenshot would have looked completely
> fine**, because a desktop render of a responsive page is not visibly broken. Nothing downstream
> would ever have contradicted it.

**Never report a viewport you have not read back from inside the page.** The check is one line:

```js
matchMedia('(max-width: 834px)').matches   // must be true before you believe anything
```

## 2. THE INSTRUMENT THAT WORKS: a same-origin iframe is a real CSS viewport

An iframe establishes its own viewport, and **media queries inside it evaluate against the iframe's
box**, not the window's. That makes it a genuine responsive-layout instrument rather than a
simulation.

```js
const f = document.createElement('iframe');
f.style.cssText =
  'position:fixed;top:0;left:0;width:834px;height:1112px;border:0;box-sizing:border-box;' +
  'z-index:2147483647;background:#fff;box-shadow:0 0 0 3px #c00';
f.src = location.origin + '/';           // same origin, so contentDocument is readable
document.body.appendChild(f);
await new Promise(r => { f.onload = r; setTimeout(r, 5000); });
```

**Measured result on `admin.dudo.work`:**

```
viewport 834 x 1112     exact834 true
matchMedia(max-width:834px)  TRUE      matchMedia(max-width:1024px)  TRUE
lang "ar"   dir "rtl"
scrollWidth 834  clientWidth 834   ->  no horizontal overflow at iPad width in Arabic RTL
```

**`border: 0` and `box-sizing: border-box` matter.** The first attempt used a 2px border and produced
an **830**-pixel viewport — a four-pixel error that would silently sit on the wrong side of a
breakpoint set at exactly 834. **Use the box-shadow for a visible frame outline; a border eats the
viewport.**

### 2a. WHAT THIS INSTRUMENT CANNOT SEE — named, because an unnamed limit is the one that bites

**An iframe gives a real CSS viewport. It does NOT give a device.** It does not emulate touch, the
device pixel ratio, a mobile user agent, safe-area insets, or the on-screen keyboard.

**So the honest question is whether the deployed CSS depends on any of those. Measured against the
shipped stylesheet rather than the source, because the source is Tailwind and the build decides:**

| Query in the deployed CSS | Faithful in the iframe? |
|---|---|
| `min-width` 40/48/64/80/96rem, `max-width` 55rem | **YES** — every width breakpoint is real |
| `prefers-reduced-motion: reduce` | **YES** — read from the OS, identical either way |
| **`@media(hover:hover)` — one occurrence** | **NO. This is the single blind spot.** |
| `pointer:` / `any-pointer:` | none present, so nothing to be wrong about |

> **`@media(hover:hover)` is Tailwind v4's DEFAULT wrapper for every `hover:` utility, so this is not
> a stray rule — it is how every hover style in the product is gated.** In the iframe it matches, as
> it does on a desktop. **On a real touch iPad it does not**, so anything reachable only through a
> hover affordance is unavailable there and **this instrument will show it working.**

**The instrument is therefore sound for layout, RTL, breakpoints, overflow, focus and keyboard, and
optimistic for hover-only affordances.** *A hover-only control is an accessibility defect on a touch
device regardless*, so the mitigation is a design rule rather than a better instrument: **no
affordance may be reachable only on hover.**

## 3. What the first render actually found, and why static checks could not

**Four untranslated strings on the Arabic sign-in page — the most-reviewed screen in the product —
and not one of them is a JSX text node:**

| String | Where it lives | Why every static pin missed it |
|---|---|---|
| `optional` ×2, on both field labels | composed at render time from a prop | **exists only in the DOM.** No source scan can reach it |
| `document.title` | `index.html` | `index.html` was in no scan population |
| two `<noscript>` sentences | `index.html` | same |

> **The translation pins reached zero and were honest about what zero meant: no `.tsx` file holds a
> text node the pattern recognises. That is all it could ever have meant.** A string that only exists
> after render is invisible to a source scan **by construction**, and `index.html` was never in any
> population at all.

**`ASCII`, `Dudo` and `English` were checked and are correct** — a technical term, a brand, and the
other language named in its own language.

### 3a. AND THE FIRST SCAN OF THE RENDER WAS ITSELF TOO NARROW

**A Latin-run scan over the Arabic page returned only `English` and `Dudo`. It missed `optional`,
which was visible in the screenshot on the same screen.** The separator is an **em dash**, outside
`\x20-\x7E`, so a leaf reading `— optional` failed an ASCII-range regex.

> **The screenshot and the scan disagreed, and the scan was nearly believed.** The instrument was
> narrower than its subject in a file whose entire subject is non-ASCII text. Fixed with a
> TreeWalker over text nodes matching Latin runs rather than an ASCII range.

**Which is the rule this whole document is an instance of: when a check and a rendering disagree,
the check is the thing to doubt first**, because the rendering is the artifact and the check is only
an opinion about it.

## 3b. ⚠ AN OVERFLOW CHECK THAT COMPARES `scrollWidth` TO `innerWidth` CANNOT FAIL

**Added 2026-09-13, and it is the most important line in this document.**

**Two instruments disagreed: the iframe measured 15px of horizontal overflow at 390 on every
settings route, in both languages, and the smoke harness reported clean with 77 passing
assertions.** The disagreement was reported **without naming a cause**, because either side could
have been the wrong one.

**The cause was in neither place anyone would look first.**

```
requested 390, mobile: true     innerWidth 421   scrollWidth 421   -> "clean"
requested 390, mobile: false    innerWidth 390   scrollWidth 420   -> +30px, the truth
```

> **WHEN CONTENT OVERFLOWS, THE LAYOUT VIEWPORT EXPANDS TO FIT IT.** So `innerWidth` grows with
> `scrollWidth`, **both sides of `scrollWidth <= innerWidth + 1` move together, and the assertion
> cannot fail at any width, in any language, ever.**

**It had been green on a real defect since it was written**, across every viewport it claimed to
cover, and the same shape was in use on a second responsive surface.

**This is `workflow.md` §11a's vacuity question with the answer yes:** *would this check pass against
an implementation that ignored its input entirely?* **Nothing about the output distinguished it from
a working check** — it named a viewport, it produced a number, and the number was internally
consistent.

**THE THREE REPAIRS, and the second is the general one:**

- **`mobile: false`** at every width-sensitive viewport, so the requested width is the width the page
  gets. **Mobile emulation is what lets the layout viewport float.**
- **READ THE VIEWPORT BACK FROM INSIDE THE PAGE AND ASSERT IT.** This document already says that
  about `resize_window`, which lies loudly by returning success. **The same rule was needed here for
  a quieter reason** — the harness did resize something, just not the thing the assertion depended
  on.
- **Compare against the width that was ASKED FOR, never against a value the page computes.**
  `scrollWidth <= 390` is a claim about the viewport under test. `scrollWidth <= innerWidth` is a
  claim about the page's agreement with itself, **and a page always agrees with itself.**

**The defect it had been hiding was ordinary and the arithmetic is worth keeping**, because it is
what a phone-width header costs:

```
wordmark 85 + transport badge 97 + language control 79 + sign-out 78 = 339
+ three 16px gaps + 32px padding                                     = 419   in a 390 viewport
```

**`flex` does not wrap by default**, so the last child hung off the inline-end edge — **the left in
Arabic, the right in English. Same overflow, opposite edge; the direction only decides where you see
it.** Fixed with `flex-wrap` and a narrower gap below `sm`, **not by hiding the transport badge** —
that badge is the only thing on screen saying whether a reader is looking at real data, and a phone
is not a less important place to know that.

> **AND THE PROCESS HALF: reporting the disagreement without diagnosing it was what made this
> findable.** *"Your check is wrong"* would have sent its author to harden a check whose logic was
> fine. **The finding was that the check's SUBJECT was unmeasurable, and only its author could see
> that** — from a candidate list that included *"is your 390 really 390"*.

## 4. ⚠ WHAT A LIVE CHECK STRUCTURALLY CANNOT COVER — and this is not a tooling gap

**Recorded 2026-09-13, before it could arrive as a surprise at the end of a milestone.**

**The agent driving the browser may never type a password, an API key or a token into any field.**
That is an absolute constraint on the operator, not a limitation of the instrument, and **no amount
of better tooling changes it.**

**The consequence is precise and it must not be rounded up:**

| Verifiable live, unauthenticated | Verifiable ONLY in the suite, never in production |
|---|---|
| the route serves and the shell renders | any authenticated screen's content |
| **unauthenticated access is REFUSED** — the single most valuable live check there is | members, invitations, roles, businesses, audit as an authenticated member sees them |
| the forbidden / expired / not-found states, if reachable without a session | **tenant A against tenant B**, which needs two authenticated principals |
| i18n, RTL, breakpoints, focus, keyboard, deep links | anything behind a permission decision |

> **So "live-verified" and "verified" are different claims about a tenant-administration surface, and
> a milestone report must say which one it is offering.** What a live pass establishes is that the
> surface is reachable, renders, and **refuses correctly**; what it cannot establish is that it
> *serves* correctly, because serving requires a session this operator must not create.

**The authenticated half is `qa-agent`'s and lands in `packages/testing/**`, against the suite —
which is the right home anyway**, since a behavioural tenant-isolation case needs two principals
constructed on purpose and production is exactly where you must not construct them
(`security.md` §6: synthetic data everywhere, regardless of what the environment is called).

**This is `workflow.md` §10's "gaps stated rather than rounded up" decided in advance instead of
discovered at hand-over** — and it is why *"ready for your testing"* is the honest phrase: **the
authenticated pass is the user's, and it always was.**

## 5. The loop

**Build a surface, say it is up, it gets rendered at desktop and iPad, in English and Arabic, and
the defects come back.** Required coverage per the user's instruction: **English and Arabic/RTL ·
desktop and iPad · loading, empty, error, forbidden, expired and not-found states · keyboard, focus
and Escape behaviour · and no fixture fallback in the deployed build.**

**A surface is rendered before it is reported, not after.**
