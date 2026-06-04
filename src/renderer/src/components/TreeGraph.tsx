/**
 * TreeGraph — reusable tree/graph guide-line component.
 *
 * Renders a row of visual "slots" (vertical lines, branch elbows, dots, etc.)
 * followed by arbitrary children content. Used by SessionSidebar and GitLogList.
 *
 * Faithfully reproduces the original SessionSidebar guide-line rendering,
 * including highlight overlay lines for continuous path visualization.
 */

export interface GuideEntry {
  type: 'line' | 'branch' | 'elbow' | 'slot' | 'dot'
  /** Primary color for lines, corners, and dots. Defaults to GRAY. */
  color?: string
  /** Only for 'branch': color of the continuation line below the branch corner. Defaults to GRAY. */
  continuationColor?: string
  /** Only for 'branch' and 'line': when true, draws a full-height blue overlay line on top */
  highlight?: boolean
  /** Only for 'branch' and 'line': color of the highlight overlay. Defaults to BLUE. */
  highlightColor?: string
  /** Only for 'dot': dot visual style */
  dotStyle?: 'filled' | 'outlined' | 'hollow'
  /** Only for 'dot': whether to draw a line from row top to dot center */
  hasLineAbove?: boolean
  /** Only for 'dot': color of the line above. Defaults to GRAY. */
  lineAboveColor?: string
  /** Only for 'dot': left position of the line above. Defaults to lineLeft. */
  lineAboveLeft?: number
  /** Only for 'dot': whether to draw a line below the dot (e.g. has expanded children) */
  hasLineBelow?: boolean
  /** Only for 'dot': color of the line below. Defaults to GRAY. */
  lineBelowColor?: string
  /** Only for 'dot': left position of the line below. Defaults to lineLeft. */
  lineBelowLeft?: number
}

export const TREE_DEFAULTS = {
  SLOT_W: 16,
  LINE_LEFT: 8,
  DOT_R: 3,
  GRAY: '#e5e7eb',
  BLUE: '#3b82f6',
} as const

interface TreeGraphRowProps {
  guides: GuideEntry[]
  slotWidth?: number
  lineLeft?: number
  dotRadius?: number
  children: React.ReactNode
}

function GuideLineSlot({
  color,
  highlight,
  highlightColor,
  slotWidth,
  lineLeft,
}: {
  color: string
  highlight: boolean
  highlightColor: string
  slotWidth: number
  lineLeft: number
}) {
  return (
    <div
      className="flex-shrink-0 relative pointer-events-none"
      style={{ width: slotWidth, alignSelf: 'stretch' }}
    >
      <div
        className="absolute"
        style={{ left: lineLeft, top: 0, bottom: 0, width: 1.5, backgroundColor: color }}
      />
      {highlight && (
        <div
          className="absolute"
          style={{ left: lineLeft, top: 0, bottom: 0, width: 1.5, backgroundColor: highlightColor }}
        />
      )}
    </div>
  )
}

function GuideBranchSlot({
  color,
  continuationColor,
  highlight,
  highlightColor,
  slotWidth,
  lineLeft,
  dotRadius,
}: {
  color: string
  continuationColor: string
  highlight: boolean
  highlightColor: string
  slotWidth: number
  lineLeft: number
  dotRadius: number
}) {
  return (
    <div
      className="flex-shrink-0 relative pointer-events-none overflow-visible"
      style={{ width: slotWidth, alignSelf: 'stretch' }}
    >
      {/* Vertical line above corner */}
      <div
        className="absolute"
        style={{ left: lineLeft, top: 0, height: `calc(50% - ${dotRadius}px)`, width: 1.5, backgroundColor: color }}
      />
      {/* Corner piece */}
      <div
        className="absolute"
        style={{
          left: lineLeft,
          top: `calc(50% - ${dotRadius}px)`,
          width: dotRadius,
          height: dotRadius,
          borderLeft: `1.5px solid ${color}`,
          borderBottom: `1.5px solid ${color}`,
          borderBottomLeftRadius: dotRadius,
        }}
      />
      {/* Horizontal line from corner to content */}
      <div
        className="absolute"
        style={{
          left: lineLeft + dotRadius,
          top: `calc(50% - 1.5px)`,
          width: slotWidth - lineLeft - dotRadius + 3,
          height: 1.5,
          backgroundColor: color,
        }}
      />
      {/* Continuation line below (parent line) */}
      <div
        className="absolute"
        style={{ left: lineLeft, top: '50%', bottom: 0, width: 1.5, backgroundColor: continuationColor }}
      />
      {/* Highlight overlay: full-height blue line on top of everything */}
      {highlight && (
        <div
          className="absolute"
          style={{ left: lineLeft, top: 0, bottom: 0, width: 1.5, backgroundColor: highlightColor }}
        />
      )}
    </div>
  )
}

