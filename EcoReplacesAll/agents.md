# Agent Instructions for EcoReplacesAll

This workspace is only for the EcoReplaceAll page. Only make changes to files in the EcoReplacesAll
directory.

Do not touch the CIC-test-Archive-Charts directory. You can analyze it if needed, but do not make
any changes there.

You can use anything in SharedResources or any other directory for reference, but do not make any
changes outside EcoReplacesAll. If you need to amend a function in a SharedResources module, copy
it and create it in EcoReplacesAll. Exception: you may edit `SharedResources/eco-replacement-utils.js`
when required for this workspace.

Do not change any file that has a "v" suffix in its filename (versioned/archived files), for
example:
- EcoReplacesAll/mini-chart-renderer-v1.js
- EcoReplacesAll/mini-chart-debug-v1.html

The only file outside EcoReplacesAll you are allowed to edit is:
- system_docs/EcoDesignAll-reference.md
- SharedResources/eco-replacement-utils.js

You can also make any changes needed in the testing harness.

Never try an overlay fallback for the mini chart gridlines.

Planning Requests
When proposing plans, offer more than one option when possible, list pros/cons for each, and recommend which to pick with a brief rationale.

## Abbreviations used in this workspace
- FPS-All: Fireplaces & All Stoves
- AllDomComb: All Domestic Combustion
- Eco-rtb: Ecodesign - Ready To Burn
