# DOM/CSS mapping reference

OpenPencil maps browser-computed DOM/CSS styles into SceneGraph fields through `@open-pencil/dom-css`. Browser adapters should use native DOM/CSSOM and `getComputedStyle()` as the source of truth. Headless conversion is an approximation for tests and CLI usage.

## Layout

| CSS | SceneGraph | Notes |
|---|---|---|
| `display: flex` / `inline-flex` | `layoutMode` | `flex-direction: row` maps to horizontal; `column` maps to vertical. |
| `justify-content` | `primaryAxisAlign` | Supports start, center, end/flex-end, and space-between. |
| `align-items` | `counterAxisAlign` | Supports start, center, end/flex-end, stretch, and baseline. |
| `align-self` | `layoutAlignSelf` | Supports start, center, end/flex-end, stretch, and baseline. |
| `flex-wrap: wrap` | `layoutWrap: WRAP` | Counter-axis spacing is preserved when gaps are available. |
| `gap`, `row-gap`, `column-gap` | `itemSpacing`, `counterAxisSpacing` | Axis-aware: row and column gaps swap meaning for column flex direction. |
| `padding-*` | `paddingTop/Right/Bottom/Left` | Browser-computed physical values are preferred. |
| `position: absolute/fixed`, `left`, `right`, `top`, `bottom` | `layoutPositioning`, `x`, `y`, `horizontalConstraint`, `verticalConstraint` | Export pins a placed layer as its constraints do: `left`/`top` for Left and Top, `right`/`bottom` for Right and Bottom, `calc(50% ± n)` for Center, both edges without a size for Left and right, and percentages for Scale; an auto layout frame with absolutely placed layers is their containing block. Import reads each back into the constraint; browser-computed insets keep their pixel positions. |
| `overflow: hidden/clip` | `clipsContent` | Other overflow values are ignored. |
| `width`, `height`, min/max sizes | node size constraints | Browser-computed pixel values are preferred. |
| `aspect-ratio` | fallback width/height sizing | Used when one axis is available and the other is `auto`/missing. |

## Paint, stroke, and effects

| CSS | SceneGraph | Notes |
|---|---|---|
| `background-color` | solid fill | Transparent values are ignored. |
| `border-color`, `border-*-color` | stroke color | First available border color is used. |
| `border-width`, `border-*-width` | inside stroke, independent stroke weights, `strokesIncludedInLayout` | Side-specific widths set independent stroke weights. A border takes room, so its stroke is included in the layout, which Figma honors on auto layout frames. |
| `border-style: dashed/dotted` | `dashPattern` | Unsupported border styles fall back to solid. |
| `outline-width`, `outline-color`, `outline-style`, `outline-offset` | stroke | Read when there is no border. An outline takes no room. Its offset sets the alignment: `-weight` is inside, `-weight/2` is center, and `0` or more is outside. Dashed and dotted set `dashPattern`. |
| `border-radius`, `border-*-radius` | corner radii | Independent corners are preserved when sides differ. |
| `opacity` | node opacity | Numeric computed value. |
| `box-shadow` | drop and inner shadows, or a stroke | Each shadow in the list is an effect, except unblurred shadows of one color that draw a stroke when there is no border or outline. A ring spreads evenly, as Tailwind's `ring` and `inset-ring` do: inset is inside, outer is outside, and one of each as wide is centered. A band is moved straight off one side and sets that side's weight. |
| `<img src="data:...">` | image fill | Data URL images are stored in the graph image map. |
| `<img src="https://...">` | preserved source URL metadata | External URL fetching is not performed; the URL is retained for HTML round-trip. |
| `object-fit: contain/cover` | image `FIT` / `FILL` scale mode | `scale-down` maps to `FIT`; other object-fit values are not mapped yet. |

## Text