function GuideElbowSlot({
  color,
  slotWidth,
  lineLeft,
  dotRadius,
}: {
  color: string
  slotWidth: number
  lineLeft: number
  dotRadius: number
}) {
  return (
    <div
      className="flex-shrink-0 relative pointer-events-none overflow-visible"
      style={{ width: slotWidth, alignSelf: 'stretch' }}
    >
      {/* Vertical line above corner */}
      <div
        className="absolute"
        style={{ left: lineLeft, top: 0, height: `calc(50% - ${dotRadius}px)`, width: 1.5, backgroundColor: color }}
      />
      {/* Corner piece */}
      <div
        className="absolute"
        style={{
          left: lineLeft,
          top: `calc(50% - ${dotRadius}px)`,
          width: dotRadius,
          height: dotRadius,
          borderLeft: `1.5px solid ${color}`,
          borderBottom: `1.5px solid ${color}`,
          borderBottomLeftRadius: dotRadius,
        }}
      />
      {/* Horizontal line from corner to content */}
      <div
        className="absolute"
        style={{
          left: lineLeft + dotRadius,
          top: `calc(50% - 1.5px)`,
          width: slotWidth - lineLeft - dotRadius + 3,
          height: 1.5,
          backgroundColor: color,
        }}
      />
    </div>
  )
}

function GuideSlotSpacer({ slotWidth }: { slotWidth: number }) {
  return (
    <div
      className="flex-shrink-0"
      style={{ width: slotWidth, alignSelf: 'stretch' }}
    />
  )
}

function DotSlot({
  color,
  dotStyle,
  hasLineAbove,
  lineAboveColor,
  lineAboveLeft,
  hasLineBelow,
  lineBelowColor,
  lineBelowLeft,
  slotWidth,
  dotRadius,
  defaultGray,
}: {
  color: string
  dotStyle: 'filled' | 'outlined' | 'hollow'
  hasLineAbove: boolean
  lineAboveColor: string
  lineAboveLeft: number
  hasLineBelow: boolean
  lineBelowColor: string
  lineBelowLeft: number
  slotWidth: number
  dotRadius: number
  defaultGray: string
}) {
  const size = dotRadius * 2 + 1 // e.g. 7px for R=3
  const borderWidth = 2

  const dotStyleCSS: React.CSSProperties =
    dotStyle === 'filled'
      ? { width: size, height: size, backgroundColor: color, border: `${borderWidth}px solid ${color}` }
      : dotStyle === 'hollow'
        ? { width: size, height: size, backgroundColor: defaultGray, border: `${borderWidth}px solid ${defaultGray}` }
        : { width: size, height: size, backgroundColor: 'white', border: `${borderWidth}px solid ${color}` }

  const isGroupHover = dotStyle === 'outlined'

  return (
    <div
      className={`flex-shrink-0 flex items-center justify-center relative ${isGroupHover ? 'group-hover:border-blue-500' : ''}`}
      style={{ width: slotWidth, alignSelf: 'stretch' }}
    >
      <div
        className="rounded-full flex-shrink-0"
        style={dotStyleCSS}
      />
      {hasLineAbove && (
        <div
          className="absolute"
          style={{
            left: lineAboveLeft,
            top: 0,
            height: `calc(50% - ${dotRadius + 2}px)`,
            width: 1.5,
            backgroundColor: lineAboveColor,
          }}
        />
      )}
      {hasLineBelow && (
        <div
          className="absolute"
          style={{
            left: lineBelowLeft,
            top: `calc(50% + ${dotRadius + 2}px)`,
            bottom: 0,
            width: 1.5,
            backgroundColor: lineBelowColor,
          }}
        />
      )}
    </div>
  )
}

/**
 * Renders one row of a tree/graph with guide lines and a content area.
 *
 * Usage:
 * ```tsx
 * <TreeGraphRow guides={[
 *   { type: 'line', color: '#e5e7eb' },
 *   { type: 'dot', color: '#3b82f6', dotStyle: 'filled', hasLineBelow: true },
 * ]}>
 *   <span>Node content here</span>
 * </TreeGraphRow>
 * ```
 */
