import type { ThemeObj } from "@dueplanner/core/themes";
import { fz } from "./lib/textSize";

// The app's one stylesheet, built from the active theme and font and injected
// via <style>{css}</style> (see the `css` memo in HomeworkPlanner, which
// rebuilds it only when one of these values changes).
type CssTheme=Pick<ThemeObj,"bg"|"card"|"cardAlt"|"border"|"borderFaint"|"solidBorder"|"text"|"textMuted"|"light"|"accent">;
export function buildCss(T:CssTheme,F:{body:string}):string{
  return `
    /* No @import for the fonts here: an @import holds back every rule in this
       stylesheet until it has loaded, so on a slow connection the app showed
       unstyled for a moment (the hidden heading visible beside the wordmark,
       the layout stretched). index.html loads the fonts instead. */
    *{box-sizing:border-box;}
    /* Form controls don't inherit the page font by default -- without this, any
       button/input without an explicit fontFamily fell back to the system font. */
    button,input,select,textarea{font-family:inherit;}
    body{margin:0;background:${T.bg};transition:background 0.4s;font-family:${F.body};}
    html{background:${T.bg};}
    .app-shell{min-height:100svh;min-height:100dvh;}
    .tc{transition:all .2s ease-out;}
    /* Hover effects only where there's a real hover (mouse/trackpad) -- on touch
       screens :hover sticks after a tap, leaving cards stuck "lifted". */
    @media (hover:hover){
      .tc:hover{transform:translateY(-2px);filter:brightness(1.05);}
      .chip:hover{transform:scale(1.05);filter:brightness(1.1);}
    }
    /* Motion: everything that appears uses the Calendar tab's entrance or a close
       relative of it: 0.2s, ease-out, a few pixels of travel, no bounce or
       overshoot. .sec-body settles down from above (screens, dropdowns, panels),
       .pop rises from below (sheets and cards), .fade-in only fades (things
       positioned with their own transform, like toasts). State changes
       (hover, color, selection) use the same 0.2s ease-out. */
    .pop{animation:pop .2s ease-out forwards;}
    @keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    .fade-in{animation:fadeIn .2s ease-out;}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    .search-pop{animation:pop .2s ease-out backwards;}
    .sec-body{animation:secIn .2s ease-out;}
    @keyframes secIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
    .clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
    /* iOS zooms the page into any focused field under 16px. */
    /* Sliders: the bar in the accent color (white on dark, black on light) and
       the knob in the opposite one with an accent ring, so the two never match
       (the browser default paints both in one color). */
    .range{-webkit-appearance:none;appearance:none;background:transparent;height:26px;padding:0;}
    .range::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:${T.accent};}
    .range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;border-radius:50%;background:${T.light?"#ffffff":"#000000"};border:2px solid ${T.accent};margin-top:-9px;box-shadow:0 1px 4px rgba(0,0,0,0.35);}
    .range::-moz-range-track{height:4px;border-radius:999px;background:${T.accent};}
    .range::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:${T.light?"#ffffff":"#000000"};border:2px solid ${T.accent};box-shadow:0 1px 4px rgba(0,0,0,0.35);}
    @media (pointer:coarse){.edit-field{font-size:16px!important;}}
    /* iOS draws date/time inputs as its own pill with an intrinsic width that
       ignores width:100%, so side by side they spilled over each other. Plain
       appearance makes them size like the other fields; the min-height keeps
       an empty one from collapsing, and the value sits left like the rest. */
    .edit-field[type=date],.edit-field[type=time]{-webkit-appearance:none;appearance:none;display:block;min-width:0;max-width:100%;min-height:calc(1.25em + 18px);}
    .edit-field::-webkit-date-and-time-value{text-align:left;margin:0;}
    .chip{cursor:pointer;border:none;border-radius:999px;padding:7px 15px;font-family:'DM Mono',monospace;font-size:${fz(12)};transition:all .2s ease-out;}
    .chip:active{transform:scale(.97);}
    input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.6);}
    /* Keyboard focus ring. !important so it also beats the inline
       outline:none on inputs -- :focus-visible only matches keyboard focus
       (and text fields), so mouse and touch users don't see it on click. */
    :focus-visible{outline:2px solid ${T.accent}!important;outline-offset:2px;}
    .search-bar input:focus-visible{outline:none!important;}
    .search-bar:has(input:focus-visible){outline:2px solid ${T.accent};outline-offset:2px;}
    [data-selected]{outline:2px solid ${T.accent};outline-offset:-1px;}
    .sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
    /* Task titles are role="button" spans (so they can be reached and opened
       from the keyboard) that look like plain text. Declared before .strike so
       the strike-through line still applies. */
    .title-btn{all:unset;cursor:pointer;overflow-wrap:anywhere;}
    /* Completing a task: the check draws itself in on a little pop, and the
       title's strike-through draws left to right. .strike is a background line
       rather than text-decoration so it can animate; box-decoration-break
       repeats it on every line of a wrapped title. */
    .check-draw polyline{stroke-dashoffset:1;animation:checkDraw .36s .07s cubic-bezier(.65,0,.35,1) forwards;}
    @keyframes checkDraw{to{stroke-dashoffset:0}}
    .check-pop{animation:checkPop .25s ease-out;}
    @keyframes checkPop{0%{transform:scale(.7)}100%{transform:scale(1)}}
    .strike{text-decoration:none!important;background-image:linear-gradient(currentColor,currentColor);background-repeat:no-repeat;background-position:0 55%;background-size:100% 1.5px;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
    .strike-anim{animation:strikeDraw .42s .19s cubic-bezier(.65,0,.35,1) both;}
    @keyframes strikeDraw{from{background-size:0% 1.5px}}
    @media (prefers-reduced-motion:reduce){.check-draw polyline{animation:none;stroke-dashoffset:0;}.check-pop,.strike-anim,.search-pop,.sec-body,.pop,.fade-in{animation:none;}}
    /* Small controls (a check, a x, an arrow, a switch) were only as easy to
       press as they are big, so a tap had to land exactly on them. .hit keeps
       the control's size and look and adds an invisible margin that also
       counts as pressing it: --hit is how far it reaches past each edge (an
       inset, so negative). The second class narrows it where a neighbour is
       close, so the margin never covers another control. */
    .hit{position:relative;}
    .hit::after{content:"";position:absolute;inset:var(--hit,-10px);}
    .hit-sm{--hit:-6px;}
    .hit-tog{--hit:-8px -6px;}
    .hit-row{--hit:-5px -10px;}
    .hit-arrow{--hit:-2px -6px -2px -10px;}
    .hit-grip{--hit:-12px -3px -12px -12px;}
    .rb{font-family:'DM Mono',monospace;font-size:${fz(10)};font-weight:500;border-radius:999px;padding:2px 8px;}
    .tog{width:38px;height:20px;border-radius:999px;border:none;cursor:pointer;transition:background .2s ease-out;position:relative;flex-shrink:0;}
    .sl{font-family:'DM Mono',monospace;font-size:${fz(10)};letter-spacing:.08em;text-transform:uppercase;padding:10px 0 6px;}
    /* Room for the page scrollbar is kept whether or not it shows, so the page
       doesn't shift sideways when a list gets long enough to scroll, or when a
       sheet locks scrolling. */
    html{scrollbar-gutter:stable;}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.border};border-radius:99px}
    .pomo-ring{animation:ring 1s linear infinite;}
    @keyframes ring{from{stroke-dashoffset:0}to{stroke-dashoffset:283}}
    .app-inner{max-width:580px;margin:0 auto;padding:20px 14px;width:100%;box-sizing:border-box;}
    /* The sidebar. Off-screen (and out of the tab order) by default: on a narrow
       screen it's a drawer that slides in while .sb-drawer is set. From 900px up
       it's fixed in place unless folded away (.sb-folded), and the page makes
       room for it. --sb lets viewport-centered toasts center on the page instead. */
    .app-sidebar{position:fixed;top:0;left:0;bottom:0;z-index:300;width:260px;max-width:84vw;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;
      padding:calc(14px + env(safe-area-inset-top)) 10px calc(12px + env(safe-area-inset-bottom));background:${T.bg};border-right:1px solid ${T.solidBorder};
      overflow-y:auto;overscroll-behavior:contain;transform:translateX(-100%);visibility:hidden;transition:transform .2s ease-out,visibility 0s linear .2s;}
    .sb-drawer .app-sidebar{transform:none;visibility:visible;transition:transform .2s ease-out;box-shadow:0 0 40px rgba(0,0,0,.45);}
    .sb-backdrop{position:fixed;inset:0;z-index:299;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s ease-out;}
    .sb-drawer .sb-backdrop{opacity:1;pointer-events:auto;}
    .sb-row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;background:none;border:none;border-radius:8px;padding:9px 10px;cursor:pointer;text-align:left;
      color:${T.textMuted};font-family:${F.body};font-size:${fz(13)};transition:background .2s ease-out,color .2s ease-out;}
    .sb-row[aria-current="page"]{background:${T.card};color:${T.text};}
    .sb-row[aria-pressed="true"]{background:${T.card};color:${T.text};}
    .sb-task{padding:6px 10px;font-size:${fz(12)};gap:8px;}
    .sb-rule{height:1px;background:${T.borderFaint};margin:8px 10px;flex-shrink:0;}
    @media (hover:hover){.sb-row:hover{background:${T.cardAlt};color:${T.text};}}
    @media (min-width:900px){
      .app-inner{max-width:720px;padding:24px 28px;}
      .sb-backdrop{display:none;}
      .app-shell:not(.sb-folded){padding-left:260px;--sb:260px;}
      .app-shell:not(.sb-folded) .app-sidebar{transform:none;visibility:visible;transition:none;box-shadow:none;}
      .app-shell:not(.sb-folded) .sb-open-btn,.app-shell:not(.sb-folded) .timer-pill,.app-shell:not(.sb-folded) .screen-header{display:none!important;}
    }
    @media (max-width:600px){
      input,textarea{font-size:16px!important;}
    }
  `;
}