| CSS | SceneGraph | Notes |
|---|---|---|
| `color` | text fill | Uses core color parsing. |
| `font-family` | `fontFamily` | Uses first family token. |
| `font-size` | `fontSize` | Pixel/rem-ish numeric values. |
| `font-weight` | `fontWeight` | Numeric values. |
| `font-style: italic` | `italic` | Other styles ignored. |
| `line-height` | `lineHeight` | Numeric computed values; export writes Auto line height as `normal`, the font's own, or for a text that sizes to one line as the height the canvas lays that line out. |
| `letter-spacing` | `letterSpacing` | Numeric computed values; Tailwind export writes them as `tracking-[…]`, since Tailwind has no scale for them. |
| `text-align` | horizontal text alignment | Supports center, right, justified; defaults left. |
| `text-decoration-line` | underline / strikethrough | Decoration style/thickness are not mapped yet. |
| `text-transform` | `textCase` | Uppercase, lowercase, and capitalize map to SceneGraph text case. |
| `white-space: nowrap` | `maxLines = 1` | Other white-space values are not mapped yet. |
| `text-shadow` | drop shadow effect | Simple shadows only. |

## Export

HTML export, Tailwind HTML, and Tailwind JSX (`sceneNodesToTailwindJSX`) share one SceneGraph → CSS projection; Tailwind classes are derived from that CSS.

| SceneGraph | CSS | Notes |
|---|---|---|
| auto layout | `display: flex`, `flex-direction`, gaps, padding | Row direction is the default and is not written. |
| grid layout | `display: grid`, `grid-template-*`, gaps | Equal `1fr` tracks use `repeat(N, minmax(0, 1fr))`. |
| grid child position | `grid-column`, `grid-row`, `*-start` | Spans are written before starts. |
| `layoutGrow` in auto layout | `flex-grow: 1` | |
| rotation | `transform: rotate()` | Rotates around the element center. |
| drop and inner shadows | `box-shadow` | Every visible shadow; inner shadows use `inset`. |
| layer / background blur | `filter` / `backdrop-filter: blur()` | |
| right-to-left layout or text | `direction: rtl` | |
| section | `<section>` | |
| colors | hex, or `rgba()` when translucent | Tailwind export keeps a color off Tailwind v4's palette as its value, such as `bg-[#7C3AED]`, rather than the v4 shade of a v3 color. |

### Strokes

A layer's first visible stroke is drawn where the design draws it, and it takes no room unless the design gives it room. The canvas and Figma lay out a stroke only when it is an inside stroke that an auto layout frame includes in its layout. A CSS border always takes room: it would move content inward by the weight and narrow it by twice the weight.

| SceneGraph | CSS | Notes |
|---|---|---|
| stroke | `box-shadow` spread | Inside is `inset 0 0 0 <weight>`, outside is `0 0 0 <weight>`, and center is half of each. It follows corner radii, keeps weights under a pixel, paints beneath the layer's children as the canvas and Figma do, and leaves focus outlines alone. It sits beneath inner shadows and above drop shadows. Tailwind writes it as `shadow-[…]`. |
| independent stroke weights | `box-shadow` bands | Each side is a shadow moved off that side by its weight, such as `inset 0 1px 0 0` for a top inside stroke. Equal sides are one ring. |
| inside stroke included in an auto layout frame's layout (`strokesIncludedInLayout`) | `border`, `box-sizing: border-box` | Figma's included strokes behave like `border-box`: children sit inside the stroke on the canvas and in the export, and a hugging frame grows by the weights. A center or outside stroke never takes room, even when included, so it stays a shadow. |
| dashed stroke | `outline`, `outline-offset` | No shadow draws dashes. The offset is `-weight` inside, `-weight/2` center, and none outside. CSS dash lengths do not follow `dashPattern`, and an outline paints above the layer's children. Dashed independent weights are a border, which takes room, since neither an outline nor a shadow draws them. |
| stroke of an image or a shader layer | `outline`, `outline-offset` | The image or the shader's canvas would cover an inset shadow. Outside strokes stay shadows. Independent weights are a border. |
| line | `box-shadow: 0 0 0 <weight/2>` | A line has no inside or height: half the weight spreads to either side, and past the ends as a square cap would. A dashed line is its top border. |

## Browser-oracle but not mapped yet

These values are collected or covered by browser oracle tests but do not yet have a stable SceneGraph mapping:

- complex gradients
- CSS filters
- media-query-specific provenance
- pseudo-elements

## Headless limitations

The headless runtime uses maintained parsers for HTML (`parse5`) and stylesheets/inline declarations (`@acemir/cssom`), but still has limited approximations for selector matching, shorthand expansion, `calc()`, and simple shadows. Do not expand those with ad hoc parsers; prefer browser `getComputedStyle()` oracle coverage or maintained parser dependencies for new CSS behavior.
