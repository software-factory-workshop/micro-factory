# Component choices and constraints

Use the installed `@software-factory-workshop/nuxt-adeo-ds/COMPONENTS.md` file for exact APIs. With npm it is normally under `node_modules/@software-factory-workshop/nuxt-adeo-ds/`. Read the file directly; it is documentation, not a JavaScript package export. Source reference: [COMPONENTS.md](https://github.com/software-factory-workshop/nuxt-adeo-ds/blob/main/COMPONENTS.md).

## Choose the right primitive

| Need | Use |
| --- | --- |
| Buttons, inputs, cards, alerts, tables, modal dialogs | Native Nuxt UI `U*` components with the ADEO theme |
| Search suggestions | `UInputMenu` |
| Searchable select popover | `USelectMenu` |
| Page title and actions | `AdeoPageHeader` with `title`, optional `description` and `actions` slot |
| Empty results | `AdeoEmptyState` with `title`, optional `description` and default action slot |
| Metric and trend | `AdeoStatCard` with `label`, `value`, optional `detail`, `evolution`, `direction` and semantic `color` |
| Date, password, phone, quantity | `AdeoDatePicker`, `AdeoPasswordInput`, `AdeoPhoneInput`, `AdeoQuantitySelector` |
| Option cards or segmented views | `AdeoOptionGroup`, `AdeoSegmentedControl` |
| Form steps and persistent actions | `AdeoStepper`, `AdeoStepperBar`, `AdeoActionBar` |
| Section or sidebar navigation | `AdeoBuiltInMenu`, `AdeoSidebar` with Nuxt UI `NavigationMenuItem[]` |

Other composed components are `AdeoHeading`, `AdeoHero`, `AdeoLink`, `AdeoFlag`, `AdeoTag`, `AdeoLoader`, `AdeoFileUpload` and `AdeoRating`. All 22 are auto-imported by the layer.

## Avoid common integration mistakes

- `AdeoDatePicker` binds a string and uses native browser date/time UI. It is not a calendar widget taking a JavaScript Date.
- `AdeoPhoneInput` keeps the national number in `v-model` and ISO country code in `v-model:country`. It does not validate or convert to E.164.
- `AdeoQuantitySelector` binds a number. Default minimum is 0 and step is 1.
- `AdeoFileUpload` binds `File[]`, emits `reject(message)`, and preserves accepted files after a rejection. It does not upload files. The application supplies an upload endpoint and server validation.
- `AdeoOptionGroup` binds a string for single selection or `string[]` with `multiple`. Items have `value`, `label` and optional `description`, `icon`, `disabled`.
- `AdeoSegmentedControl` binds a string. Connect that value to the displayed content; the component does not switch content itself.
- `AdeoStepper` uses a zero-based numeric model. The parent validates and advances. `AdeoStepperBar` takes a zero-based `step` and emits `previous`, `next`, `cancel`.
- `AdeoActionBar` announces `busy`; the caller disables action buttons while submitting.
- `AdeoTag` has separate link, selectable, removable and plain modes. Use one mode at a time. The selection model is boolean; removal emits `remove`.
- `AdeoRating` accepts integer input from 0 to 5. Fractional values are for read-only display.
- `AdeoHero` renders an h2. Place it below the page's h1. `AdeoPageHeader` renders h1 by default and accepts `level="2"` as a numeric prop via `:level="2"`.
- `AdeoStatCard` trend direction and semantic status are independent. An increase need not be positive.

For upstream component props, use the [Nuxt UI 4 documentation](https://ui.nuxt.com/docs/components) or installed type declarations. Vue component models use `modelValue` and `update:modelValue` unless a named model is specified.
