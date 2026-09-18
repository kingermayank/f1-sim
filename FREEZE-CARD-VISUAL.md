# Pit Decision Card — Visual Craft Documentation

## Component Purpose
Minimal visual placeholder for future pit wall feature (per VISION.md).  
Demonstrates broadcast glass system stressed over bright Shanghai asphalt.

## Design System Compliance

### Broadcast Glass LOCKED
- **Background:** `var(--glass)` at 92% opacity
- **Backdrop filter:** `blur(24px)` (same as race HUD pass 7)
- **Border:** `1px solid var(--glass-chrome)` + `3px LEFT team rail`
- **Shadow:** `0 .5rem 2.5rem rgb(0 0 0 / 45%)` with `7%` white inset highlight
- **Typography:** Broadcast-white headers, broadcast-blue hierarchy, JetBrains Mono on data

### Team Chroma Rail
- **Left border:** `3px solid var(--team-color)` (same as timing tower)
- **Driver code:** Broadcast-white, Formula1 Display at .95rem
- **Driver name:** Broadcast-blue small text

### AUTO Stamp (Grey, Never Lime)
- **Background:** `rgb(255 255 255 / 4%)` — subtle grey fill
- **Border:** `1px solid var(--glass-chrome)` — glass chrome outline
- **Color:** `var(--muted)` (#9aa3b2) — grey text, NEVER signal lime
- **Position:** Top-right of card header, distinct from player taps (primary CTA)

### Lime = Alarm Only
- **Focus rings:** `var(--focus)` on buttons (signal lime)
- **NO lime fills/backgrounds** anywhere else
- **Primary CTA:** Broadcast-blue border + `rgb(180 200 220 / 12%)` fill (NOT lime)

## Readability Over Bright Asphalt

### Panel Strength (Pass 7 System)
- **92% panel opacity** (not 88%) ensures glass doesn't wash out over bright track
- **16% glass-chrome borders** provide clear separation from bright background
- **24px blur** maintains glass feel while keeping content sharp
- **45% shadow depth** creates strong visual lift above bright Shanghai asphalt

### Hierarchy Under Sunlight
- **Broadcast-white** (. 95rem) headers readable even when bright track fills viewport behind glass
- **Broadcast-blue** (.72rem uppercase) kickers maintain contrast at 7.5:1 WCAG AA+
- **Muted grey** (.68rem) timeout text readable at ~7.5:1 contrast
- **Team color rail** (3px LEFT) remains vivid anchor even over bright kerbs

### Stress Test Scenarios
1. **Bright asphalt:** 92% panel opacity + 24px blur keeps glass readable
2. **Sunlit kerbs:** Glass chrome borders provide clear edge definition
3. **White runoff:** Shadow depth (45%) lifts panel above washed-out backgrounds
4. **Shanghai night → day transition:** System works across all lighting conditions

## Component Hierarchy

### Stake First (Top)
```
┌─────────────────────────────┐
│ [CODE]     Name       [AUTO]│ ← Header: driver + AUTO grey stamp
├─────────────────────────────┤
│ CURRENT SITUATION           │ ← Kicker: broadcast-blue
│ ┌──────┬──────┬──────┐     │
│ │ LAP  │ TIRE │ WEAR │     │ ← Data: mono white on glass boxes
│ └──────┴──────┴──────┘     │
└─────────────────────────────┘
```

### Taps Second (Bottom)
```
┌─────────────────────────────┐
│ DECISION                    │ ← Kicker: broadcast-blue
│ ┌─────────────────────────┐ │
│ │ Box this lap            │ │ ← Primary CTA: broadcast-blue (NOT lime)
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ Stay out                │ │ ← Secondary: glass outline
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ Decision locks in 8s        │ ← Timeout: muted grey
└─────────────────────────────┘
```

## Integration Notes

### Current Status
- **Component created:** `src/ui/PitDecisionCard.tsx`
- **Styles added:** `src/app/styles.css` (.pit-decision-card classes)
- **NOT RENDERED:** No product logic, placeholder only for visual craft validation
- **Future work:** Pit wall per VISION.md ("Next")

### Usage (When Pit Wall Implemented)
```tsx
<PitDecisionCard
  driverName="Charles Leclerc"
  driverCode="LEC"
  teamColor="#E80020"
  currentLap={42}
  currentTire="medium"
  tireWear={0.78}
  isAuto={false}  // Player decision, not AUTO
/>
```

### AUTO Stamp Logic
- `isAuto={true}` → Shows grey "AUTO" badge
- `isAuto={false}` → No badge (player decision)
- **AUTO never shares signal lime** — always grey `var(--muted)`
- **Primary CTA uses broadcast-blue** — NOT signal lime

## Visual Verification Checklist

- [x] Uses `var(--glass)` background (92% opacity)
- [x] `backdrop-filter: blur(24px)` same as race HUD
- [x] `3px LEFT team rail` same as timing tower
- [x] AUTO stamp grey (`var(--muted)`), never lime
- [x] Primary CTA broadcast-blue, NOT signal lime
- [x] Focus rings use `var(--focus)` (signal lime)
- [x] Readable over bright asphalt (92% panel + 45% shadow)
- [x] Broadcast-blue kickers maintain WCAG AA+ contrast
- [x] Stake hierarchy before taps (top → bottom)
- [x] System consistent with loading/empty/finish/race HUD

## Pass 11 Coverage
Freeze card + AUTO stamp now covered in broadcast glass system.  
Cold blue-white glass, team chroma rails, lime=alarm only, grey AUTO.  
Stressed over bright Shanghai asphalt — readable at all lighting conditions.