export default function TreeGraphRow({
  guides,
  slotWidth = TREE_DEFAULTS.SLOT_W,
  lineLeft = TREE_DEFAULTS.LINE_LEFT,
  dotRadius = TREE_DEFAULTS.DOT_R,
  children,
}: TreeGraphRowProps) {
  const { GRAY, BLUE } = TREE_DEFAULTS

  return (
    <div className="flex items-center self-stretch">
      {guides.map((entry, i) => {
        const c = entry.color ?? GRAY
        const hc = entry.highlightColor ?? BLUE
        switch (entry.type) {
          case 'line':
            return (
              <GuideLineSlot
                key={i}
                color={c}
                highlight={entry.highlight ?? false}
                highlightColor={hc}
                slotWidth={slotWidth}
                lineLeft={lineLeft}
              />
            )
          case 'branch':
            return (
              <GuideBranchSlot
                key={i}
                color={c}
                continuationColor={entry.continuationColor ?? GRAY}
                highlight={entry.highlight ?? false}
                highlightColor={hc}
                slotWidth={slotWidth}
                lineLeft={lineLeft}
                dotRadius={dotRadius}
              />
            )
          case 'elbow':
            return <GuideElbowSlot key={i} color={c} slotWidth={slotWidth} lineLeft={lineLeft} dotRadius={dotRadius} />
          case 'slot':
            return <GuideSlotSpacer key={i} slotWidth={slotWidth} />
          case 'dot':
            return (
              <DotSlot
                key={i}
                color={c}
                dotStyle={entry.dotStyle ?? 'outlined'}
                hasLineAbove={entry.hasLineAbove ?? false}
                lineAboveColor={entry.lineAboveColor ?? GRAY}
                lineAboveLeft={entry.lineAboveLeft ?? lineLeft}
                hasLineBelow={entry.hasLineBelow ?? false}
                lineBelowColor={entry.lineBelowColor ?? GRAY}
                lineBelowLeft={entry.lineBelowLeft ?? lineLeft}
                slotWidth={slotWidth}
                dotRadius={dotRadius}
                defaultGray={GRAY}
              />
            )
          default:
            return null
        }
      })}
      <div className="flex-1 flex items-center min-w-0">{children}</div>
    </div>
  )
}

/**
 * Convert session sidebar ancestorLines to GuideEntry[] for TreeGraphRow.
 * Faithfully reproduces the original renderGuides() logic.
 */
export function sessionAncestorLinesToGuides(
  ancestorLines: { hasLine: boolean; highlight: boolean; branchActive: boolean }[],
): GuideEntry[] {
  const { GRAY, BLUE } = TREE_DEFAULTS
  const guides: GuideEntry[] = []

  for (let i = 0; i < ancestorLines.length; i++) {
    const entry = ancestorLines[i]
    const isConnector = i === ancestorLines.length - 1

    if (isConnector) {
      // Connector slot: branch (has sibling below) or elbow (last child)
      const color = entry.branchActive ? BLUE : GRAY
      const highlight = entry.highlight && !entry.branchActive
      if (entry.hasLine) {
        guides.push({ type: 'branch', color, continuationColor: GRAY, highlight })
      } else {
        guides.push({ type: 'elbow', color })
      }
    } else {
      // Ancestor slot: line or spacer
      if (entry.hasLine) {
        guides.push({ type: 'line', color: GRAY, highlight: entry.highlight && !entry.branchActive })
      } else {
        guides.push({ type: 'slot' })
      }
    }
  }

  return guides
}

/**
 * Convert session sidebar dot props to a GuideEntry for TreeGraphRow.
 * Faithfully reproduces the original DotSlot logic.
 */
export function sessionDotToGuide(props: {
  active: boolean
  hasChildren: boolean
  isExpanded: boolean
  highlight: boolean
  completed: boolean
}): GuideEntry {
  const { BLUE, GRAY, LINE_LEFT } = TREE_DEFAULTS
  const { active, hasChildren, isExpanded, highlight, completed } = props

  let dotStyle: 'filled' | 'outlined' | 'hollow'
  let color: string

  if (active) {
    dotStyle = 'filled'
    color = BLUE
  } else if (completed) {
    dotStyle = 'hollow'
    color = GRAY
  } else {
    dotStyle = 'outlined'
    color = GRAY // outlined uses gray border, group-hover turns blue via CSS
  }

  return {
    type: 'dot',
    color,
    dotStyle,
    hasLineBelow: hasChildren && isExpanded,
    lineBelowColor: highlight ? BLUE : GRAY,
    lineBelowLeft: LINE_LEFT, // match original: left: LINE_LEFT
  }
}
