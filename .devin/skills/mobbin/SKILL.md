---
name: mobbin
description: Search Mobbin for UX/flow/pattern inspiration and apply it within HillGPX's existing design system
triggers:
  - user
allowed-tools:
  - read
  - grep
  - edit
  - mcp_call_tool
permissions:
  allow:
    - Read(src/**)
    - Read(public/**)
    - Read(index.html)
    - Write(src/**)
---

# Mobbin UX/flow reference skill

Use Mobbin only as a reference for better user flows, motion, button patterns, empty states, lists, dialogs, nav, and component micro-interactions. HillGPX already has its own design system; do not replace colors, fonts, or radii. Map every Mobbin insight back to the existing tokens and components.

## Prerequisite

The user must have run `devin mcp login mobbin` at least once so the Mobbin MCP server is reachable.

## Steps

1. Ask the user which screen, component, flow, or pattern needs inspiration (e.g., “venue detail page,” “route cards,” “empty state,” “filter dialog,” “onboarding flow,” “button hierarchy,” “transitions”).
2. Use `mcp_call_tool` with `server_name: mobbin`:
   - `search_screens` for single-screen references.
   - `search_flows` for multi-step interactions.
   - `search_sections` for page/section references.
3. Summarize the 2–4 most relevant results. Focus on:
   - Layout and information hierarchy
   - Spacing and rhythm
   - Button/input hierarchy and affordances
   - Motion and transition timing
   - Empty/error/loading states
   - Component patterns
4. Map the inspiration to HillGPX’s existing system:
   - Reuse existing components in `src/components/` and `src/map/`.
   - Use the existing CSS custom properties in `src/styles.css` for colors, spacing, shadows, and radii.
   - Preserve the existing header, list/map split, and shell conventions.
   - Add motion with CSS transitions/animations or MapLibre easing where appropriate; honor `prefers-reduced-motion`.
5. If the user wants a concrete change, implement it in the relevant React/TypeScript files.
6. After changes, run the validation commands and report failures:

   ```bash
   npm run typecheck
   npm run build
   ```

## Constraints

- Do not import a new component library or design system.
- Do not change the primary color palette, typography stack, or base radii unless the user explicitly requests a rebrand.
- Keep the map and list/map split behavior intact.
- Prefer small, focused edits over sweeping redesigns.
